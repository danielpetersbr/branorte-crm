# Melhorias do atendimento WhatsApp

Solicitação aprovada: implementar as melhorias propostas na conversa em 02/10/2026. Usar o CRM existente e a conexão ANA final 1144; preservar autorização por carteira, sessão exclusiva, idempotência e autoria. Nenhum teste enviará mensagem a clientes.

## Comportamento

1. Fila **Aguardando resposta** independente de leitura: conversa aberta cuja última mensagem confirmada veio do cliente. Mostrar espera e ordenar os pendentes mais antigos com paginação estável no servidor; estados de leitura continuam independentes.
2. Botão **Assumir atendimento** no composer, sem envio automático, e foco após claim. Mostrar responsável da carteira e atendente com lease ativo separadamente. Um rascunho pode ser preparado antes de assumir; envio, upload e microfone continuam protegidos pelo lease.
3. Busca autorizada em todo o histórico da conversa, paginada. Responder citando uma mensagem com prévia, cancelamento e vínculo preservado em confirmação idempotente. O servidor valida a mensagem citada na mesma conversa; a VPS transmite a opção oficial de resposta.
4. Um retorno interno pendente por conversa, horário escolhido no fuso do navegador, lembrete visual e fila de atrasados. Concluir/cancelar retorno não envia nada. Acesso acompanha carteira, inclusive transferência.
5. Respostas rápidas da equipe salvas no servidor, criação/edição/exclusão por administrador; pessoais atuais continuam disponíveis. Inserir no campo exige revisão antes de enviar.
6. Painel com pedidos/orçamentos do contato via vínculos existentes e autorização do CRM. Mostrar resumo e links; não inferir cliente por nome parecido.
7. Resumo da carteira/equipe com contadores reais (não apenas páginas carregadas): aguardando resposta, sem responsável, retornos vencidos e finalizados hoje. Métrica de resposta identifica período/limites e usa registros reais.

## Divisão de trabalho

- Banco: migração/RPCs e testes SQL transacionais; tipos de dados do chat. Não aplicar em produção até revisão.
- Interface: tela, hook, helpers/testes de busca/espera/retorno/citação; integrar componentes compartilhados e painel.
- Transporte: investigar/implementar resposta citada em patch isolado da ANA, testar comportamento e preservar identificação de mensagens/fotos. Deployment somente após revisão.
- Integração: respostas rápidas compartilhadas e componente de resumo da equipe; documentação, revisão cruzada, testes completos, build, migração e publicação.

## Verificação

Baseline: 1.211 testes passaram, zero falhas, HEAD ed50b24. Testes novos devem demonstrar autorização, isolamento de carteira, leitura sem apagar espera, filtros e paginação estáveis, concorrência/idempotência, citação de outra conversa rejeitada, retorno sem envio, templates sem acesso anônimo e dados de venda autorizados. SQL em rollback, testes de transporte sem envio real. Executar suite completa/build; publicar PR com checks no HEAD exato e checar UI e runtime em produção. Registrar limitações reais.

## Progresso

- [x] Revisão de contexto, requisitos e baseline.
- [x] Banco e contratos.
- [x] Tela/fluxo dos vendedores.
- [x] Resposta citada no transporte.
- [x] Componentes de equipe.
- [ ] Revisão/testes/publicação/QA.

Validação antes da publicação da interface: 1.226 testes Node e 62 testes de transporte passaram; build Vite passou. A checagem TypeScript não encontrou diagnósticos nos arquivos desta mudança; o projeto mantém erros anteriores em módulos legados. Revisões cruzadas concluídas. Migração aplicada em produção como `20261002120550`, seguida de testes SQL transacionais com rollback. Os únicos apontamentos do advisor para objetos novos são informativos sobre ausência intencional de políticas nas duas tabelas privadas de métricas, sem acesso direto de usuários. ANA 1.70.33 ativa às 12:09:21 UTC, final 1144 e WPP pronto; atualização natural sem reinício ou envio real a clientes. Publicação da interface e QA visual ainda pendentes.
