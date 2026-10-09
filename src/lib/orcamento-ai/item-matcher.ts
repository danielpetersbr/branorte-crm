import type { ItemPedido, VoltagemOrcamento } from './types.js'
import { valorPorVoltagem } from '../motor-do-preco.js'

export interface CatalogItemCandidate {
  id: number
  categoria: string
  subcategoria?: string | null
  codigo?: string | null
  modelo?: string | null
  descricao: string
  capacidade?: string | null
  dimensoes?: string | null
  valorEquipamento: number | null
  valorComMotorMono?: number | null
  valorComMotorTrif?: number | null
  motorCv?: number | null
  motorPolos?: number | null
  capacidadeKg?: number | null
  capacidadeLitros?: number | null
  capacidadeTon?: number | null
  fotoUrl?: string | null
}

export type ItemMatchResult =
  | { status: 'exato'; match: CatalogItemCandidate; alternatives: [] }
  | { status: 'requer_escolha'; match: null; alternatives: CatalogItemCandidate[] }
  | { status: 'nao_encontrado'; match: null; alternatives: [] }

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function canonicalCategory(value: string): string {
  const category = fold(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (['chupim', 'chumbim', 'tupim', 'rosca', 'transportador', 'transportador_helicoidal'].includes(category)) return 'transportador'
  if (['moinho', 'moinho_martelo', 'martelo', 'triturador', 'triturador_de_graos'].includes(category)) return 'moinho'
  if (['ensacadeira', 'sacadeira'].includes(category)) return 'ensacadeira'
  if (['caixa_picado', 'caixa_material_picado', 'caixa_material_triturado'].includes(category)) return 'caixa_material_picado'
  if (['caixa_racao', 'caixa_racao_pronta'].includes(category)) return 'caixa_racao'
  return category
}

function candidateCategory(candidate: CatalogItemCandidate): string {
  const category = canonicalCategory(candidate.categoria)
  if (category !== 'caixa') return category
  const description = fold(candidateSearchText(candidate))
  if (/picad|triturad|milho.*soja/.test(description)) return 'caixa_material_picado'
  if (/racao/.test(description)) return 'caixa_racao'
  return category
}

function candidateSearchText(candidate: CatalogItemCandidate): string {
  return [
    candidate.descricao,
    candidate.codigo,
    candidate.modelo,
    candidate.subcategoria,
    candidate.capacidade,
    candidate.dimensoes,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ')
}

function dimensions(value: string): { diameter?: number; length?: number } {
  const match = value.match(/\b(\d{2,3})\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*m?\b/i)
  return match ? { diameter: Number(match[1]), length: Number(match[2].replace(',', '.')) } : {}
}

function score(request: ItemPedido, candidate: CatalogItemCandidate): number {
  const ignored = new Set(['de', 'da', 'do', 'para', 'com', 'sem', 'por', 'um', 'uma'])
  const wanted = fold(request.textoOriginal).split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !ignored.has(token))
  const haystack = fold(candidateSearchText(candidate))
  return wanted.length ? wanted.filter((token) => haystack.includes(token)).length / wanted.length : 0
}

export function matchCatalogItem(request: ItemPedido, candidates: CatalogItemCandidate[]): ItemMatchResult {
  const requestedCategory = request.categoria ? canonicalCategory(request.categoria) : undefined
  let filtered = candidates.filter((candidate) => {
    if (!requestedCategory) return true
    const category = candidateCategory(candidate)
    return requestedCategory === 'caixa' ? category === 'caixa' || category.startsWith('caixa_') : category === requestedCategory
  })
  if (request.semFunil === true) filtered = filtered.filter((candidate) => /sem\s+funil/i.test(fold(candidateSearchText(candidate))))
  if (request.semFunil === false) filtered = filtered.filter((candidate) => !/sem\s+funil/i.test(fold(candidateSearchText(candidate))))
  if (request.motorCv != null) filtered = filtered.filter((candidate) => Math.abs(Number(candidate.motorCv) - request.motorCv!) < 0.01 || new RegExp(`${String(request.motorCv).replace('.', '[.,]')}\\s*cv`, 'i').test(candidateSearchText(candidate)))
  if (request.diametroMm != null) filtered = filtered.filter((candidate) => dimensions(candidateSearchText(candidate)).diameter === request.diametroMm)
  if (request.comprimentoM != null) filtered = filtered.filter((candidate) => Math.abs((dimensions(candidateSearchText(candidate)).length ?? -999) - request.comprimentoM!) < 0.011)
  if (request.capacidade != null && request.unidadeCapacidade === 'toneladas') filtered = filtered.filter((candidate) => Math.abs(Number(candidate.capacidadeTon) - request.capacidade!) < 0.51)
  if (request.capacidade != null && request.unidadeCapacidade === 'kg') filtered = filtered.filter((candidate) => Math.abs(Number(candidate.capacidadeKg) - request.capacidade!) < Math.max(1, request.capacidade! * 0.02))
  if (request.capacidade != null && request.unidadeCapacidade === 'litros') filtered = filtered.filter((candidate) => Math.abs(Number(candidate.capacidadeLitros) - request.capacidade!) < Math.max(1, request.capacidade! * 0.02))
  if (!filtered.length) return { status: 'nao_encontrado', match: null, alternatives: [] }
  const hasStructuredConstraint = request.motorCv != null || request.diametroMm != null || request.comprimentoM != null || request.capacidade != null || request.semFunil != null
  if (filtered.length === 1) {
    if (hasStructuredConstraint || score(request, filtered[0]) >= 0.35) return { status: 'exato', match: filtered[0], alternatives: [] }
    return { status: 'nao_encontrado', match: null, alternatives: [] }
  }
  const ranked = filtered.map((candidate) => ({ candidate, score: score(request, candidate) })).sort((a, b) => b.score - a.score)
  if (ranked[0].score >= 0.8 && ranked[0].score - ranked[1].score >= 0.2) return { status: 'exato', match: ranked[0].candidate, alternatives: [] }
  return { status: 'requer_escolha', match: null, alternatives: ranked.slice(0, 5).map((item) => item.candidate) }
}

export function priceForVoltage(candidate: CatalogItemCandidate, voltage?: VoltagemOrcamento): number {
  const equipment = Number(candidate.valorEquipamento) || 0
  if (!voltage) return equipment
  return valorPorVoltagem({
    valor_equipamento: candidate.valorEquipamento,
    valor_com_motor_mono: candidate.valorComMotorMono ?? null,
    valor_com_motor_trif: candidate.valorComMotorTrif ?? null,
  }, voltage).valor
}
