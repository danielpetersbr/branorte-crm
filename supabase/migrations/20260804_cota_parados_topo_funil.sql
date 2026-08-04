-- ============================================================================
-- Parados no TOPO DO FUNIL por vendedor — PROSPECÇÃO + 2ª TENTATIVA + NOVO LEAD
--
-- "Parado" = última mensagem do chat há mais de 7 dias. Mesmo critério que o
-- Kanban usa na tela (src/lib/wa-funil.ts, temperaturaDe → 'parado').
--
-- A etiqueta é POR VENDEDOR: `label_ids` guarda IDs que só fazem sentido dentro
-- do catálogo daquele vendedor, por isso o join casa vendedor E id.
--
-- Normalização do nome da etapa: o catálogo NÃO é padronizado entre vendedores
-- (PEDRO usa "2O TENTATIVA" com O, não "2A"). Sem normalizar, o vendedor
-- escapa da cota só por escrever a etiqueta diferente.
-- ============================================================================
create or replace view public.vendor_parados_topo as
with etapa as (
  select e.vendedor_nome,
         e.etiqueta_id_wascript::text as id_txt,
         case
           when upper(e.etiqueta_nome_normalizado) like 'PROSPEC%'      then 'PROSPECCAO'
           when upper(e.etiqueta_nome_normalizado) ~ '^2[AO]?\s*TENTAT' then '2A TENTATIVA'
           when upper(e.etiqueta_nome_normalizado) like 'NOVO%LEAD%'    then 'NOVO LEAD'
         end as etapa
    from public.wascript_etiquetas e
),
chat as (
  select c.vendedor_nome,
         t.etapa,
         (now() - c.last_message_at) > interval '7 days' as parado,
         c.last_message_from_me
    from public.wa_chat_labels c
    join etapa t
      on t.vendedor_nome = c.vendedor_nome
     and t.id_txt = any(c.label_ids)
   where t.etapa is not null
     and c.last_message_at is not null
)
select vendedor_nome,
       count(*)                                        as total_topo,
       count(*) filter (where parado)                  as parados,
       count(*) filter (where parado and etapa = 'PROSPECCAO')   as parados_prospeccao,
       count(*) filter (where parado and etapa = '2A TENTATIVA') as parados_2a_tentativa,
       count(*) filter (where parado and etapa = 'NOVO LEAD')    as parados_novo_lead,
       -- Recorte que é inequivocamente do vendedor: o cliente falou por último
       -- e ninguém respondeu há mais de 7 dias.
       count(*) filter (where parado and last_message_from_me is false) as parados_devendo_resposta
  from chat
 group by 1;

revoke all on public.vendor_parados_topo from anon;
grant select on public.vendor_parados_topo to authenticated;
-- ============================================================================
-- COTA DE PARADOS no roteamento — 04/08/2026
--
-- Pedido do Daniel: vendedor com muito cliente PARADO no topo do funil
-- (PROSPECÇÃO + 2ª TENTATIVA + NOVO LEAD) recebe menos lead novo, e volta a
-- receber sozinho quando limpa.
--
-- Registro honesto: o estudo mostrou que essa métrica mede QUEM ETIQUETA, não
-- quem trabalha — arrastar card pra "NÃO RESPONDEU MAIS" zera a conta em
-- segundos. O Daniel foi avisado duas vezes e manteve a decisão. Implementado
-- como pedido, com dois amortecedores:
--   • RAMPA em vez de degrau: reduz gradual entre `verde` e `zero`, senão o
--     vendedor pisca entre 100% e 0% ao cruzar a linha.
--   • HISTERESE: quem foi cortado só volta abaixo de `zero * fator_volta`,
--     senão limpa 1 card, recebe enxurrada, e volta a estourar.
-- E um detector: `outbound_cota_estado` guarda quando cada um foi cortado e
-- quantos parados tinha, pra dar pra ver depois se alguém "limpou" rápido
-- demais logo após ser cortado — que é a assinatura da fuga.
--
-- Nasce DESLIGADO (cota_ativa=false): só observa e carimba.
-- ============================================================================

alter table public.outbound_rota_config
  add column if not exists cota_ativa    boolean not null default false,
  add column if not exists cota_verde    int     not null default 15,
  add column if not exists cota_zero     int     not null default 60,
  add column if not exists cota_volta    numeric not null default 0.8;

comment on column public.outbound_rota_config.cota_verde is
  'Até este número de parados o vendedor recebe 100%.';
comment on column public.outbound_rota_config.cota_zero is
  'A partir deste número não recebe mais lead novo. Entre verde e zero, decai linear.';
comment on column public.outbound_rota_config.cota_volta is
  'Histerese: quem foi cortado só volta a receber abaixo de cota_zero * este fator.';

-- Estado de corte, pra histerese e pra auditar o comportamento depois.
create table if not exists public.outbound_cota_estado (
  vendedor_nome     text primary key,
  cortado           boolean not null default false,
  cortado_em        timestamptz,
  parados_ao_cortar int,
  liberado_em       timestamptz,
  parados_ao_liberar int
);
revoke all on public.outbound_cota_estado from anon;
grant select on public.outbound_cota_estado to authenticated;

-- ---------------------------------------------------------------------------
-- Fator de vazão de um vendedor: 1 = recebe tudo, 0 = não recebe.
-- Aplica a rampa e respeita a histerese (consulta o estado de corte).
-- ---------------------------------------------------------------------------
create or replace function public.cota_fator(p_vendedor text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  cfg      record;
  n        int;
  primeiro text;
  est      record;
  limite   int;
begin
  select cota_ativa, cota_verde, cota_zero, cota_volta into cfg
    from outbound_rota_config where id = 1;
  if cfg is null or cfg.cota_ativa is not true then
    return 1;  -- cota desligada: ninguém é limitado
  end if;

  primeiro := upper(split_part(btrim(coalesce(p_vendedor,'')), ' ', 1));
  select coalesce(parados, 0) into n
    from vendor_parados_topo
   where upper(split_part(btrim(vendedor_nome),' ',1)) = primeiro;
  n := coalesce(n, 0);

  -- HISTERESE: quem já está cortado precisa cair BEM abaixo do teto pra voltar.
  -- Sem isso, limpa um card, volta a receber, estoura de novo — e fica piscando.
  select cortado into est from outbound_cota_estado
   where upper(split_part(btrim(vendedor_nome),' ',1)) = primeiro;
  limite := case when coalesce(est.cortado, false)
                 then floor(cfg.cota_zero * cfg.cota_volta)::int
                 else cfg.cota_zero end;

  if n >= limite then return 0; end if;
  if n <= cfg.cota_verde then return 1; end if;
  return round(((cfg.cota_zero - n)::numeric / nullif(cfg.cota_zero - cfg.cota_verde, 0)), 3);
end;
$$;

revoke all on function public.cota_fator(text) from anon;
grant execute on function public.cota_fator(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Marca/desmarca o corte. Chamado pelo trigger, barato (só escreve na virada).
-- ---------------------------------------------------------------------------
create or replace function public.cota_sincronizar_estado()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cfg record;
  r   record;
  lim int;
begin
  select cota_verde, cota_zero, cota_volta into cfg from outbound_rota_config where id = 1;
  for r in select p.vendedor_nome, p.parados,
                  coalesce(e.cortado, false) as cortado
             from vendor_parados_topo p
             left join outbound_cota_estado e
               on upper(split_part(btrim(e.vendedor_nome),' ',1))
                = upper(split_part(btrim(p.vendedor_nome),' ',1))
  loop
    lim := case when r.cortado then floor(cfg.cota_zero * cfg.cota_volta)::int else cfg.cota_zero end;
    if r.parados >= lim and not r.cortado then
      insert into outbound_cota_estado (vendedor_nome, cortado, cortado_em, parados_ao_cortar)
      values (r.vendedor_nome, true, now(), r.parados)
      on conflict (vendedor_nome) do update
        set cortado = true, cortado_em = now(), parados_ao_cortar = excluded.parados_ao_cortar;
    elsif r.parados < lim and r.cortado then
      update outbound_cota_estado
         set cortado = false, liberado_em = now(), parados_ao_liberar = r.parados
       where vendedor_nome = r.vendedor_nome;
    end if;
  end loop;
end;
$$;
-- Trigger de roteamento v2: agora além de "está ligado?" pergunta também
-- "está dando conta?". Continuidade continua sendo a primeira regra e nada a
-- sobrepõe — cliente que já é de um vendedor vai pra ele mesmo cortado.
create or replace function public.outbound_rotear()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  cfg       record;
  primeiro  text;
  st        record;
  desligado boolean := false;
  fator     numeric := 1;
  estourou  boolean := false;
  dono      text;
  fone_norm text;
  escolhido text;
  total_rec int;
  pn_orig   text;
  pn_novo   text;
  trocou    boolean := false;
  motivo    text := 'mantido';
  n_parados int;
begin
  select ativo, cota_ativa, cota_verde, cota_zero into cfg
    from outbound_rota_config where id = 1;

  primeiro := upper(split_part(btrim(coalesce(new.vendedor_nome,'')),' ',1));
  if primeiro = '' then return new; end if;

  select s.online, s.bloqueado, s.share_percent into st
    from vendor_dispatch_status s
   where upper(split_part(btrim(s.vendedor_nome),' ',1)) = primeiro limit 1;
  desligado := st is not null and (st.online is not true or st.bloqueado is true
                                   or coalesce(st.share_percent,0) <= 0);

  -- Estado da cota de parados do destino pretendido.
  if coalesce(cfg.cota_ativa,false) then
    perform cota_sincronizar_estado();
    fator := cota_fator(primeiro);
    estourou := (fator = 0);
  end if;
  select parados into n_parados from vendor_parados_topo
   where upper(split_part(btrim(vendedor_nome),' ',1)) = primeiro;

  -- CONTINUIDADE — primeira regra, nada sobrepõe. Nem cota, nem toggle.
  fone_norm := fn_norm_fone_br(new.cliente_telefone);
  if fone_norm is not null and length(fone_norm) >= 10 then
    select d.vendedor_nome into dono from outbound_dispatch d
     where d.cliente_telefone_norm = fone_norm and d.status <> 'skipped'
       and d.created_at >= now() - interval '30 days'
     order by d.created_at desc limit 1;
  end if;
  if dono is not null then
    motivo := case when upper(split_part(btrim(dono),' ',1)) = primeiro
                   then 'continuidade' else 'continuidade_outro_dono' end;
  end if;

  -- REENCAMINHA se: desligado no painel OU estourou a cota de parados.
  if (desligado or estourou) and dono is null then
    select count(*) into total_rec from outbound_dispatch
     where status <> 'skipped' and created_at >= now() - interval '2 days';

    -- Elegíveis = ligados no painel E com fator de cota > 0. O peso usado no
    -- déficit é share * fator: quem está no meio da rampa recebe menos, não zero.
    select e.vendedor_nome into escolhido from (
      select s.vendedor_nome,
             (s.share_percent * cota_fator(s.vendedor_nome)) as peso,
             coalesce((select count(*) from outbound_dispatch o
                        where o.status <> 'skipped'
                          and o.created_at >= now() - interval '2 days'
                          and upper(split_part(btrim(o.vendedor_nome),' ',1))
                              = upper(split_part(btrim(s.vendedor_nome),' ',1))),0)::numeric
               / nullif(total_rec,0) as atual
        from vendor_dispatch_status s
       where s.online is true and s.bloqueado is not true
         and coalesce(s.share_percent,0) > 0
         and cota_fator(s.vendedor_nome) > 0
    ) e
     where e.peso > 0
     order by ((e.peso / nullif(sum(e.peso) over (),0)) - coalesce(e.atual,0)) desc, e.vendedor_nome
     limit 1;

    if escolhido is not null then
      motivo := case when estourou and not desligado then 'cota_estourada_de_' || primeiro
                     when estourou and desligado     then 'desligado_e_cota_' || primeiro
                     else 'reencaminhado_de_' || primeiro end;
      if coalesce(cfg.ativo,false) then
        pn_orig := split_part(btrim(new.vendedor_nome),' ',1);
        pn_novo := initcap(split_part(btrim(escolhido),' ',1));
        if new.mensagem is not null and pn_orig <> '' then
          new.mensagem := regexp_replace(new.mensagem,
            '((?:aqui\s+é|\msou|quem\s+fala\s+é|é)\s+[oa]\s+)' || pn_orig || '\M',
            '\1' || pn_novo, 'gi');
          trocou := true;
        end if;
        new.vendedor_nome := escolhido;
      end if;
    else
      -- TODOS estourados ou desligados: mantém o original. Lead parado é ruim;
      -- lead que some é pior, e uma equipe inteira no teto não pode travar a entrada.
      motivo := case when estourou then 'todos_no_teto' else 'sem_ninguem_ligado' end;
    end if;
  end if;

  new.raw_payload := coalesce(new.raw_payload,'{}'::jsonb) || jsonb_build_object(
    '_sentinela', jsonb_build_object(
      'em', now(), 'ativo', coalesce(cfg.ativo,false), 'cota_ativa', coalesce(cfg.cota_ativa,false),
      'origem_vendedor', primeiro, 'no_painel', st is not null, 'online', st.online,
      'desligado', desligado, 'parados_origem', n_parados, 'fator_cota', fator,
      'estourou_cota', estourou, 'dono', dono, 'motivo', motivo,
      'destino', new.vendedor_nome, 'assinatura_trocada', trocou));
  return new;
end; $$;
