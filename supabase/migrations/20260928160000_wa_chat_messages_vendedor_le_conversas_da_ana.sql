-- O Funil de Vendas liberou pro vendedor o quadro da ANA (chip da IA que recebe
-- o lead do anuncio). O quadro (wa_chat_labels) ja era legivel por qualquer
-- autenticado, mas o historico ficava vazio: esta policy so deixava ler as
-- mensagens do proprio vendedor. Antes: is_admin() OR vendedor_nome = current_vendedor_nome()
alter policy wa_chat_messages_select_dono on public.wa_chat_messages
  using (is_admin() OR vendedor_nome = current_vendedor_nome() OR vendedor_nome = 'ANA');
