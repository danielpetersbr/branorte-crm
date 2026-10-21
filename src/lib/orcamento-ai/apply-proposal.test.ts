import assert from 'node:assert/strict'
import test from 'node:test'
import { compacta03Master150500Mono, emptyQuoteSnapshot } from './__fixtures__/compacta-03-master-150500-mono'
import { applyProposal, motoresDosItens, proposalExtrasForModel } from './apply-proposal'
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

test('keeps proposal extras after the official model prefix, including a repeated catalog item', () => {
  const modelItems = [
    { nome: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M' },
    { nome: 'Motor 10 CV 2 polos' },
    { nome: 'TRITURADOR DE GRÃOS 10 CV' },
  ]
  const modelTransportador = { catalogoId: 10, nome: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M', quantidade: 1, valorUnitario: 5795 }
  const modelMoinho = { catalogoId: 20, nome: 'TRITURADOR DE GRÃOS 10 CV', quantidade: 1, valorUnitario: 14708 }
  const repeatedTransportador = { ...modelTransportador, quantidade: 2 }
  const ensacadeira = { catalogoId: 999, nome: 'ENSACADEIRA SACO ABERTO', quantidade: 1, valorUnitario: 26400 }

  const extras = proposalExtrasForModel(
    [modelTransportador, modelMoinho, repeatedTransportador, ensacadeira],
    modelItems,
  )

  assert.deepEqual(extras, [repeatedTransportador, ensacadeira])
  assert.notEqual(extras[0], repeatedTransportador)
})

test('motor do orçamentista vem com o valor da quantidade toda: o carrinho guarda o de UMA unidade (#208)', () => {
  const itens = [
    { catalogoId: 11, nome: 'TRANSPORTADOR HELICOIDAL 160 X 3,0 M', quantidade: 3, valorUnitario: 4820 },
    { catalogoId: 22, nome: 'SILO 42,5 TONELADAS', quantidade: 2, valorUnitario: 53030 },
    { catalogoId: 33, nome: 'TH 150 X 7,0 M', quantidade: 1, valorUnitario: 10273 },
  ]
  const motores = [
    { itemCatalogoId: 11, descricao: '3x Motor 2 CV 4 polos', cv: 2, polos: 4, valor: 6594, incluso: false },
    { itemCatalogoId: 33, descricao: 'Motor 2 CV 4 polos (incluso)', cv: 2, polos: 4, valor: 0, incluso: true },
  ]
  const ligados = motoresDosItens(itens, motores)
  assert.equal(ligados[0]?.valorUnitario, 2198)
  assert.equal(ligados[0]?.motor.cv, 2)
  assert.equal(ligados[1], null)
  assert.equal(ligados[2]?.valorUnitario, 0)
  // agruparMotores cobra motor_qtd (1) × qtd do item linhas de motor_valor_unit: 3 × 2.198, não 3 × 6.594
  assert.equal((ligados[0]?.valorUnitario ?? 0) * itens[0].quantidade, 6594)
})

test('dois itens do mesmo catálogo: cada um fica com o SEU motor, na ordem (#208)', () => {
  const itens = [
    { catalogoId: 11, nome: 'CHUPIM 160 X 3,0 M', quantidade: 2, valorUnitario: 4820 },
    { catalogoId: 11, nome: 'CHUPIM 160 X 3,0 M', quantidade: 1, valorUnitario: 4820 },
  ]
  const motores = [
    { itemCatalogoId: 11, descricao: '2x Motor 2 CV 4 polos', cv: 2, polos: 4, valor: 4396, incluso: false },
    { itemCatalogoId: 11, descricao: 'Motor 3 CV 4 polos', cv: 3, polos: 4, valor: 2541, incluso: false },
  ]
  const ligados = motoresDosItens(itens, motores)
  assert.deepEqual(ligados.map((l) => [l?.motor.cv, l?.valorUnitario]), [[2, 2198], [3, 2541]])
})
