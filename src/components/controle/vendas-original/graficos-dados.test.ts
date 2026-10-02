import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandirPedidos, type Pedido } from './calculos'
import * as dados from './graficos-dados'
const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  id: 'p-1', pedido_numero: 'S1', numero_orcamento: 'S1', cliente: 'Sintético', vendedor: 'ALFA', vendedor_2: null,
  data_venda: '2026-09-10', valor_total: 1000, status: 'FECHADO', atencao_a: '', descricao_equipamento: 'Compacta 01',
  data_primeiro_contato: '2026-09-01', fonte_origem: 'site', estado: 'RS', equipamentos_json: [],
  equipamentos_detalhados: [{ descricao: 'Misturador', quantidade: 2, unidade: 'UN', valor: 500 }],
  ajuste_valor: 0, ajuste_motivo: null, ajuste_data: null, ...extra,
})
const expandir = (p: Pedido[], inicio = '2026-01-01', fim = '2026-12-31', vendedor = 'todos') => expandirPedidos(p, inicio, fim, vendedor)

test('valor das conversões físicas não fica reduzido à primeira parcela compartilhada', () => {
  const p = pedido({ vendedor_2: 'BETA', valor_split_v1: 750, valor_split_v2: 350, ajuste_valor: 100, ajuste_data: '2026-10-05' })
  const fisico = dados.pedidosFisicos(expandir([p]))[0]
  assert.equal(dados.valorVendaFisica(fisico), 1000)
  assert.equal(dados.valorVendaFisica({ ...fisico, ajuste_data: null }), 1100)
  assert.equal(dados.valorVendaFisica({ ...fisico, _valorOverride: 0 }), 1000)
})

test('pedido compartilhado não duplica fábrica, quantidade ou valor integral dos itens', () => {
  const linhas = expandir([pedido({ vendedor_2: 'BETA' })])
  assert.equal(dados.pedidosFisicos(linhas).length, 1)
  assert.deepEqual(dados.agruparFabricasVendidas(linhas), [{ fabrica: 'Compacta 1', quantidade: 1 }])
  assert.deepEqual(dados.agruparEquipamentosVendidos(linhas), [{ equipamento: 'Misturadores', quantidade: 2, valor: 1000 }])
})

test('ajuste isolado não cria unidades ou uma nova venda física', () => {
  const p = pedido({ vendedor_2: 'BETA', ajuste_valor: 100, ajuste_data: '2026-10-05' })
  const outubro = expandir([p], '2026-10-01', '2026-10-31')
  assert.deepEqual(dados.pedidosFisicos(outubro), [])
  assert.deepEqual(dados.agruparFabricasVendidas(outubro), [])
  assert.deepEqual(dados.agruparEquipamentosVendidos(outubro), [])
  const ano = expandir([p])
  assert.equal(dados.pedidosFisicos(ano).length, 1)
  assert.equal(dados.pedidosFisicos(ano)[0].data_venda, '2026-09-10')
})

test('deduplicação para tempo de cada vendedor preserva os dois associados após filtrar o vendedor', () => {
  const linhas = expandir([pedido({ vendedor_2: 'BETA', ajuste_valor: 100, ajuste_data: '2026-10-05' })])
  for (const vendedor of ['ALFA', 'BETA']) {
    const fisicos = dados.pedidosFisicos(linhas.filter(p => p.vendedor === vendedor))
    assert.equal(fisicos.length, 1)
    assert.equal(fisicos[0].data_venda, '2026-09-10')
    assert.equal(fisicos[0].data_primeiro_contato, '2026-09-01')
  }
})

test('cancelados não são unidades físicas, ABERTO continua no escopo ativo', () => {
  const linhas = expandir([pedido({ status: 'CANCELADO' }), pedido({ id: 'aberto', status: 'ABERTO' })])
  assert.deepEqual(dados.pedidosFisicos(linhas).map((p: Pedido) => p.id), ['aberto'])
})

test('nomes de fábricas usam acentos e limites do modelo sem classificar peças de reposição', () => {
  const casos: Array<[string, string | null]> = [
    ['Compacta 1', 'Compacta 1'], ['COMPACTA 02', 'Compacta 2'], ['Compacta 3 Master', 'Compacta 3 Master'],
    ['FÁBRICA DE RAÇÃO', 'Fábrica de Ração'], ['MINI FÁBRICA DE RAÇÃO', 'Mini Fábrica de Ração'],
    ['PENEIRA PARA COMPACTA 01', null], ['Jogo de martelos Compacta 2', null],
    ['Compacta 01 com moinho martelo', 'Compacta 1'],
  ]
  for (const [descricao, esperado] of casos) assert.equal(dados.classificarFabrica(descricao, 200000), esperado, descricao)
})

test('itens detalhados identificam fábrica sem texto livre e respeitam sua quantidade', () => {
  const linhas = expandir([pedido({ descricao_equipamento: '', equipamentos_detalhados: [
    { descricao: 'Compacta 1', quantidade: 2, valor: 100000 }, { descricao: 'Peneira para Compacta 1', quantidade: 4, valor: 500 },
  ] })])
  assert.deepEqual(dados.agruparFabricasVendidas(linhas), [{ fabrica: 'Compacta 1', quantidade: 2 }])
  assert.deepEqual(dados.agruparEquipamentosVendidos(linhas), [{ equipamento: 'Outros Equipamentos', quantidade: 4, valor: 2000 }])
})

test('componentes que mencionam o modelo não aumentam a quantidade de fábricas nem somem dos equipamentos', () => {
  const p = pedido({ vendedor_2: 'BETA', valor_total: 100500, equipamentos_detalhados: [
    { descricao: 'Compacta 1', quantidade: 1, valor: 100000 },
    { descricao: 'Painel elétrico para Compacta 1', quantidade: 1, valor: 200 },
    { descricao: 'Misturador para Compacta 1', quantidade: 1, valor: 300 },
  ] })
  for (const vendedor of ['todos', 'BETA']) {
    const linhas = expandir([p], '2026-01-01', '2026-12-31', vendedor)
    assert.deepEqual({ fabricas: dados.agruparFabricasVendidas(linhas), equipamentos: dados.agruparEquipamentosVendidos(linhas) }, {
      fabricas: [{ fabrica: 'Compacta 1', quantidade: 1 }],
      equipamentos: [
        { equipamento: 'Misturadores', quantidade: 1, valor: 300 },
        { equipamento: 'Painéis Elétricos', quantidade: 1, valor: 200 },
      ],
    }, vendedor)
  }
})

test('a descrição da fábrica pode incluir seus componentes ou identificar o conjunto completo', () => {
  for (const descricao of [
    'Compacta 1 com painel elétrico e misturador',
    'Fábrica de ração Compacta 1 com painel elétrico e misturador',
    'Fábrica de ração com moinho martelo e painel elétrico - Compacta 1',
    'Conjunto completo com painel elétrico e misturador - Compacta 1',
  ]) {
    assert.deepEqual(dados.agruparFabricasVendidas(expandir([pedido({ descricao_equipamento: descricao, equipamentos_detalhados: [] })])),
      [{ fabrica: 'Compacta 1', quantidade: 1 }], descricao)
  }
})

test('quantidade explícita zero não vira uma unidade; cadastro ausente mantém fallback de uma', () => {
  const linhas = expandir([pedido({ descricao_equipamento: 'Equipamentos', equipamentos_detalhados: [
    { descricao: 'Misturador', quantidade: 0, valor: 500 }, { descricao: 'Silo', valor: 300 },
  ] })])
  assert.deepEqual(dados.agruparEquipamentosVendidos(linhas), [{ equipamento: 'Silos', quantidade: 1, valor: 300 }])
})

test('fallback de fábrica não transforma item detalhado com quantidade zero em uma fábrica', () => {
  const linhas = expandir([pedido({ equipamentos_detalhados: [{ descricao: 'Compacta 01', quantidade: 0, valor: 100000 }] })])
  assert.deepEqual(dados.agruparFabricasVendidas(linhas), [])
})

test('equipamento já existente no cliente não é captado como unidade vendida', () => {
  const linhas = expandir([pedido({ equipamentos_detalhados: [{ descricao: 'Misturador (JÁ EXISTENTE)', quantidade: 2, valor: 0 }] })])
  assert.deepEqual(dados.agruparEquipamentosVendidos(linhas), [])
})

test('item.valor é unitário e pedido do vendedor secundário mantém os itens integrais associados', () => {
  const linhas = expandir([pedido({ vendedor_2: 'BETA' })], '2026-09-01', '2026-09-30', 'BETA')
  assert.deepEqual(dados.agruparEquipamentosVendidos(linhas), [{ equipamento: 'Misturadores', quantidade: 2, valor: 1000 }])
  const texto = expandir([pedido({ vendedor_2: 'BETA', descricao_equipamento: 'Misturador', equipamentos_detalhados: [] })], '2026-09-01', '2026-09-30', 'BETA')
  assert.deepEqual(dados.agruparEquipamentosVendidos(texto), [{ equipamento: 'Misturadores', quantidade: 1, valor: 1000 }])
})

test('origem não informada nunca recebe atribuição Meta ADS', () => {
  const normalizar = dados.normalizarOrigem
  for (const origem of [null, '', 'N/D', 'nao_informado', 'Não informado', 'nao_lembra']) assert.equal(normalizar(origem), 'Não informado')
  for (const origem of ['facebook', ' Instagram ', 'META ADS']) assert.equal(normalizar(origem), 'Meta ADS')
  assert.equal(normalizar('google'), 'Google')
  assert.equal(normalizar('indicacao'), 'Indicação')
  assert.equal(normalizar('lp_compacta_01'), 'lp compacta 01')
})

test('dataset dos estados conserva todas as 27 UFs e o valor total sem limite de ranking', () => {
  const ufs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
  const linhas = ufs.map((estado, i) => pedido({ id: `uf-${i}`, estado, valor_total: 1000 }))
  const estados = dados.agruparVendasPorEstado(linhas)
  assert.equal(estados.length, 27)
  assert.equal(estados.reduce((s: number, e: { valor: number }) => s + e.valor, 0), 27000)
  assert.deepEqual(new Set(estados.map((e: { estado: string }) => e.estado)), new Set(ufs))
})

test('caixa e espaços da UF não fragmentam o valor nem sobrescrevem o estado no mapa', () => {
  const linhas = [
    pedido({ id: 'rs-maiusculo', estado: 'RS', valor_total: 100 }),
    pedido({ id: 'rs-minusculo', estado: 'rs', valor_total: 200 }),
    pedido({ id: 'rs-espacos', estado: ' rs ', valor_total: 300 }),
  ]
  assert.deepEqual(dados.agruparVendasPorEstado(linhas), [{ estado: 'RS', valor: 600, quantidade: 3 }])
})

test('UF ausente ou vazia usa um único grupo não informado mantendo seu valor', () => {
  const linhas = [pedido({ id: 'nulo', estado: null }), pedido({ id: 'vazio', estado: '  ' })]
  assert.deepEqual(dados.agruparVendasPorEstado(linhas), [{ estado: 'N/D', valor: 2000, quantidade: 2 }])
})
