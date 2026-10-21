import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  intervaloMkt, lerFonte, montarRelatorio, seloProposta,
  type FonteMkt, type GastoLinhaMkt, type PlataformaMkt, type VendaMkt, type VendedorMkt,
} from './marketing-relatorio'

const fonte = (p: Partial<FonteMkt>): FonteMkt => ({
  tipo: 'canal', chave: 'X', nome: null, leads: 100, rastreaveis: 100, qualificados: 0, comProposta: 0,
  propPor100: 0, icMin: 0, icMax: 0, rsProposto: 0, compraram: 0, rsVendido: 0, fechados: 0, nunca: 0,
  sumiu: 0, semInteresse: 0, preco: 0, concorrente: 0, nadaAVer: 0, naoFabricamos: 0, foraEscopo: 0, boi200: 0, ...p,
})
const gasto = (codigo: string | null, g: number, tipo: GastoLinhaMkt['tipo'] = 'codigo', campanhas: string | null = null): GastoLinhaMkt =>
  ({ tipo, codigo, gasto: g, conversas: 0, anuncios: 1, carregadoAte: '2026-10-20', campanhas })

test('mês passado vai do dia 1 ao dia 1 do mês atual (fim exclusivo)', () => {
  const r = intervaloMkt('mes_passado', new Date(2026, 9, 20, 15))
  assert.deepEqual([r.from.getMonth(), r.from.getDate(), r.to.getMonth(), r.to.getDate()], [8, 1, 9, 1])
  assert.equal(r.label, 'setembro de 2026')
})

test('virada de ano: janeiro olha dezembro do ano anterior', () => {
  const r = intervaloMkt('mes_passado', new Date(2027, 0, 5))
  assert.equal(r.from.getFullYear(), 2026)
  assert.equal(r.label, 'dezembro de 2026')
})

test('selo só sai do "igual à média" quando a margem inteira fica de um lado', () => {
  assert.equal(seloProposta(fonte({ icMin: 4, icMax: 13 }), 3.7), 'acima')
  assert.equal(seloProposta(fonte({ icMin: 2, icMax: 4.2 }), 3.7), 'media')
  assert.equal(seloProposta(fonte({ icMin: 0.4, icMax: 3 }), 3.7), 'abaixo')
  assert.equal(seloProposta(fonte({ leads: 15, rastreaveis: 15 }), 3.7), 'pouco')
  assert.equal(seloProposta(fonte({ leads: 35, rastreaveis: 17 }), 3.7), 'sem_fone')
})

test('RPC antiga (sem as colunas novas) não perde o "não fabricamos"', () => {
  const f = lerFonte({ tipo: 'criativo', chave: '&90', leads: 109, prop_por_100: '4.59', nada_a_ver: 7 })
  assert.equal(f.propPor100, 4.59)
  assert.equal(f.naoFabricamos, 7)
})

// Setembro/2026 de verdade, resumido: &8 bom, &88 ruim, &94 gastou sem orçamento, &96 pouco volume, &45 vaga de emprego.
const meta = fonte({ chave: 'Meta ADS (WhatsApp)', leads: 1002, rastreaveis: 999, comProposta: 37, propPor100: 3.7, icMin: 2.7, icMax: 5.1, nunca: 139, sumiu: 81 })
const fontes = [
  fonte({ tipo: 'total', chave: 'TOTAL', leads: 1638, rastreaveis: 1587, comProposta: 78, propPor100: 4.9, icMin: 4, icMax: 6.1 }),
  meta,
  fonte({ tipo: 'criativo', chave: '&8', leads: 127, rastreaveis: 125, comProposta: 9, propPor100: 7.2, icMin: 3.8, icMax: 13.1, nunca: 14, sumiu: 6 }),
  fonte({ tipo: 'criativo', chave: '&88', leads: 153, rastreaveis: 153, comProposta: 1, propPor100: 0.65, icMin: 0.1, icMax: 3.6, nunca: 22, sumiu: 17 }),
  fonte({ tipo: 'criativo', chave: '&94', leads: 35, rastreaveis: 35, comProposta: 0, propPor100: 0, icMin: 0, icMax: 9.9, naoFabricamos: 9 }),
  fonte({ tipo: 'criativo', chave: '&96', leads: 44, rastreaveis: 44, comProposta: 6, propPor100: 13.6, icMin: 6.4, icMax: 26.7 }),
]
const gastos = [
  gasto('&8', 1464), gasto('&88', 1654), gasto('&94', 1046), gasto('&96', 613),
  gasto('&45', 363, 'codigo', '[NOVA] - VAGA DE EMPREGO'), gasto(null, 6211, 'sem_codigo'), gasto(null, 20793, 'total'),
]

test('decisão de verba: sobe o bom, testa o pequeno promissor, corta o ruim e o que gastou sem orçamento', () => {
  const rel = montarRelatorio(fontes, [], gastos)
  const d = Object.fromEntries(rel.anuncios.map(a => [a.codigo, a.decisao]))
  assert.equal(d['&8'], 'subir')
  assert.equal(d['&88'], 'cortar')
  assert.equal(d['&94'], 'cortar')
  assert.equal(d['&96'], 'testar', '6 orçamentos a R$ 102, abaixo da média, mas sem volume')
  assert.equal(d['&45'], 'fora')
  assert.equal(rel.regua.mediaPor100, 3.7, 'compara anúncio com a média do META, não da conta')
  assert.ok(rel.tarefasTrafego.some(t => t.includes('código &NN')), 'R$ 6,2 mil sem código vira tarefa do tráfego')
})

test('sem gasto carregado não há custo nem corte por dinheiro', () => {
  const rel = montarRelatorio(fontes, [])
  const a = rel.anuncios.find(x => x.codigo === '&94')!
  assert.equal(a.custoOrcamento, null)
  assert.equal(rel.gastoTotal, null)
  assert.equal(a.decisao, 'esperar', '35 contatos e sem gasto = sem volume para julgar')
})

test('vendas: carteira separada da internet e vendedor sem espelho vira tarefa', () => {
  const vendas: VendaMkt[] = [
    { tipo: 'grupo', chave: 'Carteira e relacionamento', nome: null, vendas: 35, valor: 2540237 },
    { tipo: 'grupo', chave: 'Internet (anúncio, rede social, site)', nome: null, vendas: 22, valor: 1760700 },
    { tipo: 'origem', chave: 'Não informado no pedido', nome: 'Sem origem no pedido', vendas: 12, valor: 235687 },
    { tipo: 'total', chave: 'TOTAL', nome: null, vendas: 69, valor: 4536625 },
  ]
  const jardel: VendedorMkt = { vendedor: 'JARDEL', contatos: 106, rastreaveis: 106, comOrcamento: 7, sumiu: 0, clienteEscreveu: 37, respondidos: 28, medianaRespostaMin: 40, ate1h: 14, semResposta24h: 12, medianaEnviadas: 0 }
  const pedro: VendedorMkt = { vendedor: 'PEDRO', contatos: 141, rastreaveis: 141, comOrcamento: 12, sumiu: 61, clienteEscreveu: 88, respondidos: 86, medianaRespostaMin: 311, ate1h: 39, semResposta24h: 18, medianaEnviadas: 6 }
  const rel = montarRelatorio(fontes, vendas, gastos, [jardel, pedro])
  const v = rel.destaques.find(x => x.chave === 'venda')!.texto
  assert.match(v, /Carteira e relacionamento \(não é mídia\): 35 pedidos/)
  assert.ok(rel.tarefasVendas.some(t => t.startsWith('Jardel') && t.includes('espelho')))
  assert.ok(rel.tarefasVendas.some(t => t.startsWith('Pedro') && t.includes('5,2 h')))
  assert.ok(rel.tarefasVendas.some(t => t.includes('12 de 69 pedidos')))
})

test('verba do Google: vai para o canal Google Ads; sem esse canal no período (antes de 21/10), fica no Site', () => {
  const google: PlataformaMkt = { tipo: 'plataforma', plataforma: 'Google', campanha: null, status: null, orcamentoDia: null,
    gasto: 1200, impressoes: 0, cliques: 0, resultado: 0, diasComGasto: null, carregadoAte: '2026-10-21', resultadoTipo: 'conversões' }
  const site = fonte({ chave: 'Site', comProposta: 8 })
  const antes = montarRelatorio([...fontes, site], [], gastos, [], { plataformas: [google] })
  assert.equal(antes.custoCanal['Site'], 150)
  const ads = fonte({ chave: 'Google Ads', comProposta: 3 })
  const busca = fonte({ chave: 'Google (busca)', comProposta: 4 })
  const depois = montarRelatorio([...fontes, site, ads, busca], [], gastos, [], { plataformas: [google] })
  assert.equal(depois.custoCanal['Google Ads'], 400)
  assert.equal(depois.custoCanal['Site'], undefined)
  assert.equal(depois.custoCanal['Google (busca)'], undefined)
})
