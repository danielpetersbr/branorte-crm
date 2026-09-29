// Leitura de valor em reais digitado à mão, pros formulários de frete.
//
// Por que existe (29/09/2026): o portal da transportadora (TransportadoraApp) e o
// "Registrar frete feito" (FreteMapa) faziam `Number(valor.replace(',', '.'))`.
// A transportadora digita "16.500" (dezesseis mil e quinhentos, como todo brasileiro
// escreve) e o lance era gravado como R$ 16,50 — virando o "melhor preço" do painel.
// "16.500,00" virava NaN e ela lia "o valor é obrigatório" sem entender por quê.
// A página pública irmã (CotarFrete) já tinha um parser certo, mas era cópia local.
//
// A regra NÃO é reescrita aqui: é a mesma de lerValorBR (Financeiro, 24/09/2026),
// que já tem teste. Dois parsers de dinheiro no sistema acabariam discordando.

import { lerValorBR } from './financeiro-valor'

/**
 * Valor em reais → número. NaN quando não dá pra ter certeza (lixo, negativo,
 * separador fora do lugar) — o formulário mostra erro em vez de gravar um valor
 * inventado.
 *
 *   "16.500"     -> 16500      (ponto de milhar)
 *   "16.500,00"  -> 16500
 *   "1.234,56"   -> 1234.56
 *   "16,5"       -> 16.5
 *   "1500.50"    -> 1500.5     (o campo pré-preenchido com String(valor do banco))
 *   "abc"        -> NaN
 *
 * Aceita número de propósito: o estado dos formulários às vezes nasce do banco.
 */
export function parseMoeda(entrada: string | number | null | undefined): number {
  if (entrada == null) return NaN
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? entrada : NaN
  return lerValorBR(entrada)
}
