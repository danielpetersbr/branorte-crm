// De-para ORCAMENTO -> CONTRATO.
//
// O orcamento salvo (orcamentos_gerados) ja carrega quase tudo que o contrato
// precisa: cliente com CNPJ/IE/endereco, itens, total, parcelas com datas,
// prazo de entrega, frete e montagem. O que ele NAO tem e' o bloco juridico
// (representante legal, garantidor, conjuge) — esse e' o que fica destacado
// na tela pro vendedor preencher.
//
// Regra de valor de linha copiada de OrcamentoMontar: linha = valor * qtd, e
// item brinde/incluso/por conta do cliente NAO soma.

import type { OrcamentoGerado, OrcamentoItem } from '@/hooks/useOrcamentoBuilder'
import { dataBR } from './extenso'
import { parseFormaPagamento } from './parse-forma-pagamento'
import { totalMontagemSalva } from '@/lib/orcamento-montagem'

export type TipoPessoa = 'pj' | 'produtor_rural' | 'pf'

export interface ContratoPessoa {
  nome: string
  cpf: string
  rg: string
  nascimento: string          // DD/MM/AAAA
  mae: string
  estadoCivil: string
  profissao: string
  nacionalidade: string
  conjugeNome: string
  conjugeCpf: string
}

export interface ContratoComprador {
  tipoPessoa: TipoPessoa
  nome: string
  cnpj: string                // CNPJ (PJ) ou CPF (PF)
  ie: string
  endereco: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  telefone: string
  email: string
  /** Produtor rural: nome da propriedade + endereco do estabelecimento. */
  propriedadeNome: string
  propriedadeEndereco: string
  /** Representante legal (PJ) ou o proprio comprador (PF). */
  representante: ContratoPessoa
}

export interface ContratoGarantidor extends ContratoPessoa {
  incluir: boolean
  /** O garantidor e' o proprio comprador (caso comum em venda pra pessoa fisica). */
  mesmoQueComprador: boolean
  endereco: string
  cidadeUf: string
  cep: string
}

export interface ContratoItemLinha {
  letra: string
  descricao: string
  qtd: number
  valorLinha: number
  /** Nao soma no total: mostra INCLUSO / POR CONTA DO CLIENTE / BRINDE. */
  rotulo: string | null
}

export interface ContratoParcela {
  numero: string
  vencimento: string          // DD/MM/AAAA (ou texto quando nao da' pra calcular)
  valor: number
  metodo: string
}

export interface ContratoDados {
  // origem
  orcamentoId: number
  orcamentoNumero: string
  orcamentoData: string       // DD/MM/AAAA
  vendedorNome: string

  comprador: ContratoComprador
  garantidor: ContratoGarantidor

  itens: ContratoItemLinha[]
  /** Preco do contrato = total do orcamento JA COM o desconto aplicado. */
  valorTotal: number
  totalBruto: number          // total_proposta sem desconto
  descontoValor: number       // 0 quando nao ha desconto
  somaItens: number           // pra alertar divergencia com o total

  entrada: { valor: number; vencimento: string; metodo: string } | null
  parcelas: ContratoParcela[]
  /** Texto livre do orcamento. Vale quando nao ha quadro de parcelas legivel. */
  formaPagamentoTexto: string
  /** true SO quando o preco e' pago integralmente antes da entrega (desliga a
   *  reserva de dominio pelo item 3.7). Nunca inferir isso de "parcelas vazio". */
  pagamentoAntecipado: boolean

  prazoEntrega: string        // "40" / "90"
  prazoTipo: 'corridos' | 'úteis'
  freteFob: boolean
  montagemInclusa: boolean

  localInstalacao: string
  comarca: string             // "Descalvado/SP"
  dataContrato: string        // ISO AAAA-MM-DD
  multaPct: number
  usoImagem: boolean
  /**
   * Como o contrato vai ser assinado. 'digital' dispensa as testemunhas sem
   * perder a executividade (art. 784, § 4o do CPC, Lei 14.620/2023); 'papel'
   * EXIGE as duas, senao o contrato deixa de ser titulo executivo e a cobranca
   * vira acao de conhecimento.
   */
  assinatura: 'digital' | 'papel'
}

// ── datas ────────────────────────────────────────────────────────────────────

function brToIso(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
function addDiasCorridos(brDate: string, days: number): string {
  const iso = brToIso(brDate)
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoToBr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}
function addDiasUteis(brDate: string, days: number): string {
  const iso = brToIso(brDate)
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  let restantes = days
  while (restantes > 0) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) restantes--
  }
  return isoToBr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}
function ehProntaEntrega(txt: string): boolean {
  return /pronta\s*entrega|imediat/i.test(txt || '')
}
function parsePrazoDias(txt: string): number {
  if (ehProntaEntrega(txt)) return 0
  const m = (txt || '').match(/(\d+)\s*dias?/i)
  return m ? parseInt(m[1], 10) : 90
}
function prazoEhUteis(txt: string): boolean {
  return !/corrido/i.test(txt || '')
}

// ── itens ────────────────────────────────────────────────────────────────────

const LETRAS = 'abcdefghijklmnopqrstuvwxyz'

/** "1.5" -> "1,5" — CV no contrato sai com virgula, como se escreve em pt-BR. */
function cv(n: number): string {
  return String(n).replace('.', ',')
}

/**
 * Descricao da linha: nome do equipamento + acionamento.
 *
 * Cuidado com o "incluso": no orcamento da casa o motor normalmente e' cobrado
 * A PARTE (bloco proprio, total_motores). Dizer "motor incluso" na descricao e'
 * contradizer a propria tabela, que lista os motores em linha separada — e num
 * contrato essa contradicao vira discussao. So diz "incluso" quando o motor
 * realmente nao tem valor proprio (motorredutor, TH, acionamento embutido).
 */
function descricaoDoItem(it: OrcamentoItem): string {
  const partes = [it.nome.trim()]
  if (it.motor_cv) {
    const qtdMotor = (it.motor_qtd ?? 1) > 1 ? `${it.motor_qtd}x ` : ''
    const acion = it.motor_polos
      ? `${cv(it.motor_cv)} CV ${it.motor_polos} polos`
      : `${cv(it.motor_cv)} CV`
    if (it.motor_por_conta_cliente) {
      partes.push(`acionamento de ${qtdMotor}${acion} — motor por conta do cliente`)
    } else if ((it.motor_valor_unit ?? 0) > 0) {
      partes.push(`acionamento de ${qtdMotor}${acion} — motor orçado à parte`)
    } else {
      partes.push(`com ${qtdMotor}motor de ${acion} incluso`)
    }
  }
  if (it.inox) partes.push(`em aço inox ${it.inox}`)
  return partes.join(', ')
}

function rotuloDoItem(it: OrcamentoItem): string | null {
  if (it.brinde) return 'BRINDE'
  if (it.incluso) return 'INCLUSO'
  if (it.por_conta_cliente) return 'POR CONTA DO CLIENTE'
  return null
}

// ── de-para ──────────────────────────────────────────────────────────────────

function pessoaVazia(): ContratoPessoa {
  return {
    nome: '', cpf: '', rg: '', nascimento: '', mae: '',
    estadoCivil: '', profissao: '', nacionalidade: 'brasileiro',
    conjugeNome: '', conjugeCpf: '',
  }
}

/**
 * A cidade do cadastro vem com a UF grudada com frequencia ("Santo Antonio das
 * Missoes - RS", "Divinopolis/MG"). Sem separar, o campo UF fica vazio, a
 * comarca do cartorio sai em branco e o contrato perde justo o dado que define
 * ONDE registrar a reserva de dominio.
 */
function separarCidadeUf(cidade: string, uf: string): { cidade: string; uf: string } {
  const c = (cidade || '').trim()
  const u = (uf || '').trim().toUpperCase()
  const m = /^(.*?)\s*[-\/,]\s*([A-Za-z]{2})$/.exec(c)
  if (m) return { cidade: m[1].trim(), uf: u || m[2].toUpperCase() }
  return { cidade: c, uf: u }
}

function tipoPessoaDe(orc: OrcamentoGerado): TipoPessoa {
  const ieTipo = orc.cliente_dados?.ie_tipo
  if (ieTipo === 'produtor_rural') return 'produtor_rural'
  const doc = (orc.cliente_dados?.cnpj || '').replace(/\D/g, '')
  // 11 digitos = CPF -> pessoa fisica. 14 = CNPJ -> juridica.
  if (doc.length === 11) return 'pf'
  return 'pj'
}

/**
 * Monta os dados do contrato a partir do orcamento salvo.
 * `dadosSalvos` = bloco juridico ja guardado no cliente (orcamento_clientes.dados_contrato).
 */
export function contratoDoOrcamento(
  orc: OrcamentoGerado,
  dadosSalvos?: Partial<{ representante: ContratoPessoa; garantidor: ContratoGarantidor }> | null,
): ContratoDados {
  const cd = orc.cliente_dados || {}

  // ── itens: equipamentos do carrinho ──────────────────────────────────────
  const itens: ContratoItemLinha[] = []
  let i = 0
  for (const it of orc.itens || []) {
    const rotulo = rotuloDoItem(it)
    itens.push({
      letra: `${LETRAS[i] ?? '?'})`,
      descricao: descricaoDoItem(it),
      qtd: it.qtd || 1,
      valorLinha: rotulo ? 0 : (it.valor || 0) * (it.qtd || 1),
      rotulo,
    })
    i++
  }

  // acessorios (bloco unico com valor proprio)
  if (orc.acessorios && orc.acessorios.valor > 0) {
    itens.push({
      letra: `${LETRAS[i] ?? '?'})`,
      descricao: `Acessórios: ${(orc.acessorios.items || []).join('; ')}`,
      qtd: 1,
      valorLinha: orc.acessorios.valor,
      rotulo: null,
    })
    i++
  }

  // montagem (soma no total quando tem valor)
  const montagemValor = totalMontagemSalva(orc.montagem)
  if (montagemValor > 0) {
    itens.push({
      letra: `${LETRAS[i] ?? '?'})`,
      descricao: 'Montagem dos equipamentos orçados',
      qtd: 1,
      valorLinha: montagemValor,
      rotulo: null,
    })
    i++
  }

  // componentes extras (painel eletrico, etc)
  for (const ce of orc.componentes_extras || []) {
    itens.push({
      letra: `${LETRAS[i] ?? '?'})`,
      descricao: ce.nome,
      qtd: 1,
      valorLinha: ce.valor || 0,
      rotulo: null,
    })
    i++
  }

  // motores dos equipamentos (no orcamento saem em bloco proprio, fora do valor
  // do equipamento) — viram UMA linha no contrato, como no modelo da casa
  const totalMotores = Number(orc.total_motores) || 0
  if (totalMotores > 0 && (orc.motores || []).length > 0) {
    const tensao = orc.tensao_motores ? `${orc.tensao_motores}V ` : ''
    const fase = orc.voltagem === 'monofasico' ? 'monofásicos' : 'trifásicos'
    const descr = (orc.motores || [])
      .map(m => (m.motorredutor ? `${cv(m.cv)} CV motorredutor` : `${cv(m.cv)} CV ${m.polos} polos`))
      .join('; ')
    itens.push({
      letra: `${LETRAS[i] ?? '?'})`,
      descricao: `Motores ${fase} ${tensao}novos: ${descr}`,
      qtd: (orc.motores || []).length,
      valorLinha: totalMotores,
      rotulo: null,
    })
    i++
  }

  // motores avulsos (sem equipamento host)
  for (const ma of orc.motores_avulsos || []) {
    itens.push({
      letra: `${LETRAS[i] ?? '?'})`,
      descricao: `Motor trifásico novo ${ma.cv} CV ${ma.polos} polos`,
      qtd: ma.qtd || 1,
      valorLinha: 0, // valor entra no total_motores; conferir na tela
      rotulo: ma.por_conta_cliente ? 'POR CONTA DO CLIENTE' : null,
    })
    i++
  }

  // Desconto: o total_proposta guardado e' o BRUTO. O preco que o cliente paga
  // (e que as parcelas somam) e' o liquido — mesma regra do preview/DOCX.
  // Sem isso o contrato sairia com preco MAIOR que o combinado na proposta.
  const totalProposta = Number(orc.total_proposta) || 0
  const desc = orc.desconto
  const descontoValor = (() => {
    if (!desc || !desc.valor || desc.valor <= 0) return 0
    if (desc.manterValorParcelas) return 0
    if (desc.tipo !== 'pct') return desc.valor
    const base = desc.base === 'equipamento' ? (Number(orc.total_equipamentos) || totalProposta) : totalProposta
    return Math.round(base * (desc.valor / 100) * 100) / 100
  })()
  const totalLiquido = Math.round((totalProposta - descontoValor) * 100) / 100

  // Desconto vira LINHA na tabela do contrato: sem isso a soma dos itens nao
  // fecha com o preco da clausula 2.1 e o documento sai se contradizendo.
  if (descontoValor > 0) {
    itens.push({
      letra: '',
      descricao: `Desconto comercial concedido${desc?.motivo ? ` (${desc.motivo})` : ''}`,
      qtd: 1,
      valorLinha: -descontoValor,
      rotulo: null,
    })
  }

  const somaItens = itens.reduce((s, it) => s + it.valorLinha, 0)

  // ── parcelas ─────────────────────────────────────────────────────────────
  // A base do parcelamento e' a data da VENDA. Faltando ela, vale HOJE — o dia em
  // que o contrato esta sendo feito. Usar a data de emissao do orcamento jogava
  // os vencimentos pra tras: orcamento de 15/09 assinado em 22/09 fazia a parcela
  // "no pedido" vencer uma semana antes da assinatura.
  const hoje = new Date()
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  const dataVendaBR = dataBR(orc.data_venda) || dataBR(hojeIso)
  const prazoTxt = orc.prazo_entrega || ''
  const prazoDias = parsePrazoDias(prazoTxt)
  const uteis = prazoEhUteis(prazoTxt)
  const addPrazo = (base: string, d: number) => (uteis ? addDiasUteis(base, d) : addDiasCorridos(base, d))

  function vencimentoDe(p: any): string {
    if (!p) return ''
    if (p.dataTipo === 'no_pedido') return dataVendaBR || 'no pedido'
    if (p.dataTipo === 'apos_pedido') {
      return dataVendaBR ? addDiasCorridos(dataVendaBR, p.dias || 30) : `${p.dias || 30} dias após o pedido`
    }
    if (p.dataTipo === 'na_nf') {
      return dataVendaBR ? addPrazo(dataVendaBR, prazoDias) : 'na emissão da nota'
    }
    if (p.dataTipo === 'apos_nf') {
      return dataVendaBR ? addPrazo(dataVendaBR, prazoDias + (p.dias || 30)) : `${p.dias || 30} dias após a nota`
    }
    if (p.dataTipo === 'data_fixa') return p.dataFixa || ''
    return ''
  }

  const brutas: any[] = Array.isArray(orc.parcelas) ? orc.parcelas : []
  const calcValor = (p: any): number => {
    if (typeof p?.valor === 'number' && p.valor > 0) return p.valor
    if (typeof p?.pct === 'number' && p.pct > 0) return Math.round(totalLiquido * (p.pct / 100) * 100) / 100
    return 0
  }

  // A 1a parcela "no pedido"/"apos_pedido" vira ENTRADA no contrato; o resto
  // vira o quadro de parcelas. Se nao houver parcela de entrada, entrada = null.
  let entrada: ContratoDados['entrada'] = null
  const parcelas: ContratoParcela[] = []
  brutas.forEach((p, idx) => {
    const valor = calcValor(p)
    const venc = vencimentoDe(p)
    if (idx === 0 && (p?.dataTipo === 'no_pedido' || p?.dataTipo === 'apos_pedido') && brutas.length > 1) {
      entrada = { valor, vencimento: venc, metodo: p?.metodo || '' }
      return
    }
    parcelas.push({
      numero: String(parcelas.length + 1),
      vencimento: venc,
      valor,
      metodo: p?.metodo || '',
    })
  })

  // Sem quadro de parcelas? A condicao costuma estar escrita a mao em
  // `forma_pagamento`. Ler dali e' o que impede o contrato de tratar uma venda
  // parcelada como paga a vista (e desligar a reserva de dominio).
  const formaTexto = (orc.forma_pagamento || '').trim()
  if (parcelas.length === 0 && !entrada && formaTexto) {
    const lida = parseFormaPagamento(formaTexto, totalLiquido)
    if (lida) {
      if (lida.entrada) {
        entrada = { valor: lida.entrada.valor, vencimento: dataVendaBR || '', metodo: lida.entrada.metodo }
      }
      lida.parcelas.forEach(pl => {
        parcelas.push({
          numero: String(parcelas.length + 1),
          vencimento: pl.vencimento,
          valor: pl.valor,
          metodo: pl.metodo,
        })
      })
    }
  }

  const { cidade, uf } = separarCidadeUf(cd.cidade || '', cd.uf || '')
  const tipoPessoa = tipoPessoaDe(orc)
  const enderecoCompleto = [cd.endereco, cd.bairro].filter(Boolean).join(', ')

  return {
    orcamentoId: orc.id,
    orcamentoNumero: orc.numero,
    orcamentoData: dataBR(orc.data_emissao),
    vendedorNome: orc.vendedor_nome || '',

    comprador: {
      tipoPessoa,
      nome: orc.cliente_nome || '',
      cnpj: cd.cnpj || '',
      ie: cd.ie || '',
      endereco: enderecoCompleto,
      bairro: cd.bairro || '',
      cidade,
      uf,
      cep: cd.cep || '',
      telefone: cd.fone || '',
      email: cd.email || '',
      propriedadeNome: '',
      propriedadeEndereco: '',
      // Pessoa fisica/produtor rural: quem assina E o proprio comprador, entao o
      // CPF e um so. Sem espelhar, a tela pede o mesmo CPF duas vezes e o alerta
      // acusa "falta CPF" com o CPF ja preenchido na linha de cima.
      representante: (() => {
        const base = { ...pessoaVazia(), ...(dadosSalvos?.representante || {}) }
        if (tipoPessoa !== 'pj') {
          if (!base.nome) base.nome = orc.cliente_nome || ''
          if (!base.cpf) base.cpf = cd.cnpj || ''
        }
        return base
      })(),
    },

    garantidor: {
      ...pessoaVazia(),
      incluir: parcelas.length > 0 || !!formaTexto,
      mesmoQueComprador: false,
      endereco: '',
      cidadeUf: cidade && uf ? `${cidade}/${uf}` : '',
      cep: cd.cep || '',
      ...(dadosSalvos?.garantidor || {}),
    },

    itens,
    valorTotal: totalLiquido,
    totalBruto: totalProposta,
    descontoValor,
    somaItens,

    entrada,
    parcelas,
    formaPagamentoTexto: formaTexto,
    // So e' antecipado quando NAO ha nem parcela nem condicao escrita.
    pagamentoAntecipado: parcelas.length === 0 && !entrada && !formaTexto,

    prazoEntrega: prazoDias ? String(prazoDias) : '',
    prazoTipo: uteis ? 'úteis' : 'corridos',
    freteFob: (orc.frete_tipo ?? 'FOB') !== 'CIF',
    montagemInclusa: totalMontagemSalva(orc.montagem) > 0,

    localInstalacao: '',
    comarca: cidade && uf ? `${cidade}/${uf}` : '',
    dataContrato: hojeIso,
    multaPct: 10,
    usoImagem: true,
    assinatura: 'digital',
  }
}

/** Lista dos campos juridicos que faltam — vira o alerta amarelo da tela. */
export function camposPendentes(d: ContratoDados): string[] {
  const faltam: string[] = []
  const r = d.comprador.representante
  const ehPJ = d.comprador.tipoPessoa === 'pj'

  if (!d.comprador.nome) faltam.push('Nome/razão social do comprador')
  // PF: o CPF do comprador e o do signatario sao o MESMO campo — cobrar uma vez.
  const docComprador = d.comprador.cnpj || (ehPJ ? '' : r.cpf)
  if (!docComprador) faltam.push(ehPJ ? 'CNPJ do comprador' : 'CPF do comprador')
  if (!d.comprador.endereco) faltam.push('Endereço do comprador')
  if (!d.comprador.cidade || !d.comprador.uf) faltam.push('Cidade/UF do comprador')

  if (ehPJ && !r.nome) faltam.push('Nome do representante legal')
  if (ehPJ && !r.cpf) faltam.push('CPF do representante legal')
  // RG, nascimento e nome da mae NAO sao exigidos: o art. 319 do CPC pede nome,
  // estado civil, profissao, CPF, e-mail e domicilio. Os tres ajudam na cobranca
  // (homonimo, consulta em biro), mas cobrar como pendencia so trava o vendedor.
  if (!r.estadoCivil) faltam.push('Estado civil')

  if (d.garantidor.incluir && !d.garantidor.mesmoQueComprador) {
    if (!d.garantidor.nome) faltam.push('Nome do garantidor')
    if (!d.garantidor.cpf) faltam.push('CPF do garantidor')
    if (!d.garantidor.endereco) faltam.push('Endereço do garantidor')
    if (!d.garantidor.estadoCivil) faltam.push('Estado civil do garantidor')
    if (/casad/i.test(d.garantidor.estadoCivil) && !d.garantidor.conjugeNome) {
      faltam.push('Cônjuge do garantidor (garantidor casado)')
    }
  }

  if (!d.prazoEntrega) faltam.push('Prazo de entrega')
  if (!d.localInstalacao) faltam.push('Local de instalação')
  if (!d.comarca) faltam.push('Comarca do cartório (RTD)')

  return faltam
}
