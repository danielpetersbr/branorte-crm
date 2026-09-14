import { createSnapshotRevision } from './snapshot.js'
import type { AlertaValidacao, IntencaoOrcamento, ModeloCandidato, OrcamentoAISnapshot, PropostaOrcamento } from './types.js'

function sameAccessories(left: PropostaOrcamento['acessorios'], right: ModeloCandidato['acessorios']): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function validateProposal(
  proposal: PropostaOrcamento,
  intent: IntencaoOrcamento,
  snapshot: OrcamentoAISnapshot,
  model?: ModeloCandidato,
): AlertaValidacao[] {
  const alerts: AlertaValidacao[] = []
  const requested = intent.modeloPedido

  if (proposal.baseRevision !== createSnapshotRevision(snapshot)) {
    alerts.push({ code: 'REVISAO_DESATUALIZADA', severity: 'blocking', message: 'O orçamento mudou desde a leitura usada para montar esta proposta.' })
  }
  if (requested?.voltagem && proposal.voltagem !== requested.voltagem) {
    alerts.push({ code: 'VOLTAGEM_DIVERGENTE', severity: 'blocking', message: 'A voltagem proposta não corresponde à solicitada.' })
  }
  if (requested?.master !== undefined && proposal.modelo?.master !== requested.master) {
    alerts.push({ code: 'MASTER_DIVERGENTE', severity: 'blocking', message: 'A versão Master proposta não corresponde à solicitação.' })
  }
  proposal.itens.forEach((item, index) => {
    if (!Number.isFinite(item.valorUnitario) || item.valorUnitario <= 0) {
      alerts.push({ code: 'PRECO_AUSENTE', severity: 'blocking', message: `O item ${index + 1} (${item.nome}) está sem preço válido.` })
    }
  })
  if (model && !intent.instrucoesExplicitas.alterarAcessorios && !sameAccessories(proposal.acessorios, model.acessorios)) {
    alerts.push({ code: 'ACESSORIOS_NAO_AUTORIZADOS', severity: 'blocking', message: 'Os acessórios do modelo foram alterados sem pedido explícito.' })
  }
  if (intent.ambiguidades.length > 0) {
    alerts.push({ code: 'AMBIGUIDADE_PENDENTE', severity: 'blocking', message: 'Há escolhas pendentes antes de aplicar a proposta.' })
  }
  return alerts
}
