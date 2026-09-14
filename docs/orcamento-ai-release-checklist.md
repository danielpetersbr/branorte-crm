# Checklist de liberação — Orçamentista Branorte

## Automático

- [ ] `npm test` passou integralmente.
- [ ] `npm run build` passou sem erro TypeScript/Vite.
- [ ] `npm run test:orcamento-ai:e2e` passou com URL e token de vendedor de teste autorizados.
- [ ] O cenário Compacta 03 Master 150500-4000-4000 monofásica resulta em R$ 222.934,20, acessórios fixos de R$ 12.154,00 e Balança Eletrônica de R$ 8.728,00.
- [ ] A migração `orcamento_ai_eventos` foi aplicada antes da nova API entrar em produção.
- [ ] Advisors de segurança e desempenho foram executados novamente após a migração.

## Conferência manual autorizada

1. Entrar com um vendedor de teste aprovado e abrir `/orcamentos/montar`.
2. Criar um orçamento interno descartável por texto e repetir por áudio.
3. Conferir cliente, modelo exato, equipamentos, motores, acessórios, componentes, foto, condições e total no cartão.
4. Confirmar que o construtor não muda antes de “Aplicar ao orçamento”.
5. Aplicar e confirmar que todos os campos mudam juntos e que os acessórios fixos do modelo permanecem intactos.
6. Clicar em “Finalizar e gerar” e conferir o destinatário do WhatsApp no modal.
7. Não enviar para cliente real; parar antes do envio, salvo se o destino de teste estiver formalmente aprovado.
8. Conferir `requested`, `proposed` e `applied` em `orcamento_ai_eventos`, com vendedor correto e dados pessoais mascarados.
9. Repetir com outro vendedor e confirmar via RLS que ele não lê os eventos do primeiro.

## Implantação

- [ ] Confirmar `OPENAI_API_KEY`, `OPENAI_ORCAMENTO_MODEL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` apenas no ambiente do servidor.
- [ ] Aplicar a migração e só depois implantar a API/interface.
- [ ] Monitorar erros `orcamento_ai_failed`, sem registrar tokens, headers ou dados pessoais completos.
- [ ] Manter o endpoint legado somente durante a janela de compatibilidade; removê-lo após todos os clientes usarem o contrato transacional.
