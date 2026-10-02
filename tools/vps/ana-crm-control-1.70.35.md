# ANA: encerramento no CRM e supressão conservadora — 1.70.35

Estado: **arquivos publicados, aguardando atualização natural do runtime**. Nenhum envio real, bloqueio WhatsApp ou reinício foi realizado.

## Contrato

- A migration `20261002154030_crm_chat_closure_reasons.sql` fornece os RPCs exclusivos de `service_role`: `crm_ana_automation_gate(p_chat_id)` e `crm_ana_close_label_gate(p_chat_id,p_close)`.
- A nova rota POST `wa-contact-hub/ana-automation-gate` preserva a autenticação compartilhada existente, aceita apenas vendedor ANA e ID de conversa individual real. Corpo máximo de 2.048 caracteres. Não devolve credencial privilegiada.
- Sem `close`, responde à decisão de automação do servidor. Com `close`, valida exclusivamente a aplicação da etiqueta do encerramento, sem autorizar atendimento automático.
- A fila existente recebe `payload.crm_close={conversation_id,marker,label_id}` e nome real em `payload.etiqueta`. `origem` é auditoria; o transporte reconhece `crm_close` independentemente dela.

## Transporte

A porta de ativação e o ciclo da IA consultam o gate antes de ler/preprocessar as mensagens. Uma resposta gerada também é conferida antes do envio automático. HTTP inválido, timeout ou indisponibilidade negam automação; não avançam o registro de mensagem tratada ou visto da porta. Timeout de 5 s, nova tentativa de falha no máximo a cada 5 s por conversa/marcador, cache limitado a 500 entradas. Permissões positivas não são guardadas em cache.

O encerramento usa somente o ID de etiqueta existente e confirmado pelo servidor. Confere conversa, geração e catálogo antes da mutação; preserva etiquetas de vendedor, neutras e manuais, removendo apenas outras etapas do funil. Erros reais do WPP chegam ao ACK existente. Uma geração superada não aplica a etiqueta: recebe erro terminal `superada: crm_close_stale`, pois a Edge legada não possui estado `ignored`. Falha temporária de catálogo/gate utiliza o retry já existente, sem registrar aplicação bem-sucedida.

O filtro local ignora exclusivamente três ou mais IDs distintos com a **mesma saudação pura** em uma janela lida sem outro conteúdo do cliente. Primeiro contato e duas saudações seguem normais. Pergunta, preço, produto, pedido, número, anúncio, texto desconhecido, direção desconhecida ou mídia mantêm o fluxo. Não grava bloqueio permanente nem altera contatos; nova intenção diferente volta ao processamento normal. O gate determinístico existente da Ana continua responsável pelos casos comprovados de conteúdo não comercial. Esta versão não bloqueia pessoas no WhatsApp.

Outros vendedores continuam nos caminhos existentes. As capturas, fotos, autoria por ID, mídias e citações da versão 34 são preservadas.

## Provas locais

- Suíte real de transporte: **105 testes passaram**, incluindo 74 regressões e 31 novos testes de controle/hub. Executa funções reais em VM com APIs sintéticas: porta, ciclo IA, fila, falha de rede, geração obsoleta, contrato SQL sem origem, preservação de etiquetas e autenticação.
- Novos testes de transporte falham contra a versão 34, que não tem os controles.
- Sintaxe dos três arquivos JavaScript: passou.
- `ValidateOnly`: passou, sem mutações remotas.
- Patch sem contexto para excluir credenciais legadas; reconstrução deve usar `git -c core.autocrlf=false apply --unidiff-zero` e comparar os quatro SHA-256.
- Logs: `outputs/whatsapp-ana-control-tests.log`, `whatsapp-ana-control-red.log`, `whatsapp-ana-hub-red.log` na raiz da tarefa.

Baseline cloud do hub: **v15 ACTIVE**, bundle SHA-256 `f7bb39496f92d0af66b957b489cf3f54dc140929898a892f1d3812f33b66825d`, obtido pelo conector oficial. A rota nova exige os RPCs implantados antes da extensão.

## Publicação e reversão

Ordem obrigatória: migration/RPCs → hub com rota nova e guardas da Edge Ana → revisão final → extensão 35. O script `deploy-ana-crm-control-1.70.35.ps1` fixa hashes do baseline 34 e do candidato, verifica caminhos reais sem symlink, preserva owner/mode, salva quatro arquivos originais e publica atomicamente o manifesto por último. Deve atuar somente em `/opt/branorte/ext-ana`. Atualização natural; não recarregar/desconectar o telefone ou reiniciar o container.

| Arquivo | SHA-256 candidato |
| --- | --- |
| background.js | `81ff5857ef4955b729ed96756bd6667c3ac18849b85983bd5a8a87113d791fdb` |
| bsb-detect-chat.js | `8024a5ca87d91a8d5a92b243a7ad575e5ff33ba412f0e6914cc6bc890c36a9ea` |
| painel-worker.js | `84344b5a383febb21825613720ebba235d3fd4398761dc0d3abf902c10fb1127` |
| manifest.json | `a10390c60f853bf0828af4a576576de9011e8c4e482b8d61097fc13f965a708a` |

Backup confirmado: `/opt/branorte/backups/crm-media-1.70.35-20261002T154146Z-c40d8bb8`. Os quatro hashes montados coincidem com o candidato. Ativação natural pelo updater, container ativo com zero reinícios. Prova em `outputs/whatsapp-ana-control-release.log` na raiz da tarefa. Para reversão, validar o backup e restaurar arquivos originais com metadados salvos e manifesto por último, sem tocar no perfil/login. O script recusa baseline diferente; nunca sobrescrever uma atualização concorrente.

Publicação autorizada em **02/10/2026, 15:41 UTC**. Backup: `/opt/branorte/backups/crm-media-1.70.35-20261002T154146Z-c40d8bb8`. Os quatro hashes publicados e montados em `/ext` correspondem à tabela. Modos 644 e owners originais preservados (background/shim/manifest 0:0; agente 1000:1000). Container `running`, reinícios 0, iniciado em `2026-10-01T20:11:36.129357833Z`, sem alteração. Heartbeat inicial às `15:42:07.369 UTC`: background/residente 34, WPP pronto, final 1144; atualização natural ainda pendente. Evidência final de ativação será registrada no log de entrega da tarefa sem alterar estes hashes.

Limite: a validação do servidor e a mutação no WhatsApp são operações distintas; uma nova fala pode chegar entre elas. A geração impede ações já obsoletas antes da aplicação, e o gatilho do inbound cancela ações pendentes. Não é uma transação distribuída com o WhatsApp.
