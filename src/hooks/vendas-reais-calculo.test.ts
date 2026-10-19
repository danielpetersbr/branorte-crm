import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// useVendasReais importa o client do Supabase (import.meta.env do Vite): troca por um
// vazio só neste processo, como em src/lib/periodo-preset.test.ts.
const CLIENT_VAZIO = 'data:text/javascript,' + encodeURIComponent(
  'const q = {}; export const supabase = { schema() { return q } }; export const supabaseAuditoria = q',
)
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(especificador, contexto, proximo) {
    const r = await proximo(especificador, contexto)
    return new URL(r.url).pathname.endsWith('/src/lib/supabase.ts')
      ? { url: ${JSON.stringify(CLIENT_VAZIO)}, shortCircuit: true }
      : r
  }
`))
const { calcular }: typeof import('./useVendasReais') =
  await import(new URL('./useVendasReais.ts', import.meta.url).href)
type Row = Parameters<typeof calcular>[0][number]

const pedido = (p: Partial<Row>): Row => ({
  vendedor: 'IGOR', vendedor_2: null, valor_total: 0, plano_total: null, status: 'ATIVO',
  ajuste_valor: null, ajuste_data: null, data_venda: '2026-10-10', ...p,
})
const out = (rows: Row[]) => calcular(rows, '2026-10-01', '2026-11-01', 2_500_000, 278_000, 'controle', 'controle-live', '2026-10-19')

test('base é o total do plano de pagamento quando existe (regra do Controle)', () => {
  // PV-2099 (fev/26): valor 125k, plano 266k — o CRM somava o valor e o Controle o plano.
  const r = out([pedido({ valor_total: 125_000, plano_total: '266000' })])
  assert.equal(r.vendidoMes, 266_000)
  assert.equal(r.pedidosMes, 1)
})

test('ajuste SEM data vai junto com a venda; COM data, só no mês da data', () => {
  const r = out([
    pedido({ valor_total: 100_000, ajuste_valor: -38_378 }),                                   // sem data: entra
    pedido({ valor_total: 50_000, ajuste_valor: 5_000, ajuste_data: '2026-11-03' }),           // ajuste de novembro: fora
    pedido({ valor_total: 70_000, data_venda: '2026-09-20', ajuste_valor: 7_373, ajuste_data: '2026-10-02' }), // só o ajuste entra
  ])
  assert.equal(r.vendidoMes, 100_000 - 38_378 + 50_000 + 7_373)
  assert.equal(r.pedidosMes, 2)
})

test('segundo vendedor divide 50/50 e o pedido conta para os dois', () => {
  // PV-2026-2500 (set/26) ia inteiro para o JARDEL.
  const r = out([pedido({ vendedor: 'JARDEL', vendedor_2: 'GUSTAVO', valor_total: 187_146 })])
  const j = r.corrida.find(c => c.vendedor === 'JARDEL')
  const g = r.corrida.find(c => c.vendedor === 'GUSTAVO')
  assert.equal(j?.valor, 93_573)
  assert.equal(g?.valor, 93_573)
  assert.equal(j?.numVendas, 1)
  assert.equal(g?.numVendas, 1)
  assert.equal(r.vendidoMes, 187_146)
})

test('cancelado não conta e a corrida fecha com o total', () => {
  const r = out([
    pedido({ valor_total: 10_000 }),
    pedido({ vendedor: 'RAMON', valor_total: 20_000, status: 'CANCELADO' }),
    pedido({ vendedor: 'EDER', valor_total: 30_000, data_venda: '2026-09-01', ajuste_valor: -5_000, ajuste_data: '2026-10-05' }),
  ])
  assert.equal(r.vendidoMes, 5_000)
  assert.equal(r.corrida.reduce((s, c) => s + c.valor, 0), r.vendidoMes)
  // saldo negativo aparece (antes sumia e o ranking não fechava)
  assert.equal(r.corrida.find(c => c.vendedor === 'EDER')?.valor, -5_000)
  assert.equal(r.corrida.some(c => c.vendedor === 'RAMON'), false)
})
