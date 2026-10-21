-- Página /anuncios (21/10/2026): o funil do CRM por anúncio do Meta e por canal.
-- Pedido do Daniel: "237 contatos, mas desses quantos eram qualificados (a Ana filtrou e passou pro vendedor,
-- quer algo que a Branorte fabrica)? E saiu venda? E por campanha/conjunto, quantos orçamentos".
--
-- Base = contatos que CHEGARAM no período (auditoria.atendimentos_por_cliente), a mesma da página.
-- Anúncio exato = ad_id que a Ana guarda da conversa (ia_atendimentos.dados_coletados._origem), ligado ao
-- contato pelo telefone do chat da Ana (wa_chat_messages ANA). Sem isso o contato fica sem anúncio.
-- Qualificado = a Ana passou a um vendedor (dispatch_vendedor_nome) OU o vendedor marcou avanço (lead quente, follow-up,
-- agendamento, orçamento, vendido) OU virou orçamento — E não marcado NÃO FABRICAMOS / OUTROS ASSUNTOS / TRANSPORTADORAS /
-- SUPORTE TÉCNICO. (Quem vem do site cai direto no vendedor, sem a Ana: só o repasse subcontava o Site.) Orçamento e venda = mesmas réguas do relatório de marketing
-- (orçamento a partir de 2 dias antes da chegada, sem o dono; venda = pedido nascido desses orçamentos).
set lock_timeout = '5s';
create or replace function public.anuncios_crm(p_from timestamptz, p_to timestamptz)
returns table(tipo text, chave text, contatos int, qualificados int, orcamentos int, rs_orcado numeric, vendas int, rs_vendido numeric)
language sql stable security definer
set search_path to 'public', 'auditoria'
as $$
with l as materialized (
  select a.data, a.origem, a.criativo_codigo, a.dispatch_vendedor_nome,
    case when a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13 then public.fone_canon(a.telefone_norm) end fc,
    nullif(auditoria.wa_phone_strip9(a.telefone),'') pm
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false) = false and a.data >= p_from and a.data < p_to
),
ana as materialized (
  -- ad_id da conversa da Ana (a mais recente antes do fim do período) → telefone do chat
  select distinct on (fc) fc, ad_id from (
    select public.fone_canon(w.phone) fc, x.ad_id, x.ligado_em
    from (
      select ia.chat_id, ia.ligado_em,
        coalesce((ia.dados_coletados->>'_origem')::jsonb->>'ad_id',
                 substring((ia.dados_coletados->>'_origem')::jsonb->>'url' from '/([0-9]{15,})$')) ad_id
      from public.ia_atendimentos ia
      where ia.vendedor_nome = 'ANA' and ia.dados_coletados ? '_origem'
        and ia.ligado_em >= p_from - interval '30 days' and ia.ligado_em < p_to
    ) x
    join lateral (select w.phone from public.wa_chat_messages w
                  where w.vendedor_nome = 'ANA' and w.chat_id = x.chat_id and coalesce(w.phone,'') ~ '[0-9]{10}' limit 1) w on true
    where x.ad_id is not null
  ) z where fc is not null
  order by fc, ligado_em desc
),
site as materialized (
  select distinct nullif(auditoria.wa_phone_strip9(w.phone),'') pm
  from public.wa_chat_messages w
  where not w.from_me and w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '2 days'
    and w.body ~* '(vim pelo site da branorte|achei voc[eê]s no google)'
),
etq as materialized (
  select nullif(auditoria.wa_phone_strip9(w.phone),'') pm,
    bool_or(e.n in ('NAO FABRICAMOS','OUTROS ASSUNTOS','TRANSPORTADORAS','SUPORTE TECNICO')) nada,
    bool_or(public.etiqueta_categoria(e.n) in ('lead_quente','orcamento','vendido') or e.n in ('FOLLOW UP','FOLLOWUP','FALLOW UP','AGENDAMENTO')) avanco
  from public.wa_chat_labels w
  join lateral (select we.etiqueta_nome_normalizado n from unnest(w.label_ids::int[]) lid(id)
                join public.wascript_etiquetas we on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = w.vendedor_nome) e on true
  where nullif(auditoria.wa_phone_strip9(w.phone),'') in (select pm from l)
  group by 1
),
og as materialized (
  select public.fone_canon(o.cliente_dados->>'fone') fc, o.created_at, o.total_proposta, regexp_replace(o.numero,'\s','','g') num
  from public.orcamentos_gerados o
  where not (coalesce(o.vendedor_nome,'') ilike '%daniel%')
    and public.fone_canon(o.cliente_dados->>'fone') in (select fc from l where fc is not null)
),
pv as materialized (
  select distinct on (pedido_numero) regexp_replace(coalesce(numero_orcamento,''),'\s','','g') num, data_venda,
    (case when coalesce(nullif(payment_plan_json->>'total','')::numeric,0) > 0 then (payment_plan_json->>'total')::numeric
          else coalesce(valor_total,0) end) + coalesce(ajuste_valor,0) v
  from public.mirror_pedidos_venda where coalesce(upper(status),'') <> 'CANCELADO'
),
x as (
  select
    case
      when coalesce(l.origem in ('Meta ADS','META TESTE 1','Link'), false)
        or (coalesce(btrim(l.origem),'') = '' and coalesce(l.criativo_codigo ~ '^&[0-9]+', false)) then 'Meta'
      when coalesce(l.origem ilike 'google%', false) or coalesce(l.pm in (select pm from site where pm is not null), false) then 'Site'
      else 'Outros' end canal,
    an.ad_id,
    -- qualificado: a Ana passou ao vendedor OU o vendedor marcou avanço OU virou orçamento — e não é "nada a ver"
    ((l.dispatch_vendedor_nome is not null or coalesce(et.avanco, false) or coalesce(o1.tem, false))
      and not coalesce(et.nada, false)) qualif,
    o1.tem, o1.valor, coalesce(v1.n, 0) nv, v1.valor_venda
  from l
  left join ana an on an.fc = l.fc
  left join etq et on et.pm = l.pm
  left join lateral (select count(*) > 0 tem, (array_agg(o.total_proposta order by o.created_at desc))[1] valor
                     from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days') o1 on true
  left join lateral (select count(*) n, sum(pv.v) valor_venda from pv
                     where pv.num <> '' and pv.data_venda >= (l.data - interval '2 days')::date
                       and pv.num in (select o.num from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days')) v1 on true
)
select case when grouping(canal) = 0 then 'canal' else 'anuncio' end,
       case when grouping(canal) = 0 then canal else ad_id end,
       count(*)::int, count(*) filter (where qualif)::int, count(*) filter (where tem)::int, round(coalesce(sum(valor) filter (where tem), 0)),
       count(*) filter (where nv > 0)::int, round(coalesce(sum(valor_venda), 0))
from x
group by grouping sets ((canal), (ad_id))
having grouping(canal) = 0 or ad_id is not null;
$$;
revoke all on function public.anuncios_crm(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_crm(timestamptz, timestamptz) to authenticated, service_role;
