import test from 'node:test'
import assert from 'node:assert/strict'
import { fabricasDoCatalogo } from './catalogo-fabricas'
import type { CatalogoItemAdmin } from '../hooks/useCatalogoAdmin'

const modelo = { id: 46, basename: 'Compacta 03 - 1001000 Mono', pacote: 'COMPACTA 03', voltagem: 'monofasico', is_master: false, ativo: true, foto_url: 'modelos/46.jpeg', producao_kgh: 1000, total_equipamentos: 142918, itens: [{ nome: 'Moinho 10 CV', qtd: 1 }] }

test('fábricas usam modelos do orçamento com foto e voltagem, preservando equipamentos avulsos', () => {
  const avulso = { id: 8, categoria: 'CAIXA', ativo: true } as CatalogoItemAdmin
  const legado = { id: 748, categoria: 'COMPACTA', ativo: false, foto_url: 'antiga.jpg', preco_branorte_id: 313 } as CatalogoItemAdmin
  const resultado = fabricasDoCatalogo([avulso, legado], [modelo, { ...modelo, id: 47, basename: 'Compacta 03 - 1001000 Trif', voltagem: 'trifasico', foto_url: 'modelos/47.jpeg' }])
  assert.equal(resultado.length, 3)
  assert.equal(resultado[0], avulso)
  assert.deepEqual(resultado.slice(1).map(i => [i.modelo_id, i.foto_url, i.ativo]), [[46, 'modelos/46.jpeg', true], [47, 'modelos/47.jpeg', true]])
  assert.deepEqual(resultado[1].specs, ['Produção: 1.000 kg/h', 'Monofásico', '1 × Moinho 10 CV'])
  assert.equal(resultado[1].valor, modelo.total_equipamentos)
  assert.equal(new Set(resultado.map(i => i.id)).size, 3)
})

test('fábrica avulsa criada no catálogo continua visível e editável', () => {
  const avulsa = { id: 999, categoria: 'COMPACTA', ativo: true, is_oficial: true, preco_branorte_id: null, notas_curadoria: null } as CatalogoItemAdmin
  const vinculado = { ...avulsa, id: 748, notas_curadoria: 'modelo_id=46' }
  const resultado = fabricasDoCatalogo([avulsa, vinculado], [modelo])
  assert.equal(resultado.length, 2)
  assert.equal(resultado[0], avulsa)
  assert.equal(resultado[0].modelo_id, undefined)
})

test('estado inativo do modelo é respeitado; pacote vazio ou externo não vira fábrica', () => {
  const resultado = fabricasDoCatalogo([], [{ ...modelo, ativo: false }, { ...modelo, id: 90, itens: [] }, { ...modelo, id: 91, pacote: 'SERVIÇO' }])
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].ativo, false)
})
