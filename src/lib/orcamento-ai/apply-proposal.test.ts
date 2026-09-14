import assert from 'node:assert/strict'
import test from 'node:test'
import { compacta03Master150500Mono, emptyQuoteSnapshot } from './__fixtures__/compacta-03-master-150500-mono'
import { applyProposal } from './apply-proposal'
import { buildProposal } from './proposal-builder'

const intent = {
  operacao: 'novo' as const,
  cliente: { nome: 'Ronaldo Biazi' },
  modeloPedido: { linha: 'COMPACTA_03' as const, master: true, voltagem: 'monofasico' as const },
  itensPedidos: [],
  instrucoesExplicitas: { preservarAcessoriosDoModelo: true },
  ambiguidades: [],
}

test('rejects a proposal created for an older builder revision without mutating the snapshot', () => {
  const proposal = buildProposal({ snapshot: emptyQuoteSnapshot, intent, model: compacta03Master150500Mono })
  const changed = { ...emptyQuoteSnapshot, cliente: { nome: 'Outro cliente' } }
  const before = structuredClone(changed)
  assert.throws(() => applyProposal(changed, proposal), /STALE_BASE_REVISION/)
  assert.deepEqual(changed, before)
})

test('applies every proposal field together into a new snapshot', () => {
  const proposal = buildProposal({ snapshot: emptyQuoteSnapshot, intent, model: compacta03Master150500Mono })
  const next = applyProposal(emptyQuoteSnapshot, proposal)
  assert.deepEqual(next.acessorios, proposal.acessorios)
  assert.equal(next.modelo?.id, proposal.modelo?.id)
  assert.equal(next.voltagem, 'monofasico')
  assert.equal(next.fotoPrincipalUrl, compacta03Master150500Mono.fotoUrl)
  assert.notEqual(next.itens, proposal.itens)
})
