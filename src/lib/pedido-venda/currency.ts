/**
 * Utilitários para operações financeiras em BRL.
 *
 * Float em JavaScript perde precisão em operações como 100.1 * 3 = 300.299...
 * Para evitar drift, trabalhamos em CENTAVOS (inteiros) e convertemos ao final.
 *
 * Use estas funções para qualquer cálculo que vire para a DB (valor_total, comissão)
 * ou seja apresentado ao cliente (proposta, NF).
 */

/** Arredonda valor BRL para 2 casas decimais corrigindo float drift. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Converte BRL (R$) em centavos inteiros. Trata null/undefined/NaN como 0. */
export function toCents(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

/** Converte centavos inteiros de volta para BRL (number). */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Multiplica preço × quantidade preservando precisão financeira.
 * Use em vez de `valor * quantidade` direto.
 */
export function multiplyCurrency(price: number, qty: number): number {
  return fromCents(toCents(price) * (qty ?? 0));
}

/**
 * Soma valores financeiros sem acumular drift de float.
 * Use em vez de `array.reduce((s, v) => s + v, 0)`.
 */
export function sumCurrency(values: ReadonlyArray<number | null | undefined>): number {
  const totalCents = values.reduce<number>((s, v) => s + toCents(v), 0);
  return fromCents(totalCents);
}

/**
 * Soma itens com (preço × quantidade) preservando precisão.
 * Use em vez de `array.reduce((s, e) => s + e.valor * e.quantidade, 0)`.
 */
export function sumLineItems<T>(
  items: ReadonlyArray<T>,
  getPrice: (item: T) => number | null | undefined,
  getQty: (item: T) => number | null | undefined
): number {
  const totalCents = items.reduce<number>((s, item) => {
    const cents = toCents(getPrice(item));
    const qty = getQty(item) ?? 0;
    return s + cents * qty;
  }, 0);
  return fromCents(totalCents);
}
