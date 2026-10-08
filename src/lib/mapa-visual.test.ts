import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { OrcamentoPonto, Visita } from '../hooks/useVisitas'
import { selecionarMapaVisual, modoMapaVisual, estiloOrcadoVisual, prepararDesenhoVisual, deslocamentoVisual } from './mapa-visual'

function cliente(props: Partial<OrcamentoPonto> = {}): OrcamentoPonto {
  return { cli_key: 'cliente', cliente: 'Cliente', telefone: null, fone: null, numeros: null,
    cidade: 'Chapecó', uf: 'SC', total: 50_000, n_orcamentos: 1, data_recente: '2012-01-01',
    vendedor: null, vendido: false, n_vendas: 0, lat: -27.1, lng: -52.6, precisao: 'cidade', ...props }
}
function visita(props: Partial<Visita> = {}): Visita {
  return { id: 'visita', telefone: null, nome: 'Cliente', cidade: 'Chapecó', estado: 'SC',
    interesse: null, visitar: true, vendedor_nome: null, etiquetas: null, valor_negociando: null,
    lat: -27.1, lng: -52.6, created_at: '2012-01-01', vendido: false, n_vendas: 0, ...props }
}

test('cartão conserva equipamento e valor do último orçamento sem somar os orçamentos do cliente', () => {
  const equipamento = 'Misturador horizontal de 2.000 litros com conjunto completo de transporte e dosagem'
  const dados = selecionarMapaVisual([
    cliente({ cli_key: 'orcado', equipamento, total: 128_750.5, n_orcamentos: 6, data_recente: '2026-10-08' }),
    cliente({ cli_key: 'vendido', vendido: true, equipamento: 'Fábrica de ração', total: 940_500, n_vendas: 3 }),
  ], [])
  assert.equal(dados.orcados.pontos[0].detalhes.equipamento, equipamento)
  assert.equal(dados.orcados.pontos[0].detalhes.valor, 128_750.5)
  assert.equal(dados.vendidos.pontos[0].detalhes.equipamento, 'Fábrica de ração')
  assert.equal(dados.vendidos.pontos[0].detalhes.valor, 940_500)
})

test('cartão preserva valor zero e informa ausência sem inventar equipamento', () => {
  const dados = selecionarMapaVisual([
    cliente({ cli_key: 'zero', total: 0 }),
    cliente({ cli_key: 'sem-dados', equipamento: null, total: null }),
  ], [visita({ interesse: 'Avaliar uma linha de produção', valor_negociando: 0 })])
  assert.equal(dados.orcados.pontos[0].detalhes.valor, 0)
  assert.equal(dados.orcados.pontos[0].detalhes.equipamento, null)
  assert.equal(dados.orcados.pontos[1].detalhes.valor, null)
  assert.equal(dados.orcados.pontos[1].detalhes.equipamento, null)
  assert.equal(dados.visitas.pontos[0].detalhes.equipamento, 'Avaliar uma linha de produção')
  assert.equal(dados.visitas.pontos[0].detalhes.valor, 0)
  const semInteresse = selecionarMapaVisual([], [visita()]).visitas.pontos[0]
  assert.equal(semInteresse.detalhes.equipamento, null)
  assert.equal(semInteresse.detalhes.valor, null)
})

test('vendidos inclui clientes sem orçamento e antigos; comprador com vários orçamentos sai de orçados', () => {
  const dados = selecionarMapaVisual([
    cliente({ cli_key: 'comprador', vendido: true, n_vendas: 1, n_orcamentos: 8 }),
    cliente({ cli_key: 'venda-sem-orcamento', vendido: true, n_orcamentos: 0 }),
    cliente({ cli_key: 'cotacao-antiga' }),
  ], [])
  assert.deepEqual(dados.vendidos.pontos.map(p => p.id), ['comprador', 'venda-sem-orcamento'])
  assert.deepEqual(dados.orcados.pontos.map(p => p.id), ['cotacao-antiga'])
  assert.equal(dados.vendidos.total, 2)
  assert.equal(dados.orcados.total, 1)
})

test('visitas mostra só marcadas que ainda não compraram e conserva o total das sem localização', () => {
  const dados = selecionarMapaVisual([], [
    visita(), visita({ id: 'comprou', vendido: true }),
    visita({ id: 'sem-marcacao', visitar: false }), visita({ id: 'sem-flag', visitar: null }),
    visita({ id: 'sem-local', lat: null }), visita({ id: 'venda-confirmada', n_vendas: 1 }),
  ])
  assert.deepEqual(dados.visitas.pontos.map(p => p.id), ['visita'])
  assert.equal(dados.visitas.total, 2)
  assert.equal(dados.visitas.semLocalizacao, 1)
})

test('não cria posições fictícias e rejeita coordenadas inválidas', () => {
  const dados = selecionarMapaVisual([
    cliente(), cliente({ cli_key: 'nan', lat: NaN }), cliente({ cli_key: 'infinito', lng: Infinity }),
    cliente({ cli_key: 'fora-lat', lat: -91 }), cliente({ cli_key: 'fora-lng', lng: 181 }),
  ], [visita({ lng: null })])
  assert.equal(dados.orcados.total, 1)
  assert.deepEqual([dados.orcados.pontos[0].lat, dados.orcados.pontos[0].lng], [-27.1, -52.6])
  assert.equal(dados.visitas.pontos.length, 0)
})

test('valor mantém círculos abaixo de 100 mil, estrelas a partir de 100 mil e diamantes a partir de 300 mil', () => {
  const agora = Date.parse('2026-10-08T12:00:00Z')
  const recente = '2026-10-01T12:00:00Z'
  assert.equal(estiloOrcadoVisual(99_999, recente, agora).forma, 'circulo')
  assert.equal(estiloOrcadoVisual(100_000, recente, agora).forma, 'estrela')
  assert.equal(estiloOrcadoVisual(299_999, recente, agora).forma, 'estrela')
  assert.equal(estiloOrcadoVisual(300_000, recente, agora).forma, 'diamante')
  assert.equal(estiloOrcadoVisual(null, recente, agora).forma, 'circulo')
  assert.equal(estiloOrcadoVisual(100_000, recente, agora).cor, '#22c55e')
  assert.equal(estiloOrcadoVisual(100_000, '2026-08-08T12:00:00Z', agora).cor, '#ef4444')
  assert.equal(estiloOrcadoVisual(100_000, '2012-01-01', agora).cor, '#9ca3af')
  const valores = [99_999, 100_000, 299_999, 300_000, null, 0]
  const formas = ['circulo', 'estrela', 'estrela', 'diamante', 'circulo', 'circulo']
  for (const obrigatoria of [false, true]) {
    const pontos = selecionarMapaVisual([], valores.map((valor, i) => visita({
      id: String(i), valor_negociando: valor, visita_obrigatoria: obrigatoria,
    }))).visitas.pontos
    assert.deepEqual(pontos.map(p => p.forma), formas)
    assert.deepEqual(pontos.map(p => p.cor), valores.map(() => obrigatoria ? '#ef4444' : '#3b82f6'))
    assert.deepEqual(pontos.map(p => p.detalhes.valor), valores)
  }
})

test('vendidos distinguem estados vizinhos e mantêm círculos mesmo quando o valor é alto', () => {
  const dados = selecionarMapaVisual([
    cliente({ cli_key: 'sc', vendido: true, total: 900_000 }),
    cliente({ cli_key: 'pr', vendido: true, uf: 'PR' }),
    cliente({ cli_key: 'sc-2', vendido: true, uf: ' sc ' }),
    cliente({ cli_key: 'sem-uf', vendido: true, uf: null }),
  ], [])
  assert.equal(dados.vendidos.pontos[0].forma, 'circulo')
  assert.notEqual(dados.vendidos.pontos[0].cor, dados.vendidos.pontos[1].cor)
  assert.equal(dados.vendidos.pontos[0].cor, dados.vendidos.pontos[2].cor)
  assert.equal(dados.vendidos.pontos[3].cor, '#9ca3af')
})

test('os pontos preservam identidade, contato e responsável para consultar no mapa', () => {
  const dados = selecionarMapaVisual([
    cliente({ vendido: true, cliente: 'Maria & Filhos', telefone: '5548999990000', fone: '(48) 99999-0000', vendedor: 'EDER' }),
    cliente({ cli_key: 'orcado', cliente: 'João', telefone: null, fone: '5548999990001', vendedor: null }),
  ], [visita({ nome: 'Pedro', telefone: '5549999990002', vendedor_nome: 'DANIEL' })])
  assert.deepEqual(dados.vendidos.pontos[0].detalhes, {
    cliente: 'Maria & Filhos', telefone: '5548999990000', contato: '(48) 99999-0000',
    vendedor: 'EDER', cidade: 'Chapecó', uf: 'SC', categoria: 'Vendido',
    equipamento: null, valor: 50_000,
  })
  assert.equal(dados.orcados.pontos[0].detalhes.telefone, '5548999990001')
  assert.equal(dados.orcados.pontos[0].detalhes.vendedor, null)
  assert.deepEqual(dados.visitas.pontos[0].detalhes, {
    cliente: 'Pedro', telefone: '5549999990002', contato: '5549999990002', vendedor: 'DANIEL',
    cidade: 'Chapecó', uf: 'SC', categoria: 'Pode visitar',
    equipamento: null, valor: null,
  })
})

test('contatos brasileiros antigos sem DDI abrem no Brasil e o número já completo não duplica 55', () => {
  const dados = selecionarMapaVisual([
    cliente({ cli_key: 'importado', vendido: true, telefone: null, fone: '(49) 9 9922-5692' }),
    cliente({ cli_key: 'fixo', vendido: true, telefone: '48 3212-3456' }),
    cliente({ cli_key: 'ddd-55', vendido: true, telefone: '55 99999-0000' }),
    cliente({ cli_key: 'completo', vendido: true, telefone: '+55 49 99922-5692' }),
    cliente({ cli_key: 'sem-telefone', vendido: true, telefone: null, fone: null }),
    cliente({ cli_key: 'estrangeiro', vendido: true, telefone: '+1 555 123 4567' }),
  ], [visita({ telefone: '(49) 9 9922-5692' })])
  assert.deepEqual(dados.vendidos.pontos.map(p => p.detalhes.telefone),
    ['5549999225692', '554832123456', '5555999990000', '5549999225692', '', '15551234567'])
  assert.equal(dados.visitas.pontos[0].detalhes.telefone, '5549999225692')
})

test('visitas usa vermelho para É para visitar e azul para Pode visitar, independente do vendedor', () => {
  const orcamentos = [cliente({ vendedor: 'ANA', vendido: true }), cliente({ vendedor: 'DANIEL' })]
  const visitas = [
    visita({ id: 'bruno', vendedor_nome: 'BRUNO', visita_obrigatoria: true }),
    visita({ id: 'carlos', vendedor_nome: 'CARLOS', visitar: false }),
    visita({ id: 'eder', vendedor_nome: 'EDER', visita_obrigatoria: false }),
    visita({ id: 'sem-vendedor', vendedor_nome: null }),
  ]
  const esperado = [['bruno', '#ef4444'], ['eder', '#3b82f6'], ['sem-vendedor', '#3b82f6']]
  const cores = (pontos: ReturnType<typeof selecionarMapaVisual>['visitas']['pontos']) => pontos.map(p => [p.id, p.cor])
  assert.deepEqual(cores(selecionarMapaVisual(orcamentos, visitas).visitas.pontos), esperado)
  assert.deepEqual(cores(selecionarMapaVisual([...orcamentos].reverse(), [...visitas].reverse()).visitas.pontos).reverse(), esperado)
  assert.deepEqual(selecionarMapaVisual(orcamentos, visitas).visitas.pontos.map(p => p.detalhes.categoria),
    ['É para visitar', 'Pode visitar', 'Pode visitar'])
})

test('WhatsApp preserva o DDI explícito do contato original quando o normalizado tem onze dígitos', () => {
  const dados = selecionarMapaVisual([
    cliente({ cli_key: 'chile', telefone: '56912345678', fone: '  +56 912 345 678' }),
    cliente({ cli_key: 'eua', telefone: '12025550123', fone: '+1 202 555 0123', vendido: true }),
    cliente({ cli_key: 'br', telefone: '11987654321', fone: '(48) 91234-5678' }),
  ], [visita({ telefone: '+56 912 345 678' })])
  assert.equal(dados.orcados.pontos[0].detalhes.telefone, '56912345678')
  assert.equal(dados.orcados.pontos[0].detalhes.contato, '  +56 912 345 678')
  assert.equal(dados.orcados.pontos[1].detalhes.telefone, '5511987654321')
  assert.equal(dados.vendidos.pontos[0].detalhes.telefone, '12025550123')
  assert.equal(dados.visitas.pontos[0].detalhes.telefone, '56912345678')
})

test('flag É para visitar não inclui visitas desmarcadas ou clientes vendidos no mapa visual', () => {
  const dados = selecionarMapaVisual([], [
    visita({ id: 'para', visita_obrigatoria: true }),
    visita({ id: 'desmarcada', visitar: false, visita_obrigatoria: true }),
    visita({ id: 'sem-permissao', visitar: null, visita_obrigatoria: true }),
    visita({ id: 'vendida', vendido: true, visita_obrigatoria: true }),
  ])
  assert.deepEqual(dados.visitas.pontos.map(p => [p.id, p.cor]), [['para', '#ef4444']])
})

test('círculos usam o tamanho, contorno e opacidade das mesmas categorias no mapa completo', () => {
  const dados = selecionarMapaVisual([cliente(), cliente({ vendido: true })], [visita()])
  assert.deepEqual(dados.visitas.pontos[0].circulo, { radius: 9, color: '#0f172a', weight: 2.5, fillOpacity: 1 })
  const circuloOrcamento = { radius: 5, color: '#fff', weight: 1, fillOpacity: 0.92 }
  assert.deepEqual(dados.orcados.pontos[0].circulo, circuloOrcamento)
  assert.deepEqual(dados.vendidos.pontos[0].circulo, circuloOrcamento)
})

test('somente as três categorias são aceitas em links diretos', () => {
  for (const modo of ['vendidos', 'orcados', 'visitas']) assert.equal(modoMapaVisual(modo), modo)
  for (const modo of [null, '', 'todos', 'vendidos<script>']) assert.equal(modoMapaVisual(modo), null)
})

test('clientes da mesma cidade se separam ao aproximar, sem alterar as coordenadas cadastradas', () => {
  const pontos = selecionarMapaVisual(Array.from({ length: 7 }, (_, i) => cliente({ cli_key: String(i) })), []).orcados.pontos
  const antes = structuredClone(pontos)
  const desenho = prepararDesenhoVisual(pontos)
  const posicoes = desenho.map(p => deslocamentoVisual(p, 14))
  assert.equal(new Set(posicoes.map(p => p.join(','))).size, 7)
  assert.deepEqual(deslocamentoVisual(desenho[0], 14), [0, 0])
  assert.deepEqual(pontos, antes)
  for (const p of desenho) assert.deepEqual(deslocamentoVisual(p, 4), [0, 0])
})

test('separação visual respeita a cidade vizinha e os tetos de distância e de tela', () => {
  const pontos = selecionarMapaVisual([
    ...Array.from({ length: 100 }, (_, i) => cliente({ cli_key: String(i) })),
    cliente({ cli_key: 'outra-cidade', lat: -27.09 }),
  ], []).orcados.pontos
  const desenho = prepararDesenhoVisual(pontos)
  for (const zoom of [10, 14, 18]) {
    for (const p of desenho) {
      const [dx, dy] = deslocamentoVisual(p, zoom)
      const raioPx = Math.hypot(dx, dy)
      const metros = raioPx * 156543.03392 * Math.cos(p.lat * Math.PI / 180) / 2 ** zoom
      assert.ok(raioPx <= 260.000001)
      assert.ok(metros <= 556.600001) // metade dos 0,01° até o outro ponto
      assert.ok(metros <= 2500)
    }
  }
  assert.deepEqual(deslocamentoVisual(desenho.at(-1)!, 18), [0, 0])
})
