/**
 * Formatação do dashboard — fonte ÚNICA.
 *
 * Antes existiam fmtN/fmtBRL/fmtTicket/fmtHoras redefinidos dentro de
 * Dashboard.tsx, mais variações inline em cada bloco. Mesma função, formatos
 * diferentes na mesma tela.
 */

const NF = new Intl.NumberFormat('pt-BR')

/**
 * O que aparece quando não há dado. Constante e não literal solto porque o
 * leitor de tela precisa traduzir isto: um KPI que mostra "—" é anunciado como
 * "traço" (ou silêncio) e o usuário não sabe se o número é zero ou se falhou.
 * Quem monta rótulo falado usa `VAZIO_FALADO`.
 */
export const VAZIO = '—'
export const VAZIO_FALADO = 'sem dado'

/** Inteiro com separador de milhar: 3509 → "3.509" */
export function n(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return VAZIO
  return NF.format(Math.round(v))
}

/**
 * R$ abreviado, para KPI e barra onde o espaço é curto.
 * 1_257_579 → "R$ 1,26M" · 70_600 → "R$ 70,6 mil" · 940 → "R$ 940"
 *
 * Duas casas no milhão (não uma): "R$ 1,2M" e "R$ 1,3M" escondem R$ 100 mil de
 * diferença, que num pipeline deste tamanho é dinheiro real.
 */
export function brl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return VAZIO
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`
  if (abs >= 10_000) return `R$ ${(v / 1_000).toFixed(1).replace('.', ',')} mil`
  return `R$ ${NF.format(Math.round(v))}`
}

/** R$ por extenso, para tooltip e drill-down onde o número exato importa. */
export function brlFull(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return VAZIO
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Percentual com 1 casa, sem casa quando redondo: 12.0 → "12%" · 1.53 → "1,5%" */
export function pct(v: number | null | undefined, casas = 1): string {
  if (v == null || !Number.isFinite(v)) return VAZIO
  const r = Number(v.toFixed(casas))
  return `${String(r).replace('.', ',')}%`
}

/** Horas → "3h" / "2d 4h" / "45min" */
export function horas(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return VAZIO
  if (h < 1) return `${Math.round(h * 60)}min`
  if (h < 48) return `${Math.round(h)}h`
  const d = Math.floor(h / 24)
  const r = Math.round(h % 24)
  return r > 0 ? `${d}d ${r}h` : `${d}d`
}

/** "2026-08-18" → "18/08" */
export function ddmm(iso: string): string {
  const [, m, d] = (iso || '').split('-')
  return d && m ? `${d}/${m}` : iso
}

/** Primeiro nome, capitalizado: "GUSTAVO SILVA" → "Gustavo" */
export function primeiroNome(s: string): string {
  const p = String(s || '').trim().split(/\s+/)[0] || ''
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''
}
