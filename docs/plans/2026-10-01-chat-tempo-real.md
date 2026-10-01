# Atendimento em tempo real

Autorizado por Daniel: concluir implementação e resolver o atraso. O CRM consultava histórico a cada 4s e lista a cada 10s; um evento recebido na VPS levou aproximadamente 180s para aparecer no banco.

1. Broadcast privado com apenas ID e tipo de mudança. Admin recebe todos; vendedor recebe seu escopo. Toda informação continua sendo lida por RPC com autorização.
2. A tela recebe eventos, agrupa notificações por 100ms e atualiza consultas relevantes. Reconexão força recuperação; consulta de segurança a cada 60s, ou intervalo original quando desconectado.
3. Extensão somente ANA: evento de mensagem acelera a captura do chat e mídia. Fila acordada por stream autenticado no servidor, preservando claim atômico e impedindo envio duplicado.
4. Testes de autorização, eventos recebidos/enviados e reconexão; revisão, publicação e evidência visual. Nenhum envio de teste a clientes.

Conexão depende da disponibilidade do WhatsApp Web, rede, Supabase e VPS; medir o caminho efetivo antes de afirmar a latência final.

## Estado da entrega em 01/10/2026

- Broadcast privado aplicado na migração `20261001195709`; RPCs mantêm a autorização dos dados. Reconexão recupera consultas, atualização saudável tem recuperação a cada 60s, e falha do canal usa histórico/detalhe a cada 4s e lista a cada 10s.
- Frontend publicado pela PR 122 (`58429cc`), com correções posteriores até `8f17174`. Hub Edge v14 usa autenticação server-side para o stream do worker ANA e encerra canais/timers em cancelamento ou falha.
- Extensão 1.70.28 instalada somente em ANA, com versão conferida no navegador da VPS e heartbeat final 1144 confirmado às 20:30:35 UTC após recuperação da API.
- Revisão independente conferiu RLS, payload mínimo, invalidadores e reconexão. Corrigidos o cancelamento durante autenticação do SSE e a disputa entre remoção/criação de canais na navegação rápida.
- Passaram 1.113 testes Node, 14 testes do transporte, build Vite e verificações SQL de autorização. Não surgiram erros TypeScript nos arquivos novos; há erros globais prévios em módulos legados. Não foram enviados testes a clientes.
- A API de dados apresentou timeout mesmo com consulta de perfil SQL rápida. Aplicado ajuste do timeout do cache de metadados do PostgREST (`20261001201931`), preservando timeouts dos clientes; reinício oficial do projeto realizado como último recurso. Após recuperação, três chamadas HTTP retornaram 200 em 128–176ms; tela publicada carregou histórico e conectou após remontagem rápida.
- Evento sintético do chat chegou ao DOM em aproximadamente 388ms. Receptor local do endpoint SSE autenticado recebeu `wake` em aproximadamente 386ms usando o payload vazio exato do trigger; uma repetição anterior com payload de diagnóstico levou cerca de 391ms. Uma primeira amostra não foi recebida na janela de teste de 45s, portanto consulta de recuperação permanece necessária. Isso valida o endpoint; o consumo do SSE dentro da extensão não foi medido.
- QA da tela publicada confirmou reconexão após ir ao dashboard e voltar, lista de contatos completamente carregada em Nova conversa (cancelada) e histórico de mensagens naturais do próprio Daniel. Evidência visual salva em `outputs/atendimento-publicado.jpg` da tarefa. Popup na VPS confirmou PC central e sincronização periódica de 30s ativa.
- Uma mensagem natural do próprio Daniel mostrou diferença de aproximadamente 1,6s entre timestamp WhatsApp e `synced_at`; essa amostra usa relógios e resolução distintos e não cronometra sua chegada à tela. Os testes sintéticos não inseriram fila nem enviaram mensagens. A entrega a destinatário real de texto/áudio/foto permanece sem teste, e nenhuma latência garantida foi estabelecida.
