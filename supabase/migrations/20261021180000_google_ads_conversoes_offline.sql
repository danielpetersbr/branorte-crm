-- Devolver ao Google Ads quem virou qualificado / orçamento / venda (21/10/2026, item 1 do Daniel na /anuncios).
-- O site registra o clique no WhatsApp com o gclid (private.site_clique, via site_clique_registrar) e põe um código
-- invisível na mensagem; aqui o código é achado na conversa → telefone do cliente → o que aconteceu DEPOIS do clique:
--   "CRM - Qualificado" = a Ana passou o cliente a um vendedor (outbound_dispatch enviado)
--   "CRM - Orçamento"   = 1º orçamento gerado para o telefone (valor = total da proposta)
--   "CRM - Venda"       = pedido não cancelado para o telefone (valor = total do pedido)
-- Lida pelo script "CRM Branorte - envia dados" da conta do Google Ads (mesma chave do google_ads_ingest), que sobe as
-- linhas como conversões offline (o Google descarta repetidas: gclid + ação + horário). As 3 ações precisam existir no
-- Ads como "Importar → conversões de cliques" com esses nomes exatos.
set lock_timeout = '5s';
create or replace function public.google_ads_conversoes_offline(p_token text, p_dias int default 60)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'private', 'extensions', 'auditoria'
set enable_nestloop to 'off'
as $$
declare v jsonb;
begin
  if p_token is null or not exists (
    select 1 from private.integracao_token
    where nome = 'google_ads' and sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'chave invalida' using errcode = '28000';
  end if;

  with cliques as materialized (
    select c.ref, c.gclid, c.criado_em
    from private.site_clique c
    where c.criado_em > now() - make_interval(days => least(greatest(coalesce(p_dias, 60), 1), 89)) and c.gclid is not null
  ),
  falas as materialized (
    -- a 1ª fala do cliente que trouxe o código do clique
    select distinct on (r) r ref, phone
    from (select public.site_ref_de_texto(w.body) r, w.phone, w.data_msg
            from wa_chat_messages w
           where not w.from_me and w.data_msg > now() - interval '90 days' and strpos(coalesce(w.body, ''), chr(8288)) > 0) m
    where r in (select ref from cliques)
    order by r, data_msg
  ),
  cli as materialized (
    select k.gclid, k.criado_em, f.phone, fn_norm_fone_br(f.phone) fn, public.fone_canon(f.phone) fc
    from cliques k join falas f on f.ref = k.ref
  ),
  ev as (
    select c.gclid, 'CRM - Qualificado' acao, min(o.sent_at) quando, null::numeric valor
      from cli c join outbound_dispatch o on fn_norm_fone_br(o.cliente_telefone) = c.fn
     where o.status = 'sent' and o.sent_at >= c.criado_em
     group by c.gclid
    union all
    select c.gclid, 'CRM - Orçamento', min(og.created_at), (array_agg(og.total_proposta order by og.created_at))[1]
      from cli c join orcamentos_gerados og on public.fone_canon(og.cliente_dados ->> 'fone') = c.fc
     where og.created_at >= c.criado_em and not (coalesce(og.vendedor_nome, '') ilike '%daniel%')
     group by c.gclid
    union all
    select c.gclid, 'CRM - Venda', min(p.data_venda::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo',
           sum((case when coalesce(nullif(p.payment_plan_json ->> 'total', '')::numeric, 0) > 0 then (p.payment_plan_json ->> 'total')::numeric
                     else coalesce(p.valor_total, 0) end) + coalesce(p.ajuste_valor, 0))
      from cli c join mirror_pedidos_venda p on public.fone_canon(nullif(p.raw ->> 'telefone', '')) = c.fc
     where coalesce(upper(p.status), '') <> 'CANCELADO' and p.data_venda >= (c.criado_em at time zone 'America/Sao_Paulo')::date
     group by c.gclid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'gclid', gclid, 'acao', acao,
           'quando', to_char(quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') || '-03:00',
           'valor', round(coalesce(valor, 0), 2))), '[]'::jsonb)
    into v
  from ev where quando is not null;
  return v;
end $$;
revoke all on function public.google_ads_conversoes_offline(text, int) from public;
grant execute on function public.google_ads_conversoes_offline(text, int) to anon, authenticated, service_role;
