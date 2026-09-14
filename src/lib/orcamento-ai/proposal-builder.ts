import { diffProposal } from './diff'
import { createSnapshotRevision } from './snapshot'
import type { IntencaoOrcamento, ModeloCandidato, OrcamentoAISnapshot, PropostaOrcamento } from './types'
import { validateProposal } from './proposal-validator'

export interface BuildProposalInput {
  snapshot: OrcamentoAISnapshot
  intent: IntencaoOrcamento
  model?: ModeloCandidato
  resolvedItems?: ModeloCandidato['itens']
  resolvedMotors?: ModeloCandidato['motores']
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function proposalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `proposal-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildProposal({ snapshot, intent, model, resolvedItems, resolvedMotors }: BuildProposalInput): PropostaOrcamento {
  const sourceItems = model?.itens ?? resolvedItems ?? snapshot.itens
  const sourceMotors = model?.motores ?? resolvedMotors ?? snapshot.motores
  const itens = sourceItems.map((item) => ({ ...item, descricao: item.descricao ? [...item.descricao] : undefined }))
  const motores = sourceMotors.map((motor) => ({ ...motor }))
  let acessorios = model?.acessorios
    ? { ...model.acessorios, items: [...model.acessorios.items] }
    : snapshot.acessorios ? { ...snapshot.acessorios, items: [...snapshot.acessorios.items] } : null
  const componentes = (model?.componentes ?? snapshot.componentes).map((component) => ({ ...component }))
  const equipamentos = cents(itens.reduce((sum, item) => sum + item.quantidade * item.valorUnitario, 0))
  if (!model && intent.instrucoesExplicitas.percentualAcessorios !== undefined) {
    const percentual = intent.instrucoesExplicitas.percentualAcessorios
    acessorios = { mode: 'percentual', percentual, valor: cents(equipamentos * percentual / 100), items: acessorios?.items ?? [], source: 'pedido_explicito' }
  }
  const motorTotal = cents(motores.reduce((sum, motor) => sum + (motor.incluso ? 0 : motor.valor), 0))
  const accessoryTotal = cents(acessorios?.valor ?? 0)
  const componentTotal = cents(componentes.reduce((sum, component) => sum + component.valor, 0))

  const proposal: PropostaOrcamento = {
    id: proposalId(),
    baseRevision: createSnapshotRevision(snapshot),
    operacao: model ? 'substituir' : 'editar',
    cliente: { ...snapshot.cliente, ...intent.cliente, nome: intent.cliente.nome ?? snapshot.cliente.nome },
    modelo: model ? {
      id: model.id, basename: model.basename, linha: model.linha, master: model.master,
      voltagem: model.voltagem, producaoKgH: model.producaoKgH, armazenamentoKg: model.armazenamentoKg,
    } : snapshot.modelo ? { ...snapshot.modelo } : null,
    itens,
    motores,
    acessorios,
    componentes,
    voltagem: intent.modeloPedido?.voltagem ?? model?.voltagem ?? snapshot.voltagem,
    fotoPrincipalUrl: model?.fotoUrl ?? snapshot.fotoPrincipalUrl,
    condicoes: { ...snapshot.condicoes },
    totais: {
      equipamentos,
      motores: motorTotal,
      acessorios: accessoryTotal,
      componentes: componentTotal,
      proposta: cents(equipamentos + motorTotal + accessoryTotal + componentTotal),
    },
    diferencas: [],
    alertas: [],
    status: 'pronta',
  }
  proposal.diferencas = diffProposal(snapshot, proposal)
  proposal.alertas = validateProposal(proposal, intent, snapshot, model)
  proposal.status = proposal.alertas.some((alert) => alert.severity === 'blocking') ? 'bloqueada' : 'pronta'
  return proposal
}
