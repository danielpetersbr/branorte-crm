# Atendimento WhatsApp compartilhado — Branorte

O usuário autorizou implementar até o fim um chat no CRM existente, para todos atenderem pelo mesmo número da Ana, final 1144, mantendo a conexão da VPS e do celular. A pesquisa de Chatwoot, Front e Intercom orienta três colunas: carteira, conversa e contexto do cliente.

Requisitos: login existente por vendedor; vendedores acessam somente conversas dos contatos atribuídos ao seu vendor_id; administrador vê e atribui todas. Texto, fotos, arquivos, áudio gravado e recebido, etiquetas do CRM, notas internas, finalizar/reabrir, busca e filtros. Mensagens e erros reais, sem simular entrega ou leitura. Histórico paginado e atualização automática. Uma sessão assume a conversa por vez; assumir pausa a IA da Ana e cancela seus envios pendentes daquela conversa.

Integração comprovada: projeto Supabase flwbeevtvjiouxdjmziv; wa_chat_messages (ANA), wa_chat_labels e fila wa_scheduled_messages. A instância central Linux informou em 01/10/2026 a versão 1.70.26 e o final 1144. O transporte existente busca wa-contact-hub/scheduled e confirma sent/failed. Não reconectar, trocar provedor ou enviar testes para clientes.

Segurança: autorização no banco com perfil aprovado, nunca somente filtro React. Conversas novas sem responsável ficam visíveis só ao administrador. Notas e mídias novas usam os mesmos controles de carteira; bucket privado. Novos objetos aditivos; preservar código local sujo fora da cópia isolada. Histórico e etiquetas legados da Ana passam a respeitar carteira para vendedores; outros papéis conservam as políticas anteriores. Assumir exige sessão exclusiva com renovação. Idempotência em cada envio, chave preservada no navegador e claim atômico na entrega evitam reenvio após perda da confirmação.

Conclusão: testes de autorização, idempotência e validação; verificação do banco sem envio real; build e navegação desktop/mobile; revisão independente; publicar somente após validação. Falta de acesso externo deve ser descrita exatamente, sem afirmar integração testada de ponta a ponta se não foi.
