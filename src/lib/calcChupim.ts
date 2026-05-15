// Cálculo de potência de motor para transportador helicoidal (chupim).
// Fórmula oficial Branorte: POT = (C + (Q × L × K) / 200) × b × 1,36
//
// Onde:
//   C = fator de carregamento (0,4 fixo)
//   Q = capacidade em ton/h
//   L = comprimento em metros
//   K = fator do material
//   b = fator de correção pela inclinação
//   1,36 = fator de margem de segurança / conversão

export const C_FATOR_CARREGAMENTO = 0.4

// Fatores K por tipo de material (vindo da tabela da planilha oficial)
export const FATOR_MATERIAL = {
  ARROZ: 2.0,
  MILHO: 2.0,
  SOJA: 2.3,
  RACAO: 2.3,
} as const
export type MaterialChupim = keyof typeof FATOR_MATERIAL

// Fatores b por inclinação em graus (tabela oficial Branorte)
// 45° = interpolação linear entre 40° (1.75) e 50° (1.95) = 1.85
export const FATOR_INCLINACAO: Record<number, number> = {
  0: 1.0,
  10: 1.2,
  20: 1.35,
  30: 1.55,
  40: 1.75,
  45: 1.85,
  50: 1.95,
  60: 2.15,
}
export type InclinacaoChupim = keyof typeof FATOR_INCLINACAO

// CV disponíveis nos motores oficiais Branorte (PDF 2026)
export const CVS_DISPONIVEIS = [
  1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.5,
  10.0, 12.5, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0, 60.0, 75.0, 100.0,
] as const

/**
 * Calcula a potência teórica do motor pro chupim.
 *
 * @param Q capacidade em ton/h
 * @param L comprimento em metros
 * @param material 'MILHO' | 'ARROZ' | 'SOJA' | 'RACAO'
 * @param inclinacao 0 a 60 (graus)
 * @returns CV calculado (antes do arredondamento)
 */
export function calcularCvChupim(
  Q: number,
  L: number,
  material: MaterialChupim = 'MILHO',
  inclinacao: InclinacaoChupim = 0,
): number {
  const K = FATOR_MATERIAL[material]
  const b = FATOR_INCLINACAO[inclinacao]
  return (C_FATOR_CARREGAMENTO + (Q * L * K) / 200) * b * 1.36
}

/**
 * Arredonda pra CIMA para o próximo motor disponível.
 * Ex: 6.2 CV → 7.5 CV (não tem 6.5 CV no catálogo).
 */
export function proximoMotorMaior(cvCalculado: number): number {
  for (const cv of CVS_DISPONIVEIS) {
    if (cv >= cvCalculado) return cv
  }
  return CVS_DISPONIVEIS[CVS_DISPONIVEIS.length - 1]  // 100 CV (último)
}

/**
 * Extrai comprimento (L em metros) de uma descrição de chupim.
 * Ex: "chupim 160 x 3,5 m" → 3.5
 *     "TH 250 X 12 m"     → 12
 */
export function extrairComprimentoMetros(descricao: string): number | null {
  const m = descricao.match(/(\d+)\s*[xX]\s*([\d,.]+)\s*m/i)
  if (!m) return null
  return parseFloat(m[2].replace(',', '.'))
}

/**
 * Extrai capacidade Q (ton/h) de strings tipo "10 TON/H", "20 ton/h".
 */
export function extrairCapacidadeTonH(capacidade: string | null | undefined): number | null {
  if (!capacidade) return null
  const m = capacidade.match(/([\d.,]+)\s*TON/i)
  if (!m) return null
  return parseFloat(m[1].replace(',', '.'))
}

/**
 * Calcula motor recomendado pra um chupim a partir da descrição + capacidade.
 * Retorna null se não conseguir extrair os parâmetros necessários.
 *
 * @returns { cvCalculado, cvMotor } onde cvMotor é o próximo motor maior disponível
 */
export function recomendarMotorChupim(
  descricao: string,
  capacidade: string | null,
  material: MaterialChupim = 'MILHO',
  inclinacao: InclinacaoChupim = 0,
): { cvCalculado: number; cvMotor: number; Q: number; L: number } | null {
  const L = extrairComprimentoMetros(descricao)
  const Q = extrairCapacidadeTonH(capacidade)
  if (L == null || Q == null) return null
  const cvCalculado = calcularCvChupim(Q, L, material, inclinacao)
  const cvMotor = proximoMotorMaior(cvCalculado)
  return { cvCalculado, cvMotor, Q, L }
}
