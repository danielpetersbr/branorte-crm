import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandirPedidos, getValorPedido, consultaPertenceAoContexto, type Pedido } from './calculos'
import * as calculos from './calculos'

const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  id: 'pedido-sintetico', pedido_numero: '2026-0001', numero_orcamento: '2026-0001', cliente: 'Cliente sintético',
  vendedor: 'ALFA', data_venda: '2026-10-01', valor_total: 1000, status: 'FECHADO', atencao_a: '',
  descricao_equipamento: '', data_primeiro_contato: null, fonte_origem: 'site', estado: 'RS', equipamentos_json: [],
  ajuste_valor: 0, ajuste_motivo: null, ajuste_data: null, ...extra,
})

test('plano positivo prevalece sobre total e soma ajuste sem perder override', () => {
  assert.equal(getValorPedido(pedido({ valor_total: 500, payment_plan_json: { total: 800 }, ajuste_valor: -50 })), 750)
  assert.equal(getValorPedido({ ...pedido({ ajuste_valor: 50 }), _valorOverride: 150 } as Pedido), 150)
})

test('split preserva valores explícitos e seleciona vendedor secundário', () => {
  const original = { ...pedido({ vendedor_2: ' BETA ', valor_total: 1000 }), valor_split_v1: 700, valor_split_v2: 300 } as Pedido
  const linhas = expandirPedidos([original], '2026-10-01', '2026-10-31', 'BETA')
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].vendedor, 'BETA')
  assert.equal(getValorPedido(linhas[0]), 300)
})

test('split sem valores explícitos preserva cinquenta por cento para cada vendedor', () => {
  const linhas = expandirPedidos([pedido({ vendedor_2: 'BETA', valor_total: 1000, ajuste_valor: 100 })], '2026-10-01', '2026-10-31', 'todos')
  assert.equal(linhas.length, 2)
  assert.deepEqual(linhas.map(getValorPedido), [550, 550])
})

test('ajuste no período com venda anterior gera apenas acréscimo datado', () => {
  const linhas = expandirPedidos([pedido({ data_venda: '2026-09-01', ajuste_data: '2026-10-02', ajuste_valor: -50 })], '2026-10-01', '2026-10-31', 'todos')
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].data_venda, '2026-10-02')
  assert.equal(getValorPedido(linhas[0]), -50)
  assert.equal(linhas[0].pedido_numero, 'Acréscimo 2026-0001')
})

test('venda e ajuste no período viram duas linhas mantendo soma', () => {
  const linhas = expandirPedidos([pedido({ ajuste_data: '2026-10-02', ajuste_valor: 200 })], '2026-10-01', '2026-10-31', 'todos')
  assert.equal(linhas.length, 2)
  assert.equal(linhas.reduce((soma, linha) => soma + getValorPedido(linha), 0), 1200)
  assert.deepEqual(linhas.map(linha => linha.data_venda), ['2026-10-02', '2026-10-01'])
})

test('resposta de outro dono, filtro ou geração nunca pertence ao contexto atual', () => {
  assert.equal(consultaPertenceAoContexto('dono-a', 'dono-a', 3, 3, false), true)
  assert.equal(consultaPertenceAoContexto('dono-a', 'dono-b', 3, 3, false), false)
  assert.equal(consultaPertenceAoContexto('dono-a', 'dono-a', 2, 3, false), false)
  assert.equal(consultaPertenceAoContexto('dono-a', 'dono-a', 3, 3, true), false)
})

test('comissão global preserva o padrão explícito de um por cento do Controle', () => {
  assert.equal(typeof calculos.percentualComissaoControle, 'function')
  const percentualComissaoControle = calculos.percentualComissaoControle
  assert.equal(percentualComissaoControle(2.5), 2.5)
  assert.equal(percentualComissaoControle(null), 1)
  assert.equal(percentualComissaoControle(undefined), 1)
  assert.equal(percentualComissaoControle(0), 1)
})

test('exportação nunca salva depois do unmount mesmo quando refs antigas ainda combinam', () => {
  assert.equal(typeof calculos.exportacaoPertenceAoContexto, 'function')
  const captura = { dono: 'dono-a', consulta: 'outubro-alfa', geracaoPedidos: 3, geracaoAno: 2 }
  assert.equal(calculos.exportacaoPertenceAoContexto(captura, { ...captura, montado: true, acessoNegado: false }), true)
  assert.equal(calculos.exportacaoPertenceAoContexto(captura, { ...captura, montado: false, acessoNegado: false }), false)
})

test('setup posterior ao cleanup não ressuscita exportação de geração anterior', () => {
  assert.equal(typeof calculos.exportacaoPertenceAoContexto, 'function')
  const captura = { dono: 'dono-a', consulta: 'outubro-alfa', geracaoPedidos: 3, geracaoAno: 2 }
  assert.equal(calculos.exportacaoPertenceAoContexto(captura, { ...captura, geracaoPedidos: 4, geracaoAno: 3, montado: true, acessoNegado: false }), false)
  assert.equal(calculos.exportacaoPertenceAoContexto(captura, { ...captura, montado: true, acessoNegado: true }), false)
  assert.equal(calculos.exportacaoPertenceAoContexto(captura, { ...captura, dono: 'dono-b', montado: true, acessoNegado: false }), false)
})
