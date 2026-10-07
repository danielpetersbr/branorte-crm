begin;
set local lock_timeout = '5s';
alter table public.controle_permissoes_usuario drop constraint controle_permissoes_usuario_feature_key_check;
alter table public.controle_permissoes_usuario add constraint controle_permissoes_usuario_feature_key_check
  check (feature_key in ('menu.producao_fabrica', 'catalogo.editar'));
commit;
