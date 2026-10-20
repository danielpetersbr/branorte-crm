-- Aba Marketing, "Porte do lead por anúncio" (20/10/2026).
-- A Ana pergunta espécie e quantidade (31% dos leads respondem a quantidade, contra 8% na base
-- do bot antigo que o resto do Dashboard lê), mas guarda tudo em ia_atendimentos.dados_coletados,
-- com o lead pelo id interno do WhatsApp (@lid) e a origem pelo ID do ANÚNCIO do Meta — nada
-- disso casa com o código &NN. Esta função agrupa por anúncio o que a Ana coletou.
-- Proposta por anúncio NÃO entra: só 190 de 999 cliques de anúncio têm telefone (o resto é @lid).
-- Porte: corte único só para bovino (200/500 cabeças, medido na Branorte); suíno e aves só mediana.
create or replace function public.dashboard_porte_por_anuncio(p_from timestamptz, p_to timestamptz)
returns table(
  ad_id text, anuncio text, campanha text, codigo text, texto text, app text,
  conversas int, informou_animal int, informou_qtd int,
  bovino int, bovino_com_qtd int, bovino_mediana numeric, bovino_200 int, bovino_500 int,
  suino int, suino_mediana numeric, aves int, aves_mediana numeric, outros_animais int,
  revenda int, repassados int, equipamento_mais_pedido text)
language sql stable security definer
set search_path to 'public'
as $$
with base as (
  select ia.dados_coletados d, (ia.dados_coletados->>'_origem')::jsonb o
  from public.ia_atendimentos ia
  where ia.ligado_em >= p_from and ia.ligado_em < p_to
    and ia.dados_coletados ? '_origem'
),
x as (
  select
    coalesce(o->>'ad_id', substring(o->>'url' from '/([0-9]{15,})$')) as ad_id,
    left(regexp_replace(coalesce(o->>'descricao', o->>'titulo', ''), '\s+', ' ', 'g'), 90) as texto,
    o->>'app' as app,
    lower(coalesce(d->>'animal','')) as animal,
    (case
       when coalesce(d->>'quantidade','') ~ '[0-9]' then
         replace((regexp_match(d->>'quantidade', '([0-9][0-9.]*)'))[1], '.', '')::numeric
         * case when lower(d->>'quantidade') ~ '\mmil\M' then 1000 else 1 end
     end) as q,
    lower(coalesce(d->>'uso','')) as uso,
    (d ? '_repasse') as repassado,
    nullif(btrim(d->>'equipamento'), '') as equip
  from base
)
select x.ad_id,
  max(m.anuncio) as anuncio, max(m.campanha) as campanha, max(substring(m.anuncio from '&[0-9]+')) as codigo,
  mode() within group (order by x.texto) as texto, mode() within group (order by x.app) as app,
  count(*)::int as conversas,
  count(*) filter (where x.animal <> '')::int,
  count(*) filter (where x.q > 0)::int,
  count(*) filter (where x.animal ~ 'bovin')::int,
  count(*) filter (where x.animal ~ 'bovin' and x.q > 0)::int,
  percentile_cont(0.5) within group (order by x.q) filter (where x.animal ~ 'bovin' and x.q > 0)::numeric,
  count(*) filter (where x.animal ~ 'bovin' and x.q >= 200)::int,
  count(*) filter (where x.animal ~ 'bovin' and x.q >= 500)::int,
  count(*) filter (where x.animal ~ 'su[ií]n')::int,
  percentile_cont(0.5) within group (order by x.q) filter (where x.animal ~ 'su[ií]n' and x.q > 0)::numeric,
  count(*) filter (where x.animal ~ '^ave|frango|galinha|codorn|poedeir')::int,
  percentile_cont(0.5) within group (order by x.q) filter (where x.animal ~ '^ave|frango|galinha|codorn|poedeir' and x.q > 0)::numeric,
  count(*) filter (where x.animal <> '' and x.animal !~ 'bovin|su[ií]n|^ave|frango|galinha|codorn|poedeir')::int,
  count(*) filter (where x.uso = 'venda')::int,
  count(*) filter (where x.repassado)::int,
  mode() within group (order by x.equip) filter (where x.equip is not null)
from x
left join public.meta_anuncio_mapa m on m.ad_id = x.ad_id
group by x.ad_id;
$$;
revoke all on function public.dashboard_porte_por_anuncio(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_porte_por_anuncio(timestamptz, timestamptz) to authenticated, service_role;
