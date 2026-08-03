/**
 * Geração da proposta que vai PRO CLIENTE.
 *
 * REGRA DURA: nada de custo, margem, lucro, comissão, imposto, preço mínimo ou
 * desconto máximo sai daqui. O que o cliente recebe é preço, quantidade,
 * embalagem, condição e validade. `dadosProposta` é a única fonte que a tela do
 * cliente e o texto do WhatsApp consomem — se um número interno não está neste
 * objeto, não tem como vazar.
 */
import { nomeCategoria, nomeEspecie } from './catalogo'
import { brl, brlKg, dataBR, numero } from './formato'
import type { ResultadoSimulacao, SimulacaoInput } from './tipos'

export interface DadosProposta {
  codigo: string
  data: string
  validade: string

  clienteNome: string
  clienteEmpresa: string
  clienteCidade: string
  clienteUf: string
  clienteTelefone: string

  vendedorNome: string

  produto: string
  categoria: string

  quantidadeKg: number
  toneladas: number
  sacos: number
  pesoSaco: number

  precoPorKg: number
  precoPorSaco: number
  precoPorTonelada: number
  valorTotal: number

  prazoPagamento: string
  formaPagamento: string
  condicaoEntrega: string

  textoComercial: string
  avisoNutricional: string
}

export function dadosProposta(
  input: SimulacaoInput,
  resultado: ResultadoSimulacao,
  extras: { codigo: string; textoComercial: string; avisoNutricional: string },
): DadosProposta {
  const { identificacao: id, produto, quantidade } = input
  return {
    codigo: extras.codigo,
    data: id.data,
    validade: id.validade,

    clienteNome: id.clienteNome,
    clienteEmpresa: id.clienteEmpresa,
    clienteCidade: id.clienteCidade,
    clienteUf: id.clienteUf,
    clienteTelefone: id.clienteTelefone,

    vendedorNome: id.vendedorNome,

    produto: nomeEspecie(produto.especie),
    categoria: nomeCategoria(produto.especie, produto.categoria, produto.categoriaLivre),

    quantidadeKg: resultado.demanda.quantidadeKg,
    toneladas: resultado.demanda.toneladas,
    sacos: resultado.demanda.sacos,
    pesoSaco: quantidade.pesoSaco,

    precoPorKg: resultado.negociado.precoPorKg,
    precoPorSaco: resultado.negociado.precoPorSaco,
    precoPorTonelada: resultado.negociado.precoPorTonelada,
    valorTotal: resultado.negociado.valorTotalPedido,

    prazoPagamento: input.venda.prazoPagamento,
    formaPagamento: input.venda.formaPagamento,
    condicaoEntrega: input.venda.condicaoEntrega,

    textoComercial: extras.textoComercial,
    avisoNutricional: extras.avisoNutricional,
  }
}

/** Texto pronto pro WhatsApp — editável antes do envio. */
export function textoWhatsApp(p: DadosProposta): string {
  const primeiroNome = (p.clienteNome || '').trim().split(/\s+/)[0] || 'tudo bem'
  const sacosInteiros = Math.round(p.sacos)
  const embalagem = sacosInteiros > 0
    ? `${numero(sacosInteiros)} sacos de ${numero(p.pesoSaco)} kg`
    : 'a combinar'

  const linhas = [
    `Olá, ${primeiroNome}!`,
    '',
    `Preparei a condição para o fornecimento de ${p.produto.toLowerCase()}${p.categoria ? ` — ${p.categoria}` : ''}.`,
    '',
    `Quantidade: ${numero(p.quantidadeKg)} kg (${numero(p.toneladas, 1)} t)`,
    `Embalagem: ${embalagem}`,
    `Valor por kg: ${brl(p.precoPorKg, 2)}`,
    `Valor por saco: ${brl(p.precoPorSaco)}`,
    `Valor total: ${brl(p.valorTotal)}`,
    `Condição de pagamento: ${[p.formaPagamento, p.prazoPagamento].filter(Boolean).join(' · ') || 'a combinar'}`,
    `Entrega/frete: ${p.condicaoEntrega || 'a combinar'}`,
    `Validade da proposta: ${dataBR(p.validade)}`,
    '',
    'Qualquer dúvida, fico à disposição.',
    '',
    p.vendedorNome || '',
    'Branorte',
    '',
    `Proposta ${p.codigo}`,
  ]
  return linhas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n')
}

/** Só os dígitos do telefone, com 55 na frente — pro wa.me. */
export function telefoneWhatsApp(telefone: string): string {
  const d = (telefone || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('55')) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

/**
 * Link do WhatsApp. Sem telefone cai no seletor de contato do próprio app —
 * é como o vendedor já usa no estudo de viabilidade.
 */
export function linkWhatsApp(p: DadosProposta, texto?: string): string {
  const msg = encodeURIComponent(texto ?? textoWhatsApp(p))
  const fone = telefoneWhatsApp(p.clienteTelefone)
  return fone ? `https://wa.me/${fone}?text=${msg}` : `https://wa.me/?text=${msg}`
}

/** Resumo em texto puro pro botão "Copiar resumo". */
export function resumoTexto(p: DadosProposta): string {
  return [
    `PROPOSTA ${p.codigo} — BRANORTE`,
    `Cliente: ${p.clienteNome}${p.clienteEmpresa ? ` (${p.clienteEmpresa})` : ''}`,
    p.clienteCidade || p.clienteUf ? `Local: ${[p.clienteCidade, p.clienteUf].filter(Boolean).join('/')}` : '',
    `Produto: ${p.produto}${p.categoria ? ` — ${p.categoria}` : ''}`,
    `Quantidade: ${numero(p.quantidadeKg)} kg · ${numero(Math.round(p.sacos))} sacos de ${numero(p.pesoSaco)} kg`,
    `Preço: ${brlKg(p.precoPorKg, 2)} · ${brl(p.precoPorSaco)}/saco · ${brl(p.precoPorTonelada)}/t`,
    `Total: ${brl(p.valorTotal)}`,
    `Pagamento: ${[p.formaPagamento, p.prazoPagamento].filter(Boolean).join(' · ') || 'a combinar'}`,
    `Entrega: ${p.condicaoEntrega || 'a combinar'}`,
    `Validade: ${dataBR(p.validade)}`,
    `Vendedor: ${p.vendedorNome || '—'}`,
  ].filter(Boolean).join('\n')
}
