import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

function load(path: string, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const exports: Record<string, any> = {}
  vm.runInNewContext(js, { exports, React, Map, Date, Error, require: (name: string) => {
    assert.ok(name in imports, `Import não simulado: ${name}`)
    return imports[name]
  } })
  return exports
}

function renderRoute(pathname: string, stats: Record<string, unknown>) {
  const calls = { stats: 0, vendors: 0, pipeline: 0, lista: 0 }
  const empty = () => null
  const box = ({ children }: any) => React.createElement('div', {}, children)
  const names = (keys: string) => Object.fromEntries(keys.split(' ').map(name => [name, empty]))
  const { Orcamentos } = load('./Orcamentos.tsx', {
    react: { ...React, useMemo: (fn: () => unknown) => fn(), useState: (value: unknown) => [value, empty] },
    'react-router-dom': { useLocation: () => ({ pathname }), Link: ({ to, children }: any) => React.createElement('a', { href: to }, children) },
    '@/hooks/useOrcamentoStats': { useOrcamentoStats: () => { calls.stats++; return stats } },
    '@/hooks/useVendors': { useVendors: () => { calls.vendors++; return { data: [] } } },
    '@/hooks/usePipelineVendedor': { usePipelineVendedor: () => { calls.pipeline++; return {} } },
    '@/components/ui/Card': { Card: box, CardContent: box },
    '@/components/ui/LoadingSpinner': { PageLoading: () => React.createElement('p', {}, 'Indicadores carregando') },
    '@/components/ui/QueryNotice': { QueryNotice: () => React.createElement('p', {}, 'Falha dos indicadores') },
    '@/lib/utils': { formatNumber: String },
    'lucide-react': names('FileText TrendingUp Calendar BarChart2 Trophy Handshake Hourglass XCircle Snowflake FilePlus2'),
    '@/pages/OrcamentosLista': { OrcamentosLista: () => { calls.lista++; return React.createElement('p', {}, 'Lista paginada com filtros próprios') } },
    recharts: names('BarChart Bar XAxis YAxis CartesianGrid Tooltip ResponsiveContainer Cell'),
  })
  return { html: renderToStaticMarkup(React.createElement(Orcamentos)), calls }
}

for (const [state, result] of [
  ['lentos', { isLoading: true }],
  ['com erro', { error: new Error('stats indisponíveis') }],
] as const) {
  test(`lista monta sua consulta e Novo orçamento sem iniciar indicadores ${state}`, () => {
    const { html, calls } = renderRoute('/orcamentos/lista', result)
    assert.deepEqual(calls, { stats: 0, vendors: 0, pipeline: 0, lista: 1 })
    assert.match(html, /Orçamentos/)
    assert.match(html, /Lista paginada com filtros próprios/)
    assert.match(html, /href="\/orcamentos\/montar"/)
    assert.match(html, /Novo orçamento/)
    assert.doesNotMatch(html, /Indicadores carregando|Falha dos indicadores/)
  })
}

test('painel mantém totais, variação anual, gráfico e consultas próprias', () => {
  const { html, calls } = renderRoute('/orcamentos', { data: {
    total: 300, yearStats: [{ year: '2025', count: 100 }, { year: '2026', count: 200 }],
    monthStats: [{ month: '2026-10', label: 'Out/2026', count: 200 }], hasMonthData: true, vendorStats: [],
  } })
  assert.deepEqual(calls, { stats: 1, vendors: 1, pipeline: 1, lista: 0 })
  assert.match(html, /300 arquivos únicos/)
  assert.match(html, /Total Orçamentos/)
  assert.match(html, /Ano Mais Ativo/)
  assert.match(html, /\+100.0%/)
  assert.match(html, /Anual/)
  assert.match(html, /Mensal/)
  assert.match(html, /Novo orçamento/)
})

function statsQuery(rows: any[], failOffset?: number) {
  const calls: Array<{ columns: string; options: any; order?: unknown; range?: number[] }> = []
  const { useOrcamentoStats } = load('../hooks/useOrcamentoStats.ts', {
    '@tanstack/react-query': { useQuery: (options: unknown) => options },
    '@/lib/supabase': { supabase: { from: (table: string) => {
      assert.equal(table, 'orcamentos_files')
      return { select: (columns: string, options?: unknown) => {
        const call = { columns, options, order: undefined as unknown, range: undefined as number[] | undefined }
        calls.push(call)
        return { order: (column: string, options: unknown) => {
          call.order = [column, options]
          return { range: async (start: number, end: number) => {
            call.range = [start, end]
            if (start === failOffset) return { error: new Error('segunda página indisponível') }
            return { data: rows.slice(start, end + 1), error: null, count: call.options ? rows.length : null }
          } }
        } }
      } }
    } } },
  })
  return { query: useOrcamentoStats(), calls }
}

test('stats pede COUNT só na primeira página e agrega todas as linhas mantendo ordem e tamanho', async () => {
  const rows = Array.from({ length: 2005 }, (_, i) => ({
    ano: i < 1000 ? 2025 : 2026, mtime_iso: i < 1000 ? '2025-01-01' : '2026-02-01',
    status_kanban: i < 1000 ? 'Enviado' : 'Fechado', vendor_id: i < 1000 ? null : 'vendedor',
  }))
  const { query, calls } = statsQuery(rows)
  const data = await query.queryFn()
  assert.deepEqual(calls.map(call => call.options?.count), ['exact', undefined, undefined])
  assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999], [2000, 2999]])
  for (const call of calls) {
    assert.equal(call.columns, 'ano, mtime_iso, status_kanban, vendor_id')
    assert.deepEqual(JSON.parse(JSON.stringify(call.order)), ['id', { ascending: true }])
  }
  assert.equal(data.total, 2005)
  assert.deepEqual(JSON.parse(JSON.stringify(data.yearStats)), [{ year: '2025', count: 1000 }, { year: '2026', count: 1005 }])
  assert.deepEqual(JSON.parse(JSON.stringify(data.monthStats)), [{ month: '2025-01', label: 'Jan/2025', count: 1000 }, { month: '2026-02', label: 'Fev/2026', count: 1005 }])
  assert.deepEqual(JSON.parse(JSON.stringify(data.statusStats)), [{ status: 'Fechado', count: 1005 }, { status: 'Enviado', count: 1000 }])
  assert.deepEqual(JSON.parse(JSON.stringify(data.vendorStats)), [{ vendor_id: 'vendedor', count: 1005 }, { vendor_id: null, count: 1000 }])
  assert.equal(data.hasMonthData, true)
})

test('erro em página posterior rejeita indicadores completos em vez de publicar agregação parcial', async () => {
  const { query, calls } = statsQuery(Array.from({ length: 1005 }, () => ({})), 1000)
  await assert.rejects(query.queryFn(), /segunda página indisponível/)
  assert.equal(calls.length, 2)
})
