import assert from 'node:assert/strict'
import test from 'node:test'
import {
  materializeProjeto3DOrcamento,
  parseProjeto3DOrcamentoPayload,
  readProjeto3DOrcamentoTransfer,
  saveProjeto3DOrcamentoTransfer,
  type Projeto3DOrcamentoPayload,
} from './projeto-3d-orcamento'

function fixture(): Projeto3DOrcamentoPayload {
  return {
    version: 1,
    exportId: 'export_20261020_001',
    projectId: 'project-1',
    projectName: 'Fábrica do João',
    clientName: 'João & Filhos',
    items: [
      { sourceId: 'piece-2', floorId: 'floor-a', floorName: 'Térreo', kind: 'equipment', catalogId: 'branorte_bnmm30', sequence: 1, name: 'TRITURADOR DE GRÃOS 30 CV', quantity: 1, specifications: ['COM BASE', 'Referência 3D: BNMM30'] },
      { sourceId: 'piece-1', floorId: 'floor-a', floorName: 'Térreo', kind: 'equipment', catalogId: 'branorte_bnmm30', sequence: 2, name: 'TRITURADOR DE GRÃOS 30 CV', quantity: 1, specifications: ['COM BASE'] },
      { sourceId: 'extra-1', floorId: 'floor-b', floorName: 'Mezanino', kind: 'manual', catalogId: null, sequence: 3, name: '  Serviço especial — Ø210 × 3,5 m  ', quantity: 7, specifications: ['INOX 304', 'Não converter 1900 L em kg'] },
    ],
  }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

test('preserva literalmente nomes, especificações, quantidade e sequência de todos os pisos', () => {
  const source = fixture()
  const result = parseProjeto3DOrcamentoPayload(source)
  assert.deepEqual(result, source)
  assert.notEqual(result, source)
  assert.notEqual(result.items[0].specifications, source.items[0].specifications)
})

test('mantém duas peças com nomes e catalogId iguais quando sourceId é diferente', () => {
  const items = materializeProjeto3DOrcamento(fixture())
  assert.equal(items.length, 3)
  assert.deepEqual(items.map(item => item.uid), [
    '["export_20261020_001","floor-a","equipment","piece-2"]',
    '["export_20261020_001","floor-a","equipment","piece-1"]',
    '["export_20261020_001","floor-b","manual","extra-1"]',
  ])
  assert.deepEqual(items.map(item => item.qtd), [1, 1, 7])
  assert.equal(items[2].nome, '  Serviço especial — Ø210 × 3,5 m  ')
})

test('todos os itens entram pendentes sem aceitar preços, motores ou vínculo do remetente', () => {
  const source = fixture()
  Object.assign(source.items[0], { valor: 999, unitPrice: 999, catalogo_id: 20, preco_branorte_id: 44, motor_cv: 30 })
  const items = materializeProjeto3DOrcamento(source)
  for (const item of items) {
    assert.equal(item.valor, 0)
    assert.equal(item.valor_original, 0)
    assert.equal(item.catalogo_id, -1)
    assert.equal(item.preco_branorte_id, null)
    assert.equal(item.categoria, 'PROJETO3D')
    assert.equal(item.motor_cv, null)
    assert.equal(item.motor_polos, null)
    assert.equal(item.motor_qtd, 0)
    assert.equal(item.motor_valor_unit, 0)
    assert.equal(item.foto_url, null)
    assert.equal(item.origem_projeto3d.resolution, 'pendente')
  }
  assert.deepEqual(items[0].origem_projeto3d, {
    exportId: 'export_20261020_001', projectId: 'project-1', projectName: 'Fábrica do João',
    floorId: 'floor-a', floorName: 'Térreo', sourceId: 'piece-2', catalogId: 'branorte_bnmm30',
    sequence: 1, kind: 'equipment', sourceName: 'TRITURADOR DE GRÃOS 30 CV',
    sourceSpecifications: ['COM BASE', 'Referência 3D: BNMM30'], resolution: 'pendente',
  })
  assert.equal('valor' in parseProjeto3DOrcamentoPayload(source).items[0], false)
})

test('salvar e reler mantém a transferência para recarga e usa exportId como token', () => {
  const source = fixture()
  const storage = memoryStorage()
  const token = saveProjeto3DOrcamentoTransfer(source, storage)
  assert.equal(token, 'export_20261020_001')
  assert.deepEqual(readProjeto3DOrcamentoTransfer(token, storage), source)
  assert.deepEqual(readProjeto3DOrcamentoTransfer(token, storage), source)
  assert.equal(storage.values.size, 1)
})

test('reenvio idêntico é idempotente e colisão de exportId não sobrescreve a transferência', () => {
  const source = fixture()
  const storage = memoryStorage()
  assert.equal(saveProjeto3DOrcamentoTransfer(source, storage), saveProjeto3DOrcamentoTransfer(source, storage))
  const changed = fixture()
  changed.items[0].quantity = 2
  assert.throws(() => saveProjeto3DOrcamentoTransfer(changed, storage), /transferência|identificador/i)
  assert.deepEqual(readProjeto3DOrcamentoTransfer(source.exportId, storage), source)
})

test('leitura ausente, token inválido, JSON corrompido e storage indisponível retornam null', () => {
  const storage = memoryStorage()
  assert.equal(readProjeto3DOrcamentoTransfer('export_20261020_001', storage), null)
  assert.equal(readProjeto3DOrcamentoTransfer('../invalid', storage), null)
  saveProjeto3DOrcamentoTransfer(fixture(), storage)
  const key = [...storage.values.keys()][0]
  storage.values.set(key, '{broken')
  assert.equal(readProjeto3DOrcamentoTransfer('export_20261020_001', storage), null)
  storage.values.set(key, JSON.stringify({ ...fixture(), exportId: 'export_different_001' }))
  assert.equal(readProjeto3DOrcamentoTransfer('export_20261020_001', storage), null)
  assert.equal(readProjeto3DOrcamentoTransfer('export_20261020_001', { getItem() { throw new Error('unavailable') } }), null)
})

test('erro de escrita não declara a transferência salva', () => {
  assert.throws(() => saveProjeto3DOrcamentoTransfer(fixture(), {
    getItem: () => null, setItem() { throw new Error('quota exceeded') },
  }), /salvar|armazenamento/i)
})

test('rejeita linha repetida no mesmo piso e tipo sem remover linhas silenciosamente', () => {
  const source = fixture()
  source.items[1].sourceId = source.items[0].sourceId
  assert.throws(() => parseProjeto3DOrcamentoPayload(source), /duplicad|repetid/i)
  source.items[1].floorId = 'floor-b'
  assert.equal(parseProjeto3DOrcamentoPayload(source).items.length, 3)
  source.items[1].floorId = 'floor-a'
  source.items[1].kind = 'manual'
  source.items[1].catalogId = null
  assert.equal(parseProjeto3DOrcamentoPayload(source).items.length, 3)
})

for (const quantity of [0, -1, 1.5, 10001, NaN, Infinity, '2', null]) {
  test(`rejeita quantidade inválida ${String(quantity)}`, () => {
    const source = fixture()
    ;(source.items[1] as unknown as Record<string, unknown>).quantity = quantity
    assert.throws(() => parseProjeto3DOrcamentoPayload(source), /quantidade/i)
  })
}

for (const sequence of [0, 1, 3, 2.5, '2']) {
  test(`rejeita sequência global incoerente ${String(sequence)}`, () => {
    const source = fixture()
    ;(source.items[1] as unknown as Record<string, unknown>).sequence = sequence
    assert.throws(() => parseProjeto3DOrcamentoPayload(source), /sequência/i)
  })
}

test('rejeita versão, ids, nomes, tipo, especificações e arrays inválidos', () => {
  const invalidValues: unknown[] = [null, [], {}, { ...fixture(), version: 2 },
    { ...fixture(), exportId: 'short' }, { ...fixture(), projectId: 'project\nunsafe' },
    { ...fixture(), projectName: 'a'.repeat(2001) }, { ...fixture(), clientName: 'a'.repeat(501) },
    { ...fixture(), items: [] }, { ...fixture(), items: [null] },
  ]
  for (const field of ['sourceId', 'floorId', 'catalogId']) {
    const source = fixture()
    ;(source.items[0] as unknown as Record<string, unknown>)[field] = 'a'.repeat(129)
    invalidValues.push(source)
  }
  for (const patch of [
    { kind: 'unknown' }, { name: ' ' }, { name: 'a'.repeat(2001) },
    { floorName: '' }, { specifications: 'wrong' }, { specifications: [12] },
    { specifications: ['a'.repeat(2001)] }, { specifications: Array(21).fill('spec') },
  ]) {
    const source = fixture()
    Object.assign(source.items[0], patch)
    invalidValues.push(source)
  }
  for (const value of invalidValues) assert.throws(() => parseProjeto3DOrcamentoPayload(value), /inválid|obrigatóri|limite/i)
})

test('aceita ids legados Unicode com separadores e mantém uid sem colisão de tuplas', () => {
  const source = fixture()
  source.projectId = 'projeto:São.João'
  source.items[0].floorId = 'Piso:São.João'
  source.items[0].sourceId = 'x:equipment:y'
  source.items[1].floorId = 'Piso:São.João:equipment:x'
  source.items[1].sourceId = 'y'
  const items = materializeProjeto3DOrcamento(source)
  assert.notEqual(items[0].uid, items[1].uid)
  assert.equal(items[0].origem_projeto3d.projectId, 'projeto:São.João')
})

test('cliente vazio legado é permitido e projeto sem nome recebe fallback', () => {
  const source = fixture()
  source.clientName = ''
  source.projectName = ' '
  assert.equal(parseProjeto3DOrcamentoPayload(source).clientName, '')
  assert.equal(parseProjeto3DOrcamentoPayload(source).projectName, 'Projeto 3D')
})

test('contactId opcional permite UUID ou null e rejeita identificador arbitrário', () => {
  const source = fixture()
  source.contactId = '4e63960e-0b76-4e7d-bc9a-481b91c62e57'
  assert.equal(parseProjeto3DOrcamentoPayload(source).contactId, source.contactId)
  source.contactId = null
  assert.equal(parseProjeto3DOrcamentoPayload(source).contactId, null)
  source.contactId = 'outro-cliente'
  assert.throws(() => parseProjeto3DOrcamentoPayload(source), /inválid/i)
})

test('referência de catálogo desconhecida continua como linha pendente', () => {
  const source = fixture()
  source.items[0].catalogId = null
  assert.equal(materializeProjeto3DOrcamento(source)[0].origem_projeto3d.catalogId, null)
})

test('rejeita controles em ids e arrays esparsos sem pular linhas ou especificações', () => {
  const withControl = fixture()
  withControl.items[0].sourceId = 'piece\n'
  assert.throws(() => parseProjeto3DOrcamentoPayload(withControl), /inválid/i)
  const sparseRows = fixture()
  delete sparseRows.items[1]
  assert.throws(() => parseProjeto3DOrcamentoPayload(sparseRows), /inválid/i)
  const sparseSpecs = fixture()
  delete sparseSpecs.items[0].specifications[0]
  assert.throws(() => parseProjeto3DOrcamentoPayload(sparseSpecs), /inválid/i)
})

test('aceita 2000 linhas e quantidade 10000, rejeita excedente sem truncar', () => {
  const source = fixture()
  source.items = Array.from({ length: 2000 }, (_, index) => ({
    ...source.items[0], sourceId: `piece-${index}`, sequence: index + 1, quantity: 10000,
  }))
  assert.equal(parseProjeto3DOrcamentoPayload(source).items.length, 2000)
  source.items.push({ ...source.items[0], sourceId: 'piece-over', sequence: 2001 })
  assert.throws(() => parseProjeto3DOrcamentoPayload(source), /limite|2000/i)
})
