import type { IntencaoOrcamento, ModeloCandidato } from './types.js'

export type ModelMatchResult =
  | { status: 'exato'; match: ModeloCandidato; alternatives: [] }
  | { status: 'requer_escolha'; match: null; alternatives: ModeloCandidato[]; reason: string }
  | { status: 'nao_encontrado'; match: null; alternatives: []; reason: string }

function folded(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '')
}

export function matchModel(intent: IntencaoOrcamento, candidates: ModeloCandidato[]): ModelMatchResult {
  const requested = intent.modeloPedido
  if (!requested) return { status: 'nao_encontrado', match: null, alternatives: [], reason: 'Modelo não informado.' }

  const sameLine = candidates.filter(candidate => !requested.linha || candidate.linha === requested.linha)
  const sameMaster = sameLine.filter(candidate => requested.master === undefined || candidate.master === requested.master)
  const sameVoltage = sameMaster.filter(candidate => !requested.voltagem || candidate.voltagem === requested.voltagem)
  const exact = sameVoltage.filter(candidate =>
    !requested.basenameToken || folded(candidate.basename).includes(folded(requested.basenameToken)),
  )

  if (exact.length === 1) return { status: 'exato', match: exact[0], alternatives: [] }
  if (exact.length > 1) {
    return { status: 'requer_escolha', match: null, alternatives: exact, reason: 'Mais de um modelo corresponde ao pedido.' }
  }

  const alternatives = (sameVoltage.length ? sameVoltage : sameMaster.length ? sameMaster : sameLine).slice(0, 5)
  if (alternatives.length) {
    return { status: 'requer_escolha', match: null, alternatives, reason: 'Não há correspondência exata; confirme uma alternativa.' }
  }
  return { status: 'nao_encontrado', match: null, alternatives: [], reason: 'Nenhum modelo compatível foi encontrado.' }
}
