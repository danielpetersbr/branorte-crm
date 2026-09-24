// Entrada de dinheiro e de data nos formulários do Financeiro.
//
// Os dois bugs que isto fecha (achados em 24/09/2026):
//
// 1. O campo de valor fazia `Number(v.replace(',', '.'))`. Quem digitava do jeito
//    brasileiro se dava mal: "15.000" virava R$ 15, e "15.000,00" virava NaN (o
//    botão só ficava cinza, sem dizer por quê). O primeiro caso é o perigoso — o
//    lançamento saía com o valor errado, sem aviso.
//
// 2. A data padrão era `new Date().toISOString().slice(0, 10)`, que é a data em
//    UTC. Depois das 21h em Brasília isso já é AMANHÃ, e o servidor recusa com
//    "A data do recebimento não pode estar no futuro" — justo no horário em que o
//    vendedor senta pra lançar o que recebeu no dia.

/**
 * Lê um valor em reais do jeito que a pessoa digitou.
 *
 *   "15000"        -> 15000
 *   "15000,50"     -> 15000.5
 *   "15.000"       -> 15000      (ponto de milhar, sem centavos)
 *   "15.000,50"    -> 15000.5
 *   "R$ 1.234,56"  -> 1234.56
 *   "15000.50"     -> 15000.5    (o campo já vem preenchido assim: saldo.toFixed(2))
 *
 * Devolve NaN quando não dá pra ter certeza — melhor travar o botão do que lançar
 * um número inventado.
 */
export function lerValorBR(entrada: string): number {
  const s = entrada.replace(/R\$/gi, '').replace(/\s/g, '')
  if (!s) return NaN
  if (!/^[\d.,]+$/.test(s)) return NaN

  if (s.includes(',')) {
    // vírgula é o decimal: pontos só podem ser de milhar, em grupos de 3
    const [inteiro, dec, ...resto] = s.split(',')
    if (resto.length > 0 || dec === undefined || !/^\d{0,2}$/.test(dec)) return NaN
    if (inteiro.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) return NaN
    const n = Number(inteiro.replace(/\./g, '') + '.' + (dec || '0'))
    return Number.isFinite(n) ? n : NaN
  }

  // sem vírgula: "1.500" / "150.000" / "1.500.000" é milhar; "1500.50" é decimal
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''))
  if (/^\d+(\.\d{1,2})?$/.test(s)) return Number(s)
  return NaN
}

/** Data civil de hoje em São Paulo (AAAA-MM-DD) — a mesma régua do servidor (hojeSP). */
export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora)
}

export function brlCentavos(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}
