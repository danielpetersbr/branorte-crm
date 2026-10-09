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

  if (!proposal.cliente.nome?.trim()) {
    alerts.push({ code: 'CLIENTE_AUSENTE', severity: 'blocking', message: 'Informe o nome ou razão social do cliente.' })
  }
  if (proposal.itens.length === 0) {
    alerts.push({ code: 'ITENS_AUSENTES', severity: 'blocking', message: 'O orçamento precisa ter ao menos um equipamento.' })
  }

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
    if (!Number.isInteger(item.quantidade) || item.quantidade < 1) {
      alerts.push({ code: 'QUANTIDADE_INVALIDA', severity: 'blocking', message: `O item ${index + 1} (${item.nome}) está com quantidade inválida.` })
    }
    if (!Number.isFinite(item.valorUnitario) || item.valorUnitario <= 0) {
      alerts.push({ code: 'PRECO_AUSENTE', severity: 'blocking', message: `O item ${index + 1} (${item.nome}) está sem preço válido.` })
    }
  })
  proposal.motores.forEach((motor, index) => {
    if (!motor.incluso && (!Number.isFinite(motor.valor) || motor.valor <= 0)) {
      alerts.push({ code: 'MOTOR_SEM_PRECO', severity: 'blocking', message: `O motor ${index + 1} (${motor.descricao}) está sem preço válido.` })
    }
  })
  proposal.componentes.forEach((component, index) => {
    if (!Number.isFinite(component.valor) || component.valor <= 0) {
      alerts.push({ code: 'COMPONENTE_SEM_PRECO', severity: 'blocking', message: `O componente ${index + 1} (${component.nome}) está sem preço válido.` })
    }
  })
  if (!proposal.voltagem && proposal.motores.length > 0) {
    alerts.push({ code: 'VOLTAGEM_AUSENTE', severity: 'blocking', message: 'Informe se os motores serão monofásicos ou trifásicos.' })
  }
  if (intent.instrucoesExplicitas.itensAcessorios?.length && (proposal.acessorios?.valor ?? 0) <= 0) {
    alerts.push({ code: 'ACESSORIOS_SEM_VALOR', severity: 'blocking', message: 'Os acessórios foram listados, mas falta informar o percentual ou valor deles.' })
  }
  const explicitAccessoryChange = intent.instrucoesExplicitas.alterarAcessorios
    || intent.instrucoesExplicitas.percentualAcessorios !== undefined
    || Boolean(intent.instrucoesExplicitas.itensAcessorios?.length)
  if (model && !explicitAccessoryChange && !sameAccessories(proposal.acessorios, model.acessorios)) {
    alerts.push({ code: 'ACESSORIOS_NAO_AUTORIZADOS', severity: 'blocking', message: 'Os acessórios do modelo foram alterados sem pedido explícito.' })
  }
  if (intent.ambiguidades.length > 0) {
    alerts.push({ code: 'AMBIGUIDADE_PENDENTE', severity: 'blocking', message: 'Há escolhas pendentes antes de aplicar a proposta.' })
  }
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const expected = {
    equipamentos: cents(proposal.itens.reduce((sum, item) => sum + item.quantidade * item.valorUnitario, 0)),
    motores: cents(proposal.motores.reduce((sum, motor) => sum + (motor.incluso ? 0 : motor.valor), 0)),
    acessorios: cents(proposal.acessorios?.valor ?? 0),
    componentes: cents(proposal.componentes.reduce((sum, component) => sum + component.valor, 0)),
  }
  const expectedProposal = cents(expected.equipamentos + expected.motores + expected.acessorios + expected.componentes)
  if (
    Math.abs(proposal.totais.equipamentos - expected.equipamentos) > 0.01
    || Math.abs(proposal.totais.motores - expected.motores) > 0.01
    || Math.abs(proposal.totais.acessorios - expected.acessorios) > 0.01
    || Math.abs(proposal.totais.componentes - expected.componentes) > 0.01
    || Math.abs(proposal.totais.proposta - expectedProposal) > 0.01
  ) {
    alerts.push({ code: 'TOTAL_DIVERGENTE', severity: 'blocking', message: 'Os totais calculados não conferem com os itens da proposta.' })
  }
  return alerts
}
