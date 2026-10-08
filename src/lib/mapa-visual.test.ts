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
})

test('vendidos são círculos azuis mesmo quando o valor é alto', () => {
  const dados = selecionarMapaVisual([cliente({ vendido: true, total: 900_000 })], [])
  assert.equal(dados.vendidos.pontos[0].forma, 'circulo')
  assert.equal(dados.vendidos.pontos[0].cor, '#2563eb')
})

test('visitas mantém a cor de cada vendedor do mapa completo, mesmo com outros vendedores fora do filtro', () => {
  const orcamentos = [cliente({ vendedor: 'ANA', vendido: true }), cliente({ vendedor: 'DANIEL' })]
  const visitas = [
    visita({ id: 'bruno', vendedor_nome: 'BRUNO' }),
    visita({ id: 'carlos', vendedor_nome: 'CARLOS', visitar: false }),
    visita({ id: 'eder', vendedor_nome: 'EDER' }),
    visita({ id: 'sem-vendedor', vendedor_nome: null }),
  ]
  const esperado = [['bruno', '#3b82f6'], ['eder', '#8b5cf6'], ['sem-vendedor', '#ec4899']]
  const cores = (pontos: ReturnType<typeof selecionarMapaVisual>['visitas']['pontos']) => pontos.map(p => [p.id, p.cor])
  assert.deepEqual(cores(selecionarMapaVisual(orcamentos, visitas).visitas.pontos), esperado)
  assert.deepEqual(cores(selecionarMapaVisual([...orcamentos].reverse(), [...visitas].reverse()).visitas.pontos).reverse(), esperado)
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
