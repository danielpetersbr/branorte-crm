# Escritório — Visão do Gestor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar o bloco Escritório para mostrar produção diária, presença e gargalos em uma leitura gerencial clara, preservando o mapa e seus controles.

**Architecture:** `EscritorioMapa` continua dono das consultas e da planta, mas converte as fontes atuais em um modelo gerencial por vendedor. Regras puras ficam em `src/lib/escritorio-gestor.ts`; um novo `EscritorioGestor` recebe esse modelo por propriedades e renderiza KPIs, alertas, tabela Hoje/Mês e o detalhe selecionado. `Disparos` passa a cota de parados já carregada para o mapa, sem criar RPC ou alterar roteamento.

**Tech Stack:** React 18, TypeScript estrito, TanStack Query, Tailwind CSS, Lucide React, Supabase, Node test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-04-escritorio-visao-gestor-design.md`

## Global Constraints

- Manter drag-and-drop de pessoas, edição de mesas, edição de paredes e os dados atuais do mapa.
- Métricas essenciais precisam de nome visível; não depender apenas de emoji, tooltip ou cor.
- “Ligações atendidas” não pode virar “ligações feitas”, pois a direção não é confiável.
- Não apresentar `funil.vendido` ou conversão acumulada como venda realizada hoje.
- Não adicionar período de sete dias; a seção Atividade Diária já cobre esse intervalo.
- Não criar novas metas, notificações, RPCs ou regras de roteamento.
- Vendedores administrativos continuam no mapa, mas não entram nos indicadores gerenciais.
- A interface deve funcionar a partir de 360 px e nos temas claro e escuro.

---

### Task 1: Modelo gerencial e regras de alerta

**Files:**
- Create: `src/lib/escritorio-gestor.ts`
- Test: `src/lib/escritorio-gestor.test.ts`

**Interfaces:**
- Consumes: dados já retornados por `escritorio_funil_vivo`, `escritorio_leads_hoje`, `orcamentos_gerados`, `escritorio_ligacoes_prospec_hoje`, `vendor_roteamento_efetivo` e `live`.
- Produces: `VendedorGestor`, `ResumoGestor`, `AlertaGestor`, `criarResumoGestor`, `criarAlertasGestor`, `ordenarVendedoresGestor` e `escolherVendedorInicial`.

- [ ] **Step 1: Write the failing tests for summaries, missing values, alerts, and ordering**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  criarAlertasGestor,
  criarResumoGestor,
  escolherVendedorInicial,
  ordenarVendedoresGestor,
  type VendedorGestor,
} from './escritorio-gestor'

const base = (overrides: Partial<VendedorGestor>): VendedorGestor => ({
  nome: 'EDER',
  status: 'ativo',
  statusLabel: 'trabalhando',
  pingSec: 10,
  versao: '1.46.0',
  atendimentos: 4,
  leads: 2,
  orcamentos: 1,
  ligacoesAtendidas: 1,
  ligacoesTotal: 2,
  followup: 17,
  quentes: 0,
  carteiraAberta: 91,
  carteiraTotal: 1371,
  parados: 0,
  fatorCota: 1,
  cortadoPorCota: false,
  ...overrides,
})

test('resume produção e conta cada pessoa em atenção uma única vez', () => {
  const vendedores = [
    base({ nome: 'RAMON', atendimentos: 4, leads: 0, orcamentos: 0, status: 'ocioso', parados: 109, fatorCota: 0, cortadoPorCota: true }),
    base({ nome: 'ALVARO', atendimentos: 6, leads: 2, orcamentos: 0, status: 'desconectado', parados: 86, fatorCota: 0, cortadoPorCota: true }),
    base({ nome: 'LUCAS', atendimentos: 8, leads: 2, orcamentos: 5 }),
  ]
  assert.deepEqual(criarResumoGestor(vendedores, true), {
    atendimentos: 18,
    leads: 4,
    orcamentos: 5,
    ativos: 1,
    total: 3,
    precisamAtencao: 2,
  })
})

test('preserva ausência de fonte como null em vez de zero', () => {
  const resumo = criarResumoGestor([base({ atendimentos: null, leads: null, orcamentos: null })], true)
  assert.equal(resumo.atendimentos, null)
  assert.equal(resumo.leads, null)
  assert.equal(resumo.orcamentos, null)
})

test('gera primeiro o bloqueio por cota e depois a queda operacional', () => {
  const alertas = criarAlertasGestor([
    base({ nome: 'ALVARO', status: 'desconectado', parados: 86, fatorCota: 0, cortadoPorCota: true }),
    base({ nome: 'RAMON', status: 'ocioso', parados: 109, fatorCota: 0, cortadoPorCota: true }),
  ], { expediente: true, cotaAtiva: true, cotaZero: 60 })
  assert.equal(alertas[0].tipo, 'cota-bloqueada')
  assert.match(alertas[0].texto, /não recebe novos leads/i)
  assert.ok(alertas.some(alerta => alerta.tipo === 'offline' && alerta.vendedor === 'ALVARO'))
  assert.ok(alertas.some(alerta => alerta.tipo === 'destaque' && alerta.vendedor === 'ALVARO'))
})

test('ordena atenção antes da produção e escolhe o primeiro alerta', () => {
  const vendedores = [base({ nome: 'JARDEL', atendimentos: 30 }), base({ nome: 'RAMON', parados: 109, cortadoPorCota: true })]
  assert.equal(ordenarVendedoresGestor(vendedores, 'atencao')[0].nome, 'RAMON')
  assert.equal(escolherVendedorInicial(vendedores, [{ id: 'RAMON-cota', vendedor: 'RAMON', tipo: 'cota-bloqueada', nivel: 'critico', titulo: '', texto: '' }]), 'RAMON')
})
```

- [ ] **Step 2: Run the focused test and verify it fails because the module does not exist**

Run:

```powershell
npm test -- src/lib/escritorio-gestor.test.ts
```

Expected: FAIL with module resolution error for `./escritorio-gestor`.

- [ ] **Step 3: Implement the pure types and functions**

```ts
export type StatusGestor = 'ativo' | 'ocioso' | 'aguardando' | 'wa_fechado' | 'verificar_wa' | 'lento' | 'versao_antiga' | 'desconectado' | 'desligado'

export type VendedorGestor = {
  nome: string
  status: StatusGestor
  statusLabel: string
  pingSec: number | null
  versao: string | null
  atendimentos: number | null
  leads: number | null
  orcamentos: number | null
  ligacoesAtendidas: number | null
  ligacoesTotal: number | null
  followup: number | null
  quentes: number | null
  carteiraAberta: number | null
  carteiraTotal: number | null
  parados: number | null
  fatorCota: number | null
  cortadoPorCota: boolean
}

export type ResumoGestor = {
  atendimentos: number | null
  leads: number | null
  orcamentos: number | null
  ativos: number
  total: number
  precisamAtencao: number
}

export type AlertaGestor = {
  id: string
  vendedor: string
  tipo: 'cota-bloqueada' | 'cota-reduzida' | 'offline' | 'destaque'
  nivel: 'critico' | 'atencao' | 'positivo'
  titulo: string
  texto: string
}

export type OrdemGestor = 'atencao' | 'atendimentos' | 'leads' | 'orcamentos' | 'ligacoes' | 'parados'

const somaOuNull = (valores: Array<number | null>) => valores.every(valor => valor == null)
  ? null
  : valores.reduce<number>((total, valor) => total + (valor ?? 0), 0)

const precisaAtencao = (v: VendedorGestor, expediente: boolean) =>
  v.cortadoPorCota || (expediente && ['wa_fechado', 'verificar_wa', 'desconectado'].includes(v.status))

export function criarResumoGestor(vendedores: VendedorGestor[], expediente: boolean): ResumoGestor {
  return {
    atendimentos: somaOuNull(vendedores.map(v => v.atendimentos)),
    leads: somaOuNull(vendedores.map(v => v.leads)),
    orcamentos: somaOuNull(vendedores.map(v => v.orcamentos)),
    ativos: vendedores.filter(v => v.status === 'ativo').length,
    total: vendedores.length,
    precisamAtencao: new Set(vendedores.filter(v => precisaAtencao(v, expediente)).map(v => v.nome)).size,
  }
}

export function criarAlertasGestor(vendedores: VendedorGestor[], cfg: { expediente: boolean; cotaAtiva: boolean; cotaZero: number }): AlertaGestor[] {
  const alertas: AlertaGestor[] = []
  for (const v of vendedores) {
    if (cfg.cotaAtiva && v.cortadoPorCota) alertas.push({ id: `${v.nome}-cota`, vendedor: v.nome, tipo: 'cota-bloqueada', nivel: 'critico', titulo: `${v.nome} não recebe novos leads`, texto: `${v.parados ?? 0} clientes parados; limite ${cfg.cotaZero}.` })
    else if (cfg.cotaAtiva && v.fatorCota != null && v.fatorCota < 1) alertas.push({ id: `${v.nome}-cota`, vendedor: v.nome, tipo: 'cota-reduzida', nivel: 'atencao', titulo: `${v.nome} recebe menos leads`, texto: `${v.parados ?? 0} clientes parados reduziram a distribuição.` })
    if (cfg.expediente && ['wa_fechado', 'verificar_wa', 'desconectado'].includes(v.status)) alertas.push({ id: `${v.nome}-status`, vendedor: v.nome, tipo: 'offline', nivel: 'critico', titulo: `${v.nome} está ${v.statusLabel}`, texto: 'Verifique o computador e o WhatsApp.' })
  }
  const lider = [...vendedores].sort((a, b) => (b.orcamentos ?? -1) - (a.orcamentos ?? -1) || (b.leads ?? -1) - (a.leads ?? -1))[0]
  if (lider && (lider.orcamentos ?? 0) > 0) alertas.push({ id: `${lider.nome}-destaque`, vendedor: lider.nome, tipo: 'destaque', nivel: 'positivo', titulo: `${lider.nome} lidera em orçamentos`, texto: `${lider.orcamentos} dos orçamentos de hoje.` })
  const peso = { critico: 0, atencao: 1, positivo: 2 } as const
  return alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.vendedor.localeCompare(b.vendedor))
}

export function ordenarVendedoresGestor(vendedores: VendedorGestor[], ordem: OrdemGestor): VendedorGestor[] {
  if (ordem === 'atencao') return [...vendedores].sort((a, b) => Number(!b.cortadoPorCota) - Number(!a.cortadoPorCota) || (b.parados ?? -1) - (a.parados ?? -1) || (b.atendimentos ?? -1) - (a.atendimentos ?? -1))
  const campo = ordem === 'ligacoes' ? 'ligacoesAtendidas' : ordem
  return [...vendedores].sort((a, b) => ((b[campo] as number | null) ?? -1) - ((a[campo] as number | null) ?? -1))
}

export function escolherVendedorInicial(vendedores: VendedorGestor[], alertas: AlertaGestor[]): string | null {
  return alertas[0]?.vendedor ?? ordenarVendedoresGestor(vendedores, 'atendimentos')[0]?.nome ?? null
}
```

- [ ] **Step 4: Run the focused tests and the whole test suite**

Run:

```powershell
npm test -- src/lib/escritorio-gestor.test.ts
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the model**

```powershell
git add src/lib/escritorio-gestor.ts src/lib/escritorio-gestor.test.ts
git commit -m "feat: add office manager view model"
```

---

### Task 2: Novo painel de leitura do gestor

**Files:**
- Create: `src/components/EscritorioGestor.tsx`
- Modify: `src/lib/escritorio-gestor.ts`
- Test: `src/lib/escritorio-gestor.test.ts`

**Interfaces:**
- Consumes: `VendedorGestor[]`, `ResumoGestor`, `AlertaGestor[]`, linhas mensais e seleção controlada.
- Produces: `EscritorioGestor({ vendedores, resumo, alertas, rankingMes, rankingMesDisponivel, selecionado, onSelecionar })`.

- [ ] **Step 1: Add a failing test for formatting missing metrics**

```ts
import { formatarMetricaGestor } from './escritorio-gestor'

test('formata métrica ausente como travessão', () => {
  assert.equal(formatarMetricaGestor(null), '—')
  assert.equal(formatarMetricaGestor(0), '0')
  assert.equal(formatarMetricaGestor(1384), '1.384')
})
```

- [ ] **Step 2: Run the focused test and verify the missing export**

Run: `npm test -- src/lib/escritorio-gestor.test.ts`

Expected: FAIL because `formatarMetricaGestor` is not exported.

- [ ] **Step 3: Implement the formatter**

```ts
export function formatarMetricaGestor(valor: number | null): string {
  return valor == null ? '—' : new Intl.NumberFormat('pt-BR').format(valor)
}
```

- [ ] **Step 4: Build the controlled manager panel**

Create `EscritorioGestor.tsx` with:

```tsx
type RankingMesGestor = { nome: string; atendimentos: number; leads: number; orcamentos: number }

type Props = {
  vendedores: VendedorGestor[]
  resumo: ResumoGestor
  alertas: AlertaGestor[]
  rankingMes: RankingMesGestor[]
  rankingMesDisponivel: boolean
  selecionado: string | null
  onSelecionar: (nome: string) => void
  mapa: ReactNode
}

export function EscritorioGestor(props: Props) {
  const [periodo, setPeriodo] = useState<'hoje' | 'mes'>('hoje')
  const [ordem, setOrdem] = useState<OrdemGestor>('atencao')
  const linhasHoje = useMemo(() => ordenarVendedoresGestor(props.vendedores, ordem), [props.vendedores, ordem])
  return (
    <div className="space-y-3">
      <ResumoDia resumo={props.resumo} />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.85fr)] gap-3 items-start">
        <div className="min-w-0">{props.mapa}</div>
        <PainelComparativo
          {...props}
          periodo={periodo}
          ordem={ordem}
          linhasHoje={linhasHoje}
          onPeriodo={setPeriodo}
          onOrdem={setOrdem}
        />
      </div>
    </div>
  )
}
```

Use os seguintes elementos visíveis:

```tsx
<div className="grid grid-cols-2 xl:grid-cols-4 gap-2" aria-label="Resumo do dia">
  <Kpi label="Atendimentos hoje" value={formatarMetricaGestor(resumo.atendimentos)} icon={MessageSquare} />
  <Kpi label="Leads recebidos" value={formatarMetricaGestor(resumo.leads)} icon={Inbox} />
  <Kpi label="Orçamentos hoje" value={formatarMetricaGestor(resumo.orcamentos)} icon={FileText} />
  <Kpi label="Precisam de atenção" value={String(resumo.precisamAtencao)} icon={TriangleAlert} tone={resumo.precisamAtencao ? 'danger' : 'neutral'} />
</div>
```

`Kpi`, `ResumoDia` e `PainelComparativo` são funções locais do mesmo arquivo. `Kpi` recebe `{ label: string; value: string; icon: LucideIcon; tone?: 'neutral' | 'danger' }`; `ResumoDia` recebe `{ resumo: ResumoGestor }`; `PainelComparativo` recebe as propriedades públicas mais `periodo`, `ordem`, `linhasHoje`, `onPeriodo` e `onOrdem`. Não exportar esses auxiliares.

Na tabela Hoje, os cabeçalhos são botões de ordenação com `aria-sort`; as colunas são Vendedor, Status, Atend., Leads, Orç., Ligações e Pendências. Na visão Mês, usar somente Vendedor, Atend., Leads e Orç. O detalhe mostra produção do dia, `followup`, `quentes`, `parados`, carteira e motivo do corte. Não mostrar `vendido` ou conversão.

- [ ] **Step 5: Run tests and build**

Run:

```powershell
npm test -- src/lib/escritorio-gestor.test.ts
npm run build
```

Expected: tests PASS and Vite production build completes without TypeScript errors.

- [ ] **Step 6: Commit the manager panel**

```powershell
git add src/components/EscritorioGestor.tsx src/lib/escritorio-gestor.ts src/lib/escritorio-gestor.test.ts
git commit -m "feat: add actionable office manager panel"
```

---

### Task 3: Integrar cota, seleção e fontes do escritório

**Files:**
- Modify: `src/pages/Disparos.tsx:16-27, 720-728`
- Modify: `src/components/EscritorioMapa.tsx:14-36, 358-620, 800-1229`
- Modify: `src/components/EscritorioGestor.tsx`

**Interfaces:**
- Consumes: `Efetivo` e `cotaCfg` já carregados em `Disparos`; consultas existentes de hoje/mês em `EscritorioMapa`.
- Produces: propriedades `efetivo`, `cotaAtiva`, `cotaZero` em `EscritorioMapa`; seleção bidirecional entre mapa e `EscritorioGestor`.

- [ ] **Step 1: Export and pass the quota data without adding a query**

Move `Efetivo` to an exported type or duplicate only the narrow public shape:

```ts
export type CotaVendedorGestor = {
  parados_topo: number
  fator_cota: number
  cortado_por_cota: boolean
}
```

Update the render in `Disparos.tsx`:

```tsx
<EscritorioMapa
  vendedores={(vendedores ?? []).map(v => ({ vendedor_nome: v.vendedor_nome, online: v.online || v.so_recebe }))}
  live={liveMesas}
  efetivo={efetivo}
  cotaAtiva={!!cotaCfg?.cota_ativa}
  cotaZero={cotaCfg?.cota_zero ?? 60}
/>
```

- [ ] **Step 2: Make query availability explicit**

Destructure query flags in `EscritorioMapa`:

```ts
const { data: orcHoje, isFetched: orcHojeFetched } = useQuery(...)
const { data: leadsHoje, isFetched: leadsHojeFetched } = useQuery(...)
const { data: ligProsp, isFetched: ligProspFetched } = useQuery(...)
const { data: funil, isFetched: funilFetched } = useQuery(...)
const { data: rankingMesRaw, isFetched: rankingMesFetched, isError: rankingMesError } = useQuery(...)
```

Use the flags when building `VendedorGestor`, returning `null` before a source has completed instead of returning zero.

- [ ] **Step 3: Normalize all sellers once**

Create `vendedoresGestor` with `useMemo` and the exact source mapping:

```ts
const vendedoresGestor = useMemo<VendedorGestor[]>(() => vendedores.map(v => {
  const nome = v.vendedor_nome
  const f = funil?.[nome]
  const lp = ligProspDe(nome)
  const quota = efetivo?.[nome]
  const ls = live?.[nome]
  return {
    nome,
    status: ls?.status ?? 'desligado',
    statusLabel: STATUS_CFG[ls?.status ?? 'desligado'].label,
    pingSec: ls?.pingSec ?? null,
    versao: ls?.versao ?? null,
    atendimentos: funilFetched ? (f?.atendimentos ?? 0) : null,
    leads: leadsHojeFetched ? leadsDe(nome) : null,
    orcamentos: orcHojeFetched ? orcDe(nome) : null,
    ligacoesAtendidas: ligProspFetched ? (lp?.atendidas ?? 0) : null,
    ligacoesTotal: ligProspFetched ? (lp?.ligTotal ?? 0) : null,
    followup: funilFetched ? (f?.followup ?? 0) : null,
    quentes: funilFetched ? (f?.quente ?? 0) : null,
    carteiraAberta: funilFetched ? (f?.aberto ?? 0) : null,
    carteiraTotal: funilFetched ? (f?.totalChats ?? 0) : null,
    parados: quota ? quota.parados_topo : null,
    fatorCota: quota ? Number(quota.fator_cota) : null,
    cortadoPorCota: cotaAtiva && !!quota?.cortado_por_cota,
  }
}), [vendedores, live, funil, funilFetched, ligProsp, ligProspFetched, efetivo, cotaAtiva, leadsHoje, leadsHojeFetched, orcHoje, orcHojeFetched])
```

- [ ] **Step 4: Synchronize selection between desks and rows**

Use one state, `vendedorSelecionado`, for the manager panel. When a populated desk is clicked in normal mode, select that seller and keep the existing mobile `FunilCard` behavior. Pass `onSelecionar={setVendedorSelecionado}` to `EscritorioGestor`. Add `aria-pressed={vendedorSelecionado === nome}` and an `aria-label` with status and three daily metrics to populated desks.

- [ ] **Step 5: Replace KPI chips and both ranking columns**

Remove:

- the inline KPI chip row;
- `RANK_METRICAS` and `RankRow`;
- the `Ranking do dia` aside;
- the `Ranking do mês` aside;
- the status/metric legend that explains the old emoji strip.

Render:

```tsx
<div className="space-y-3">
  <EscritorioGestor
    vendedores={vendedoresGestor}
    resumo={criarResumoGestor(vendedoresGestor, expediente)}
    alertas={criarAlertasGestor(vendedoresGestor, { expediente, cotaAtiva, cotaZero })}
    rankingMes={(rankingMesRaw ?? []).map(r => ({ nome: r.vend, atendimentos: r.atendimentos, leads: r.leads, orcamentos: r.orcamentos }))}
    rankingMesDisponivel={rankingMesFetched && !rankingMesError}
    selecionado={vendedorSelecionado}
    onSelecionar={setVendedorSelecionado}
    mapa={mapaEscritorio}
  />
</div>
```

Extraia o JSX atual da planta para a constante local `mapaEscritorio: ReactNode` e entregue-a à propriedade `mapa`. `EscritorioGestor` será o único dono da grade responsiva; os quatro KPIs ficam acima da grade, a planta na primeira coluna e o painel comparativo na segunda. Não duplicar o estado.

- [ ] **Step 6: Verify integration**

Run:

```powershell
npm test -- src/lib/escritorio-gestor.test.ts
npm run build
```

Expected: PASS. Search must return no daily ranking fields for accumulated sales:

```powershell
rg -n "rankMetric|vendido.*hoje|conversao.*hoje|Ranking do dia|Ranking do mês" src/components/EscritorioMapa.tsx src/components/EscritorioGestor.tsx
```

Expected: no matches except intentional user-facing period labels in `EscritorioGestor`.

- [ ] **Step 7: Commit the integration**

```powershell
git add src/pages/Disparos.tsx src/components/EscritorioMapa.tsx src/components/EscritorioGestor.tsx
git commit -m "feat: integrate manager view with live office"
```

---

### Task 4: Responsive, accessibility, and regression verification

**Files:**
- Modify: `src/components/EscritorioMapa.tsx`
- Modify: `src/components/EscritorioGestor.tsx`
- Modify: `src/lib/escritorio-gestor.test.ts`

**Interfaces:**
- Consumes: completed manager panel and shared selection.
- Produces: final responsive and accessible office block with no map-control regressions.

- [ ] **Step 1: Add edge-case tests**

```ts
test('cota parcial gera aviso sem dizer que o vendedor está bloqueado', () => {
  const [alerta] = criarAlertasGestor([base({ nome: 'JARDEL', parados: 37, fatorCota: 0.52, cortadoPorCota: false })], { expediente: true, cotaAtiva: true, cotaZero: 60 })
  assert.equal(alerta.tipo, 'cota-reduzida')
  assert.doesNotMatch(alerta.titulo, /não recebe/i)
})

test('fora do expediente não transforma ausência de WhatsApp em alerta', () => {
  const alertas = criarAlertasGestor([base({ status: 'desconectado' })], { expediente: false, cotaAtiva: false, cotaZero: 60 })
  assert.equal(alertas.length, 0)
})

test('vendedor sem alerta inicial seleciona o líder de atendimentos', () => {
  assert.equal(escolherVendedorInicial([base({ nome: 'EDER', atendimentos: 4 }), base({ nome: 'JARDEL', atendimentos: 30 })], []), 'JARDEL')
})
```

- [ ] **Step 2: Verify keyboard and accessible labels**

Ensure:

- populated desks are real buttons or have equivalent keyboard semantics;
- selected row and desk expose `aria-selected`/`aria-pressed`;
- sortable headers expose `aria-sort`;
- every KPI and alert has visible text;
- the detail uses `aria-live="polite"`;
- no essential content exists only in `title`.

- [ ] **Step 3: Verify responsive classes**

At `360px`, the order must be KPIs → alerts/table/detail → map, avoiding a full map before actionable information. At `xl`, use KPIs across the top and map/panel side by side. Wrap the table in `overflow-x-auto` and keep the map at `min-w-0`.

- [ ] **Step 4: Run complete automated verification**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected: all tests PASS, production build succeeds, and `git diff --check` prints nothing.

- [ ] **Step 5: Run visual smoke tests**

Start the local app with `npm run dev`, open `/disparos`, and verify at widths 1440, 768 and 360 pixels in both themes:

- values and labels do not overlap;
- alert text remains readable;
- table stays inside its container;
- selecting a table row highlights the matching desk;
- selecting a desk updates the detail;
- modes Paredes and Mover mesas still work;
- existing drag-and-drop remains functional;
- monthly unavailable state does not erase the Today view.

- [ ] **Step 6: Commit final polish**

```powershell
git add src/components/EscritorioMapa.tsx src/components/EscritorioGestor.tsx src/lib/escritorio-gestor.test.ts
git commit -m "fix: polish office manager view accessibility"
```

- [ ] **Step 7: Final repository check**

Run:

```powershell
git status --short
git log -5 --oneline
```

Expected: only intentional changes are committed and the last commits correspond to the model, panel, integration, and polish.
