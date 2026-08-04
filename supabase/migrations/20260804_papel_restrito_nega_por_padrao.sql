-- ═══════════════════════════════════════════════════════════════════════════
-- CONTAS EXTERNAS PARAM DE ALCANÇAR O QUE A TELA DELAS NÃO USA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O PROBLEMA. O guard de rota do App.tsx é CLIENT-SIDE: decide o que a pessoa
-- VÊ, não o que ela ALCANÇA. Com a chave anon (que está no bundle) mais uma
-- sessão válida, uma conta de papel `mapa` ou `consultor` lia **133 das 219**
-- tabelas/views pela API REST sem passar por tela nenhuma — inclusive 175 mil
-- contatos com nome e telefone, a lista de preços (com escrita liberada), os
-- scripts de venda e 1,8 milhão de payloads de WhatsApp.
--
-- Depois destas migrations: **7 de 219**, e as 7 são exatamente a allowlist.
--
-- A POSTURA. Bloquear tabela sensível uma a uma não termina nunca — tabela nova
-- nasce liberada. Então: NEGA TUDO pros papéis externos, libera só o que as
-- telas deles consultam de verdade. A lista saiu de grep no código.
--
-- POR QUE `RESTRICTIVE`. Policy restritiva é ANDada com as permissivas que já
-- existem. Nenhuma policy atual foi reescrita, então não há como quebrar
-- vendedor/marketing/admin por efeito colateral — e a verificação confirmou:
-- admin e os 5 vendedores continuam lendo 5/5 em contacts, precos,
-- orcamentos_gerados e atendimentos.
--
-- REVERTER: drop das policies `bloqueia_papel_restrito` + `drop function
-- papel_restrito`. Os `revoke` e os `security_invoker` precisam ser desfeitos
-- um a um (ver seções 3 e 4).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) quem é papel restrito ───────────────────────────────────────────────
create or replace function public.papel_restrito()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('mapa', 'consultor') from public.user_profiles where id = auth.uid()),
    false)
$$;

revoke execute on function public.papel_restrito() from anon;
grant execute on function public.papel_restrito() to authenticated;

-- ── 2) nega por padrão em `public`, com allowlist ──────────────────────────
-- A allowlist saiu de grep no código, não de suposição:
--   user_profiles              useAuth (sem isso o login não completa)
--   role_permissions           usePermissions
--   venda_racao_*              /producao-propria e /venda-racao
--   cliente_dados_visita,
--   mapa_marcacoes, vendas_mapa,
--   representante_territorios  useVisitas e useTerritorios (mapas do Patrick)
--
-- O resto do mapa vem por RPC SECURITY DEFINER (mapa_orcamentos,
-- lista_orcamentos_mapa), que não passa por RLS — por isso orcamentos_*,
-- cidade_geocache e contacts podem ficar fechados sem quebrar o mapa.
do $$
declare
  r record;
  liberadas text[] := array[
    'user_profiles', 'role_permissions',
    'venda_racao_config', 'venda_racao_formulas',
    'venda_racao_ingredientes', 'venda_racao_simulacoes',
    'cliente_dados_visita', 'mapa_marcacoes', 'vendas_mapa',
    'representante_territorios'
  ];
begin
  for r in
    select c.relname as tab
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relrowsecurity                      -- policy em tabela sem RLS não faz efeito
      and not (c.relname = any(liberadas))
  loop
    execute format('drop policy if exists bloqueia_papel_restrito on public.%I', r.tab);
    execute format(
      'create policy bloqueia_papel_restrito on public.%I
         as restrictive for all to authenticated
         using (not public.papel_restrito())
         with check (not public.papel_restrito())', r.tab);
  end loop;
end $$;

-- ── 2b) outros schemas ─────────────────────────────────────────────────────
-- A varredura original só olhou `public` e deu a impressão de que a base de
-- contatos estava fechada. Não estava: `public.contacts_v2` é view sobre
-- `branorte_crm.contatos` — outro schema, 114 mil linhas com nome, telefone,
-- e-mail, endereço e CEP. Travar a view não resolveria: outra view sobre a
-- mesma tabela reabriria. A trava vai na TABELA.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as sch, c.relname as tab
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and c.relrowsecurity
      and ((n.nspname = 'branorte_crm' and c.relname in ('contatos','vendedores','orcamentos'))
        or (n.nspname = 'auditoria' and c.relname like '%atendimento%'))
  loop
    execute format('drop policy if exists bloqueia_papel_restrito on %I.%I', r.sch, r.tab);
    execute format(
      'create policy bloqueia_papel_restrito on %I.%I
         as restrictive for all to authenticated
         using (not public.papel_restrito())
         with check (not public.papel_restrito())', r.sch, r.tab);
  end loop;
end $$;

-- ── 3) views paravam de furar RLS ──────────────────────────────────────────
-- View no Postgres roda com os direitos do DONO por padrão — ou seja, FURA a
-- RLS das tabelas por baixo. Era assim que `contacts_v2`, `v_contacts_pipeline`
-- e companhia entregavam o mesmo conteúdo que a tabela negava.
-- REVERTER isto reabre o furo pra QUALQUER papel, não só pros restritos.
do $$
declare r record;
begin
  for r in
    select c.relname as v from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'true'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.v);
  end loop;
end $$;

-- ── 4) o que policy não alcança ────────────────────────────────────────────
-- Backups com RLS DESLIGADA: policy neles não faz efeito, e ligar RLS sem
-- policy bloquearia job legítimo. A trava é por GRANT. `precos_branorte_bkp`
-- é a lista de preços inteira. service_role não depende destes grants.
do $$
declare r record;
begin
  for r in
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','m')
      and (c.relname like '%backup%' or c.relname like '%bkp%' or c.relname like '\_backup%')
  loop
    execute format('revoke select on public.%I from authenticated', r.t);
    execute format('revoke select on public.%I from anon', r.t);
  end loop;
end $$;

-- MATERIALIZED VIEW não aceita RLS nem security_invoker: é tabela com resultado
-- já calculado. Só GRANT resolve. Sem uso no repo (grep).
revoke select on public.mv_etiqueta_ciclo from authenticated;
revoke select on public.mv_etiqueta_ciclo from anon;

-- Estas duas leem de FUNÇÃO security definer — quem fura é a função, então
-- `security_invoker` na view não adianta. Não mexo na função: wl_funil_ativo()
-- tem uso no CRM e alterá-la afetaria vendedor e admin. A guarda entra na view.
create or replace view public.v_funil_ativo
with (security_invoker = true) as
  select etapa, qtd from wl_funil_ativo() wl_funil_ativo(etapa, qtd)
  where not public.papel_restrito();

create or replace view public.v_funil_completo
with (security_invoker = true) as
  select etapa, qtd from wl_funil_completo() wl_funil_completo(etapa, qtd)
  where not public.papel_restrito();
