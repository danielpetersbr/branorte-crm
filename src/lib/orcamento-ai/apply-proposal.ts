import { createSnapshotRevision } from './snapshot.js'
import type { ItemResolvido, MotorResolvido, OrcamentoAISnapshot, PropostaOrcamento } from './types.js'

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

export interface MotorDoItem {
  motor: MotorResolvido
  /** Valor de UMA unidade do motor: é o que o carrinho guarda em `motor_valor_unit`. */
  valorUnitario: number
}

/**
 * Motor de cada item da proposta, na ordem dos itens. Cada motor serve a um item só:
 * o primeiro item do mesmo catálogo que ainda não tem motor. Antes, todo item de mesmo
 * catálogo pegava o primeiro motor, e dois itens iguais com quantidades diferentes
 * ficavam com o motor do outro.
 *
 * O orçamentista manda o motor avulso com o valor da QUANTIDADE TODA (motorDoPreco ×
 * quantidade, em api/_lib/orcamento-ai-catalog.ts). O carrinho guarda o valor de UMA
 * unidade, e o agruparMotores multiplica pela quantidade do item. Sem a divisão,
 * 3 chupins cobravam 9 motores (issue #208).
 */
export function motoresDosItens(itens: readonly ItemResolvido[], motores: readonly MotorResolvido[]): Array<MotorDoItem | null> {
  const usados = new Set<number>()
  return itens.map((item) => {
    if (item.catalogoId == null) return null
    const idx = motores.findIndex((motor, i) => !usados.has(i) && motor.itemCatalogoId === item.catalogoId)
    if (idx < 0) return null
    usados.add(idx)
    const motor = motores[idx]
    return { motor, valorUnitario: motor.incluso ? 0 : motor.valor / Math.max(1, item.quantidade) }
  })
}
