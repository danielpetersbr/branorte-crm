import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { format } from 'date-fns'
import {
  ORIGEM_TODAS, ORIGEM_NAO_INFORMADA, chaveOrigemVenda, ehPedidoGarantia, rotuloOrigemVenda,
  filtrarPorOrigem, resumirOrigens, chaveOrigemRastreada, origemFinalVenda,
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
  assert.deepEqual(d.coberturaOrigem, { total: { vendas: 3, valor: 600 }, informada: { vendas: 2, valor: 400 }, rastreada: { vendas: 0, valor: 0 } })
  assert.equal(d.rastreioAplicado, false)
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

// ── Origem RASTREADA pelo telefone (07/10/2026) ────────────────────────────

test('chaveOrigemRastreada: texto do registro de chegada vira a MESMA chave do form quando existe', () => {
  assert.equal(chaveOrigemRastreada('Meta ADS'), 'meta_ads')
  assert.equal(chaveOrigemRastreada('LP Mini Fábrica'), 'lp_mini_fabrica')
  assert.equal(chaveOrigemRastreada('LP Compacta 2'), 'lp_compacta_02')
  assert.equal(chaveOrigemRastreada(' Instagram '), 'instagram')
  assert.equal(chaveOrigemRastreada('Bio Instagram'), 'bio_instagram')
  assert.equal(chaveOrigemRastreada('Instagram Formulario'), 'instagram_formulario')
  assert.equal(chaveOrigemRastreada('quiz_site'), 'site')
  assert.equal(chaveOrigemRastreada('WhatsApp 1144'), 'whatsapp_empresa')
  assert.equal(chaveOrigemRastreada('WhatsApp ANA'), 'whatsapp_empresa')
  assert.equal(chaveOrigemRastreada('WhatsApp 9999'), 'whatsapp_empresa') // número novo da casa não vira canal de marketing
})

test('chaveOrigemRastreada: "Não identificou" e vazio são CONTATO, não origem', () => {
  for (const o of [null, undefined, '', '  ', 'Não identificou', 'nao identificou', 'Não identificado']) {
    assert.equal(chaveOrigemRastreada(o), null, `origem ${JSON.stringify(o)}`)
  }
})

test('chaveOrigemRastreada: origem que o mapa não conhece aparece como veio (não some)', () => {
  assert.equal(chaveOrigemRastreada('Rádio Local'), 'radio_local')
  assert.equal(rotuloOrigemVenda('radio_local'), 'Radio local')
  assert.equal(rotuloOrigemVenda('meta_ads'), 'Meta ADS (anúncio)')
})

test('origemFinalVenda: rastreio com origem vale — inclusive quando o vendedor não marcou nada', () => {
  const o = origemFinalVenda({ fonte_declarada: null, chegada_origem: 'Meta ADS' })
  assert.deepEqual([o.chave, o.base, o.conferencia], ['meta_ads', 'rastreio', 'so_rastreio'])
  assert.equal(o.rotulo, 'Meta ADS (anúncio)')
  assert.equal(o.declarada, ORIGEM_NAO_INFORMADA)
})

test('origemFinalVenda: rastreio e vendedor no mesmo canal CONFEREM (Meta ADS x Instagram, LP x Site)', () => {
  const a = origemFinalVenda({ fonte_declarada: 'instagram', chegada_origem: 'Meta ADS' })
  assert.deepEqual([a.chave, a.base, a.conferencia], ['meta_ads', 'rastreio', 'confere'])
  const b = origemFinalVenda({ fonte_declarada: 'site', chegada_origem: 'LP Mini Fábrica' })
  assert.deepEqual([b.chave, b.base, b.conferencia], ['lp_mini_fabrica', 'rastreio', 'confere'])
  const c = origemFinalVenda({ fonte_declarada: 'google', chegada_origem: 'Google' })
  assert.deepEqual([c.chave, c.conferencia], ['google', 'confere'])
})

test('origemFinalVenda: vendedor marcou outro canal — vale o rastreio e a divergência fica à vista', () => {
  const o = origemFinalVenda({ fonte_declarada: 'indicacao', chegada_origem: 'Google' })
  assert.deepEqual([o.chave, o.base, o.conferencia, o.declarada], ['google', 'rastreio', 'diverge', 'indicacao'])
  // "já era cliente" com anúncio rastreado no ciclo desta compra: foi o anúncio que trouxe de volta
  const r = origemFinalVenda({ fonte_declarada: 'ja_era_cliente', chegada_origem: 'Meta ADS', pedido_anterior_data: '2026-03-01' })
  assert.deepEqual([r.chave, r.base, r.conferencia], ['meta_ads', 'rastreio', 'diverge'])
})

test('origemFinalVenda: sem rastreio, vale o que o vendedor marcou', () => {
  for (const chegada of [null, undefined, '', 'Não identificou']) {
    const o = origemFinalVenda({ fonte_declarada: 'feira', chegada_origem: chegada })
    assert.deepEqual([o.chave, o.base, o.conferencia, o.rastreada], ['feira', 'vendedor', 'so_vendedor', null], `chegada ${JSON.stringify(chegada)}`)
  }
})

test('origemFinalVenda: "WhatsApp da empresa" é porta de entrada — NÃO passa por cima do vendedor', () => {
  const o = origemFinalVenda({ fonte_declarada: 'indicacao', chegada_origem: 'WhatsApp 1144' })
  assert.deepEqual([o.chave, o.base, o.conferencia], ['indicacao', 'vendedor', 'so_vendedor'])
  assert.equal(o.rastreada, 'whatsapp_empresa') // a tela ainda mostra por onde ele entrou
})

test('origemFinalVenda: sem rastreio e sem vendedor — recompra › porta de entrada › não informada', () => {
  const recompra = origemFinalVenda({ fonte_declarada: 'nao_lembra', chegada_origem: null, pedido_anterior_data: '2026-01-10' })
  assert.deepEqual([recompra.chave, recompra.base, recompra.conferencia], ['ja_era_cliente', 'historico', 'nenhum'])
  const recompraComPorta = origemFinalVenda({ fonte_declarada: '', chegada_origem: 'WhatsApp 4502', pedido_anterior_data: '2026-01-10' })
  assert.deepEqual([recompraComPorta.chave, recompraComPorta.base], ['ja_era_cliente', 'historico'])
  const porta = origemFinalVenda({ fonte_declarada: null, chegada_origem: 'WhatsApp ANA' })
  assert.deepEqual([porta.chave, porta.base], ['whatsapp_empresa', 'porta'])
  const nada = origemFinalVenda({ fonte_declarada: 'nao_informado', chegada_origem: 'Não identificou' })
  assert.deepEqual([nada.chave, nada.base, nada.conferencia], [ORIGEM_NAO_INFORMADA, 'nenhuma', 'nenhum'])
})

test('origemFinalVenda: recompra NÃO passa por cima do que o vendedor marcou (ele pediu: sem rastreio, vale o vendedor)', () => {
  const o = origemFinalVenda({ fonte_declarada: 'instagram', chegada_origem: null, pedido_anterior_data: '2026-01-10' })
  assert.deepEqual([o.chave, o.base], ['instagram', 'vendedor'])
})

// ── O rastreio dentro do painel ────────────────────────────────────────────

const ESPELHO_ID: Pedido[] = [
  ped({ id: 'p1', vendedor: 'ANA', fonte_origem: 'instagram', valor_total: 100 }),
  ped({ id: 'p2', vendedor: 'BETO', fonte_origem: 'facebook', valor_total: 50, payment_plan_json: { total: 300 } }),
  ped({ id: 'p3', vendedor: 'ANA', fonte_origem: null, valor_total: 200 }),           // vendedor não informou
  ped({ id: 'p4', vendedor: 'CAIO', fonte_origem: 'GARANTIA', valor_total: 0 }),
  ped({ id: 'p5', vendedor: 'DUDA', fonte_origem: 'indicacao', valor_total: 40 }),
  ped({ id: 'p6', vendedor: 'DUDA', fonte_origem: 'nao_lembra', valor_total: 60 }),
]
const RASTREIO = new Map<string, { chegada_origem?: string | null; pedido_anterior_data?: string | null }>([
  ['p1', { chegada_origem: 'Meta ADS' }],                 // confere com instagram → chip Meta ADS
  ['p2', { chegada_origem: null }],                       // sem rastreio → fica facebook
  ['p3', { chegada_origem: 'Meta ADS' }],                 // sem origem declarada → rastreio preenche
  ['p4', { chegada_origem: 'Meta ADS' }],                 // garantia continua fora
  ['p5', { chegada_origem: 'WhatsApp 1144' }],            // porta não derruba "indicação"
  ['p6', { chegada_origem: null, pedido_anterior_data: '2026-01-10' }],  // recompra preenche o "não lembra"
])

test('painel com rastreio: a venda sem origem vira Meta ADS e a cobertura sobe', () => {
  const d = computeControleVendas(ESPELHO_ID, {}, 'mes', ORIGEM_TODAS, RASTREIO)
  assert.equal(d.rastreioAplicado, true)
  assert.equal(d.totalVendasMes, 5)
  assert.equal(d.valorTotal, 700)
  const chip = Object.fromEntries(d.origens.map(o => [o.chave, [o.vendas, o.valor]]))
  assert.deepEqual(chip, {
    meta_ads: [2, 300], facebook: [1, 300], indicacao: [1, 40], ja_era_cliente: [1, 60],
  })
  assert.deepEqual(d.coberturaOrigem, {
    total: { vendas: 5, valor: 700 }, informada: { vendas: 5, valor: 700 }, rastreada: { vendas: 2, valor: 300 },
  })
  assert.ok(!d.origens.some(o => o.chave === ORIGEM_NAO_INFORMADA))
})

test('painel com rastreio: clicar no chip Meta ADS recorta pelas vendas RASTREADAS (não pelo que o vendedor marcou)', () => {
  const d = computeControleVendas(ESPELHO_ID, {}, 'mes', 'meta_ads', RASTREIO)
  assert.equal(d.totalVendasMes, 2)
  assert.equal(d.valorTotal, 300)
  assert.deepEqual(d.ranking.map(r => [r.vendedor, r.realizado, r.vendas]), [['ANA', 300, 2]])
  // "instagram" deixou de existir como chip: a venda da ANA foi pro rastreio
  assert.equal(computeControleVendas(ESPELHO_ID, {}, 'mes', 'instagram', RASTREIO).totalVendasMes, 0)
})

test('painel com rastreio: chip e recorte continuam batendo em toda origem', () => {
  const todas = computeControleVendas(ESPELHO_ID, {}, 'mes', ORIGEM_TODAS, RASTREIO)
  for (const o of todas.origens) {
    const d = computeControleVendas(ESPELHO_ID, {}, 'mes', o.chave, RASTREIO)
    assert.equal(d.totalVendasMes, o.vendas, o.chave)
    assert.equal(d.valorTotal, o.valor, o.chave)
  }
})

test('painel SEM rastreio (erro, sem permissão ou mapa vazio): tudo como o vendedor marcou, e a tela sabe disso', () => {
  for (const r of [undefined, null, new Map()]) {
    const d = computeControleVendas(ESPELHO_ID, {}, 'mes', ORIGEM_TODAS, r)
    assert.equal(d.rastreioAplicado, false)
    assert.deepEqual(d.coberturaOrigem, {
      total: { vendas: 5, valor: 700 }, informada: { vendas: 3, valor: 440 }, rastreada: { vendas: 0, valor: 0 },
    })
    assert.ok(d.origens.some(o => o.chave === 'instagram'))
    assert.ok(!d.origens.some(o => o.chave === 'meta_ads'))
  }
})

test('painel com rastreio: pedido que o rastreio não cobre (fora da janela) segue com a origem do vendedor', () => {
  const soUm = new Map<string, { chegada_origem?: string | null; pedido_anterior_data?: string | null }>([['p3', { chegada_origem: 'Google' }]])
  const d = computeControleVendas(ESPELHO_ID, {}, 'mes', ORIGEM_TODAS, soUm)
  const chaves = d.origens.map(o => o.chave)
  assert.ok(chaves.includes('google'))
  assert.ok(chaves.includes('instagram'))   // p1 não está no rastreio → declarada
  assert.ok(chaves.includes(ORIGEM_NAO_INFORMADA)) // p6 "não lembra" sem evidência
})
