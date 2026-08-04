-- ============================================================================
-- ROTEAMENTO NO BANCO — "vendedor desligado não recebe lead"
-- 04/08/2026
--
-- POR QUE AQUI E NÃO NO CÓDIGO
-- O gate existe no /api/leads/dispatch desde 24/06 e está correto. Só que quem
-- roteia de verdade não passa por lá: um deploy às 11:33 de hoje, que carimba
-- `_rota` em TODO dispatch, não apareceu em nenhum lead das 14:06, 14:07 e
-- 14:12 — enquanto o carimbo `_assinatura`, de um deploy de 28/07, aparece.
-- Quem chama está preso numa URL de deploy congelada.
--
-- Somando: 5 endpoints escrevem nesta tabela, 2 sem gate nenhum, mais um caller
-- externo numa versão velha. Consertar o gate em cada um deixou furo três vezes
-- (junho, julho, agora). O INSERT é o único ponto por onde todos passam.
--
-- O QUE FAZ
--   1. Continuidade é inquebrável: cliente que já é de um vendedor vai pra ele,
--      mesmo desligado. É a regra do dono, e ela vem antes de tudo.
--   2. Fora isso, se o vendedor está desligado no painel (online=false,
--      bloqueado, ou fatia zero), o lead é REENCAMINHADO para quem está ligado.
--   3. Escolhe por maior déficit de cota (mesma lógica do route.ts): alvo =
--      share normalizado, atual = recebidos na janela recente.
--   4. Troca o primeiro nome na APRESENTAÇÃO da mensagem ("aqui é o X"), senão
--      o cliente recebe texto assinado por quem não vai atendê-lo. Só na
--      apresentação — troca global renomearia o próprio cliente.
--   5. Se NINGUÉM estiver ligado, mantém o original e carimba alerta. Lead
--      parado é ruim; lead perdido é pior.
--
-- COMO DESLIGAR (sem deploy, efeito imediato):
--   update outbound_rota_config set ativo = false;
-- Com ativo=false o trigger só observa e carimba, não muda nada.
-- ============================================================================

create table if not exists public.outbound_rota_config (
  id            smallint primary key default 1 check (id = 1),
  ativo         boolean not null default false,
  atualizado_em timestamptz not null default now(),
  nota          text
);
insert into public.outbound_rota_config (id, ativo, nota)
values (1, false, 'nasce DESLIGADO: liga só depois de ver a sentinela carimbando')
on conflict (id) do nothing;

revoke all on public.outbound_rota_config from anon;
grant select on public.outbound_rota_config to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.outbound_rotear()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cfg_ativo  boolean := false;
  primeiro   text;
  st         record;
  desligado  boolean := false;
  dono       text;
  escolhido  text;
  total_rec  int;
  pn_orig    text;
  pn_novo    text;
  trocou     boolean := false;
  motivo     text := 'mantido';
begin
  select ativo into cfg_ativo from outbound_rota_config where id = 1;

  primeiro := upper(split_part(btrim(coalesce(new.vendedor_nome, '')), ' ', 1));
  if primeiro = '' then
    return new;
  end if;

  select s.online, s.bloqueado, s.share_percent into st
    from vendor_dispatch_status s
   where upper(split_part(btrim(s.vendedor_nome), ' ', 1)) = primeiro
   limit 1;

  -- Sem registro no painel = não bloqueia (fail-open, igual ao código).
  desligado := st is not null
               and (st.online is not true or st.bloqueado is true
                    or coalesce(st.share_percent, 0) <= 0);

  -- ---- CONTINUIDADE (regra do dono, vem antes de tudo) --------------------
  -- Cliente despachado nos últimos 30 dias a um vendedor que ainda está ativo
  -- pertence a ele. Nem o reencaminhamento pode tirar. Variantes de 9º dígito
  -- porque o mesmo cliente aparece com 12 e 13 dígitos.
  select d.vendedor_nome into dono
    from outbound_dispatch d
   where d.status <> 'skipped'
     and d.created_at >= now() - interval '30 days'
     and regexp_replace(coalesce(d.cliente_telefone_norm, d.cliente_telefone), '\D', '', 'g') in (
           regexp_replace(coalesce(new.cliente_telefone_norm, new.cliente_telefone), '\D', '', 'g'),
           -- sem o 9
           regexp_replace(coalesce(new.cliente_telefone_norm, new.cliente_telefone), '\D', '', 'g'),
           -- com o 9 (quando vier com 12 dígitos)
           case when length(regexp_replace(coalesce(new.cliente_telefone_norm, new.cliente_telefone), '\D','','g')) = 12
                then left(regexp_replace(coalesce(new.cliente_telefone_norm, new.cliente_telefone), '\D','','g'), 4)
                     || '9'
                     || substr(regexp_replace(coalesce(new.cliente_telefone_norm, new.cliente_telefone), '\D','','g'), 5)
           end)
   order by d.created_at desc
   limit 1;

  if dono is not null and upper(split_part(btrim(dono), ' ', 1)) <> primeiro then
    motivo := 'continuidade_outro_dono';
  elsif dono is not null then
    motivo := 'continuidade';
  end if;

  -- ---- REENCAMINHAMENTO ---------------------------------------------------
  if desligado and dono is null then
    -- Elegíveis: ligados no painel. Escolhe o de MAIOR DÉFICIT de cota
    -- (alvo = share normalizado; atual = fatia recebida na janela recente).
    select count(*) into total_rec
      from outbound_dispatch
     where status <> 'skipped' and created_at >= now() - interval '2 days';

    select e.vendedor_nome into escolhido
      from (
        select s.vendedor_nome,
               s.share_percent / nullif(sum(s.share_percent) over (), 0) as alvo,
               coalesce((select count(*) from outbound_dispatch o
                          where o.status <> 'skipped'
                            and o.created_at >= now() - interval '2 days'
                            and upper(split_part(btrim(o.vendedor_nome),' ',1))
                                = upper(split_part(btrim(s.vendedor_nome),' ',1))), 0)::numeric
                 / nullif(total_rec, 0) as atual
          from vendor_dispatch_status s
         where s.online is true and s.bloqueado is not true
           and coalesce(s.share_percent, 0) > 0
      ) e
     order by (coalesce(e.alvo,0) - coalesce(e.atual,0)) desc, e.vendedor_nome
     limit 1;

    if escolhido is not null then
      motivo := 'reencaminhado_de_' || primeiro;
      if cfg_ativo then
        pn_orig := split_part(btrim(new.vendedor_nome), ' ', 1);
        pn_novo := initcap(split_part(btrim(escolhido), ' ', 1));
        -- Troca SÓ na apresentação. Global renomearia o cliente em "Olá, Lucas!".
        if new.mensagem is not null and pn_orig <> '' then
          new.mensagem := regexp_replace(
            new.mensagem,
            '((?:aqui\s+é|\msou|quem\s+fala\s+é|é)\s+[oa]\s+)' || pn_orig || '\M',
            '\1' || pn_novo, 'gi');
          trocou := true;
        end if;
        new.vendedor_nome := escolhido;
      end if;
    else
      motivo := 'sem_ninguem_ligado';
    end if;
  end if;

  new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb) || jsonb_build_object(
    '_sentinela', jsonb_build_object(
      'em', now(),
      'ativo', cfg_ativo,
      'origem_vendedor', primeiro,
      'no_painel', st is not null,
      'online', st.online,
      'share', st.share_percent,
      'desligado', desligado,
      'dono', dono,
      'motivo', motivo,
      'destino', new.vendedor_nome,
      'assinatura_trocada', trocou,
      'tem_rota', (new.raw_payload ? '_rota')
    ));
  return new;
end;
$$;

drop trigger if exists trg_outbound_sentinela on public.outbound_dispatch;
drop trigger if exists trg_outbound_rotear on public.outbound_dispatch;
create trigger trg_outbound_rotear
  before insert on public.outbound_dispatch
  for each row execute function public.outbound_rotear();
-- FIX 04/08: a busca do dono montava variantes de 9º dígito na mão e não batia
-- com o que a tabela guarda. `cliente_telefone_norm` é coluna GERADA por
-- fn_norm_fone_br() — que já resolve DDI, DDD e 9º dígito. Usar a mesma função
-- é o único jeito de comparar maçã com maçã. Detectado em teste: continuidade
-- devolvia dono=null e o trigger teria reencaminhado cliente que já tem dono.
create or replace function public.outbound_rotear()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  cfg_ativo boolean := false;
  primeiro  text;
  st        record;
  desligado boolean := false;
  dono      text;
  fone_norm text;
  escolhido text;
  total_rec int;
  pn_orig   text;
  pn_novo   text;
  trocou    boolean := false;
  motivo    text := 'mantido';
begin
  select ativo into cfg_ativo from outbound_rota_config where id = 1;
  primeiro := upper(split_part(btrim(coalesce(new.vendedor_nome,'')),' ',1));
  if primeiro = '' then return new; end if;

  select s.online, s.bloqueado, s.share_percent into st
    from vendor_dispatch_status s
   where upper(split_part(btrim(s.vendedor_nome),' ',1)) = primeiro limit 1;
  desligado := st is not null and (st.online is not true or st.bloqueado is true
                                   or coalesce(st.share_percent,0) <= 0);

  -- CONTINUIDADE — mesma normalização da coluna gerada, sem variante manual.
  fone_norm := fn_norm_fone_br(new.cliente_telefone);
  if fone_norm is not null and length(fone_norm) >= 10 then
    select d.vendedor_nome into dono
      from outbound_dispatch d
     where d.cliente_telefone_norm = fone_norm
       and d.status <> 'skipped'
       and d.created_at >= now() - interval '30 days'
     order by d.created_at desc limit 1;
  end if;

  if dono is not null then
    motivo := case when upper(split_part(btrim(dono),' ',1)) = primeiro
                   then 'continuidade' else 'continuidade_outro_dono' end;
  end if;

  if desligado and dono is null then
    select count(*) into total_rec from outbound_dispatch
     where status <> 'skipped' and created_at >= now() - interval '2 days';
    select e.vendedor_nome into escolhido from (
      select s.vendedor_nome,
             s.share_percent / nullif(sum(s.share_percent) over (),0) alvo,
             coalesce((select count(*) from outbound_dispatch o
                        where o.status <> 'skipped'
                          and o.created_at >= now() - interval '2 days'
                          and upper(split_part(btrim(o.vendedor_nome),' ',1))
                              = upper(split_part(btrim(s.vendedor_nome),' ',1))),0)::numeric
               / nullif(total_rec,0) atual
        from vendor_dispatch_status s
       where s.online is true and s.bloqueado is not true and coalesce(s.share_percent,0) > 0
    ) e order by (coalesce(e.alvo,0)-coalesce(e.atual,0)) desc, e.vendedor_nome limit 1;

    if escolhido is not null then
      motivo := 'reencaminhado_de_' || primeiro;
      if cfg_ativo then
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
      motivo := 'sem_ninguem_ligado';
    end if;
  end if;

  new.raw_payload := coalesce(new.raw_payload,'{}'::jsonb) || jsonb_build_object(
    '_sentinela', jsonb_build_object(
      'em', now(), 'ativo', cfg_ativo, 'origem_vendedor', primeiro,
      'no_painel', st is not null, 'online', st.online, 'share', st.share_percent,
      'desligado', desligado, 'dono', dono, 'fone_norm', fone_norm,
      'motivo', motivo, 'destino', new.vendedor_nome,
      'assinatura_trocada', trocou, 'tem_rota', (new.raw_payload ? '_rota')));
  return new;
end; $$;
