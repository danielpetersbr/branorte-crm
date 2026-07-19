---
name: feedback_audit_before_recommend
description: Sempre auditar o codebase real (hooks, RPCs, componentes) antes de desenhar arquitetura de dashboard/métricas para o CRM Branorte — muita coisa já existe.
metadata:
  type: feedback
---

Ao receber um pedido de "desenhar" ou "redesenhar" um dashboard/relatório no
branorte-crm, ler primeiro os hooks e componentes reais (`src/hooks/`,
`src/pages/Dashboard.tsx` etc.) antes de propor uma arquitetura de informação do
zero. O dashboard do CRM já é maduro (sistema de veredito por vendedor, resumo do
gerente, leads em risco, leads órfãos, funil canônico) — o brief do usuário pode
descrever o estado como mais cru do que realmente é.

**Why:** Uma auditoria de código em 2026-07 (ver [[project_dashboard_gaps_2026-07]])
achou 3 campos já calculados no backend (`forecast`, `leadAging`, `ticketMedioBRL`)
que nunca chegam na tela, e 1 fórmula (`winRate`) calculada de forma injusta entre
vendedores. Se eu tivesse desenhado a resposta sem ler o código, teria proposto
"criar" métricas que já existem — desperdiçando trabalho de implementação e
perdendo credibilidade (recomendação genérica em vez de grounded).

**How to apply:** Antes de responder qualquer pedido de arquitetura de dashboard
ou métrica pro Branorte CRM, rodar Grep/Read nos hooks relevantes (`useDashboard.ts`,
`useVendedoresPainel.ts`, `useOrcamentosResumo.ts`, `usePropostasStatus.ts`,
`useDashboardExtra.ts`, e o próprio `Dashboard.tsx`) pra separar "já existe, só não
está exposto" de "precisa ser construído do zero". Isso muda a estimativa de
esforço e a credibilidade da recomendação.
