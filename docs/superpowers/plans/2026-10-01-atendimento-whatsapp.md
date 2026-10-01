# Atendimento WhatsApp Implementation Plan

> For agentic workers: use superpowers:executing-plans inline, como autorizado pelo usuário.

**Goal:** Atendimento no CRM pelo WhatsApp existente 1144, com carteira individual.
**Architecture:** RPCs autenticadas e autorizadas no Postgres, histórico legado lido com escopo explícito, fila existente como transporte. Novas conversas/etiquetas/notas, armazenamento privado e lease por sessão. React Query e polling recuperável, sem depender da entrega de evento Realtime.
**Tech Stack:** React 18, TypeScript, Vite, Supabase/Postgres17, extensão existente na VPS.
**Spec:** ../specs/2026-10-01-atendimento-whatsapp.md

## Global Constraints
- Somente admin ou vendor aprovado; vendor_id decide a carteira no servidor.
- Não mandar testes a clientes nem reconectar o número.
- Mídias privadas, fila com confirmação real, IA parada quando atendimento humano.
- Preservar branch principal e alterações locais externas.

## Review Focus
- Vendedor tentando outro chat ou reassignment indevido.
- Rede cai depois de enviar: idempotência e ausência de retry automático incerto.
- Atribuição muda durante compose/upload.
- Áudio sem permissão e mídia expirada.
- IA já possui mensagem pendente ao assumir.

## Task 1 — Banco e transporte
- [ ] Escrever testes de domínio: MIME/tamanho, status real e reconciliação conservadora; observar falha.
- [ ] Criar src/lib/atendimento-chat.ts e migration com conversations, labels, notes, outbox, RLS e RPCs. Chat id string, vendor id uuid, session uuid, request uuid; public RPCs invoker encaminham a helpers private autorizados.
- [ ] RPCs list/detail/history/action/send e media por pasta do chat. Histórico 50 mensagens com cursor timestamp/id; listagem com busca/filtros e paginação.
- [ ] Atualizar wa-contact-hub de forma aditiva para claim exclusivo dos envios do novo CRM; não alterar fila legada.
- [ ] Aplicar/validar migração com transação de teste rollback para duas carteiras/admin/anônimo, lease e idempotência, sem entrega.

## Task 2 — Interface
- [ ] src/hooks/useAtendimentoChat.ts: consultas por identidade e RPC, polling, upload e cancelamento de operações ao mudar chat.
- [ ] src/pages/AtendimentoWhatsApp.tsx: três colunas, responsivo, etiquetas/notas, transferir, assumir/pausar/finalizar, composer texto/anexos e gravação.
- [ ] App/Layout/usePermissions: rota /whatsapp, menu Comercial/Atendimento WhatsApp e vendor fallback.
- [ ] Build e tsc: separar problemas prévios; verificar UI com navegador.

## Task 3 — Entrega
- [ ] Rodar suite, testes de integração rollback e advisors novos objetos.
- [ ] Revisão fresh-context da branch; corrigir falhas materiais e repetir checagens afetadas.
- [ ] Commit, PR e attach; publicação Vercel autorizada pela instrução até o fim.
- [ ] Confirmar tela publicada, registrar limites de teste real e salvar relatório em outputs.
