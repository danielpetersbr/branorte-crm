import { createSnapshotRevision } from './snapshot.js'
import type { OrcamentoAISnapshot, PropostaOrcamento } from './types.js'

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
