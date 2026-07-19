---
name: project_dashboard_gaps_2026-07
description: Gaps concretos no Dashboard.tsx do CRM Branorte identificados em auditoria de 2026-07 — dados já calculados que nunca chegam na tela.
metadata:
  type: project
---

Em 2026-07, Daniel pediu um redesenho da arquitetura de informação do dashboard
(`src/pages/Dashboard.tsx`) do branorte-crm — "mais útil, me ajuda a tomar decisão".
Auditoria do código revelou que o dashboard já é bem mais maduro do que o brief
sugeria: existe um sistema de veredito por vendedor (cobrar/atenção/ok,
`Dashboard.tsx:1299-1312`), "Resumo do gerente", leads em risco, leads órfãos,
funil canônico com "onde vaza".

## Gaps reais encontrados (não teóricos — código lido)

1. **`forecast`** (`useDashboard.ts:304-314, 802-811`) — ritmo diário, projeção de
   fim de mês, % da meta (META_MENSAL_REAIS = R$2.000.000, `useDashboard.ts:12`).
   Calculado, **nunca renderizado** em nenhum componente do Dashboard.tsx.

2. **`leadAging`** (`useDashboard.ts:251-255, 748-752`) — R$ parado em 4 faixas
   (24-48h, 48h-7d, 7d-30d, +30d). Calculado, **nunca renderizado**. É exatamente
   o dado que faltava pro bloco "Agir Agora" (orçamento envelhecendo sem retorno).

3. **`ticketMedioBRL`** (`useOrcamentosResumo.ts:16`) — usado, mas só dentro da
   seção 1 "Visão geral", que é colapsável e fecha por padrão. Deveria estar no
   hero pra negócio de ticket alto.

4. **`winRate` do vendedor** (`SlaVendedor.winRate`, `useDashboard.ts:265`) — hoje
   é `vendidos / totalLeads`. Isso mistura conversão de topo de funil (qualidade
   do lead recebido) com fechamento (habilidade do vendedor). Métrica correta pra
   comparar vendedores entre si é `vendidos / orçamentos_enviados` — isolando
   fechamento de quantidade/qualidade de lead recebido.

**Why:** Daniel disse que o dashboard atual é "mais informativo que acionável",
mas boa parte da solução não é construir do zero — é puxar dado que já existe do
backend pra cima na UI, e corrigir uma fórmula de fairness entre vendedores.

**How to apply:** Antes de propor qualquer métrica nova pro dashboard Branorte,
ler `useDashboard.ts`, `useVendedoresPainel.ts`, `useOrcamentosResumo.ts`,
`usePropostasStatus.ts`, `useDashboardExtra.ts` primeiro — é comum achar que o
campo já está calculado, só não exposto. Ver também [[feedback_audit_before_recommend]].
