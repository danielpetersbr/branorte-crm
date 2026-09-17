// Motor SOMADO no preço do equipamento ("➕ SOMAR no valor do equipamento", modal
// Trocar Motor do orçamento). Diferente de "marcar como INCLUSO" puro, que só para de
// cobrar o motor e derruba o total: aqui o valor do motor SAI da tabela MOTORES e ENTRA
// no preço do equipamento — o total do orçamento não muda, o motor só deixa de ser linha.
//
// Mora aqui (e não dentro de OrcamentoMontar) porque a conta é o que pode errar dinheiro:
// escolher as linhas certas do motor, dividir pela quantidade do item e devolver
// exatamente o que foi somado ao reverter.

/** Linha da tabela MOTORES (subconjunto do MotorAgrupado de que a conta precisa). */
export interface LinhaMotorEmbutivel {
  item_uid?: string
  motorIndex?: number
  valor_total: number
  removido?: boolean
  por_conta_cliente?: boolean
}

/** Item do carrinho (subconjunto do CarrinhoItem de que a conta precisa). */
export interface ItemEmbutivel {
  qtd: number
  valor: number
  valor_original: number
  motores_embutidos?: Record<string, number>
  motor_incluso_manual?: boolean
  motores_incluso_idx?: number[]
}

/**
 * Quanto esse motor custa hoje no orçamento. Soma TODAS as linhas do mesmo
 * (item_uid, motorIndex) — são qtd_do_item × motor_qtd linhas, já com redutor somado e
 * com override manual de preço aplicado. Motor removido ou por conta do cliente não
 * entra: não há valor sendo cobrado pra realocar.
 *
 * motorIndex undefined = motor único do item (linhas sem motorIndex). Não confundir com
 * "qualquer motor": um item multi-motor tem índice 0/1 e não pode casar com o único.
 */
export function valorCobradoDoMotor(
  linhas: LinhaMotorEmbutivel[],
  itemUid: string,
  motorIndex?: number,
): number {
  return linhas
    .filter(m => m.item_uid === itemUid
      && (motorIndex == null ? m.motorIndex == null : m.motorIndex === motorIndex)
      && !m.removido
      && !m.por_conta_cliente)
    .reduce((acc, m) => acc + (Number(m.valor_total) || 0), 0)
}

/**
 * Soma o motor no preço do equipamento e marca o motor como incluso.
 * valor/valor_original do item são UNITÁRIOS (o total multiplica por qtd), então o que
 * entra é o valor do motor dividido pela quantidade do item.
 * Devolve o item intacto quando não há o que somar (motor já embutido ou sem valor).
 */
export function embutirMotorNoItem<T extends ItemEmbutivel>(
  it: T,
  chave: string,
  valorCobradoTotal: number,
  motorIndex?: number,
): T {
  if ((it.motores_embutidos ?? {})[chave] != null) return it   // já embutido: no-op
  if (!(valorCobradoTotal > 0)) return it                       // motor sem valor cobrado
  const porUnidade = Math.round(valorCobradoTotal / Math.max(1, it.qtd))
  if (porUnidade <= 0) return it
  return {
    ...it,
    valor: it.valor + porUnidade,
    valor_original: it.valor_original + porUnidade,
    motores_embutidos: { ...(it.motores_embutidos ?? {}), [chave]: porUnidade },
    ...(motorIndex == null
      ? { motor_incluso_manual: true }
      : { motores_incluso_idx: Array.from(new Set([...(it.motores_incluso_idx ?? []), motorIndex])) }),
  }
}

/**
 * Tira do preço do equipamento EXATAMENTE o que foi somado e volta a cobrar o motor
 * como linha separada. Item sem esse motor embutido volta intacto.
 */
export function devolverMotorDoItem<T extends ItemEmbutivel>(
  it: T,
  chave: string,
  motorIndex?: number,
): T {
  const emb = it.motores_embutidos ?? {}
  const valorEmbutido = emb[chave]
  if (valorEmbutido == null) return it
  const resto = { ...emb }
  delete resto[chave]
  return {
    ...it,
    valor: it.valor - valorEmbutido,
    valor_original: it.valor_original - valorEmbutido,
    motores_embutidos: Object.keys(resto).length ? resto : undefined,
    ...(motorIndex == null
      ? { motor_incluso_manual: false }
      : { motores_incluso_idx: (it.motores_incluso_idx ?? []).filter(i => i !== motorIndex) }),
  }
}

/** Soma de tudo que foi embutido a mão neste item (entra em motorContributionDoItem). */
export function totalEmbutidoNoItem(it: Pick<ItemEmbutivel, 'motores_embutidos'>): number {
  return Object.values(it.motores_embutidos ?? {}).reduce((s, v) => s + (Number(v) || 0), 0)
}
