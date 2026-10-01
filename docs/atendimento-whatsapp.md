# Atendimento WhatsApp — número final 1144

Acesse **Comercial → Atendimento WhatsApp** (`/whatsapp`). A interface usa o login existente do CRM: administrador aprovado vê toda a equipe; vendedor aprovado e vinculado a um vendedor ativo vê apenas sua carteira. Cadastros e aprovação continuam em **ADM → Usuários**.

1. Filtre conversas abertas/finalizadas, etiquetas ou nome/telefone. Administrador também filtra e define o responsável.
2. Abra uma conversa ou use **+ Nova conversa** para selecionar um contato da carteira.
3. Clique **Assumir** antes de responder. A sessão fica exclusiva e a IA da Ana pausa para aquele cliente. Outra sessão não pode enviar simultaneamente.
4. Envie texto, foto, PDF, vídeo ou áudio (até 20 MB). O microfone grava até 2 minutos, permite ouvir antes de enviar e cancelar.
5. Crie/aplique etiquetas e salve notas internas. Notas não são enviadas ao cliente. **Finalizar** exige que os envios estejam concluídos; mensagem nova reabre a conversa.

**Envios recentes** mostra o estado confirmado pela conexão existente: fila da VPS, aguardando confirmação, enviada ou falha. “Enviada” não significa lida pelo cliente. Em erro incerto, **Confirmar envio** consulta/reutiliza o mesmo identificador, inclusive depois de trocar de conversa ou recarregar. Confira o histórico antes de reenviar uma mensagem cuja conexão não confirmou a entrega.

A fila existente `wa_scheduled_messages` e a extensão central Linux 1.70.26 enviam pelo WhatsApp da Ana. A conexão do celular/VPS foi mantida. O servidor faz claim atômico do envio; assumir e transferir usam a mesma trava. Transferência em Contatos também cancela envios ainda pendentes do responsável anterior e aguarda envios em andamento.

Mídias novas ficam no bucket privado `crm-chat-media`, com links temporários e carteira validada no banco. Áudios/fotos antigos expirados no WhatsApp podem aparecer como indisponíveis. Histórico é carregado em páginas de 50; conversas em páginas de 100. A tela atualiza automaticamente enquanto aberta.

Finalizar/liberar a sessão não religa a IA automaticamente. A decisão de reativação continua nos controles existentes de IA; o bloqueio humano do CRM protege contra retomada inadvertida da automação.

Referências de produto: [Chatwoot](https://github.com/chatwoot/chatwoot), [Whaticket](https://github.com/canove/whaticket-community), [Front](https://help.front.com/en/articles/2403), [Intercom](https://www.intercom.com/). Implementação nativa no CRM; não exige instalar outro atendimento nem trocar a API do número.

Validação: suíte Node, build Vite, testes SQL em transação com rollback para carteira, transferência, lease, idempotência, claim e recovery. Nenhum teste foi enviado a clientes. O teste de texto/áudio/foto com destinatário real precisa de um número de teste escolhido pelo responsável.
