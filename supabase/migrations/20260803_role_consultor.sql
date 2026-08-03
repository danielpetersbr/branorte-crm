-- Papel 'consultor': conta externa de consultor, com acesso APENAS ao estudo
-- de viabilidade da produção própria (/producao-propria, mais as rotas antigas
-- /viabilidade e /venda-racao que redirecionam pra lá).
-- Sem mapa, sem contato, sem orçamento: não enxerga carteira nem dado comercial.
--
-- Barrado por lista branca no App.tsx (ROTAS_RESTRITAS), com o menu lateral
-- correspondente em MENUS_RESTRITOS no Layout — as duas listas têm que casar.
-- NÃO passa por role_permissions: papéis restritos não têm linha lá nem estão
-- em ASSIGNABLE_ROLES, então useCan() é sempre false pra eles.
--
-- No /producao-propria a RLS já cobre o caso: vr_simulacoes_insert/select
-- exigem created_by = auth.uid() (só as próprias) e venda_racao_ve_todas() é
-- falso (não altera os padrões da empresa; aba de configurações só-leitura).
alter table public.user_profiles drop constraint user_profiles_role_check;

alter table public.user_profiles add constraint user_profiles_role_check
  check (role = any (array[
    'admin'::text, 'vendor'::text, 'marketing'::text, 'visualizador'::text,
    'mapa'::text, 'consultor'::text, 'pending'::text, 'rejected'::text
  ]));
