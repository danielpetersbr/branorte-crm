import assert from 'node:assert/strict'
import test from 'node:test'
import { matchCatalogItemWithSelection } from '../../../api/_lib/orcamento-ai-catalog'

const request = {
  textoOriginal: 'uma ensacadeira',
  categoria: 'ENSACADEIRA',
  quantidade: 1,
}

const candidates = [
  { id: 101, categoria: 'ENSACADEIRA', descricao: 'Ensacadeira de saco aberto', valorEquipamento: 1000 },
  { id: 202, categoria: 'ENSACADEIRA', descricao: 'Ensacadeira de válvula', valorEquipamento: 1200 },
]

test('resolves only a selected equipment option from the ambiguity alternatives', () => {
  assert.equal(matchCatalogItemWithSelection(request, candidates).status, 'requer_escolha')

  const selected = matchCatalogItemWithSelection(request, candidates, '202')
  assert.equal(selected.status, 'exato')
  if (selected.status === 'exato') assert.equal(selected.match.id, 202)

  assert.equal(matchCatalogItemWithSelection(request, candidates, '999').status, 'requer_escolha')
})
