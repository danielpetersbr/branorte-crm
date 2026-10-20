/**
 * Relatório de marketing (20/10/2026) — a aba Marketing enxuta e o PDF pro gestor de tráfego
 * leem daqui. Quatro perguntas, na ordem que o dono pediu:
 *   1. quais canais trazem os melhores contatos;
 *   2. o que virou venda e quanto;
 *   3. quais criativos trazem lead bom (e quais trazem gente que some ou quer outra coisa);
 *   4. por que os atendimentos fecham.
 *
 * Os números vêm de duas RPCs: dashboard_marketing_fontes (coorte de leads que CHEGARAM no
 * período, por canal e por criativo) e dashboard_marketing_vendas (pedidos FECHADOS no
 * período, pela origem que o vendedor marca no pedido). As duas medem coisas diferentes de
 * propósito: a venda de hoje nasce de lead de semanas atrás, então "vendas" não é a coorte.
 */

export type PeriodoMkt = 'mes' | 'mes_passado' | '90d'

export const PERIODOS_MKT: { value: PeriodoMkt; label: string }[] = [
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: '90d', label: '90 dias' },
]

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

/** Intervalo em hora local (= São Paulo pra quem usa o CRM), fim exclusivo. */
export function intervaloMkt(p: PeriodoMkt, agora = new Date()): { from: Date; to: Date; label: string } {
  const y = agora.getFullYear(), m = agora.getMonth()
  const amanha = new Date(y, m, agora.getDate() + 1)
  if (p === 'mes_passado') {
    const from = new Date(y, m - 1, 1)
    return { from, to: new Date(y, m, 1), label: `${MESES[from.getMonth()]} de ${from.getFullYear()}` }
  }
  if (p === '90d') {
    const from = new Date(y, m, agora.getDate() - 89)
    return { from, to: amanha, label: `90 dias (${dm(from)} a ${dm(agora)})` }
  }
  return { from: new Date(y, m, 1), to: amanha, label: `${MESES[m]} de ${y} (até ${dm(agora)})` }
}

export interface FonteMkt {
  tipo: 'canal' | 'criativo' | 'total'
  chave: string
  nome: string | null
  leads: number
  rastreaveis: number
  qualificados: number
  comProposta: number
  propPor100: number | null
  icMin: number | null
  icMax: number | null
  rsProposto: number
  compraram: number
  rsVendido: number
  fechados: number
  nunca: number
  sumiu: number
  semInteresse: number
  preco: number
  concorrente: number
  nadaAVer: number
  boi200: number
}

export interface VendaMkt {
  tipo: 'origem' | 'criativo' | 'total'
  chave: string
  nome: string | null
  vendas: number
  valor: number
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
const numOuNulo = (v: unknown) => (v == null || v === '' ? null : Number(v))

export function lerFonte(r: Record<string, unknown>): FonteMkt {
  return {
    tipo: String(r.tipo) as FonteMkt['tipo'],
    chave: String(r.chave ?? ''),
    nome: r.nome == null ? null : String(r.nome),
    leads: num(r.leads),
    rastreaveis: num(r.leads_rastreaveis),
    qualificados: num(r.qualificados),
    comProposta: num(r.com_proposta),
    propPor100: numOuNulo(r.prop_por_100),
    icMin: numOuNulo(r.prop_ic95_min),
    icMax: numOuNulo(r.prop_ic95_max),
    rsProposto: num(r.rs_proposto),
    compraram: num(r.compraram),
    rsVendido: num(r.rs_vendido),
    fechados: num(r.fechados),
    nunca: num(r.nunca_respondeu),
    sumiu: num(r.nao_respondeu_mais),
    semInteresse: num(r.sem_interesse),
    preco: num(r.preco),
    concorrente: num(r.concorrente),
    nadaAVer: num(r.nada_a_ver),
    boi200: num(r.bovino_200_mais),
  }
}

export function lerVenda(r: Record<string, unknown>): VendaMkt {
  return {
    tipo: String(r.tipo) as VendaMkt['tipo'],
    chave: String(r.chave ?? ''),
    nome: r.nome == null ? null : String(r.nome),
    vendas: num(r.vendas),
    valor: num(r.valor),
  }
}

/** Abaixo disto, a taxa de um canal/criativo é ruído: mostra, mas sem selo e fora dos destaques. */
export const AMOSTRA_MIN_MKT = 20

/**
 * Selo da taxa de proposta contra a média da própria conta, pelo intervalo de 95%:
 * só é "acima" ou "abaixo" quando o intervalo inteiro fica do mesmo lado da média.
 */
export type SeloMkt = 'acima' | 'media' | 'abaixo' | 'pouco' | 'sem_fone'

export function seloProposta(r: FonteMkt, mediaPor100: number | null): SeloMkt {
  if (r.leads > 0 && r.rastreaveis / r.leads < 0.5) return 'sem_fone'
  if (r.rastreaveis < AMOSTRA_MIN_MKT || mediaPor100 == null || r.icMin == null || r.icMax == null) return 'pouco'
  if (r.icMin > mediaPor100) return 'acima'
  if (r.icMax < mediaPor100) return 'abaixo'
  return 'media'
}

export const SELO_TEXTO: Record<SeloMkt, string> = {
  acima: 'Acima da média',
  media: 'Na média',
  abaixo: 'Abaixo da média',
  pouco: 'Pouco volume',
  sem_fone: 'Sem telefone',
}

export const taxa = (parte: number, todo: number) => (todo > 0 ? (100 * parte) / todo : null)

/** "&90 · Mini fábrica de ração" */
export function rotuloCriativo(codigo: string, nome: string | null): string {
  const n = (nome ?? '').trim()
  if (!n) return codigo
  const bonito = n.charAt(0) + n.slice(1).toLowerCase()
  return `${codigo} · ${bonito}`
}

export interface Destaque { chave: string; texto: string; tom: 'bom' | 'ruim' | 'neutro' }

export interface RelatorioMkt {
  total: FonteMkt | null
  canais: FonteMkt[]
  criativos: FonteMkt[]
  vendasTotal: VendaMkt | null
  vendasOrigem: VendaMkt[]
  vendasCriativo: VendaMkt[]
  destaques: Destaque[]
}

const pctTxt = (v: number | null) => (v == null ? '—' : `${String(Number(v.toFixed(0)))}%`)
/** Mesmo formato do brl() do Dashboard: o resumo e a tabela mostram o mesmo texto. */
const brlCurto = (v: number) => (v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`
  : v >= 10_000 ? `R$ ${(v / 1_000).toFixed(1).replace('.', ',')} mil` : `R$ ${Math.round(v).toLocaleString('pt-BR')}`)

export function montarRelatorio(fontes: FonteMkt[], vendas: VendaMkt[]): RelatorioMkt {
  const total = fontes.find(f => f.tipo === 'total') ?? null
  const canais = fontes.filter(f => f.tipo === 'canal' && f.leads > 0).sort((a, b) => b.leads - a.leads)
  const criativos = fontes.filter(f => f.tipo === 'criativo' && f.leads > 0).sort((a, b) => b.leads - a.leads)
  const vendasTotal = vendas.find(v => v.tipo === 'total') ?? null
  const vendasOrigem = vendas.filter(v => v.tipo === 'origem').sort((a, b) => b.valor - a.valor)
  const vendasCriativo = vendas.filter(v => v.tipo === 'criativo').sort((a, b) => b.valor - a.valor)

  const media = total?.propPor100 ?? null
  const destaques: Destaque[] = []

  const acima = canais.filter(c => seloProposta(c, media) === 'acima').sort((a, b) => (b.propPor100 ?? 0) - (a.propPor100 ?? 0))
  if (acima.length) {
    destaques.push({ chave: 'canal', tom: 'bom', texto: `Canal com contato melhor: ${acima.map(c => `${c.chave} (${String(c.propPor100?.toFixed(1)).replace('.', ',')} propostas a cada 100 leads)`).join(', ')} — a média da conta é ${String(media?.toFixed(1)).replace('.', ',')}.` })
  } else if (canais.length) {
    destaques.push({ chave: 'canal', tom: 'neutro', texto: `Nenhum canal ficou claramente acima da média de ${String(media?.toFixed(1) ?? '—').replace('.', ',')} propostas a cada 100 leads neste período.` })
  }

  const topVenda = vendasOrigem[0]
  if (vendasTotal && vendasTotal.vendas > 0 && topVenda) {
    destaques.push({ chave: 'venda', tom: 'neutro', texto: `${vendasTotal.vendas} vendas fecharam (${brlCurto(vendasTotal.valor)}). A origem que mais vendeu: ${topVenda.chave}, ${topVenda.vendas} venda${topVenda.vendas === 1 ? '' : 's'} e ${brlCurto(topVenda.valor)}.` })
  }

  const comVolume = criativos.filter(c => c.leads >= AMOSTRA_MIN_MKT)
  const melhorProp = [...comVolume].filter(c => c.comProposta >= 2).sort((a, b) => (b.propPor100 ?? 0) - (a.propPor100 ?? 0))[0]
  if (melhorProp) {
    destaques.push({ chave: 'criativo', tom: 'bom', texto: `Criativo que mais vira proposta: ${rotuloCriativo(melhorProp.chave, melhorProp.nome)} — ${melhorProp.comProposta} propostas em ${melhorProp.leads} leads.` })
  }
  const maiorBoi = [...comVolume].filter(c => c.boi200 >= 3).sort((a, b) => b.boi200 - a.boi200)[0]
  if (maiorBoi) {
    destaques.push({ chave: 'porte', tom: 'bom', texto: `Criativo que mais traz produtor grande: ${rotuloCriativo(maiorBoi.chave, maiorBoi.nome)} — ${maiorBoi.boi200} com 200 bois ou mais.` })
  }
  const semResp = [...comVolume].sort((a, b) => (b.nunca + b.sumiu) / b.leads - (a.nunca + a.sumiu) / a.leads)[0]
  if (semResp && semResp.nunca + semResp.sumiu > 0) {
    destaques.push({ chave: 'sumiu', tom: 'ruim', texto: `Criativo com mais gente que não responde: ${rotuloCriativo(semResp.chave, semResp.nome)} — ${pctTxt(taxa(semResp.nunca + semResp.sumiu, semResp.leads))} dos leads nunca responderam ou pararam de responder.` })
  }
  const nada = [...comVolume].sort((a, b) => b.nadaAVer / b.leads - a.nadaAVer / a.leads)[0]
  if (nada && nada.nadaAVer > 0) {
    destaques.push({ chave: 'nada', tom: 'ruim', texto: `Criativo com mais assunto fora do que a Branorte vende: ${rotuloCriativo(nada.chave, nada.nome)} — ${pctTxt(taxa(nada.nadaAVer, nada.leads))} dos leads (não fabricamos, outros assuntos, transportadora, suporte).` })
  }

  return { total, canais, criativos, vendasTotal, vendasOrigem, vendasCriativo, destaques }
}

/** Fatias do "por que fecha", na ordem da barra. */
export const MOTIVOS_MKT: { campo: keyof FonteMkt; rotulo: string; cor: string }[] = [
  { campo: 'nunca', rotulo: 'Nunca respondeu', cor: '#94a3b8' },
  { campo: 'sumiu', rotulo: 'Parou de responder', cor: '#cbd5e1' },
  { campo: 'preco', rotulo: 'Só preço / fora do orçamento', cor: '#f59e0b' },
  { campo: 'nadaAVer', rotulo: 'Assunto nada a ver', cor: '#ef4444' },
  { campo: 'concorrente', rotulo: 'Comprou do concorrente', cor: '#8b5cf6' },
  { campo: 'semInteresse', rotulo: 'Sem interesse', cor: '#64748b' },
]
