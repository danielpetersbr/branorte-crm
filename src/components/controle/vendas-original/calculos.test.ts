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

for (const ajuste of [100, -100]) {
  for (const compartilhado of [false, true]) {
    test(`soma dos meses conserva o ano com ajuste ${ajuste} e compartilhamento ${compartilhado}`, () => {
      const original = pedido({ data_venda: '2026-09-10', ajuste_data: '2026-10-05', ajuste_valor: ajuste,
        vendedor_2: compartilhado ? ' BETA ' : null })
      const setembro = expandirPedidos([original], '2026-09-01', '2026-09-30', 'todos')
      const outubro = expandirPedidos([original], '2026-10-01', '2026-10-31', 'todos')
      const ano = expandirPedidos([original], '2026-01-01', '2026-12-31', 'todos')
      assert.equal(setembro.reduce((s, p) => s + getValorPedido(p), 0), 1000)
      assert.equal(outubro.reduce((s, p) => s + getValorPedido(p), 0), ajuste)
      assert.equal(ano.reduce((s, p) => s + getValorPedido(p), 0), 1000 + ajuste)
      assert.equal(ano.filter(p => p.data_venda.startsWith('2026-09')).reduce((s, p) => s + getValorPedido(p), 0), 1000)
      assert.equal(ano.filter(p => p.data_venda.startsWith('2026-10')).reduce((s, p) => s + getValorPedido(p), 0), ajuste)
      assert.ok(outubro.every(p => (p as any)._isAjuste && p.data_venda === '2026-10-05'))
    })
  }
}

test('ajuste de outro ano não contamina o valor anual da venda', () => {
  const original = pedido({ data_venda: '2025-12-20', vendedor_2: 'BETA', ajuste_valor: 100, ajuste_data: '2026-01-05' })
  assert.equal(expandirPedidos([original], '2025-01-01', '2025-12-31', 'todos').reduce((s, p) => s + getValorPedido(p), 0), 1000)
  const atual = expandirPedidos([original], '2026-01-01', '2026-12-31', 'todos')
  assert.equal(atual.reduce((s, p) => s + getValorPedido(p), 0), 100)
  assert.ok(atual.every(p => p.data_venda === '2026-01-05'))
})

test('splits explícitos são o total final e ajuste datado desloca metade de cada parcela', () => {
  // Overrides já representam o total final no ranking original. Ajustes usam 50/50 nas comissões.
  const original = { ...pedido({ vendedor: ' ALFA ', vendedor_2: ' BETA ', data_venda: '2026-09-10',
    ajuste_valor: 100, ajuste_data: '2026-10-05' }), valor_split_v1: 750, valor_split_v2: 350 }
  const setembro = expandirPedidos([original], '2026-09-01', '2026-09-30', 'todos')
  assert.deepEqual(setembro.map(p => [p.vendedor, getValorPedido(p)]), [['ALFA', 700], ['BETA', 300]])
  const outubro = expandirPedidos([original], '2026-10-01', '2026-10-31', 'BETA')
  assert.deepEqual(outubro.map(p => [p.vendedor, getValorPedido(p)]), [['BETA', 50]])
  assert.equal(expandirPedidos([original], '2026-01-01', '2026-12-31', 'todos').reduce((s, p) => s + getValorPedido(p), 0), 1100)
})

test('um split explícito completa o outro com o total do pai, inclusive quando é zero', () => {
  const original = { ...pedido({ vendedor_2: 'BETA', ajuste_valor: 100, ajuste_data: '2026-10-05' }), valor_split_v1: 0 }
  const linhas = expandirPedidos([original], '2026-10-01', '2026-10-31', 'todos')
  assert.deepEqual(linhas.filter(p => !(p as any)._isAjuste).map(getValorPedido), [-50, 1050])
  assert.deepEqual(linhas.filter(p => (p as any)._isAjuste).map(getValorPedido), [50, 50])
})

test('ajuste sem data acompanha a venda e preserva o split explícito', () => {
  const original = { ...pedido({ vendedor_2: 'BETA', ajuste_valor: 100 }), valor_split_v1: 750, valor_split_v2: 350 }
  const linhas = expandirPedidos([original], '2026-10-01', '2026-10-31', 'todos')
  assert.deepEqual(linhas.map(getValorPedido), [750, 350])
  assert.ok(linhas.every(p => !(p as any)._isAjuste))
})

test('filtro normalizado vale para vendedor principal e pedidos sem compartilhamento', () => {
  const linhas = expandirPedidos([pedido({ vendedor: ' ALFA ' }), pedido({ id: 'outro', vendedor: 'BETA' })], '2026-10-01', '2026-10-31', ' alfa ')
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].vendedor, 'ALFA')
  assert.equal(expandirPedidos([pedido({ vendedor: ' ALFA ', vendedor_2: 'BETA' })], '2026-10-01', '2026-10-31', ' alfa ').length, 1)
})

test('nenhuma linha fora das datas da consulta é incorporada', () => {
  assert.deepEqual(expandirPedidos([pedido({ data_venda: '2026-09-01' })], '2026-10-01', '2026-10-31', 'todos'), [])
})

for (const valor of [100.01, -100.01, 0.01, -0.01]) {
  test(`split implícito de ${valor} fecha em centavos e atribui excedente assinado ao vendedor 1`, () => {
    const linhas = expandirPedidos([pedido({ vendedor_2: 'BETA', valor_total: valor })], '2026-10-01', '2026-10-31', 'todos')
    const valores = linhas.map(getValorPedido)
    const centavos = Math.round(valor * 100)
    const primeiro = Math.sign(centavos) * Math.ceil(Math.abs(centavos) / 2)
    assert.deepEqual(valores, [primeiro / 100, (centavos - primeiro) / 100])
    assert.equal(valores.reduce((s, v) => s + Math.round(v * 100), 0), centavos)
    assert.equal(valores.reduce((s, v) => s + Number(v.toFixed(2)), 0).toFixed(2), valor.toFixed(2))
  })
}

for (const ajuste of [0.01, -0.01, 100.01, -100.01]) {
  test(`ajuste datado ${ajuste} mantém a base compartilhada idêntica antes e durante seu mês`, () => {
    const original = pedido({ vendedor_2: 'BETA', valor_total: 100.01, data_venda: '2026-09-10',
      ajuste_valor: ajuste, ajuste_data: '2026-10-05' })
    const venda = expandirPedidos([original], '2026-09-01', '2026-09-30', 'todos')
    const alteracao = expandirPedidos([original], '2026-10-01', '2026-10-31', 'todos')
    const ano = expandirPedidos([original], '2026-01-01', '2026-12-31', 'todos')
    assert.deepEqual(venda.map(getValorPedido), [50.01, 50])
    assert.deepEqual(ano.filter(p => !p._isAjuste).map(getValorPedido), venda.map(getValorPedido))
    const centavosAjuste = Math.round(ajuste * 100)
    const primeiro = Math.sign(centavosAjuste) * Math.ceil(Math.abs(centavosAjuste) / 2)
    assert.deepEqual(alteracao.map(getValorPedido), [primeiro / 100, (centavosAjuste - primeiro) / 100])
    assert.equal(ano.reduce((s, p) => s + Math.round(getValorPedido(p) * 100), 0), 10001 + centavosAjuste)
    for (const vendedor of ['ALFA', 'BETA']) {
      assert.deepEqual(expandirPedidos([original], '2026-01-01', '2026-12-31', vendedor).map(getValorPedido),
        ano.filter(p => p.vendedor === vendedor).map(getValorPedido))
    }
  })
}

test('ajuste ímpar datado preserva splits explícitos finais e não introduz meio centavo', () => {
  const original = pedido({ vendedor_2: 'BETA', data_venda: '2026-09-10', valor_total: 100.02,
    valor_split_v1: 75.02, valor_split_v2: 25.01, ajuste_valor: 0.01, ajuste_data: '2026-10-05' })
  const ano = expandirPedidos([original], '2026-01-01', '2026-12-31', 'todos')
  assert.deepEqual(ano.filter(p => !p._isAjuste).map(getValorPedido), [75.01, 25.01])
  assert.deepEqual(ano.filter(p => p._isAjuste).map(getValorPedido), [0.01, 0])
  assert.equal(ano.filter(p => p.vendedor === 'ALFA').reduce((s, p) => s + Math.round(getValorPedido(p) * 100), 0), 7502)
  assert.equal(ano.filter(p => p.vendedor === 'BETA').reduce((s, p) => s + Math.round(getValorPedido(p) * 100), 0), 2501)
})

test('um split explícito com centavos mantém seu valor e complementa o outro pelo total final', () => {
  const original = pedido({ vendedor_2: 'BETA', valor_total: 100.01, valor_split_v1: 60.01,
    ajuste_valor: 0.01, ajuste_data: '2026-10-05' })
  const ano = expandirPedidos([original], '2026-01-01', '2026-12-31', 'todos')
  assert.deepEqual(ano.filter(p => !p._isAjuste).map(getValorPedido), [60, 40.01])
  assert.deepEqual(ano.filter(p => p._isAjuste).map(getValorPedido), [0.01, 0])
})

test('sem data de ajuste as parcelas da base e do ajuste continuam juntas na venda', () => {
  const original = pedido({ vendedor_2: 'BETA', valor_total: 100.01, ajuste_valor: 0.01 })
  const linhas = expandirPedidos([original], '2026-10-01', '2026-10-31', 'todos')
  assert.deepEqual(linhas.map(getValorPedido), [50.02, 50])
  assert.ok(linhas.every(p => !p._isAjuste))
})
