-- 21/10/2026, Daniel: o Fabrício (gestor de tráfego, papel 'visualizador' — único usuário desse papel) vê SÓ
-- "Anúncios Meta e Google" e "Leads Recebidos". A página /anuncios ganha permissão própria (menu.anuncios),
-- separada da Análise de Campanhas (menu.campanhas). Admin e marketing continuam vendo pela menu.campanhas e
-- ganham menu.anuncios também.
update public.role_permissions
   set permissions = (permissions - 'menu.dashboard' - 'menu.viabilidade') || '{"menu.atendimentos": true, "menu.anuncios": true}'::jsonb,
       updated_at = now()
 where role = 'visualizador';
update public.role_permissions
   set permissions = permissions || '{"menu.anuncios": true}'::jsonb, updated_at = now()
 where role in ('admin', 'marketing');
