import test from 'node:test'
import assert from 'node:assert/strict'
import { createSnapshotRevision } from './snapshot'
import type { OrcamentoAISnapshot } from './types'

const base: OrcamentoAISnapshot = {
  orcamentoId: 1896,
  cliente: { nome: 'Ronaldo Biazi', telefone: '(62) 9136-3682', cidade: 'Hidrolândia', uf: 'GO' },
  modelo: null,
  itens: [],
  motores: [],
  acessorios: null,
  componentes: [],
  voltagem: 'monofasico',
  fotoPrincipalUrl: null,
  condicoes: {
    formaPagamento: 'a combinar',
    prazoDias: 90,
    prazoTipo: 'uteis',
    freteTipo: 'FOB',
    freteTexto: 'por conta do cliente',
    validadeDias: 10,
    observacoes: '',
  },
}

test('same semantic snapshot has the same revision', () => {
  const reordered = {
    ...base,
    cliente: { uf: 'GO', cidade: 'Hidrolândia', telefone: '(62) 9136-3682', nome: 'Ronaldo Biazi' },
  }
  assert.equal(createSnapshotRevision(base), createSnapshotRevision(reordered))
})

test('array order changes the revision', () => {
  const a = { ...base, acessorios: { mode: 'fixo' as const, valor: 12154, items: ['A', 'B'], source: 'modelo' as const } }
  const b = { ...base, acessorios: { ...a.acessorios, items: ['B', 'A'] } }
  assert.notEqual(createSnapshotRevision(a), createSnapshotRevision(b))
})

test('accessory value changes the revision', () => {
  const changed = {
    ...base,
    acessorios: { mode: 'fixo' as const, valor: 12154, items: ['Base do moinho'], source: 'modelo' as const },
  }
  assert.notEqual(createSnapshotRevision(base), createSnapshotRevision(changed))
})
