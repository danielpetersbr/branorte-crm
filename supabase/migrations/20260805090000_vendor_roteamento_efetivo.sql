-- AS DUAS VIEWS DE ROTEAMENTO NÃO TINHAM MIGRATION
--
-- `vendor_parados_topo` e `vendor_roteamento_efetivo` foram criadas direto no
-- banco em 04/08. Existiam no repo só dentro da migration
-- `20260804210000_view_nova_nasce_fechada.sql`, e lá apenas como
-- `alter view ... set (security_invoker = true)` — um ALTER sobre um objeto que
-- nenhuma migration cria.
--
-- Ou seja: ambiente novo (branch do Supabase, staging, restore) rodava todas as
-- migrations e o `alter` estourava, ou passava e as views simplesmente não
-- existiam. Quem quebra:
--   src/pages/Disparos.tsx:61              — a tela abre com a lista vazia
--   supabase/functions/ext-version:39      — a edge lê `fator_cota` e não acha
--
-- Eu tinha declarado que a migration de ontem "cobria" essas views. Cobria o
-- security_invoker, não a existência delas. Este arquivo fecha o buraco: extraí
-- a definição com `pg_get_viewdef` do próprio banco de produção, então é o que
-- está rodando hoje, não uma reescrita de memória.
--
-- security_invoker vem explícito nas duas. O event trigger
-- `trg_forca_security_invoker` já poria, mas depender dele aqui deixaria a
-- migration com um comportamento que só existe se o gatilho tiver sido criado
-- antes — e ordem de migration não é lugar pra sorte.

-- ── quantos leads parados cada vendedor tem no topo do funil ────────────────
create or replace view public.vendor_parados_topo
with (security_invoker = true) as
  with etapa as (
    select e.vendedor_nome,
           e.etiqueta_id_wascript::text as id_txt,
           case
             when upper(e.etiqueta_nome_normalizado) like 'PROSPEC%' then 'PROSPECCAO'
             when upper(e.etiqueta_nome_normalizado) ~ '^2[AO]?\s*TENTAT' then '2A TENTATIVA'
             when upper(e.etiqueta_nome_normalizado) like 'NOVO%LEAD%' then 'NOVO LEAD'
             else null
           end as etapa
    from public.wascript_etiquetas e
  ), chat as (
    select c.vendedor_nome,
           t.etapa,
           (now() - c.last_message_at) > interval '7 days' as parado,
           c.last_message_from_me
    from public.wa_chat_labels c
    join etapa t on t.vendedor_nome = c.vendedor_nome and (t.id_txt = any (c.label_ids))
    where t.etapa is not null and c.last_message_at is not null
  )
  select vendedor_nome,
         count(*) as total_topo,
         count(*) filter (where parado) as parados,
         count(*) filter (where parado and etapa = 'PROSPECCAO') as parados_prospeccao,
         count(*) filter (where parado and etapa = '2A TENTATIVA') as parados_2a_tentativa,
         count(*) filter (where parado and etapa = 'NOVO LEAD') as parados_novo_lead,
         count(*) filter (where parado and last_message_from_me is false) as parados_devendo_resposta
  from chat
  group by vendedor_nome;

-- ── a fatia que cada vendedor recebe DEPOIS da cota ─────────────────────────
-- O join é por PRIMEIRO NOME em maiúsculo, e não por igualdade: o
-- `vendedor_nome` chega de fontes diferentes e vem sujo ("RAMON" vs
-- "RAMON FERNANDES", espaço no fim). Mesma razão do casamento de vendedor em
-- viagem_paradas — e a mesma armadilha: dois vendedores com o mesmo primeiro
-- nome quebram isto.
create or replace view public.vendor_roteamento_efetivo
with (security_invoker = true) as
  select s.vendedor_nome,
         s.online,
         s.bloqueado,
         s.share_percent,
         coalesce(p.parados, 0::bigint) as parados_topo,
         coalesce(p.parados_prospeccao, 0::bigint) as parados_prospeccao,
         coalesce(p.parados_2a_tentativa, 0::bigint) as parados_2a_tentativa,
         coalesce(p.parados_novo_lead, 0::bigint) as parados_novo_lead,
         public.cota_fator(s.vendedor_nome) as fator_cota,
         round(s.share_percent * public.cota_fator(s.vendedor_nome), 2) as share_efetivo,
         coalesce(e.cortado, false) as cortado_por_cota,
         e.cortado_em,
         (select round(extract(epoch from now() - max(l.updated_at)) / 60::numeric)::integer
          from public.wa_chat_labels l
          where upper(split_part(btrim(l.vendedor_nome), ' ', 1))
              = upper(split_part(btrim(s.vendedor_nome), ' ', 1))) as sync_min
  from public.vendor_dispatch_status s
  left join public.vendor_parados_topo p
    on upper(split_part(btrim(p.vendedor_nome), ' ', 1))
     = upper(split_part(btrim(s.vendedor_nome), ' ', 1))
  left join public.outbound_cota_estado e
    on upper(split_part(btrim(e.vendedor_nome), ' ', 1))
     = upper(split_part(btrim(s.vendedor_nome), ' ', 1));

-- ⚠️ FICA EM ABERTO, e é maior que este arquivo: das 76 RPCs que o front chama,
-- 69 não têm CREATE FUNCTION em migration nenhuma — blocos inteiros de
-- dashboard_*, prospeccao_*, escritorio_*, frete_*. O repo NÃO reconstrói o CRM
-- hoje; o único lugar onde essas funções existem é o projeto de produção.
