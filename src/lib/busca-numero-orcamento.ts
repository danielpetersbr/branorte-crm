/**
 * Número de orçamento digitado na busca: "2026-0241", "2026 - 0241", "2026 – 0241",
 * "2026/0241", "20260241", "0241" ou "241".
 *
 * O CRM grava "2026 - 0241" (com espaços) e a pasta Z: tem número sem zero à esquerda
 * até 2020 ("241") e com zero depois ("0241"). Sem isso, buscar "2026-0241" não achava
 * nada nas duas telas (24/09/2026) — a lista da pasta nem olhava o número.
 */
export interface NumeroOrcamentoBuscado {
  ano: number | null
  /** Formas em que o número pode estar gravado ("241", "0241"). */
  variantes: string[]
}

export function lerNumeroOrcamento(texto: string): NumeroOrcamentoBuscado | null {
  const t = texto.trim()
  const comAno = t.match(/^(20\d{2})\s*[-–—/.]\s*(\d{1,5})$/) ?? t.match(/^(20\d{2})(\d{4})$/)
  if (comAno) return { ano: Number(comAno[1]), variantes: variantesNumero(comAno[2]) }
  if (/^\d{1,5}$/.test(t)) return { ano: null, variantes: variantesNumero(t) }
  return null
}

function variantesNumero(digitos: string): string[] {
  const n = String(Number(digitos))
  return Array.from(new Set([digitos, n, n.padStart(4, '0')]))
}

/** Compara ignorando espaço, traço, barra e ponto: "2026-0241" casa com "2026 - 0241". */
export function semSeparadores(s: string): string {
  return s.replace(/[\s\-–—/.]/g, '').toLowerCase()
}
