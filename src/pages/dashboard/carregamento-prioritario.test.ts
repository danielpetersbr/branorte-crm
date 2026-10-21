import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

function load(file: string, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, React, Map, Set, Date, require: (name: string) => {
    assert.ok(name in imports, `Import não simulado: ${name}`)
    return imports[name]
  } })
  return exports as Record<string, any>
}

function overview(primary: Record<string, unknown>, secondary: Record<string, unknown> = {}) {
  let requests = 0
  const hook = () => { requests++; return secondary }
  const empty = () => null
  const imports: Record<string, unknown> = {
    react: { ...React, useMemo: (fn: () => unknown) => fn(), useState: () => [null, empty] },
    '@/hooks/useDashboard': { useDashboard: () => primary },
    './DashboardFilterContext': { useJanela: () => ({ preset: 'hoje', periodoLabel: 'Hoje', temPeriodo: true }) },
    './tabs': { useDashboardTab: () => ['geral', empty], irPara: empty },
    './ui/Metric': { Metric: ({ label, valor }: any) => React.createElement('p', {}, `${label}: ${valor}`) },
    './ui/format': { n: String, brl: String, pct: String, primeiroNome: String },
    '@/lib/vendedores-fora-do-ranking': { foraDoRanking: () => false },
  }
  for (const name of ['useDashboardEtiquetas', 'useDashboardExtra', 'useDashboardVendedorFunil', 'useOrcamentosResumo', 'usePropostasStatus', 'useVendedorCobertura', 'useFunilUnion', 'useVendasReais', 'useLeadsContexto']) {
    imports[`@/hooks/${name}`] = { [name]: () => {
      const result = hook()
      if (result.data === undefined) return result
      if (name === 'useVendedorCobertura') return { ...result, data: [] }
      if (name === 'useDashboardExtra') return { ...result, data: { atendimentos: { hoje: 39, ontem: 70 }, atendimentosTroca: { hoje: 64, hojeComVendedor: 22, hojeSoAna: 42, ontem: 109, ontemAteAgora: 49, semEspelho: [] } } }
      if (name === 'usePropostasStatus') return { ...result, data: { abertoQuente: { brl: 1000 } } }
      return result
    } }
  }
  imports['@/hooks/useDashboardOrcamentos'] = { useDashboardOrcamentos: hook, useDashboardVendas: hook, useDashboardVendasCoorte: hook }
  for (const name of ['MetaDoMes', 'OperacaoAgora', 'FunilResumo', 'FinalizadosPorMotivo', 'Tendencia', 'AcoesPrioritarias', 'TopEquipe', 'DrillModal']) {
    imports[`./blocks/${name}`] = { [name]: () => React.createElement('p', {}, name) }
  }
  const { TabVisaoGeral } = load('./TabVisaoGeral.tsx', imports)
  return { html: renderToStaticMarkup(React.createElement(TabVisaoGeral)), requests }
}

const data = {
  kpiTotal: { valor: 39, deltaPct: -44 }, kpiQualificados: { valor: 7 }, funil: [], leadsPorDia: [],
}

test('primeira abertura prioriza o snapshot sem iniciar dez consultas enquanto mostra o esqueleto', () => {
  const result = overview({ isLoading: true })
  assert.equal(result.requests, 0)
  assert.match(result.html, /animate-pulse/)
})

test('falha do snapshot não dispara consultas complementares nem apresenta números inventados', () => {
  const result = overview({ error: new Error('temporariamente indisponível') })
  assert.equal(result.requests, 0)
  assert.match(result.html, /Não deu para carregar/)
  assert.doesNotMatch(result.html, /Vendas: 0/)
})

test('snapshot disponível libera os complementos e informa espera sem apresentar vendas falsas como zero', () => {
  const result = overview({ data, isLoading: false }, { isPending: true })
  // (21/10/2026) eram 10: etiquetas, funil por vendedor, status das propostas e cobertura saíram com as Decisões do gerente;
  // entrou o contexto do tile Leads (clientes antigos que voltaram e os que ainda estão com a Ana)
  // + vendas dos leads do período no tile Vendas (21/10/2026)
  assert.equal(result.requests, 8)
  assert.match(result.html, /Leads: 39/)
  assert.match(result.html, /Vendas: Carregando/)
  assert.doesNotMatch(result.html, /Vendas: 0/)
  assert.doesNotMatch(result.html, /AcoesPrioritarias/)
})

test('dados complementares resolvidos mantêm os valores e blocos do dashboard', () => {
  const result = overview({ data }, { data: { qtd: 2, qtdLead: 1, valor: 67000, valorLead: 10000 }, isPending: false })
  assert.match(result.html, /Vendas: 2/)
  assert.match(result.html, /Valor vendido: 67000/)
  // (21/10/2026, Daniel) Decisões do gerente saiu; a última faixa são os 3 gráficos
  assert.doesNotMatch(result.html, /AcoesPrioritarias/)
  assert.match(result.html, /FinalizadosPorMotivo/)
  assert.match(result.html, /Tendencia/)
  assert.match(result.html, /2xl:grid-cols-3/)
  // régua do Daniel (21/10/2026): troca de mensagens, não lead novo
  assert.match(result.html, /Atendimentos hoje: 64/)
})

test('falha dos complementos mantém leads disponíveis e não transforma dado ausente em zero', () => {
  const result = overview({ data }, { isPending: false, error: new Error('falha de rede') })
  assert.match(result.html, /Leads: 39/)
  assert.match(result.html, /Vendas: Indisponível/)
  assert.match(result.html, /O funil está temporariamente indisponível/)
  assert.doesNotMatch(result.html, /Vendas: 0/)
  assert.doesNotMatch(result.html, /TopEquipe/)
})

test('troca de período mantém o aviso de dados anteriores enquanto os complementos atualizam', () => {
  const result = overview({ data }, { data: { qtd: 2, valor: 67000 }, isPending: false, isPlaceholderData: true })
  assert.match(result.html, /aria-busy="true"/)
  assert.match(result.html, /Atualizando os números para Hoje/)
  assert.match(result.html, /Vendas: 2/)
})

test('atualização em segundo plano preserva os dados e os complementos já disponíveis', () => {
  const result = overview({ data, isLoading: false, isFetching: true }, { data: { qtd: 2, valor: 67000 }, isPending: false })
  // (21/10/2026) eram 10: etiquetas, funil por vendedor, status das propostas e cobertura saíram com as Decisões do gerente;
  // entrou o contexto do tile Leads (clientes antigos que voltaram e os que ainda estão com a Ana)
  // + vendas dos leads do período no tile Vendas (21/10/2026)
  assert.equal(result.requests, 8)
  assert.match(result.html, /Leads: 39/)
  assert.match(result.html, /Vendas: 2/)
  assert.doesNotMatch(result.html, /Carregando/)
})
