-- ============================================================================
-- O papel `mapa` passa a PLANEJAR VIAGEM — e só isso.
-- 31/08/2026. Caso real: uma conta `mapa` montou 1.781 km e 25h de roteiro e
-- levou "new row violates row-level security policy" no último clique.
--
-- ⚠️ POR QUE NÃO MEXI EM `papel_restrito()`
-- Ela é o portão de ~230 tabelas (contacts, orcamentos, precos, wa_*, mirror_*…)
-- via a policy RESTRICTIVE `bloqueia_papel_restrito`. Tirar 'mapa' de lá abriria
-- o CRM inteiro de uma vez. Ela fica intacta.
--
-- O RECORTE: `viagem_pode_editar()` só é usada em 8 policies, em 3 tabelas
-- (viagens, viagem_paradas, cliente_localizacao). Então o domínio de viagens ganha
-- a SUA regra de "papel externo" e o resto do banco não sente nada.
--
-- CONTINUAM BLOQUEADOS: 'consultor' e 'representante' — os dois EXTERNOS, como o
-- próprio comentário de papel_restrito() documenta. 'mapa' é consulta INTERNA, e
-- montar roteiro de visita é trabalho de mapa.
--
-- ⚠️ `cliente_localizacao` NÃO entra: é cadastro de cliente, não viagem, e guarda
-- a `bloqueia_papel_restrito` original. O papel `mapa` planeja a viagem mas segue
-- sem corrigir localização de cliente — se atrapalhar, é outra decisão.
--
-- MEDIDO DEPOIS DE APLICAR, com a identidade do usuário `mapa`:
--   insert em viagens + viagem_paradas .......... passa
--   contacts / orcamentos_files / precos_branorte
--   wa_chat_messages / vendors / cliente_localizacao .... 0 linhas (segue cego)
--   papel_restrito() .............................. continua true
--   representante tentando gravar viagem .......... recusado
--
-- COMO DESFAZER: repontar as duas policies pra `papel_restrito()` e devolver
-- 'mapa' à lista de `viagem_pode_editar()`.
-- ============================================================================

create or replace function public.papel_restrito_viagens()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select role in (
        'consultor',     -- consultor externo
        'representante'  -- representante externo
      ) from public.user_profiles where id = auth.uid()),
    false)
$function$;

comment on function public.papel_restrito_viagens() is
  'Papeis EXTERNOS que nao podem tocar em viagens. Diferente de papel_restrito(): aqui o papel interno `mapa` e permitido, porque montar roteiro de visita e trabalho dele.';

revoke all on function public.papel_restrito_viagens() from public, anon;
grant execute on function public.papel_restrito_viagens() to authenticated, service_role;

-- ⚠️ Esta função é a FONTE ÚNICA da pergunta "posso gravar viagem?", porque a tela
-- passou a consultá-la pra avisar o usuário ANTES dele montar o roteiro. Por isso
-- ela precisa contar as DUAS travas: a whitelist de papel (policy PERMISSIVE) e a
-- `papel_restrito_viagens()` (policy RESTRICTIVE). Sem o `and` do fim, ela dizia
-- "pode" pro 'representante' — que morria na outra trava — e a tela reintroduziria
-- exatamente o bug que ela veio consertar.
create or replace function public.viagem_pode_editar()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from user_profiles up
    where up.id = auth.uid()
      and up.approved_at is not null
      and up.role not in ('consultor','pending','rejected')
  )
  and not public.papel_restrito_viagens();
$function$;

drop policy if exists bloqueia_papel_restrito on public.viagens;
create policy bloqueia_papel_restrito on public.viagens
  as restrictive for all to authenticated
  using (not public.papel_restrito_viagens())
  with check (not public.papel_restrito_viagens());

drop policy if exists bloqueia_papel_restrito on public.viagem_paradas;
create policy bloqueia_papel_restrito on public.viagem_paradas
  as restrictive for all to authenticated
  using (not public.papel_restrito_viagens())
  with check (not public.papel_restrito_viagens());
