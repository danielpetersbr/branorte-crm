import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolverEscopo, escopoPodeConsultar, filtroDoVendedor, descreveEscopo,
  nomeParaEscopo, PAPEIS_GESTORES,
} from './escopo-pedidos'

// ── A armadilha do display_name ─────────────────────────────────────────────
// `useVendedorNome()` cai no display_name quando não há vendor_id. Sem esta
// trava, o nome inventado vira filtro — e um display_name que case com um
// vendedor real entrega os pedidos dele.

test('nomeParaEscopo: SEM vendor_id o nome é descartado (nao vira filtro)', () => {
  assert.equal(nomeParaEscopo(null, 'DANIEL'), '')
  assert.equal(nomeParaEscopo(undefined, 'DANIEL'), '')
  assert.equal(nomeParaEscopo('', 'DANIEL'), '')
})

test('nomeParaEscopo: COM vendor_id o nome passa', () => {
  assert.equal(nomeParaEscopo('32e02344-120a-4d4f-982a-a20be0850c04', 'EDER'), 'EDER')
})

test('display_name que casa com vendedor real NAO vira escopo sem vendor_id', () => {
  // "Daniel" bate com o vendedor DANIEL (10 pedidos). Sem vendor_id tem que fechar.
  const e = resolverEscopo({
    role: 'marketing',
    nomeVendedor: nomeParaEscopo(null, 'DANIEL'),
    nomeCarregando: false,
  })
  assert.deepEqual(e, { tipo: 'sem-escopo' })
  assert.equal(escopoPodeConsultar(e), false)
})

const base = { role: 'vendor', nomeVendedor: 'EDER', nomeCarregando: false }

test('gestor (admin/financeiro) vê tudo, mesmo sem nome de vendedor', () => {
  for (const role of PAPEIS_GESTORES) {
    const e = resolverEscopo({ role, nomeVendedor: '', nomeCarregando: false })
    assert.deepEqual(e, { tipo: 'tudo' }, `${role} deveria ver tudo`)
  }
})

test('gestor vê tudo mesmo enquanto o nome ainda carrega (não depende dele)', () => {
  const e = resolverEscopo({ role: 'admin', nomeVendedor: '', nomeCarregando: true })
  assert.deepEqual(e, { tipo: 'tudo' })
})

test('vendedor fica recortado no proprio nome', () => {
  assert.deepEqual(resolverEscopo(base), { tipo: 'vendedor', nome: 'EDER' })
})

// ── As travas que impedem o vazamento ───────────────────────────────────────

test('FECHA enquanto o nome carrega — este intervalo era a janela de vazamento', () => {
  const e = resolverEscopo({ ...base, nomeVendedor: '', nomeCarregando: true })
  assert.deepEqual(e, { tipo: 'carregando' })
  assert.equal(escopoPodeConsultar(e), false)
})

test('FECHA quando o nome nao resolve (sem vendor_id, ou a busca falhou)', () => {
  const e = resolverEscopo({ ...base, nomeVendedor: '', nomeCarregando: false })
  assert.deepEqual(e, { tipo: 'sem-escopo' })
  assert.equal(escopoPodeConsultar(e), false)
})

test('FECHA sem papel (sessao meio resolvida) — nunca cai em "tudo"', () => {
  for (const role of [null, undefined, '']) {
    const e = resolverEscopo({ ...base, role })
    assert.deepEqual(e, { tipo: 'sem-escopo' }, `role=${String(role)} deveria fechar`)
    assert.equal(escopoPodeConsultar(e), false)
  }
})

test('papel desconhecido NAO vira gestor', () => {
  for (const role of ['vendor', 'marketing', 'visualizador', 'mapa', 'consultor', 'representante', 'pending', 'rejected', 'inventado']) {
    const e = resolverEscopo({ role, nomeVendedor: 'EDER', nomeCarregando: false })
    assert.equal(e.tipo, 'vendedor', `${role} nao pode ver tudo`)
  }
})

test('nome so com espaco conta como vazio (fecha)', () => {
  assert.deepEqual(resolverEscopo({ ...base, nomeVendedor: '   ' }), { tipo: 'sem-escopo' })
})

test('so tudo/vendedor podem consultar', () => {
  assert.equal(escopoPodeConsultar({ tipo: 'tudo' }), true)
  assert.equal(escopoPodeConsultar({ tipo: 'vendedor', nome: 'EDER' }), true)
  assert.equal(escopoPodeConsultar({ tipo: 'carregando' }), false)
  assert.equal(escopoPodeConsultar({ tipo: 'sem-escopo' }), false)
})

// ── O filtro que vai pro PostgREST ──────────────────────────────────────────

test('filtro cobre venda dividida (vendedor E vendedor_2)', () => {
  assert.equal(filtroDoVendedor('EDER'), 'vendedor.ilike.EDER,vendedor_2.ilike.EDER')
})

test('virgula/parentese no nome nao quebram a sintaxe do or= (nem alargam o recorte)', () => {
  // Sem a limpeza, "A,B" viraria DOIS termos no or= e traria os pedidos de B.
  assert.equal(filtroDoVendedor('A,B'), 'vendedor.ilike.A B,vendedor_2.ilike.A B')
  assert.equal(filtroDoVendedor('X(Y)'), 'vendedor.ilike.X Y,vendedor_2.ilike.X Y')
  for (const sujo of ['A,B', 'X(Y)', 'M),N']) {
    const f = filtroDoVendedor(sujo)
    assert.equal(f.split(',').length, 2, `"${sujo}" deveria virar exatamente 2 termos`)
  }
})

test('espaco nas pontas some antes de virar filtro', () => {
  assert.equal(filtroDoVendedor('  EDER  '), 'vendedor.ilike.EDER,vendedor_2.ilike.EDER')
})

test('descreveEscopo so fala quando ha recorte', () => {
  assert.equal(descreveEscopo({ tipo: 'vendedor', nome: 'EDER' }), 'Somente os pedidos de EDER')
  assert.equal(descreveEscopo({ tipo: 'tudo' }), null)
})
