import { createSnapshotRevision } from './snapshot.js'
import type { ItemResolvido, OrcamentoAISnapshot, PropostaOrcamento } from './types.js'

const LEGACY_MODEL_MOTOR_ITEM_RE = /^\s*motor\s+\d+(?:[.,]\d+)?\s*cv\s+\d+\s*polos?\s*$/i

/**
 * Propostas com modelo são ordenadas como: itens oficiais do modelo, depois os
 * itens avulsos pedidos no chat. O modelo local pode manter linhas legadas de
 * motor, que não entram na proposta; por isso elas não contam neste limite.
 */
export function proposalExtrasForModel(
  proposalItems: readonly ItemResolvido[],
  modelItems: readonly { nome?: string | null }[],
): ItemResolvido[] {
  const modelItemCount = modelItems.filter((item) => !LEGACY_MODEL_MOTOR_ITEM_RE.test(item.nome ?? '')).length
  if (proposalItems.length < modelItemCount) throw new Error('MODEL_PROPOSAL_ITEMS_MISSING')
  return proposalItems.slice(modelItemCount).map((item) => (
    item.descricao ? { ...item, descricao: [...item.descricao] } : { ...item }
  ))
}

export function applyProposal(snapshot: OrcamentoAISnapshot, proposal: PropostaOrcamento): OrcamentoAISnapshot {
  if (proposal.baseRevision !== createSnapshotRevision(snapshot)) throw new Error('STALE_BASE_REVISION')
  if (proposal.status !== 'pronta') throw new Error('PROPOSAL_NOT_READY')
  return {
    orcamentoId: snapshot.orcamentoId,
    cliente: { ...proposal.cliente },
    modelo: proposal.modelo ? { ...proposal.modelo } : null,
    itens: proposal.itens.map((item) => ({ ...item, descricao: item.descricao ? [...item.descricao] : undefined })),
    motores: proposal.motores.map((motor) => ({ ...motor })),
    acessorios: proposal.acessorios ? { ...proposal.acessorios, items: [...proposal.acessorios.items] } : null,
    componentes: proposal.componentes.map((component) => ({ ...component })),
    voltagem: proposal.voltagem,
    fotoPrincipalUrl: proposal.fotoPrincipalUrl,
    condicoes: { ...proposal.condicoes },
  }
}
