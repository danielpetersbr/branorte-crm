-- ============================================================================
-- Guia do Vendedor — revisão POR FRENTE, e não uma assinatura só.
--
-- O schema original tinha `revisor_tecnico` e `revisado_em`: um campo, uma
-- assinatura. Isso não bate com a realidade das pendências, que são de naturezas
-- diferentes e de gente diferente:
--
--   NUTRIÇÃO   — faixa de inclusão, composição, consumo de referência
--   ENGENHARIA — densidade, fluidez, ponte, corrosão, misturador indicado
--   IMAGEM     — autor, licença, e a decisão de que a foto representa o item
--
-- Com um campo só, o nutricionista assinaria por tabela junto com a engenharia,
-- ou ninguém assinaria. Agora cada frente assina a sua, e `pendente_validacao`
-- cai sozinho quando todas as frentes APLICÁVEIS àquele card estiverem assinadas.
--
-- `revisor_tecnico` e `revisado_em` continuam existindo e passam a refletir a
-- assinatura mais recente — nada que já lê esses campos quebra.
-- ============================================================================

alter table public.guia_animais
  add column if not exists revisao jsonb not null default '{}'::jsonb;
alter table public.guia_materias
  add column if not exists revisao jsonb not null default '{}'::jsonb;

comment on column public.guia_animais.revisao is
  'Assinaturas por frente: {"nutricao":{"por":"...","em":"2026-08-04"},"engenharia":{...}}';
comment on column public.guia_materias.revisao is
  'Assinaturas por frente: {"nutricao":{"por":"...","em":"2026-08-04"},"engenharia":{...}}';

-- ---------------------------------------------------------------------------
-- Quais frentes um card EXIGE.
--
-- Derivado do conteúdo, não declarado à mão: um card só cobra nutrição se de
-- fato afirma número nutricional, e só cobra engenharia se de fato afirma
-- comportamento no equipamento. Card que não afirma nada não fica preso.
-- ---------------------------------------------------------------------------
create or replace function public.guia_frentes_animal(a public.guia_animais)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when a.consumo_ref is not null or a.peso_nota is not null
         then 'nutricao' end,
    case when array_length(a.equipamentos, 1) > 0 or a.processo is not null
         then 'engenharia' end
  ], null);
$$;

create or replace function public.guia_frentes_materia(m public.guia_materias)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when m.inclusao <> '{}'::jsonb or m.composicao is not null
         then 'nutricao' end,
    case when m.misturador_indicado is not null or m.densidade_kg_m3 is not null
              or m.fluidez is not null or m.compat_branorte <> 'avaliar'
         then 'engenharia' end
  ], null);
$$;

-- ---------------------------------------------------------------------------
-- `pendente_validacao` deixa de ser um flag que alguém lembra de desligar:
-- passa a ser CALCULADO. Enquanto faltar assinatura de uma frente aplicável, o
-- selo fica na tela. Assinou tudo, o selo some sozinho.
-- ---------------------------------------------------------------------------
create or replace function public.guia_recalcular_pendencia()
returns trigger language plpgsql as $$
declare
  frentes text[];
  f text;
  falta boolean := false;
  ultima_data date;
  ultimo_por text;
begin
  if tg_table_name = 'guia_animais' then
    frentes := public.guia_frentes_animal(new::public.guia_animais);
  else
    frentes := public.guia_frentes_materia(new::public.guia_materias);
  end if;

  foreach f in array coalesce(frentes, '{}') loop
    if new.revisao -> f ->> 'em' is null then
      falta := true;
    else
      -- guarda a assinatura mais recente pros campos legados
      if ultima_data is null or (new.revisao -> f ->> 'em')::date > ultima_data then
        ultima_data := (new.revisao -> f ->> 'em')::date;
        ultimo_por  := new.revisao -> f ->> 'por';
      end if;
    end if;
  end loop;

  new.pendente_validacao := falta;
  if ultima_data is not null then
    new.revisado_em     := ultima_data;
    new.revisor_tecnico := ultimo_por;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guia_animais_pendencia on public.guia_animais;
create trigger trg_guia_animais_pendencia
  before insert or update of revisao on public.guia_animais
  for each row execute function public.guia_recalcular_pendencia();

drop trigger if exists trg_guia_materias_pendencia on public.guia_materias;
create trigger trg_guia_materias_pendencia
  before insert or update of revisao on public.guia_materias
  for each row execute function public.guia_recalcular_pendencia();

-- ---------------------------------------------------------------------------
-- Assinatura EM LOTE.
--
-- É a razão de existir desta migration. Pedir ao nutricionista que abra 63
-- cards um a um para assinar garante que ninguém assina nunca. Aqui ele
-- seleciona, assina, e o banco registra quem e quando em cada card.
--
-- security definer + checagem explícita de guia_pode_editar(): a função roda com
-- privilégio, mas só depois de confirmar que quem chamou tem o direito.
-- ---------------------------------------------------------------------------
create or replace function public.guia_assinar_revisao(
  p_tabela text,
  p_slugs  text[],
  p_frente text,
  p_por    text,
  p_em     date default current_date
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if not public.guia_pode_editar() then
    raise exception 'sem permissão para revisar o guia (guia.editar)';
  end if;
  if p_frente not in ('nutricao', 'engenharia') then
    raise exception 'frente inválida: %', p_frente;
  end if;
  if coalesce(trim(p_por), '') = '' then
    raise exception 'a assinatura precisa de um responsável nomeado';
  end if;

  if p_tabela = 'guia_animais' then
    update public.guia_animais
       set revisao = revisao || jsonb_build_object(
             p_frente, jsonb_build_object('por', trim(p_por), 'em', p_em))
     where slug = any(p_slugs);
  elsif p_tabela = 'guia_materias' then
    update public.guia_materias
       set revisao = revisao || jsonb_build_object(
             p_frente, jsonb_build_object('por', trim(p_por), 'em', p_em))
     where slug = any(p_slugs);
  else
    raise exception 'tabela inválida: %', p_tabela;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.guia_assinar_revisao(text, text[], text, text, date) from anon;
grant execute on function public.guia_assinar_revisao(text, text[], text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Aprovar imagem em lote — mesma lógica. O CHECK da tabela continua valendo:
-- sem autor, licença e alt, a imagem NÃO passa a 'verificada', e a função
-- devolve quantas realmente mudaram para o revisor conferir.
-- ---------------------------------------------------------------------------
create or replace function public.guia_verificar_imagens(
  p_slugs text[],
  p_por   text,
  p_em    date default current_date
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if not public.guia_pode_editar() then
    raise exception 'sem permissão para revisar o guia (guia.editar)';
  end if;
  if coalesce(trim(p_por), '') = '' then
    raise exception 'a verificação precisa de um responsável nomeado';
  end if;

  update public.guia_imagens
     set status = 'verificada', verificada_em = p_em, aprovada_por = trim(p_por)
   where slug = any(p_slugs)
     and status <> 'reprovada'
     -- só passa o que tem a papelada completa; o resto fica como está
     and arquivo_url is not null and alt <> '' and autor is not null and licenca is not null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.guia_verificar_imagens(text[], text, date) from anon;
grant execute on function public.guia_verificar_imagens(text[], text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Fila de revisão: o que falta, de quem, agrupado. Uma view pra tela não ter
-- que reimplementar a regra de "quais frentes este card exige".
-- ---------------------------------------------------------------------------
create or replace view public.guia_fila_revisao as
  select 'guia_animais' as tabela, a.slug, a.nome,
         a.especie::text as grupo, a.status, a.pendente_validacao,
         public.guia_frentes_animal(a) as frentes_exigidas,
         a.revisao,
         array(select f from unnest(public.guia_frentes_animal(a)) f
                where a.revisao -> f ->> 'em' is null) as frentes_pendentes
    from public.guia_animais a
   where a.status <> 'arquivado'
  union all
  select 'guia_materias', m.slug, m.nome,
         m.categoria::text, m.status, m.pendente_validacao,
         public.guia_frentes_materia(m),
         m.revisao,
         array(select f from unnest(public.guia_frentes_materia(m)) f
                where m.revisao -> f ->> 'em' is null)
    from public.guia_materias m
   where m.status <> 'arquivado';

revoke all on public.guia_fila_revisao from anon;
grant select on public.guia_fila_revisao to authenticated;

-- Recalcula o estado atual de todo mundo (nenhuma assinatura ainda: tudo pendente,
-- mas agora o flag é derivado e não mais um booleano solto).
update public.guia_animais  set revisao = revisao;
update public.guia_materias set revisao = revisao;
