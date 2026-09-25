import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  avisoValorEdicao,
  decidirValorEdicao,
  hojeSP,
  parcelaDoPlano,
  planejarParcelas,
  valorContrato,
  type ParcelaFinanceiro,
} from './revisaoPedido'

// PV-2026-2444 (Marco Antônio), como está no banco em 25/09/2026
const MARCO = {
  data_venda: '2026-08-31',
  valor_total: 89865,
  payment_plan_json: { total: 89865 },
  ajuste_valor: 0,
  ajuste_data: null,
  ajuste_motivo: null,
}

test('pedido de agosto revisado em setembro: agosto igual, diferença em setembro', () => {
  const d = decidirValorEdicao(MARCO, 97000, '2026-08-31', '2026-09-25')
  assert.equal(d.tipo, 'diferenca_no_mes_atual')
  assert.equal(d.base, 89865)
  assert.equal(d.ajusteValor, 7135)
  assert.equal(d.ajusteData, '2026-09-25')
  assert.match(d.ajusteMotivo ?? '', /Revisão 25\/09\/2026/)
  assert.equal(valorContrato({ ...MARCO, ajuste_valor: d.ajusteValor }), 97000)
  assert.match(avisoValorEdicao(d) ?? '', /acréscimo de R\$\s7\.135,00 conta em setembro\/2026/)
})

test('redução em pedido de mês passado vira ajuste negativo no mês atual', () => {
  const d = decidirValorEdicao(MARCO, 85000, '2026-08-31', '2026-09-25')
  assert.equal(d.base, 89865)
  assert.equal(d.ajusteValor, -4865)
  assert.match(avisoValorEdicao(d) ?? '', /redução de R\$\s4\.865,00 sai de setembro\/2026/)
})

test('valor igual mantém base e ajuste; valor vazio não zera a venda', () => {
  const comAjuste = { ...MARCO, ajuste_valor: 7135, ajuste_data: '2026-09-25', ajuste_motivo: 'x' }
  const d = decidirValorEdicao(comAjuste, 97000, '2026-08-31', '2026-10-02')
  assert.equal(d.tipo, 'sem_mudanca')
  assert.deepEqual([d.base, d.ajusteValor, d.ajusteData, d.ajusteMotivo], [89865, 7135, '2026-09-25', 'x'])
  assert.equal(decidirValorEdicao(MARCO, 0, '2026-08-31', '2026-09-25').base, 89865)
})

test('venda do próprio mês muda a própria venda, sem ajuste', () => {
  const d = decidirValorEdicao({ ...MARCO, data_venda: '2026-09-10' }, 97000, '2026-09-10', '2026-09-25')
  assert.equal(d.tipo, 'mesmo_mes')
  assert.equal(d.base, 97000)
  assert.equal(d.ajusteValor, 0)
  assert.equal(d.ajusteData, null)
})

test('ajuste antigo de outro mês: avisa que muda de mês', () => {
  const d = decidirValorEdicao({ ...MARCO, ajuste_valor: 5000, ajuste_data: '2026-06-30' }, 101000, '2026-08-31', '2026-09-25')
  assert.deepEqual(d.ajusteAnteriorMovido, { valor: 5000, mes: '2026-06' })
  assert.match(avisoValorEdicao(d) ?? '', /junho\/2026/)
})

test('hojeSP: 23h30 em São Paulo ainda é o mesmo dia', () => {
  assert.equal(hojeSP(new Date('2026-09-30T23:30:00-03:00')), '2026-09-30')
})

const CTX = { dataVenda: '2026-08-31', dataEntrega: '2026-11-20', criadoEm: '2026-08-31T20:31:15Z', contratoTotal: 97000 }
const parcelaFin = (over: Partial<ParcelaFinanceiro>): ParcelaFinanceiro => ({
  id: 'p1', installment_no: 1, amount: 89865, due_date: '2026-08-31', description: 'No pedido',
  status: 'PENDENTE', canceled: false, total_installments: 1, ...over,
})

test('parcelaDoPlano: mesmo vencimento do gerar-parcelas', () => {
  const p = parcelaDoPlano({ descricao: '30 dias após o pedido', valor: { tipo: 'fixo', fixo: 100 } }, 0, 1, CTX)
  assert.equal(p.due_date, '2026-09-30')
  assert.equal(p.boleto_enviado, true)
})

test('planejarParcelas: acrescenta só a nova e não toca em parcela paga', () => {
  const plano = [
    { n: 1, vencimento: 'custom', data: '2026-08-31', descricao: 'No pedido', valor: { tipo: 'fixo', fixo: 89865 } },
    { n: 2, vencimento: 'custom', data: '2026-10-05', descricao: 'Data fixa', valor: { tipo: 'fixo', fixo: 7135 } },
  ]
  const r = planejarParcelas(plano, [parcelaFin({})], new Set(), CTX)
  assert.equal(r.inserir.length, 1)
  assert.equal(r.inserir[0].amount, 7135)
  assert.deepEqual(r.atualizar, [{ id: 'p1', patch: { total_installments: 2 } }])

  const paga = planejarParcelas([{ ...plano[0], valor: { tipo: 'fixo', fixo: 97000 } }], [parcelaFin({})], new Set(['p1']), CTX)
  assert.deepEqual(paga.atualizar, [])
  assert.equal(paga.preservadas, 1)
})

test('planejarParcelas: sem plano não cancela nada; saiu do plano = cancela, não apaga', () => {
  assert.deepEqual(planejarParcelas([], [parcelaFin({})], new Set(), CTX), { inserir: [], atualizar: [], cancelar: [], preservadas: 0 })
  const r = planejarParcelas(
    [{ n: 1, vencimento: 'custom', data: '2026-08-31', descricao: 'No pedido', valor: { tipo: 'fixo', fixo: 89865 } }],
    [parcelaFin({ id: 'a', total_installments: 2 }), parcelaFin({ id: 'b', installment_no: 2, total_installments: 2 })],
    new Set(), CTX)
  assert.deepEqual(r.cancelar, ['b'])
})
