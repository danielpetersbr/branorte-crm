-- =============================================================================
-- 07/08/2026 — O CRIATIVO VEM DO ANÚNCIO, NÃO DO LINK
-- =============================================================================
--
-- Esta migration reconstitui no repositório o que foi aplicado direto no banco
-- em 07/08/2026. Estava divergente: o gatilho em produção não era o que está
-- versionado em 20260805_link_rota_origem.sql.
--
-- POR QUE MUDOU
-- -------------
-- link_rota.criativo_codigo assumia "um link = um criativo". Os dados
-- derrubaram a premissa no mesmo dia: DOIS anúncios (&54 e &8) apontavam para o
-- MESMO /l/compacta02. Um código no link creditaria os dois igual — e o carimbo
-- de criativo é first-touch-wins, ou seja, irreversível.
--
-- O clique já captura o id do anúncio em utm_content ({{ad.id}}). Faltava o
-- de-para ad_id -> &NN. É o que meta_ad_criativo guarda.
--
-- ⚠ ARMADILHA MEDIDA: a ordem dos ids do Meta ENGANA. O ad_id menor
--   (…019870424) é o Compacta 02 (&8), não o 01. Conferido abrindo o editor de
--   cada anúncio no Gerenciador. Nunca inferir código por ordem de id.
--
-- ALÉM DISSO
-- ----------
-- A janela de tempo deixou de escrever no CRM. Dos 7 casamentos por janela em
-- 05-07/08, NENHUM veio do link: Instagram, quiz do site, um fornecedor
-- prospectando a Branorte e uma cliente de 22/06. A janela virou diagnóstico,
-- registrado em link_rota_match_log, e caiu de 60 para 5 minutos.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trilha de decisão do casamento
-- ---------------------------------------------------------------------------
create table if not exists public.link_rota_match_log (
  id             bigserial primary key,
  msg_id         bigint,
  vendedor_nome  text,
  click_id       bigint,
  decisao        text not null,
  motivo         text,
  criado_em      timestamptz not null default now()
);

alter table public.link_rota_match_log enable row level security;

-- Tinha RLS ligada e ZERO policy: ninguém conseguia ler a própria trilha.
drop policy if exists link_rota_match_log_select on public.link_rota_match_log;
create policy link_rota_match_log_select on public.link_rota_match_log
  for select to authenticated using (not papel_restrito());

-- ---------------------------------------------------------------------------
-- 2. Campos por link (criativo vira só rede de segurança; pixel/UTM são
--    configuração de apoio — ATENÇÃO: api/l.ts ainda não lê pixel_id nem os
--    utm_* do link, então hoje esses campos só documentam a intenção)
-- ---------------------------------------------------------------------------
alter table public.link_rota
  add column if not exists criativo_codigo text,
  add column if not exists pixel_id        text,
  add column if not exists utm_source      text,
  add column if not exists utm_medium      text,
  add column if not exists utm_campaign    text,
  add column if not exists utm_content     text,
  add column if not exists utm_term        text;

do $$ begin
  alter table public.link_rota add constraint link_rota_criativo_ck
    check (criativo_codigo is null or criativo_codigo ~ '^&[0-9]{1,4}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.link_rota add constraint link_rota_pixel_ck
    check (pixel_id is null or pixel_id ~ '^[0-9]{10,20}$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. De-para do anúncio para o código &NN
-- ---------------------------------------------------------------------------
create table if not exists public.meta_ad_criativo (
  ad_id           text primary key check (ad_id ~ '^[0-9]{10,25}$'),
  criativo_codigo text not null      check (criativo_codigo ~ '^&[0-9]{1,4}$'),
  nome_anuncio    text,
  observacao      text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table public.meta_ad_criativo is
  'De-para do id do anuncio no Meta para o codigo &NN usado no CRM. '
  'Alimentado a partir do nome do anuncio (que carrega "CODIGO &NN"). '
  'Tem prioridade sobre link_rota.criativo_codigo, porque varios anuncios '
  'podem compartilhar o mesmo link de roteamento.';

alter table public.meta_ad_criativo enable row level security;

drop policy if exists meta_ad_criativo_select on public.meta_ad_criativo;
create policy meta_ad_criativo_select on public.meta_ad_criativo
  for select to authenticated using (not papel_restrito());

drop policy if exists meta_ad_criativo_write on public.meta_ad_criativo;
create policy meta_ad_criativo_write on public.meta_ad_criativo
  for all to authenticated using (exists (
    select 1 from user_profiles up
    left join role_permissions rp on rp.role = up.role
    where up.id = auth.uid() and up.approved_at is not null
      and (up.role = 'admin'
           or coalesce((rp.permissions ->> 'menu.disparos')::boolean, false))));

create index if not exists link_rota_click_utm_content_idx
  on public.link_rota_click (utm_content) where utm_content is not null;

-- ---------------------------------------------------------------------------
-- 4. O gatilho
-- ---------------------------------------------------------------------------
create or replace function public.link_rota_casar_msg()
returns trigger
language plpgsql
security definer
set search_path = public, auditoria, pg_temp
as $fn$
declare
  v_num          bigint;
  v_click_id     bigint;
  v_link_id      uuid;
  v_origem       text;
  v_criativo     text;
  v_criativo_ad  text;
  v_fonte_criat  text := 'nenhum';
  v_atend_id     uuid;
  v_atend_criado timestamptz;
  v_origem_atual text;
  v_tinha_codigo boolean := false;
  v_ids          bigint[];
  c_janela    constant interval := interval '5 minutes';
  c_max_idade constant interval := interval '48 hours';
begin
  begin
    ------------------------------------------------------------------
    -- CAMINHO 1: SELO INVISIVEL. Unico caminho que escreve no CRM.
    ------------------------------------------------------------------
    if new.body is not null and position(chr(8288) in new.body) > 0 then
      v_num := public.link_rota_decode(new.body);
      if v_num is not null then
        v_tinha_codigo := true;
        update public.link_rota_click
           set matched_at          = now(),
               match_via           = 'codigo',
               cliente_telefone    = new.phone,
               msg_id              = new.id,
               vendedor_confirmado = new.vendedor_nome
         where codigo_num = v_num and matched_at is null
        returning id, link_id into v_click_id, v_link_id;
      end if;
    end if;

    ------------------------------------------------------------------
    -- CAMINHO 2: JANELA = DIAGNOSTICO. Marca o clique e PARA.
    ------------------------------------------------------------------
    if v_click_id is null and not v_tinha_codigo then
      select array_agg(t.id) into v_ids
        from (select c.id
                from public.link_rota_click c
               where c.matched_at is null
                 and c.vendedor_nome is not null
                 and upper(c.vendedor_nome) = upper(new.vendedor_nome)
                 and c.created_at > now() - c_janela
               order by c.created_at desc
               limit 2) t;

      if v_ids is null then return null; end if;

      if cardinality(v_ids) <> 1 then
        insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
        values (new.id, new.vendedor_nome, null, 'recusado',
                'ambiguo: ' || cardinality(v_ids) || '+ cliques pendentes na janela');
        return null;
      end if;

      v_click_id := v_ids[1];

      if exists (select 1 from public.wa_chat_messages m
                  where m.vendedor_nome = new.vendedor_nome
                    and m.chat_id = new.chat_id and m.id < new.id) then
        insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
        values (new.id, new.vendedor_nome, v_click_id, 'recusado',
                'nao e a primeira mensagem do chat');
        return null;
      end if;

      update public.link_rota_click
         set matched_at          = now(),
             match_via           = 'janela',
             cliente_telefone    = new.phone,
             msg_id              = new.id,
             vendedor_confirmado = new.vendedor_nome
       where id = v_click_id and matched_at is null;

      if not found then
        insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
        values (new.id, new.vendedor_nome, v_click_id, 'recusado',
                'corrida: clique ja reivindicado por outra mensagem');
      else
        insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
        values (new.id, new.vendedor_nome, v_click_id, 'janela_diagnostico',
                'clique marcado; origem NAO carimbada (janela nao e prova)');
      end if;
      return null;
    end if;

    ------------------------------------------------------------------
    -- DAQUI PRA BAIXO: so chega quem veio pelo SELO.
    ------------------------------------------------------------------
    if v_link_id is null then return null; end if;

    select nullif(btrim(origem), ''), nullif(btrim(criativo_codigo), '')
      into v_origem, v_criativo
      from public.link_rota where id = v_link_id;
    if v_origem is null then return null; end if;

    -- CRIATIVO: o do ANUNCIO manda. Varios anuncios compartilham um link,
    -- entao o codigo do link so vale como rede de seguranca (clique sem utm).
    select nullif(btrim(m.criativo_codigo), '')
      into v_criativo_ad
      from public.link_rota_click c
      join public.meta_ad_criativo m on m.ad_id = c.utm_content
     where c.id = v_click_id;

    if v_criativo_ad is not null then
      v_criativo    := v_criativo_ad;
      v_fonte_criat := 'anuncio';
    elsif v_criativo is not null then
      v_fonte_criat := 'link';
    end if;

    select a.id, a.created_at, nullif(btrim(a.origem), '')
      into v_atend_id, v_atend_criado, v_origem_atual
      from auditoria.auditoria_atendimentos a
     where auditoria.wa_phone_strip9(a.telefone_norm) = auditoria.wa_phone_strip9(new.phone)
     order by a.created_at desc limit 1;

    if v_atend_id is null then
      -- wa_set_lead_fields ja normaliza o '&' e ja faz first-touch-wins.
      perform auditoria.wa_set_lead_fields(
        p_lead_phone      := new.phone,
        p_responsavel     := new.vendedor_nome,
        p_origem          := v_origem,
        p_criativo_codigo := v_criativo,
        p_external_id     := null);
      insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
      values (new.id, new.vendedor_nome, v_click_id, 'selo_lead_novo',
              v_origem || coalesce(' / ' || v_criativo, '') || ' [criativo: ' || v_fonte_criat || ']');

    elsif v_atend_criado < now() - c_max_idade then
      insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
      values (new.id, new.vendedor_nome, v_click_id, 'recusado',
              'atendimento anterior a 48h (' || v_atend_criado::date || ') - nao carimba');

    else
      if v_origem_atual is null or v_origem_atual = 'Não identificou' then
        update auditoria.auditoria_atendimentos
           set origem = v_origem where id = v_atend_id;
      end if;
      -- Criativo: mesma regra first-touch-wins.
      if v_criativo is not null then
        update auditoria.auditoria_atendimentos
           set criativo_codigo = v_criativo
         where id = v_atend_id and criativo_codigo is null;
      end if;
      insert into public.link_rota_match_log(msg_id, vendedor_nome, click_id, decisao, motivo)
      values (new.id, new.vendedor_nome, v_click_id, 'selo_atendimento_existente',
              coalesce(v_origem_atual, v_origem) || coalesce(' / ' || v_criativo, '')
              || ' [criativo: ' || v_fonte_criat || ']');
    end if;

  exception when others then
    raise warning 'link_rota_casar_msg falhou (msg_id=%): % / %',
      new.id, sqlstate, sqlerrm;
    return null;
  end;

  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Seed do de-para (verificado no editor do Gerenciador em 07/08/2026)
-- ---------------------------------------------------------------------------
insert into public.meta_ad_criativo (ad_id, criativo_codigo, nome_anuncio, observacao)
values
  ('120245665019870424', '&8',  'FÁBRICA DE RAÇÃO COMPACTA 02 CODIGO &8',
   'conjunto [35 - 45] [PB BOVINOS] [compacta 02 &8]'),
  ('120245665894260424', '&54', 'FÁBRICA DE RAÇÃO COMPACTA 01 CODIGO &54',
   'conjunto [35 - 45] [PB BOVINOS] [compacta 01 &54]')
on conflict (ad_id) do nothing;
