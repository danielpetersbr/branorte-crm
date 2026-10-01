# Atendimento WhatsApp — número final 1144

Acesse **Comercial → Atendimento WhatsApp** (`/whatsapp`). A interface usa o login existente do CRM: administrador aprovado vê toda a equipe; vendedor aprovado e vinculado a um vendedor ativo vê apenas sua carteira. Cadastros e aprovação continuam em **ADM → Usuários**.

1. Filtre conversas abertas/finalizadas, etiquetas ou nome/telefone. Administrador também filtra e define o responsável.
2. Abra uma conversa ou use **+ Nova conversa** para selecionar um contato da carteira.
3. Clique **Assumir** antes de responder. A sessão fica exclusiva e a IA da Ana pausa para aquele cliente. Outra sessão não pode enviar simultaneamente.
4. Envie texto, foto, PDF, vídeo ou áudio (até 20 MB). O microfone grava até 2 minutos, permite ouvir antes de enviar e cancelar.
5. Crie/aplique etiquetas e salve notas internas. Notas não são enviadas ao cliente. **Finalizar** exige que os envios estejam concluídos; mensagem nova reabre a conversa.

**Envios recentes** mostra o estado confirmado pela conexão existente: fila da VPS, aguardando confirmação, enviada ou falha. “Enviada” não significa lida pelo cliente. Em erro incerto, **Confirmar envio** consulta/reutiliza o mesmo identificador, inclusive depois de trocar de conversa ou recarregar. Confira o histórico antes de reenviar uma mensagem cuja conexão não confirmou a entrega.

A fila existente `wa_scheduled_messages` e a extensão central Linux enviam pelo WhatsApp da Ana. A versão 1.70.28 foi instalada apenas na instância ANA. A conexão do celular/VPS foi mantida. O servidor faz claim atômico do envio; assumir e transferir usam a mesma trava. Transferência em Contatos também cancela envios ainda pendentes do responsável anterior e aguarda envios em andamento.

Mídias novas ficam no bucket privado `crm-chat-media`, com links temporários e carteira validada no banco. Áudios/fotos antigos expirados no WhatsApp podem aparecer como indisponíveis. Histórico é carregado em páginas de 50; conversas em páginas de 100.

Com **Tempo real conectado**, a tela recebe eventos privados e atualiza as conversas afetadas. Uma consulta a cada 60 segundos recupera eventuais mudanças perdidas. Em **Reconectando chat**, o histórico e os detalhes são consultados a cada 4 segundos, e a lista a cada 10 segundos. **Verificar VPS** indica que a informação de sincronização está ausente, antiga ou não corresponde ao final 1144. O indicador confirma os eventos do CRM e a última sincronização registrada; a latência efetiva também depende da captura no WhatsApp Web, da VPS e do banco.

No transporte, novas mensagens acordam a captura do chat na extensão. Novos envios do CRM notificam o worker ANA por um stream autenticado em `wa-contact-hub/crm-events`; a consulta periódica da fila continua como recuperação. O navegador recebe apenas IDs e tipos de mudança pelo Supabase Broadcast privado. O conteúdo é consultado novamente pelas RPCs que validam a carteira.

Finalizar/liberar a sessão não religa a IA automaticamente. A decisão de reativação continua nos controles existentes de IA; o bloqueio humano do CRM protege contra retomada inadvertida da automação.

Referências de produto: [Chatwoot](https://github.com/chatwoot/chatwoot), [Whaticket](https://github.com/canove/whaticket-community), [Front](https://help.front.com/en/articles/2403), [Intercom](https://www.intercom.com/). Implementação nativa no CRM; não exige instalar outro atendimento nem trocar a API do número.

Validação de código: 1.113 testes Node, 14 testes do transporte, build Vite e testes SQL de autorização, carteira, transferência, lease, idempotência, claim e recuperação. A checagem TypeScript não encontrou erros nos novos arquivos; a checagem global mantém erros prévios em módulos legados. Nenhum teste foi enviado a clientes.

A atualização foi publicada pela [PR 122](https://github.com/danielpetersbr/branorte-crm/pull/122), com correções posteriores até `8f17174`. Após recuperação do Supabase em 01/10/2026, três consultas da API retornaram HTTP 200 em 128–176ms. O heartbeat da ANA confirmou versão 1.70.28 e final 1144; a tela publicada exibiu conexão ativa e histórico, inclusive após sair e voltar rapidamente à rota. A lista de contatos em **Nova conversa** carregou; o diálogo foi cancelado sem criar atendimento. Mensagens naturais do próprio Daniel apareceram no histórico. O popup da extensão na VPS confirmou PC central e sincronização periódica ativa.

Uma notificação sintética chegou ao navegador em aproximadamente 388ms. Um receptor local conectado ao endpoint autenticado recebeu `wake` em aproximadamente 386ms, usando o mesmo payload vazio do trigger da fila; essa prova valida o endpoint, sem medir o consumidor SSE dentro da extensão. Uma mensagem natural do próprio Daniel apresentou diferença de aproximadamente 1,6s entre o timestamp da mensagem e o registro no banco. São amostras observadas, com relógios e resolução de timestamp distintos; não medem uma latência garantida nem o percurso completo de um envio. Uma tentativa anterior de `wake` não foi observada pelo receptor dentro da janela de teste; duas repetições posteriores passaram, e a recuperação periódica continua habilitada. A entrega ponta a ponta de texto, áudio e foto não foi confirmada por um envio a destinatário real.
