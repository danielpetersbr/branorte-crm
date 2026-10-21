-- /anuncios v3 (21/10/2026) — Daniel: "os de LP vão direto pro vendedor… dá de traquear pelo deles (WhatsApp)".
-- Contato de LANDING PAGE e de SITE não passa pela Ana: o "a Ana passou ao vendedor" não existe para ele, e o
-- vendedor quase não etiqueta (LP out/26: 0 de 23 com etiqueta de avanço, mas 3–4 clientes deram rebanho/energia/
-- pediram forma de pagamento na conversa). Para esses canais ("diretos") a régua passa a ler a CONVERSA espelhada do
-- WhatsApp do vendedor:
--   qualificado = (etiqueta de avanço OU orçamento OU o cliente deu informação de compra — espécie/rebanho/kg/energia/
--                  preço/pagamento/frete/cidade… — OU respondeu 2+ vezes depois da 1ª mensagem do vendedor)
--                 E não marcado NÃO FABRICAMOS / OUTROS ASSUNTOS / TRANSPORTADORAS / SUPORTE TÉCNICO.
--   A mensagem pronta da página ("Vim pela LP…", "Quero um orçamento da Mini…", "Vim pelo site…") NÃO conta.
-- E duas medidas novas por linha: sem_resposta (cliente escreveu e nenhum vendedor respondeu até agora) e
-- resp_mediana_h (horas até a 1ª mensagem do vendedor, mediana). Só para contatos diretos.
set lock_timeout = '5s';
drop function if exists public.anuncios_crm(timestamptz, timestamptz);
create function public.anuncios_crm(p_from timestamptz, p_to timestamptz)
returns table(tipo text, chave text, contatos int, qualificados int, orcamentos int, rs_orcado numeric, vendas int, rs_vendido numeric,
              so_ana int, voltaram int, diretos int, sem_resposta int, resp_mediana_h numeric)
language sql stable security definer
set search_path to 'public', 'auditoria'
-- sem isto o planejador cruza CTEs por "nested loop" (comparando telefone a telefone): 20 s → ~3 s
set enable_nestloop to 'off'
as $$
with ana_conv as materialized (
  -- conversas da Ana vindas de anúncio, com telefone do chat
  select distinct on (fc) fc, phone, ad_id, ligado_em from (
    select public.fone_canon(w.phone) fc, w.phone, x.ad_id, x.ligado_em
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
crm_todos as materialized (
  -- primeira chegada no CRM dos telefones que conversaram com a Ana por anúncio (para saber quem já era contato)
  select b.fc, min(b.data) primeira
  from (select public.fone_canon(a.telefone_norm) fc, a.data
        from auditoria.atendimentos_por_cliente a
        where coalesce(a.is_internal,false) = false and a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13) b
  join ana_conv c on c.fc = b.fc
  group by 1
),
l as materialized (
  -- base: contatos que chegaram no CRM no período…
  select a.data, a.origem, a.criativo_codigo, a.dispatch_vendedor_nome, false so_ana,
    case when a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13 then public.fone_canon(a.telefone_norm) end fc,
    nullif(auditoria.wa_phone_strip9(a.telefone),'') pm
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false) = false and a.data >= p_from and a.data < p_to
  union all
  -- …mais quem conversou com a Ana por anúncio no período e nunca virou atendimento no CRM
  select c.ligado_em, 'Meta ADS', null, null, true, c.fc, nullif(auditoria.wa_phone_strip9(c.phone),'')
  from ana_conv c
  where c.ligado_em >= p_from and c.ligado_em < p_to and not exists (select 1 from crm_todos t where t.fc = c.fc)
),
site as materialized (
  select distinct nullif(auditoria.wa_phone_strip9(w.phone),'') pm
  from public.wa_chat_messages w
  where not w.from_me and w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '2 days'
    and w.body ~* '(vim pelo site da branorte|achei voc[eê]s no google)'
),
dir as materialized (
  -- contatos que vão direto ao vendedor: landing page e site/Google
  select distinct l.pm from l
  where l.pm is not null and (coalesce(l.origem ilike 'LP %', false) or coalesce(l.origem ilike 'google%', false)
                              or l.pm in (select pm from site where pm is not null))
),
msgs as materialized (
  -- conversa desses contatos no WhatsApp dos vendedores (a Ana fora)
  select nullif(auditoria.wa_phone_strip9(w.phone),'') pm, w.from_me, w.data_msg,
    (not w.from_me and coalesce(w.body,'') ~* '(vim pela lp|vim da p[aá]gina|quero um or[cç]amento da mini|quero mais informa[cç]|vim pelo site da branorte|achei voc[eê]s no google|&LP\M)') tmpl,
    (not w.from_me and coalesce(w.body,'') !~* '(vim pela lp|vim da p[aá]gina|quero um or[cç]amento da mini|vim pelo site da branorte|achei voc[eê]s no google|&LP\M)'
      and coalesce(w.body,'') ~* '(kg|quilo|tonelad|cabe[cç]a|\mbois?\M|bezerr|gado|vaca|leite|corte|confina|su[ií]n|porc|frango|galinha|\maves?\M|codorn|peixe|til[aá]pia|ovelh|cabra|trif[aá]sic|monof[aá]sic|energia|pre[cç]o|valor|quanto|pagamento|financ|parcel|bndes|frete|entrega|prazo|cnpj|cpf|cep|cidade|endere[cç]o|modelo|motor|misturador|moinho|balan[cç]a|silo|ra[cç][aã]o|milho|soja)') info
  from public.wa_chat_messages w
  where w.data_msg >= p_from - interval '1 day' and w.vendedor_nome <> 'ANA'
    and coalesce(w.chat_id,'') !~ '@(g\.us|broadcast)'
    and nullif(auditoria.wa_phone_strip9(w.phone),'') in (select pm from dir)
),
conv as materialized (
  select c.*,
    (select count(*) from msgs m where m.pm = c.pm and not m.from_me and not m.tmpl and c.v1 is not null and m.data_msg > c.v1) resp_n
  from (
    select l.pm, l.data,
      min(m.data_msg) filter (where m.from_me) v1,
      min(m.data_msg) filter (where not m.from_me) c1,
      coalesce(bool_or(m.info), false) info
    from (select distinct pm, data from l where pm in (select pm from dir)) l
    join msgs m on m.pm = l.pm and m.data_msg >= l.data - interval '1 day'
    group by l.pm, l.data
  ) c
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
  select distinct on (pedido_numero) pedido_numero, regexp_replace(coalesce(numero_orcamento,''),'\s','','g') num, data_venda,
    public.fone_canon(nullif(raw->>'telefone','')) fc,
    (case when coalesce(nullif(payment_plan_json->>'total','')::numeric,0) > 0 then (payment_plan_json->>'total')::numeric
          else coalesce(valor_total,0) end) + coalesce(ajuste_valor,0) v
  from public.mirror_pedidos_venda
  where coalesce(upper(status),'') <> 'CANCELADO' and data_venda >= (p_from at time zone 'America/Sao_Paulo')::date - 2
),
vend as materialized (
  -- pedido ligado ao contato: pelo orçamento dele (número) ou pelo mesmo telefone
  select o.fc, o.created_at orc_em, p.pedido_numero, p.v, p.data_venda
  from og o join pv p on p.num = o.num and p.num <> ''
  union all
  select p.fc, null, p.pedido_numero, p.v, p.data_venda
  from pv p where p.fc is not null and p.fc in (select fc from l where fc is not null)
),
x as (
  select
    case
      when coalesce(l.origem in ('Meta ADS','META TESTE 1','Link'), false)
        or (coalesce(btrim(l.origem),'') = '' and coalesce(l.criativo_codigo ~ '^&[0-9]+', false)) then 'Meta'
      when coalesce(l.origem ilike 'google%', false) or coalesce(l.pm in (select pm from site where pm is not null), false) then 'Site'
      else 'Outros' end canal,
    case when l.origem ilike 'LP %' then l.origem end origem_lp,
    an.ad_id, l.so_ana, (cv.pm is not null) direto,
    case when cv.pm is not null then
      -- direto (LP/site): lê a conversa do vendedor
      ((coalesce(et.avanco, false) or coalesce(o1.tem, false) or cv.info or cv.resp_n >= 2) and not coalesce(et.nada, false))
    else
      ((l.dispatch_vendedor_nome is not null or coalesce(et.avanco, false) or coalesce(o1.tem, false))
        and not coalesce(et.nada, false)) end qualif,
    (cv.pm is not null and cv.c1 is not null and cv.v1 is null) sem_resp,
    case when cv.v1 is not null then greatest(0, extract(epoch from (cv.v1 - coalesce(cv.c1, l.data))) / 3600) end resp_h,
    o1.tem, o1.valor, v1.n nv, v1.valor_venda
  from l
  left join ana_conv an on an.fc = l.fc
  left join etq et on et.pm = l.pm
  left join conv cv on cv.pm = l.pm and cv.data = l.data
  left join lateral (select count(*) > 0 tem, (array_agg(o.total_proposta order by o.created_at desc))[1] valor
                     from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days') o1 on true
  left join lateral (
    select count(*) n, sum(d.v) valor_venda from (
      select distinct on (vd.pedido_numero) vd.pedido_numero, vd.v from vend vd
      where vd.fc = l.fc and vd.data_venda >= (l.data - interval '2 days')::date
        and (vd.orc_em is null or vd.orc_em >= l.data - interval '2 days')
    ) d
  ) v1 on true
),
voltas as (
  -- clientes que já estavam no CRM e voltaram por um anúncio no período
  select c.ad_id, count(*)::int n
  from ana_conv c join crm_todos t on t.fc = c.fc
  where c.ligado_em >= p_from and c.ligado_em < p_to and t.primeira < p_from - interval '1 day'
  group by c.ad_id
),
agg as (
  select
    case when grouping(canal) = 0 and grouping(ad_id) = 1 and grouping(origem_lp) = 1 then 'canal'
         when grouping(canal) = 0 and grouping(origem_lp) = 1 then 'sem_anuncio'
         when grouping(origem_lp) = 0 then 'origem_lp'
         else 'anuncio' end tipo,
    case when grouping(origem_lp) = 0 then origem_lp
         when grouping(canal) = 0 then canal else ad_id end chave,
    count(*)::int contatos, count(*) filter (where qualif)::int qualificados, count(*) filter (where tem)::int orcamentos,
    round(coalesce(sum(valor) filter (where tem), 0)) rs_orcado, count(*) filter (where nv > 0)::int vendas,
    round(coalesce(sum(valor_venda), 0)) rs_vendido, count(*) filter (where so_ana)::int so_ana,
    count(*) filter (where direto)::int diretos, count(*) filter (where sem_resp)::int sem_resposta,
    round((percentile_cont(0.5) within group (order by resp_h) filter (where resp_h is not null))::numeric, 1) resp_mediana_h,
    max(ad_id) ad
  from x
  group by grouping sets ((canal), (canal, ad_id), (ad_id), (origem_lp))
  having (grouping(canal) = 0 and grouping(ad_id) = 1)                    -- canal
      or (grouping(canal) = 0 and grouping(ad_id) = 0 and ad_id is null)  -- sem anúncio por canal
      or (grouping(canal) = 1 and grouping(ad_id) = 0 and ad_id is not null) -- anúncio
      or (grouping(origem_lp) = 0 and origem_lp is not null)              -- origem LP
)
select a.tipo, a.chave, a.contatos, a.qualificados, a.orcamentos, a.rs_orcado, a.vendas, a.rs_vendido, a.so_ana,
       coalesce((select v.n from voltas v where a.tipo = 'anuncio' and v.ad_id = a.chave), 0),
       a.diretos, a.sem_resposta, a.resp_mediana_h
from agg a
union all
-- anúncio que só trouxe cliente antigo de volta (sem contato novo no período)
select 'anuncio', v.ad_id, 0, 0, 0, 0, 0, 0, 0, v.n, 0, 0, null::numeric
from voltas v where v.ad_id not in (select chave from agg where tipo = 'anuncio');
$$;
revoke all on function public.anuncios_crm(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_crm(timestamptz, timestamptz) to authenticated, service_role;

