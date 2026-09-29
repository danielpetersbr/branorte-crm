import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { format } from 'date-fns'
import {
  ORIGEM_TODAS, ORIGEM_NAO_INFORMADA, chaveOrigemVenda, ehPedidoGarantia, rotuloOrigemVenda,
  filtrarPorOrigem, resumirOrigens,
} from './vendas-origem'

process.env.TZ = 'America/Sao_Paulo'

// ── Regra da origem (pura) ─────────────────────────────────────────────────

test('chaveOrigemVenda: vazio, "Não informado" e "Não lembra" caem no MESMO balde', () => {
  for (const f of [null, undefined, '', '   ', 'nao_informado', 'Não informado', 'nao_lembra', 'N/D']) {
    assert.equal(chaveOrigemVenda(f), ORIGEM_NAO_INFORMADA, `fonte ${JSON.stringify(f)}`)
  }
  assert.equal(chaveOrigemVenda(' Instagram '), 'instagram')
  assert.equal(chaveOrigemVenda('ja_era_cliente'), 'ja_era_cliente')
})

test('ehPedidoGarantia: só GARANTIA (qualquer caixa) — o resto é venda', () => {
  assert.equal(ehPedidoGarantia('GARANTIA'), true)
  assert.equal(ehPedidoGarantia(' garantia '), true)
  assert.equal(ehPedidoGarantia('google'), false)
  assert.equal(ehPedidoGarantia(null), false)
})

test('rotuloOrigemVenda: texto do form; valor desconhecido aparece como veio (não some)', () => {
  assert.equal(rotuloOrigemVenda('indicacao'), 'Indicação')
  assert.equal(rotuloOrigemVenda('ja_era_cliente'), 'Já era cliente')
  assert.equal(rotuloOrigemVenda('lp_mini_fabrica'), 'LP Mini Fábrica')
  assert.equal(rotuloOrigemVenda(ORIGEM_NAO_INFORMADA), 'Origem não informada')
  assert.equal(rotuloOrigemVenda('algo_novo'), 'Algo novo')
})

test('NÃO repete o "Meta ADS" do controle: facebook, instagram e não informado ficam separados', () => {
  const chaves = new Set(['facebook', 'instagram', 'nao_informado'].map(chaveOrigemVenda))
  assert.equal(chaves.size, 3)
})

test('filtrarPorOrigem: Todas devolve tudo; balde sem origem pega vazio + não informado + não lembra', () => {
  const ps = [
    { id: 1, fonte_origem: 'instagram' },
    { id: 2, fonte_origem: 'INSTAGRAM' },
    { id: 3, fonte_origem: null },
    { id: 4, fonte_origem: 'nao_lembra' },
    { id: 5, fonte_origem: 'nao_informado' },
    { id: 6, fonte_origem: 'feira' },
  ]
  assert.equal(filtrarPorOrigem(ps, ORIGEM_TODAS), ps)
  assert.deepEqual(filtrarPorOrigem(ps, 'instagram').map(p => p.id), [1, 2])
  assert.deepEqual(filtrarPorOrigem(ps, ORIGEM_NAO_INFORMADA).map(p => p.id), [3, 4, 5])
})

test('resumirOrigens: "não informada" sempre por último, cobertura separa o que tem origem', () => {
  const ps = [
    { fonte_origem: 'feira', v: 50, n: 1 },
    { fonte_origem: null, v: 900, n: 3 },       // o maior balde — e mesmo assim vai pro fim
    { fonte_origem: 'google', v: 300, n: 1 },
    { fonte_origem: 'site', v: 0, n: 0 },       // fora da janela: continua na lista (chip não pula)
    { fonte_origem: 'nao_lembra', v: 100, n: 1 },
  ]
  const r = resumirOrigens(ps, p => ({ vendas: p.n, valor: p.v }))
  assert.deepEqual(r.origens.map(o => o.chave), ['google', 'feira', 'site', ORIGEM_NAO_INFORMADA])
  assert.deepEqual(r.origens[r.origens.length - 1], { chave: ORIGEM_NAO_INFORMADA, rotulo: 'Origem não informada', vendas: 4, valor: 1000 })
  assert.deepEqual(r.total, { vendas: 6, valor: 1350 })
  assert.deepEqual(r.informada, { vendas: 2, valor: 350 })
  // a soma dos chips fecha com o total — nada fica fora de balde nenhum
  assert.equal(r.origens.reduce((s, o) => s + o.valor, 0), r.total.valor)
})

// ── O recorte chega em TODOS os números do painel ──────────────────────────
//
// computeControleVendas mora em hooks/useControleDashboard, que importa o client do
// Supabase — e ele lê `import.meta.env` do Vite, que não existe no node. Só neste
// processo de teste o módulo src/lib/supabase.ts vira um vazio (mesmo truque do
// periodo-preset.test.ts). Nenhuma consulta sai daqui.
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
const { computeControleVendas }: typeof import('../hooks/useControleDashboard') =
  await import(new URL('../hooks/useControleDashboard.ts', import.meta.url).href)

type Pedido = Parameters<typeof computeControleVendas>[0][number]
const HOJE = format(new Date(), 'yyyy-MM-dd')
function ped(p: Partial<Pedido>): Pedido {
  return {
    vendedor: 'ANA', vendedor_2: null, valor_total: 0, ajuste_valor: null, ajuste_data: null,
    data_venda: HOJE, status: 'ABERTO', payment_plan_json: null, fonte_origem: null, ...p,
  }
}

const ESPELHO: Pedido[] = [
  ped({ vendedor: 'ANA', fonte_origem: 'instagram', valor_total: 100 }),
  ped({ vendedor: 'BETO', fonte_origem: 'facebook', valor_total: 50, payment_plan_json: { total: 300 } }),
  ped({ vendedor: 'ANA', fonte_origem: null, valor_total: 200 }),
  ped({ vendedor: 'CAIO', fonte_origem: 'GARANTIA', valor_total: 0 }),
  ped({ vendedor: 'ANA', fonte_origem: 'nao_lembra', valor_total: 10, status: 'CANCELADO' }),
]

test('Todas: garantia NÃO conta como venda do mês (antes contava e derrubava o ticket)', () => {
  const d = computeControleVendas(ESPELHO, {}, 'mes', ORIGEM_TODAS)
  assert.equal(d.totalVendasMes, 3)
  assert.equal(d.valorTotal, 600)
  assert.equal(d.ticketMedio, 200)
  assert.ok(!d.ranking.some(r => r.vendedor === 'CAIO'))
  assert.ok(!d.origens.some(o => o.chave === 'garantia'))
  assert.deepEqual(d.coberturaOrigem, { total: { vendas: 3, valor: 600 }, informada: { vendas: 2, valor: 400 } })
})

test('origem escolhida recorta KPIs, corrida, faturamento e metas — cobertura segue sobre o total', () => {
  const d = computeControleVendas(ESPELHO, {}, 'mes', 'instagram')
  assert.equal(d.totalVendasMes, 1)
  assert.equal(d.valorTotal, 100)
  assert.equal(d.ticketMedio, 100)
  assert.deepEqual(d.ranking.map(r => [r.vendedor, r.realizado, r.vendas]), [['ANA', 100, 1]])
  assert.equal(d.faturamentoMensal[d.faturamentoMensal.length - 1].valor, 100)
  assert.equal(d.faturamentoMensal[d.faturamentoMensal.length - 1].vendas, 1)
  assert.equal(d.metaMes.realizado, 100)
  assert.equal(d.metaSemanal.realizado, 100)
  // o que NÃO recorta: a linha de cobertura e os chips (pra ver o todo)
  assert.deepEqual(d.coberturaOrigem.total, { vendas: 3, valor: 600 })
  assert.equal(d.origens.length, 3)
})

test('balde "Origem não informada" é filtrável como qualquer origem', () => {
  const d = computeControleVendas(ESPELHO, {}, 'mes', ORIGEM_NAO_INFORMADA)
  assert.equal(d.totalVendasMes, 1)
  assert.equal(d.valorTotal, 200)
  assert.deepEqual(d.ranking.map(r => r.vendedor), ['ANA'])
})

test('chip e recorte batem: o número do chip é o KPI que aparece ao clicar nele', () => {
  const todas = computeControleVendas(ESPELHO, {}, 'mes', ORIGEM_TODAS)
  for (const o of todas.origens) {
    const d = computeControleVendas(ESPELHO, {}, 'mes', o.chave)
    assert.equal(d.totalVendasMes, o.vendas, o.chave)
    assert.equal(d.valorTotal, o.valor, o.chave)
  }
})
