-- Destination CRM only. No source production changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
  IF to_regclass('public.controle_permissoes_usuario') IS NOT NULL THEN
    RAISE EXCEPTION 'override_table_already_exists_review_required';
  END IF;
  IF (SELECT count(*) FROM public.role_permissions WHERE role = 'admin') <> 1 THEN
    RAISE EXCEPTION 'admin_role_cardinality_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE permissions IS NOT NULL AND jsonb_typeof(permissions) <> 'object') THEN
    RAISE EXCEPTION 'role_permissions_shape_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE role = 'admin' AND permissions ? 'menu.producao_fabrica' AND permissions->'menu.producao_fabrica' IS DISTINCT FROM 'true'::jsonb) THEN
    RAISE EXCEPTION 'existing_factory_denial_preserved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE role <> 'admin' AND permissions->'menu.producao_fabrica' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'existing_other_factory_grants_review_required';
  END IF;
END $$;

CREATE TABLE public.controle_permissoes_usuario (
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key = 'menu.producao_fabrica'),
  permitido boolean NOT NULL,
  confirmado_por uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  confirmado_em timestamptz,
  PRIMARY KEY (user_id, feature_key)
);
ALTER TABLE public.controle_permissoes_usuario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.controle_permissoes_usuario FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.controle_permissoes_usuario TO authenticated, service_role;
CREATE POLICY controle_permissoes_select ON public.controle_permissoes_usuario
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.approved_at IS NOT NULL
      AND p.role IN ('admin', 'financeiro', 'vendor', 'mapa', 'marketing', 'visualizador')
      AND (p.id = controle_permissoes_usuario.user_id OR p.role = 'admin')
  )
);

DO $$
DECLARE
  before_admin text;
  before_others text;
BEGIN
  SELECT md5((coalesce(permissions, '{}'::jsonb) - 'menu.producao_fabrica')::text)
    INTO before_admin FROM public.role_permissions WHERE role = 'admin';
  SELECT md5(coalesce(string_agg(role || coalesce(permissions::text, 'NULL'), '|' ORDER BY role), ''))
    INTO before_others FROM public.role_permissions WHERE role <> 'admin';
  UPDATE public.role_permissions
  SET permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('menu.producao_fabrica', true)
  WHERE role = 'admin' AND NOT (coalesce(permissions, '{}'::jsonb) ? 'menu.producao_fabrica');
  IF before_admin IS DISTINCT FROM (SELECT md5((coalesce(permissions, '{}'::jsonb) - 'menu.producao_fabrica')::text) FROM public.role_permissions WHERE role = 'admin') THEN
    RAISE EXCEPTION 'unrelated_admin_permissions_changed';
  END IF;
  IF before_others IS DISTINCT FROM (SELECT md5(coalesce(string_agg(role || coalesce(permissions::text, 'NULL'), '|' ORDER BY role), '')) FROM public.role_permissions WHERE role <> 'admin') THEN
    RAISE EXCEPTION 'other_role_permissions_changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role = 'admin' AND permissions->'menu.producao_fabrica' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'factory_capability_not_enabled';
  END IF;
END $$;
COMMIT;
