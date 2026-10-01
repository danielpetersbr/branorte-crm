# Atendimento em tempo real

Autorizado por Daniel: concluir implementação e resolver o atraso. O CRM consultava histórico a cada 4s e lista a cada 10s; um evento recebido na VPS levou aproximadamente 180s para aparecer no banco.

1. Broadcast privado com apenas ID e tipo de mudança. Admin recebe todos; vendedor recebe seu escopo. Toda informação continua sendo lida por RPC com autorização.
2. A tela recebe eventos, agrupa notificações por 100ms e atualiza consultas relevantes. Reconexão força recuperação; consulta de segurança a cada 60s, ou intervalo original quando desconectado.
3. Extensão somente ANA: evento de mensagem acelera a captura do chat e mídia. Fila acordada por stream autenticado no servidor, preservando claim atômico e impedindo envio duplicado.
4. Testes de autorização, eventos recebidos/enviados e reconexão; revisão, publicação e evidência visual. Nenhum envio de teste a clientes.

Conexão depende da disponibilidade do WhatsApp Web, rede, Supabase e VPS; medir o caminho efetivo antes de afirmar a latência final.
