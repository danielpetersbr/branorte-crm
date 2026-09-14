import assert from 'node:assert/strict'
import test from 'node:test'
import { compacta03Master150500Mono, emptyQuoteSnapshot } from './__fixtures__/compacta-03-master-150500-mono'
import { buildProposal } from './proposal-builder'

test('reproduces the complete Compacta 03 Master quote without changing model accessories', () => {
  const proposal = buildProposal({
    snapshot: emptyQuoteSnapshot,
    intent: {
      operacao: 'novo', cliente: { nome: 'Ronaldo Biazi', telefone: '62 9136-3682', cidade: 'Hidrolândia', uf: 'GO' },
      modeloPedido: { linha: 'COMPACTA_03', master: true, basenameToken: '150500-4000-4000', voltagem: 'monofasico' },
      itensPedidos: [], instrucoesExplicitas: { preservarAcessoriosDoModelo: true }, ambiguidades: [],
    },
    model: compacta03Master150500Mono,
  })

  assert.equal(proposal.itens.length, 10)
  assert.equal(proposal.motores.length, 8)
  assert.equal(proposal.acessorios?.items.length, 10)
  assert.equal(proposal.acessorios?.source, 'modelo')
  assert.deepEqual(proposal.totais, {
    equipamentos: 178684.2,
    motores: 23368,
    acessorios: 12154,
    componentes: 8728,
    proposta: 222934.2,
  })
  assert.equal(proposal.status, 'pronta')
})

test('editing a model keeps client and commercial conditions from the current quote', () => {
  const snapshot = {
    ...emptyQuoteSnapshot,
    orcamentoId: 99,
    cliente: { nome: 'Cliente Atual', email: 'financeiro@cliente.com' },
    condicoes: { ...emptyQuoteSnapshot.condicoes, prazoDias: 90, observacoes: 'Condição negociada' },
  }
  const proposal = buildProposal({
    snapshot,
    intent: {
      operacao: 'editar', cliente: {}, modeloPedido: { linha: 'COMPACTA_03', master: true },
      itensPedidos: [], instrucoesExplicitas: { preservarAcessoriosDoModelo: true }, ambiguidades: [],
    },
    model: compacta03Master150500Mono,
  })

  assert.deepEqual(proposal.cliente, snapshot.cliente)
  assert.deepEqual(proposal.condicoes, snapshot.condicoes)
  assert.equal(proposal.operacao, 'substituir')
})
