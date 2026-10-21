-- Card Qualificados da tela Atendimentos (21/10/2026, Daniel: "tá errado esse 100%").
--
-- Qualificado era "tem responsavel" (régua de 18/08: passou pro vendedor). A ANA virou `responsavel` dos leads que ela
-- está atendendo, então todo lead do período passou a ter dono e o card dava 100% (hoje, 38 de 38). Régua nova:
--   . a ANA não é vendedor: lead que ainda está com ela não conta;
--   . lead que veio pela Ana conta quando ela passou pro vendedor como qualificado (outbound_dispatch com chat_ana e
--     ana_qualificado diferente de false). Repasse de dúvida técnica (ana_qualificado = false) não conta;
--   . lead que foi direto pro vendedor, sem passar pela Ana, segue a régua de 18/08: tem vendedor, conta.
-- Pros leads da Ana é a mesma régua do Qualificados do Dashboard (dashboard_funil_union, 21/10).
-- Medido antes de aplicar: hoje 31 de 38 (82%), 7 dias 322 de 368 (88%), outubro 926 de 1.122 (83%).
--
-- Só muda a coluna `qualificados`; total e os baldes ficam iguais.
-- Cópia da versão anterior: private._bak_atendimentos_kpis_acao_20261021 (voltar = recriar a public com aquele corpo).

do $bak$
declare d text;
begin
  if to_regprocedure('private._bak_atendimentos_kpis_acao_20261021(timestamptz, timestamptz, text)') is null then
    d := pg_get_functiondef('public.atendimentos_kpis_acao(timestamptz, timestamptz, text)'::regprocedure);
    d := replace(d, 'FUNCTION public.atendimentos_kpis_acao(', 'FUNCTION private._bak_atendimentos_kpis_acao_20261021(');
    execute d;
    execute 'revoke all on function private._bak_atendimentos_kpis_acao_20261021(timestamptz, timestamptz, text) from public, anon, authenticated';
  end if;
end
$bak$;

create or replace function public.atendimentos_kpis_acao(
  p_from timestamp with time zone default null::timestamp with time zone,
  p_to timestamp with time zone default null::timestamp with time zone,
  p_vendedor_first text default null::text
)
returns table(total integer, sem_dono integer, sem_primeiro_contato integer, esperando_resposta integer, em_conversa integer, sem_retorno integer, qualificados integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with leads as (
    select a.telefone_norm,
           public.fone_canon(a.telefone_norm) canon,
           nullif(btrim(a.responsavel), '') resp
    from auditoria.atendimentos_por_cliente a
    where coalesce(a.is_internal, false) = false
      -- ⚠️ 18/08: lead sem telefone fora do universo (ordem do Daniel). Espelha o
      -- .neq('telefone_norm','') do applyBaseFilters no front — os dois tem que andar juntos,
      -- senao o total do cabecalho diverge dos cards.
      and coalesce(a.telefone_norm, '') <> ''
      and (p_from is null or a.created_at >= p_from)
      and (p_to   is null or a.created_at <= p_to)
      -- escopo do vendedor logado: os dele + os sem dono (espelha applyBaseFilters do front)
      and (
        p_vendedor_first is null
        or a.responsavel ilike p_vendedor_first || '%'
        or a.responsavel is null or btrim(a.responsavel) = '' or lower(a.responsavel) = 'a definir'
      )
  ),
  -- Janela de mensagens ancorada no periodo pedido (com 1 dia de folga pra pegar a conversa
  -- que comecou na vespera). Sem isso, filtro "Este mes" olharia so os ultimos dias.
  msg as (
    select public.fone_canon(m.phone) canon,
           count(*) filter (where m.from_me is false) n_cliente,
           count(*) filter (where m.from_me is true)  n_nosso,
           max(m.data_msg) filter (where m.from_me is false) ult_cliente,
           max(m.data_msg) filter (where m.from_me is true)  ult_nosso
    from public.wa_chat_messages m
    where m.data_msg >= coalesce(p_from, now() - interval '7 days') - interval '1 day'
      and m.phone is not null
    group by 1
  ),
  -- (21/10/2026) clientes que a Ana passou pro vendedor. qualif = true: algum repasse qualificado (o de antes da marca
  -- existir, até 30/09, conta). qualif = false: só repasse de dúvida técnica. Sem linha: não passou pela Ana.
  ana as (
    select public.fone_canon(o.cliente_telefone_norm) canon,
           bool_or(coalesce(o.raw_payload->>'ana_qualificado', 'true') <> 'false') qualif
    from public.outbound_dispatch o
    where o.raw_payload ? 'chat_ana'
      and coalesce(o.cliente_telefone_norm, '') <> ''
    group by 1
  ),
  j as (
    select l.*,
           coalesce(x.n_cliente, 0) n_cliente,
           coalesce(x.n_nosso, 0)   n_nosso,
           x.ult_cliente, x.ult_nosso,
           an.qualif ana_qualif
    from leads l
    left join msg x on x.canon = l.canon and l.canon is not null
    left join ana an on an.canon = l.canon and l.canon is not null
  ),
  cls as (
    select case
      -- ⚠️ A ORDEM IMPORTA. Sem dono ganha de tudo: nao adianta saber em que pe esta a
      -- conversa se ninguem e responsavel por ela.
      when resp is null or lower(resp) = 'a definir'                       then 'sem_dono'
      when n_nosso = 0                                                     then 'sem_primeiro_contato'
      when n_cliente > 0 and (ult_nosso is null or ult_cliente > ult_nosso) then 'esperando_resposta'
      when n_cliente > 0                                                   then 'em_conversa'
      else 'sem_retorno'
    end balde,
    -- QUALIFICADO = PASSOU PRO VENDEDOR. Regra do Daniel, reafirmada em 18/08/2026: lead que foi
    -- direto pro vendedor conta pelo responsavel, sem olhar mensagem (o card mede DISTRIBUICAO:
    -- quem preenche `responsavel` e o roteamento automatico).
    -- 21/10/2026 ("ta errado esse 100%"): a ANA nao e vendedor — lead que ainda esta com ela
    -- nao conta. Lead que veio pela Ana conta quando ela passou como qualificado; repasse de
    -- duvida tecnica nao conta. Repasse qualificado conta mesmo se o responsavel ainda nao virou.
    (
      (resp is not null and lower(resp) <> 'a definir' and upper(resp) <> 'ANA' and coalesce(ana_qualif, true))
      or coalesce(ana_qualif, false)
    ) qualificado
    from j
  )
  select count(*)::int,
         count(*) filter (where balde = 'sem_dono')::int,
         count(*) filter (where balde = 'sem_primeiro_contato')::int,
         count(*) filter (where balde = 'esperando_resposta')::int,
         count(*) filter (where balde = 'em_conversa')::int,
         count(*) filter (where balde = 'sem_retorno')::int,
         count(*) filter (where qualificado)::int
  from cls;
$function$;
