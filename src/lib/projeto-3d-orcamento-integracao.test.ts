import test from 'node:test'
import assert from 'node:assert/strict'

const integration = await import('./projeto-3d-orcamento-integracao').catch(() => null)
const origin = { exportId: 'export-1', projectId: 'project-1', projectName: 'Projeto', floorId: 'floor-1', floorName: 'Térreo', sourceId: 'piece-1', catalogId: 'cad-1', sequence: 1, resolution: 'pendente' as const, sourceName: 'Balança Eletrônica - Trifásico', sourceSpecifications: ['Medida original'], kind: 'equipment' as const }
const original = { uid: 'stable-uid', nome: origin.sourceName, nome_custom: null, specs: ['Medida original'], qtd: 3, valor: 0, valor_original: 0, motor_cv: null, motor_polos: null, motor_qtd: 0, motor_valor_unit: 0, catalogo_id: -1, categoria: 'PROJETO_3D', foto_url: null, origem_projeto3d: origin }

test('vínculo usa preço calculado do catálogo preservando identidade, ordem, nome e quantidade da lista', () => {
  assert.ok(integration, 'integração deve existir')
  const linked = integration.resolverVinculoProjeto3D(original, { ...original, uid: 'discard', nome: 'Catálogo', qtd: 1, specs: ['Motor oficial'], valor: 2300, valor_original: 2300, catalogo_id: 21, preco_branorte_id: 77, motor_cv: 3, motor_polos: 4, motor_qtd: 1, motor_valor_unit: 500 })
  assert.equal(linked.uid, original.uid)
  assert.equal(linked.nome, original.nome)
  assert.equal(linked.qtd, 3)
  assert.deepEqual(linked.specs, ['Medida original', 'Motor oficial'])
  assert.equal(linked.valor, 2300)
  assert.equal(linked.motor_valor_unit, 500)
  assert.equal(linked.catalogo_id, 21)
  assert.equal(linked.origem_projeto3d.resolution, 'vinculado')
  assert.deepEqual(linked.origem_projeto3d.sourceSpecifications, ['Medida original'])
  assert.equal(original.origem_projeto3d.resolution, 'pendente')
})

test('confirmação manual exige valor válido e mantém cada duplicata separada', () => {
  assert.ok(integration)
  for (const price of [NaN, Infinity, -1]) assert.throws(() => integration.resolverManualProjeto3D(original, price))
  const result = [original, { ...original, uid: 'second' }].map(row => integration.resolverManualProjeto3D(row, 1900))
  assert.deepEqual(result.map(row => [row.uid, row.nome, row.qtd, row.valor]), [['stable-uid', original.nome, 3, 1900], ['second', original.nome, 3, 1900]])
  assert.equal(integration.temPendenciasProjeto3D(result), false)
  assert.equal(integration.temPendenciasProjeto3D([original, result[0]]), true)
})

test('popup só recebe o projeto esperado da janela e origem exatas', () => {
  assert.ok(integration)
  const opener = {}
  const valid = { origin: 'https://branorte-configurador-3d.vercel.app', source: opener, data: { type: 'branorte:budget:transfer', payload: { exportId: 'export-1' } } }
  assert.equal(integration.mensagemPopupProjeto3DValida(valid, opener, 'export-1'), true)
  for (const message of [{ ...valid, source: {} }, { ...valid, origin: 'https://evil.example' }, { ...valid, data: { type: 'branorte:budget:transfer', payload: { exportId: 'other' } } }, { ...valid, source: null }]) assert.equal(integration.mensagemPopupProjeto3DValida(message, opener, 'export-1'), false)
  assert.equal(integration.mensagemPopupProjeto3DValida(valid, null, 'export-1'), false)
})

test('reload prefere rascunho do token sem consumir rascunhos de outro orçamento', () => {
  assert.ok(integration)
  const payload = { version: 1, saved_at: new Date().toISOString(), data: { carrinho: [{ ...original, valor: 1900, origem_projeto3d: { ...origin, resolution: 'manual' } }], clienteDados: { nome: 'Cliente do projeto' } } }
  const reads: string[] = []
  const storage = { getItem(key: string) { reads.push(key); return JSON.stringify(payload) } }
  assert.equal(integration.readProjeto3DDraft('export-1', storage)?.carrinho[0].valor, 1900)
  assert.deepEqual(reads, ['branorte_orcamento_montar_draft_v1:import3d-export-1'])
  assert.equal(integration.readProjeto3DDraft('other', storage), null)
  assert.equal(integration.readProjeto3DDraft('export-1', { getItem: () => JSON.stringify({ ...payload, saved_at: '2000-01-01' }) }), null)
})
