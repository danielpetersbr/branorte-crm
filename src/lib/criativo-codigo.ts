/**
 * Código de criativo do Meta, com o sufixo regional que o gestor usa desde 08/2026.
 *
 * O mesmo criativo pode rodar em conjuntos separados por estado, e a única marca é o
 * nome do anúncio: `AD - &8 RO` (Rondônia) e `AD - &8 MTS` (Mato Grosso do Sul). O
 * webhook de entrada preserva esse sufixo, então `criativo_codigo` passou a valer
 * tanto "&8" quanto "&8 RO".
 *
 * Consequência para o filtro da tela: quem digita "&8" quer as três coisas. Um
 * `.eq('criativo_codigo', '&8')` devolveria só os leads sem sufixo e esconderia as
 * campanhas regionais, que em 30 dias foram 96% da verba do "&8".
 */

/** As 27 unidades da federação, na forma que aparece como sufixo. */
export const UFS_BR = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

/** "&8 MTS" é como o anúncio de Mato Grosso do Sul está nomeado no Meta. */
const UF_ALIAS: Record<string, string> = { MTS: 'MS' }

/**
 * Códigos que o filtro deve casar para a busca digitada.
 *
 * - "&8" ou "8"  → o código puro MAIS todas as variantes regionais
 * - "&8 RO"      → só aquela campanha
 * - "#LPMINI"    → devolvido como está
 *
 * Devolve lista vazia quando não há nada para filtrar.
 */
export function codigosParaFiltro(entrada: string | null | undefined): string[] {
  const bruto = (entrada ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!bruto) return []

  // Código com sufixo de estado já digitado: filtra só ele.
  const comUf = bruto.match(/^&?(\d+)\s+([A-Z]{2,3})$/)
  if (comUf) {
    const uf = UF_ALIAS[comUf[2]] ?? comUf[2]
    if ((UFS_BR as readonly string[]).includes(uf)) return [`&${comUf[1]} ${uf}`]
    return [bruto.startsWith('&') ? bruto : `&${bruto}`]
  }

  // Código puro: traz o puro e todas as regionais dele.
  const puro = bruto.match(/^&?(\d+)$/)
  if (puro) {
    const base = `&${puro[1]}`
    return [base, ...UFS_BR.map(uf => `${base} ${uf}`)]
  }

  return [bruto]
}
