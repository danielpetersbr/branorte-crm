import assert from 'node:assert/strict'
import test from 'node:test'
import { compacta03Master150500Mono, emptyQuoteSnapshot } from './__fixtures__/compacta-03-master-150500-mono'
import { buildProposal } from './proposal-builder'
import { validateProposal } from './proposal-validator'

function proposal() {
  return buildProposal({
    snapshot: emptyQuoteSnapshot,
    intent: {
      operacao: 'novo', cliente: { nome: 'Ronaldo' },
      modeloPedido: { linha: 'COMPACTA_03', master: true, voltagem: 'monofasico' },
      itensPedidos: [], instrucoesExplicitas: { preservarAcessoriosDoModelo: true }, ambiguidades: [],
    },
    model: compacta03Master150500Mono,
  })
}

test('blocks an accessory change that was not explicitly requested', () => {
  const changed = proposal()
  changed.acessorios = { ...changed.acessorios!, items: ['Outro acessório'], source: 'pedido_explicito' }
  const result = validateProposal(changed, {
    operacao: 'novo', cliente: {}, itensPedidos: [],
    instrucoesExplicitas: { preservarAcessoriosDoModelo: true }, ambiguidades: [],
  }, emptyQuoteSnapshot, compacta03Master150500Mono)
  assert.ok(result.some((alert) => alert.code === 'ACESSORIOS_NAO_AUTORIZADOS' && alert.severity === 'blocking'))
})

test('blocks voltage, Master, missing price and stale-revision inconsistencies', () => {
  const changed = proposal()
  changed.voltagem = 'trifasico'
  changed.modelo = { ...changed.modelo!, master: false }
  changed.itens[0] = { ...changed.itens[0], valorUnitario: 0 }
  changed.baseRevision = 'v1:stale'
  const result = validateProposal(changed, {
    operacao: 'novo', cliente: {},
    modeloPedido: { master: true, voltagem: 'monofasico' },
    itensPedidos: [], instrucoesExplicitas: {}, ambiguidades: [],
  }, emptyQuoteSnapshot, compacta03Master150500Mono)
  const codes = new Set(result.map((alert) => alert.code))
  assert.ok(codes.has('VOLTAGEM_DIVERGENTE'))
  assert.ok(codes.has('MASTER_DIVERGENTE'))
  assert.ok(codes.has('PRECO_AUSENTE'))
  assert.ok(codes.has('REVISAO_DESATUALIZADA'))
})
