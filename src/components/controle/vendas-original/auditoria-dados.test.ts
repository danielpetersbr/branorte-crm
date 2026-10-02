import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandirPedidos, type Pedido } from './calculos'
import { resumoAuditoriaVendas } from './auditoria-dados'

const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  id: 'sintetico', pedido_numero: 'S1', numero_orcamento: 'S1', cliente: 'Sintético', vendedor: 'ALFA',
  data_venda: '2026-09-10', valor_total: 1000, status: 'FECHADO', atencao_a: '', descricao_equipamento: '',
  data_primeiro_contato: null, fonte_origem: 'site', estado: 'RS', equipamentos_json: [],
  ajuste_valor: 0, ajuste_motivo: null, ajuste_data: null, ...extra,
})

test('cancelado abaixo do mínimo é excluído uma vez e o pipeline fecha com os ativos', () => {
  const cancelado = pedido({ id: 'cancelado', status: 'CANCELADO', valor_total: 500 })
  const ativo = pedido({ id: 'ativo', valor_total: 2000 })
  const resumo = resumoAuditoriaVendas([cancelado, ativo], 1000)
  assert.deepEqual(resumo, { totalCarregados: 2, totalCancelados: 1, excluidosPorValor: 0, pedidosAtivos: [ativo], totalAtivos: 1 })
  assert.equal(resumo.totalCarregados - resumo.totalCancelados - resumo.excluidosPorValor, resumo.totalAtivos)
})

test('mínimo inclusivo preserva ABERTO e não modifica os pedidos recebidos', () => {
  const aberto = pedido({ id: 'aberto', status: 'ABERTO', valor_total: 1000 })
  const abaixo = pedido({ id: 'abaixo', valor_total: 999.99 })
  const entrada = [aberto, abaixo]
  const antes = structuredClone(entrada)
  const resumo = resumoAuditoriaVendas(entrada, 1000)
  assert.deepEqual(resumo.pedidosAtivos, [aberto])
  assert.equal(resumo.pedidosAtivos[0], aberto)
  assert.equal(resumo.excluidosPorValor, 1)
  assert.deepEqual(entrada, antes)
})

test('filtro avalia total do pai com plano e ajuste e não a parcela monetária negativa', () => {
  const linhas = expandirPedidos([pedido({ vendedor_2: 'BETA', valor_total: 10, payment_plan_json: { total: 1000 },
    ajuste_valor: -50, ajuste_data: '2026-10-05' })], '2026-01-01', '2026-12-31', 'todos')
  const passam = resumoAuditoriaVendas(linhas, 950)
  assert.equal(passam.totalAtivos, 4)
  assert.equal(passam.excluidosPorValor, 0)
  assert.deepEqual(passam.pedidosAtivos, linhas)
  const excluidos = resumoAuditoriaVendas(linhas, 950.01)
  assert.equal(excluidos.totalAtivos, 0)
  assert.equal(excluidos.excluidosPorValor, 4)
})

test('sem mínimo, linhas zeradas e negativas continuam ativas; cancelados não entram', () => {
  const linhas = [pedido({ id: 'zero', valor_total: 0 }), pedido({ id: 'negativo', valor_total: -100 }),
    pedido({ id: 'cancelado', status: 'CANCELADO', valor_total: 0 })]
  const resumo = resumoAuditoriaVendas(linhas, 0)
  assert.equal(resumo.totalAtivos, 2)
  assert.equal(resumo.totalCancelados, 1)
  assert.equal(resumo.excluidosPorValor, 0)
})
