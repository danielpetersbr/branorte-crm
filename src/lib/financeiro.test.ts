import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  devidoDe, diffDias, statusParcela, agregarPedido, resumoKpis, pedidoNoEscopo,
  type PedidoRaw, type ParcelaRaw, type ReceiptRaw, type Escopo,
} from '../../api/_lib/financeiro-core.js'

const HOJE = '2026-08-06'

function pedido(over: Partial<PedidoRaw> = {}): PedidoRaw {
  return {
    id: 'p1', pedido_numero: 'PV-2026-0001', cliente: 'Fulano', vendedor: 'JARDEL',
    vendedor_2: null, valor_total: 1000, ajuste_valor: null, status: 'ABERTO',
    forma_pagamento: null, data_venda: '2026-01-10', payment_plan_json: null, ...over,
  }
}
function parcela(over: Partial<ParcelaRaw> = {}): ParcelaRaw {
  return {
    id: 'i1', order_id: 'p1', installment_no: 1, total_installments: 2,
    due_date: '2026-09-01', amount: 500, description: 'Parcela 1', status: 'PENDENTE',
    canceled: false, cancellation_reason: null, boleto_enviado: false, boleto_enviado_em: null, ...over,
  }
}
function receipt(over: Partial<ReceiptRaw> = {}): ReceiptRaw {
  return {
    id: 'r1', order_id: 'p1', installment_id: 'i1', amount: 500, paid_at: '2026-08-01',
    payment_method: 'PIX', notes: null, receipt_url: null, ...over,
  }
}

// ── devidoDe: o plano manda, valor_total é fallback, ajuste soma ──────────────

test('devidoDe: payment_plan_json.total vence valor_total', () => {
  assert.equal(devidoDe({ payment_plan_json: { total: 1200 }, valor_total: 1000, ajuste_valor: null }), 1200)
})

test('devidoDe: cai em valor_total quando o plano nao tem total util', () => {
  assert.equal(devidoDe({ payment_plan_json: { total: 0 }, valor_total: 1000, ajuste_valor: null }), 1000)
  assert.equal(devidoDe({ payment_plan_json: null, valor_total: 1000, ajuste_valor: null }), 1000)
})

test('devidoDe: total do plano vem como string (JSONB) e ainda soma o ajuste', () => {
  assert.equal(devidoDe({ payment_plan_json: { total: '1500.50' }, valor_total: 1, ajuste_valor: 49.5 }), 1550)
})

test('devidoDe: ajuste negativo reduz o devido', () => {
  assert.equal(devidoDe({ payment_plan_json: null, valor_total: 1000, ajuste_valor: -250 }), 750)
})

// ── diffDias ─────────────────────────────────────────────────────────────────

test('diffDias conta dias civis e atravessa virada de mes', () => {
  assert.equal(diffDias('2026-08-06', '2026-08-06'), 0)
  assert.equal(diffDias('2026-08-31', '2026-09-01'), 1)
  assert.equal(diffDias('2026-09-01', '2026-08-31'), -1)
})

// ── statusParcela: precedencia ───────────────────────────────────────────────

test('statusParcela: cancelada vence tudo, inclusive pagamento', () => {
  const p = parcela({ canceled: true, due_date: '2026-01-01' })
  assert.equal(statusParcela(p, 500, HOJE), 'CANCELADA')
})

test('statusParcela: pago vence vencido (parcela quitada em atraso nao fica VENCIDO)', () => {
  const p = parcela({ due_date: '2026-01-01' })
  assert.equal(statusParcela(p, 500, HOJE), 'PAGO')
})

test('statusParcela: parcial vence vencido', () => {
  const p = parcela({ due_date: '2026-01-01' })
  assert.equal(statusParcela(p, 200, HOJE), 'PARCIAL')
})

test('statusParcela: vencido, vence hoje e a vencer se distinguem', () => {
  assert.equal(statusParcela(parcela({ due_date: '2026-08-05' }), 0, HOJE), 'VENCIDO')
  assert.equal(statusParcela(parcela({ due_date: '2026-08-06' }), 0, HOJE), 'VENCE_HOJE')
  assert.equal(statusParcela(parcela({ due_date: '2026-08-07' }), 0, HOJE), 'PENDENTE')
})

test('statusParcela: boleto enviado so aparece em parcela futura e nao paga', () => {
  assert.equal(statusParcela(parcela({ due_date: '2026-08-07', boleto_enviado: true }), 0, HOJE), 'BOLETO_ENVIADO')
  // vencida com boleto enviado ainda e VENCIDO — a cobranca e o que importa
  assert.equal(statusParcela(parcela({ due_date: '2026-08-05', boleto_enviado: true }), 0, HOJE), 'VENCIDO')
})

test('statusParcela: sobra de centavo nao impede a quitacao', () => {
  assert.equal(statusParcela(parcela({ amount: 500 }), 499.995, HOJE), 'PAGO')
})

test('statusParcela: parcela de valor zero nao vira PAGO por acidente', () => {
  // sem dinheiro e sem valor, o que manda e a data
  assert.equal(statusParcela(parcela({ amount: 0, due_date: '2026-08-07' }), 0, HOJE), 'PENDENTE')
})

// ── agregarPedido ────────────────────────────────────────────────────────────

test('agregarPedido: soma recebimentos por parcela e calcula saldo', () => {
  const r = agregarPedido(
    pedido(),
    [parcela({ id: 'i1', installment_no: 1 }), parcela({ id: 'i2', installment_no: 2, due_date: '2026-10-01' })],
    [receipt({ id: 'r1', installment_id: 'i1', amount: 200 })],
    HOJE,
  )
  assert.equal(r.recebido, 200)
  assert.equal(r.aReceber, 800)
  assert.equal(r.parcelas[0].recebido, 200)
  assert.equal(r.parcelas[0].saldo, 300)
  assert.equal(r.parcelas[0].status, 'PARCIAL')
  assert.equal(r.parcelas[1].recebido, 0)
  assert.equal(r.status, 'PARCIAL')
})

test('agregarPedido: dois recebimentos na MESMA parcela quitam (pagamento parcial do spec)', () => {
  const r = agregarPedido(
    pedido({ valor_total: 500 }),
    [parcela({ id: 'i1', amount: 500 })],
    [
      receipt({ id: 'r1', installment_id: 'i1', amount: 200 }),
      receipt({ id: 'r2', installment_id: 'i1', amount: 300 }),
    ],
    HOJE,
  )
  assert.equal(r.parcelas[0].recebido, 500)
  assert.equal(r.parcelas[0].status, 'PAGO')
  assert.equal(r.parcelas[0].recebimentos.length, 2)
  assert.equal(r.status, 'QUITADO')
})

test('agregarPedido: recebimento avulso (sem installment_id) entra no pedido, nao na parcela', () => {
  const r = agregarPedido(
    pedido({ valor_total: 1000 }),
    [parcela({ id: 'i1', amount: 1000 })],
    [receipt({ id: 'r1', installment_id: null, amount: 400 })],
    HOJE,
  )
  assert.equal(r.recebido, 400, 'o pedido reconhece o dinheiro')
  assert.equal(r.parcelas[0].recebido, 0, 'a parcela nao e amortizada por recebimento avulso')
  assert.equal(r.parcelas[0].status, 'PENDENTE')
})

test('agregarPedido: aguardandoComprovante quando entrou dinheiro sem anexo', () => {
  const semAnexo = agregarPedido(pedido(), [parcela({ id: 'i1' })],
    [receipt({ installment_id: 'i1', amount: 500, receipt_url: null })], HOJE)
  assert.equal(semAnexo.parcelas[0].aguardandoComprovante, true)
  assert.equal(semAnexo.pagamentosSemComprovante, 1)

  const comAnexo = agregarPedido(pedido(), [parcela({ id: 'i1' })],
    [receipt({ installment_id: 'i1', amount: 500, receipt_url: 'https://x/y.jpg' })], HOJE)
  assert.equal(comAnexo.parcelas[0].aguardandoComprovante, false)
  assert.equal(comAnexo.pagamentosSemComprovante, 0)
})

test('agregarPedido: parcela cancelada sai da soma, do vencido e da contagem', () => {
  const r = agregarPedido(
    pedido({ valor_total: 1000 }),
    [
      parcela({ id: 'i1', amount: 500, due_date: '2026-01-01' }),
      parcela({ id: 'i2', amount: 500, due_date: '2026-01-01', canceled: true, installment_no: 2 }),
    ],
    [], HOJE,
  )
  assert.equal(r.qtdParcelas, 1)
  assert.equal(r.somaParcelas, 500)
  assert.equal(r.vencido, 500, 'so a parcela ativa vencida conta')
  assert.equal(r.parcelasVencidas, 1)
})

test('agregarPedido: divergencia entre soma das parcelas e valor do pedido (item 1 do spec)', () => {
  const bate = agregarPedido(pedido({ valor_total: 1000 }),
    [parcela({ id: 'i1', amount: 400 }), parcela({ id: 'i2', amount: 600, installment_no: 2 })], [], HOJE)
  assert.equal(bate.divergenciaPlano, 0)

  const falta = agregarPedido(pedido({ valor_total: 1000 }), [parcela({ id: 'i1', amount: 400 })], [], HOJE)
  assert.equal(falta.divergenciaPlano, -600, 'plano menor que o pedido acusa diferenca negativa')
})

test('agregarPedido: pedido sem parcela nenhuma e SEM_PLANO e nao inventa divergencia', () => {
  const r = agregarPedido(pedido({ valor_total: 1000 }), [], [], HOJE)
  assert.equal(r.status, 'SEM_PLANO')
  assert.equal(r.qtdParcelas, 0)
  assert.equal(r.divergenciaPlano, 0, 'sem plano nao e plano divergente')
  assert.equal(r.aReceber, 1000)
})

test('agregarPedido: proximo vencimento ignora parcela quitada e parcela vencida', () => {
  const r = agregarPedido(
    pedido({ valor_total: 1500 }),
    [
      parcela({ id: 'i1', amount: 500, due_date: '2026-01-01', installment_no: 1 }), // vencida
      parcela({ id: 'i2', amount: 500, due_date: '2026-09-01', installment_no: 2 }), // quitada
      parcela({ id: 'i3', amount: 500, due_date: '2026-10-01', installment_no: 3 }), // a proxima
    ],
    [receipt({ id: 'r1', installment_id: 'i2', amount: 500 })],
    HOJE,
  )
  assert.equal(r.proximoVencimento, '2026-10-01')
})

test('agregarPedido: pedido cancelado nao vira QUITADO nem VENCIDO', () => {
  const r = agregarPedido(pedido({ status: 'CANCELADO' }),
    [parcela({ id: 'i1', due_date: '2026-01-01' })], [], HOJE)
  assert.equal(r.status, 'CANCELADO')
})

test('agregarPedido: boletosPendentes so conta parcela com saldo', () => {
  const r = agregarPedido(
    pedido({ valor_total: 1000 }),
    [
      parcela({ id: 'i1', amount: 500, boleto_enviado: false, installment_no: 1 }),
      parcela({ id: 'i2', amount: 500, boleto_enviado: false, installment_no: 2 }),
    ],
    [receipt({ id: 'r1', installment_id: 'i2', amount: 500 })],
    HOJE,
  )
  assert.equal(r.boletosPendentes, 1, 'a parcela ja paga nao precisa de boleto')
})

test('agregarPedido: parcelas voltam ordenadas por numero mesmo chegando fora de ordem', () => {
  const r = agregarPedido(pedido(),
    [parcela({ id: 'i2', installment_no: 2 }), parcela({ id: 'i1', installment_no: 1 })], [], HOJE)
  assert.deepEqual(r.parcelas.map(p => p.numero), [1, 2])
})

// ── resumoKpis ───────────────────────────────────────────────────────────────

test('resumoKpis: pedido cancelado nao entra em nenhum total', () => {
  const vivo = agregarPedido(pedido({ id: 'a', valor_total: 1000 }), [parcela({ id: 'i1', amount: 1000 })], [], HOJE)
  const morto = agregarPedido(pedido({ id: 'b', valor_total: 9999, status: 'CANCELADO' }), [], [], HOJE)
  const k = resumoKpis([vivo, morto])
  assert.equal(k.totalVendido, 1000)
  assert.equal(k.totalAReceber, 1000)
})

test('resumoKpis: soma vencido, quitados, parciais e sem plano', () => {
  const vencido = agregarPedido(pedido({ id: 'a', valor_total: 500 }),
    [parcela({ id: 'i1', amount: 500, due_date: '2026-01-01' })], [], HOJE)
  const quitado = agregarPedido(pedido({ id: 'b', valor_total: 300 }),
    [parcela({ id: 'i2', amount: 300 })], [receipt({ id: 'r', order_id: 'b', installment_id: 'i2', amount: 300 })], HOJE)
  const semPlano = agregarPedido(pedido({ id: 'c', valor_total: 700 }), [], [], HOJE)

  const k = resumoKpis([vencido, quitado, semPlano])
  assert.equal(k.totalVendido, 1500)
  assert.equal(k.totalRecebido, 300)
  assert.equal(k.totalVencido, 500)
  assert.equal(k.pedidosComVencido, 1)
  assert.equal(k.pedidosQuitados, 1)
  assert.equal(k.pedidosSemPlano, 1)
})

// ── escopo ───────────────────────────────────────────────────────────────────

const gestor: Escopo = { userId: 'u', role: 'admin', displayName: 'Daniel', vendedores: null }
const jardel: Escopo = { userId: 'u', role: 'vendor', displayName: 'Jardel', vendedores: ['JARDEL'] }

test('pedidoNoEscopo: gestor ve tudo', () => {
  assert.equal(pedidoNoEscopo({ vendedor: 'ALVARO', vendedor_2: null }, gestor), true)
})

test('pedidoNoEscopo: vendedor so ve o proprio', () => {
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: null }, jardel), true)
  assert.equal(pedidoNoEscopo({ vendedor: 'ALVARO', vendedor_2: null }, jardel), false)
})

test('pedidoNoEscopo: venda em dupla conta pro segundo vendedor', () => {
  assert.equal(pedidoNoEscopo({ vendedor: 'ALVARO', vendedor_2: 'JARDEL' }, jardel), true)
})

test('pedidoNoEscopo: casamento ignora caixa e espaco em volta', () => {
  assert.equal(pedidoNoEscopo({ vendedor: ' jardel ', vendedor_2: null }, jardel), true)
})

test('pedidoNoEscopo: vendedor nulo nao casa com escopo restrito', () => {
  assert.equal(pedidoNoEscopo({ vendedor: null, vendedor_2: null }, jardel), false)
  assert.equal(pedidoNoEscopo({ vendedor: null, vendedor_2: null }, gestor), true)
})
