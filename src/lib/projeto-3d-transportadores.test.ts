import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogoItem } from '../hooks/useCatalogo'
import type { PrecoBranorte } from '../hooks/usePrecosBranorte'
import { encontrarCatalogoProjeto3D } from './projeto-3d-catalogo-match'
import { catalogoProjeto3DComTransportadores } from './projeto-3d-transportadores'
import { materializeProjeto3DOrcamento } from './projeto-3d-orcamento'

const price = { id: 101, categoria: 'TRANSPORTADOR', subcategoria: 'CHUPIM', descricao: 'chupim 160 x 5,5 m', ativo: true, motor_cv: 3, motor_polos: 4, potencia: '3 CV', capacidade: '10 TON/H', valor_equipamento: 6976.2 } as PrecoBranorte
const source = materializeProjeto3DOrcamento({ version: 1, exportId: 'teste-transportador-1234', projectId: 'projeto', projectName: 'Teste', clientName: '', items: [{ sourceId: 'tubo', floorId: 'terreo', floorName: 'Térreo', kind: 'equipment', catalogId: 'branorte_chupim', sequence: 1, name: 'TRANSPORTADOR HELICOIDAL 160 X 5,5 M', quantity: 2, specifications: [] }] })[0]

test('medida exata ausente no catálogo curado usa a tabela oficial atual, sem persistir uma FK de catálogo inventada', () => {
  const options = catalogoProjeto3DComTransportadores([], [price])
  const match = encontrarCatalogoProjeto3D(source, options)!
  assert.ok(match)
  assert.equal(match.preco_branorte_id, 101)
  assert.equal(match.valor, 6976.2)
  assert.ok(match.id < 0, 'id temporário da opção não é FK de catalogo_items')
  assert.ok(match.specs.includes('Comprimento: 5,5 metros.'))
  assert.ok(match.specs.includes('Diâmetro: 160 mm'))
  assert.equal(encontrarCatalogoProjeto3D({ ...source, origem_projeto3d: { ...source.origem_projeto3d, sourceName: 'TRANSPORTADOR HELICOIDAL 160 X 5,6 M' } }, options), null)
})

test('cadastro curado já vinculado à mesma linha oficial não vira uma segunda opção ambígua', () => {
  const curated = { id: 10, ativo: true, is_oficial: true, preco_branorte_id: 101 } as CatalogoItem
  assert.deepEqual(catalogoProjeto3DComTransportadores([curated], [price]), [curated])
})

test('preço inativo, categoria diferente e descrição com complemento não geram produto de transportador', () => {
  for (const patch of [{ ativo: false }, { categoria: 'CAIXA' }, { descricao: 'chupim 160 x 5,5 m inox' }, { descricao: 'chupim 160 x 5,5 m + moinho' }]) {
    assert.equal(catalogoProjeto3DComTransportadores([], [{ ...price, ...patch }]).length, 0)
  }
})

test('foto representativa respeita diâmetro, tipo e variante padrão', () => {
  const photos = [
    { id: 11, ativo: true, is_oficial: true, categoria: 'TRANSPORTADOR', nome_curto: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M', foto_url: '/tubo160.jpg', specs: [] },
    { id: 12, ativo: true, is_oficial: true, categoria: 'TRANSPORTADOR', nome_curto: 'TRANSPORTADOR HELICOIDAL 210 X 3,5 M', foto_url: '/tubo210.jpg', specs: [] },
  ] as unknown as CatalogoItem[]
  assert.equal(catalogoProjeto3DComTransportadores(photos, [price]).find(row => row.preco_branorte_id === 101)?.foto_url, '/tubo160.jpg')
  const onlyOther = catalogoProjeto3DComTransportadores(photos.slice(1), [price]).find(row => row.preco_branorte_id === 101)
  assert.equal(onlyOther?.foto_url, null)
})

test('chupim usa a fórmula comercial do motor e não a potência histórica da planilha', () => {
  const option = catalogoProjeto3DComTransportadores([], [{ ...price, motor_cv: 99, potencia: '99 CV' }])[0]
  assert.equal(option.motor_padrao_cv, 3)
  assert.ok(option.specs.some(spec => /3 CV/.test(spec)))
  assert.ok(!option.specs.some(spec => /99 CV/.test(spec)))
})

test('foto de motorredutor superior não representa o transportador padrão', () => {
  const photo = { id: 11, ativo: true, is_oficial: true, categoria: 'TRANSPORTADOR', nome_curto: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M - MOTORREDUTOR SUPERIOR', foto_url: '/variante.jpg', specs: [] } as unknown as CatalogoItem
  assert.equal(catalogoProjeto3DComTransportadores([photo], [price]).find(row => row.preco_branorte_id === price.id)?.foto_url, null)
})

test('calha TH conserva motorredutor incluso mesmo quando a potência descritiva está vazia', () => {
  const th = catalogoProjeto3DComTransportadores([], [{ ...price, subcategoria: 'TH', descricao: 'TH 160 x 5,5 m', potencia: null }])[0]
  assert.ok(th.specs.some(spec => /motorredutor incluso/.test(spec)))
  assert.ok(!th.specs.some(spec => /motor não incluso/.test(spec)))
})
