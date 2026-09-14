import type { ItemPedido, VoltagemOrcamento } from './types.js'

export interface CatalogItemCandidate {
  id: number
  categoria: string
  descricao: string
  valorEquipamento: number | null
  valorComMotorMono?: number | null
  valorComMotorTrif?: number | null
  motorCv?: number | null
  motorPolos?: number | null
  capacidadeKg?: number | null
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

function dimensions(value: string): { diameter?: number; length?: number } {
  const match = value.match(/\b(\d{2,3})\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*m?\b/i)
  return match ? { diameter: Number(match[1]), length: Number(match[2].replace(',', '.')) } : {}
}

function score(request: ItemPedido, candidate: CatalogItemCandidate): number {
  const ignored = new Set(['de', 'da', 'do', 'para', 'com', 'sem', 'por', 'um', 'uma'])
  const wanted = fold(request.textoOriginal).split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !ignored.has(token))
  const haystack = fold(candidate.descricao)
  return wanted.length ? wanted.filter((token) => haystack.includes(token)).length / wanted.length : 0
}

export function matchCatalogItem(request: ItemPedido, candidates: CatalogItemCandidate[]): ItemMatchResult {
  let filtered = candidates.filter((candidate) => !request.categoria || candidate.categoria === request.categoria)
  if (request.semFunil === true) filtered = filtered.filter((candidate) => /sem\s+funil/i.test(fold(candidate.descricao)))
  if (request.semFunil === false) filtered = filtered.filter((candidate) => !/sem\s+funil/i.test(fold(candidate.descricao)))
  if (request.motorCv != null) filtered = filtered.filter((candidate) => Math.abs(Number(candidate.motorCv) - request.motorCv!) < 0.01 || new RegExp(`${String(request.motorCv).replace('.', '[.,]')}\\s*cv`, 'i').test(candidate.descricao))
  if (request.diametroMm != null) filtered = filtered.filter((candidate) => dimensions(candidate.descricao).diameter === request.diametroMm)
  if (request.comprimentoM != null) filtered = filtered.filter((candidate) => Math.abs((dimensions(candidate.descricao).length ?? -999) - request.comprimentoM!) < 0.011)
  if (request.capacidade != null && request.unidadeCapacidade === 'toneladas') filtered = filtered.filter((candidate) => Math.abs(Number(candidate.capacidadeTon) - request.capacidade!) < 0.51)
  if (request.capacidade != null && request.unidadeCapacidade === 'kg') filtered = filtered.filter((candidate) => Math.abs(Number(candidate.capacidadeKg) - request.capacidade!) < Math.max(1, request.capacidade! * 0.02))
  filtered = filtered.filter((candidate) => priceForVoltage(candidate, undefined) > 0)
  if (!filtered.length) return { status: 'nao_encontrado', match: null, alternatives: [] }
  if (filtered.length === 1) return { status: 'exato', match: filtered[0], alternatives: [] }
  const ranked = filtered.map((candidate) => ({ candidate, score: score(request, candidate) })).sort((a, b) => b.score - a.score)
  if (ranked[0].score >= 0.8 && ranked[0].score - ranked[1].score >= 0.2) return { status: 'exato', match: ranked[0].candidate, alternatives: [] }
  return { status: 'requer_escolha', match: null, alternatives: ranked.slice(0, 5).map((item) => item.candidate) }
}

export function priceForVoltage(candidate: CatalogItemCandidate, voltage?: VoltagemOrcamento): number {
  const equipment = Number(candidate.valorEquipamento) || 0
  if (equipment > 0) return equipment
  return voltage === 'monofasico' ? Number(candidate.valorComMotorMono) || 0 : voltage === 'trifasico' ? Number(candidate.valorComMotorTrif) || 0 : Math.max(Number(candidate.valorComMotorMono) || 0, Number(candidate.valorComMotorTrif) || 0)
}
