// Le a condicao de pagamento ESCRITA A MAO no campo `forma_pagamento`.
//
// Nem todo orcamento tem o quadro `parcelas[]` preenchido: boa parte da carteira
// tem so o texto livre, do tipo
//
//   "R$ 5.000,00 no pedido; R$ 14.700,00 ate 10/10/2026; 21/11/2026 R$ 6.000,00
//    via PIX; saldo restante em boletos: 21/12/2026 R$ 5.000,00; ...
//    21/06/2027 R$ 42.823,00 (quitacao)."
//
// Sem ler esse texto o contrato tratava a venda como paga a vista e DESLIGAVA a
// reserva de dominio (item 3.7) numa venda parcelada em 10x — o oposto do que
// protege a casa.
//
// Regra de seguranca: so aceita o resultado se a soma das parcelas fechar com o
// preco. Nao fechou, devolve null e o contrato usa o texto original, sem inventar
// quadro de vencimento.

export interface ParcelaLida {
  vencimento: string     // DD/MM/AAAA, ou '' quando e' "no pedido"
  valor: number
  metodo: string
  noPedido: boolean
}

export interface FormaPagamentoLida {
  entrada: { valor: number; vencimento: string } | null
  parcelas: ParcelaLida[]
  soma: number
}

const RE_VALOR = /R\$\s*([\d.]+,\d{2}|\d+(?:\.\d{3})*(?:,\d{2})?)/
const RE_DATA = /(\d{2}\/\d{2}\/\d{4})/
const RE_METODO = /\b(pix|boleto|boletos|dinheiro|transfer[êe]ncia|ted|doc|cart[ãa]o|cheque|financiamento|finame)\b/i

function paraNumero(txt: string): number {
  // "42.823,00" -> 42823.00 ; "5.000" -> 5000
  const limpo = txt.replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param texto  conteudo de orcamentos_gerados.forma_pagamento
 * @param total  preco do contrato (ja com desconto) — usado so pra validar
 */
export function parseFormaPagamento(texto: string, total: number): FormaPagamentoLida | null {
  const t = (texto || '').trim()
  if (!t) return null

  // Quebra por ';' e tambem por ' e ' quando nao ha ';' nenhum.
  const pedacos = (t.includes(';') ? t.split(';') : t.split(/\s+e\s+/i))
    .map(x => x.trim())
    .filter(Boolean)
  if (pedacos.length === 0) return null

  const lidas: ParcelaLida[] = []
  for (const pedaco of pedacos) {
    const mv = RE_VALOR.exec(pedaco)
    if (!mv) continue                     // trecho sem valor ("saldo restante em boletos:") e' so rotulo
    const valor = paraNumero(mv[1])
    if (valor <= 0) continue

    const md = RE_DATA.exec(pedaco)
    const noPedido = /no\s+pedido|na\s+assinatura|entrada|sinal/i.test(pedaco)
    const mm = RE_METODO.exec(pedaco)

    lidas.push({
      vencimento: md ? md[1] : '',
      valor,
      metodo: mm ? mm[1].toUpperCase().replace('BOLETOS', 'BOLETO') : '',
      noPedido: noPedido && !md,
    })
  }

  if (lidas.length === 0) return null

  const soma = Math.round(lidas.reduce((s, p) => s + p.valor, 0) * 100) / 100
  // Nao fechou com o preco? Nao arrisca: o contrato usa o texto original.
  if (total > 0 && Math.abs(soma - total) > 1) return null

  let entrada: FormaPagamentoLida['entrada'] = null
  const parcelas: ParcelaLida[] = []
  for (const p of lidas) {
    if (!entrada && p.noPedido) {
      entrada = { valor: p.valor, vencimento: '' }
      continue
    }
    parcelas.push(p)
  }

  return { entrada, parcelas, soma }
}
