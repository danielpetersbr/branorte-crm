// MODO EXPORTAÇÃO (+10% / +20%) — a ida e a volta entre o carrinho e o que fica gravado.
//
// O carrinho do OrcamentoMontar vive SEMPRE no valor-base. A camada de exibição
// (carrinhoExib) infla só `valor` e `motor_valor_unit`, e é ela que o save grava em
// orcamentos_gerados.itens. `valor_original` NÃO é inflado: é a base de cálculo do
// Inox/Tungstênio ("desligar" volta `valor` para `valor_original`) e do selo de
// "valor editado", e vai para o banco como está.
//
// Ao reabrir, só se desfaz o que foi inflado. Até 29/09/2026 a reabertura dividia
// TAMBÉM o valor_original pelo fator: ele encolhia 10-20% a cada reabrir-e-salvar
// (medido no banco: o mesmo item com valor_original 49.789 → 45.263 → 41.148 → 37.407
// em 1804/1805/1824/1826) e, ao ligar/desligar Inox ou Tungstênio, o item caía de
// preço sem aviso. Por isso a conta mora aqui, com teste da ida e da volta.
//
// Arredondamento: base inteira faz a ida e volta exata (round(round(b·f)/f) = b,
// porque o erro do 1º round dividido por f fica abaixo de 0,5). Base com centavos
// (item de modelo pronto, ex.: R$ 12.124,20) volta inteira e o valor exibido pode
// andar R$ 1 por unidade na 1ª reabertura — depois estabiliza.

export function fatorExportacao(pct: number): number {
  const p = Number(pct)
  return 1 + (Number.isFinite(p) ? p : 0) / 100
}

interface ValoresExportacao {
  valor: number
  motor_valor_unit?: number | null
}

/** Camada de exibição: o que o preview/PDF mostra e o save grava. Arredonda sempre
 *  (fator 1 inclusive) — a regra é "orçamento sem centavos". */
export function inflarItemExportacao<T extends ValoresExportacao>(c: T, fator: number): T {
  return {
    ...c,
    valor: Math.round(c.valor * fator),
    motor_valor_unit: c.motor_valor_unit != null ? Math.round(c.motor_valor_unit * fator) : c.motor_valor_unit,
  }
}

/** Reabertura: devolve ao valor-base o que o save gravou inflado. `valor_original`
 *  (e qualquer outro campo) passa intacto — ele já foi gravado na base. */
export function desinflarItemExportacao<T extends ValoresExportacao>(c: T, fator: number): T {
  const mv = c.motor_valor_unit
  return {
    ...c,
    valor: Math.round(c.valor / fator),
    motor_valor_unit: typeof mv === 'number' && mv > 0 ? Math.round(mv / fator) : mv,
  }
}
