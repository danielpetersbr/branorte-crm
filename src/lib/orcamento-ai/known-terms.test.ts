import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeKnownTerms } from '../../../api/_lib/orcamento-ai-openai'

test('normalizes known equipment transcription mistakes locally', () => {
  assert.equal(
    normalizeKnownTerms('um chumbim de 160 por 6 e um eletor de canecas'),
    'um chupim de 160 por 6 e um elevador de canecas',
  )
  assert.equal(
    normalizeKnownTerms('MOINHO MNARTLEO DE 20 CV'),
    'MOINHO martelo DE 20 CV',
  )
})

test('does not replace short technical aliases inside customer names', () => {
  assert.equal(normalizeKnownTerms('Thiago Henrique pediu um th de 160'), 'Thiago Henrique pediu um TH de 160')
})
