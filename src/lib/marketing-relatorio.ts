/**
 * Relatório de marketing (20/10/2026, v2) — a aba Marketing e o PDF do gestor de tráfego leem daqui.
 *
 * v1 respondia 4 perguntas. A revisão do analista (20/10) mostrou que o gestor ainda não conseguia
 * decidir VERBA nem DELEGAR. A v2 acrescenta:
 *  - o gasto do Meta por anúncio (tabela meta_gasto_anuncio_dia) → custo por contato e por orçamento;
 *  - uma decisão por anúncio (subir / manter / esperar volume / cortar), com regra escrita aqui;
 *  - as tarefas do gestor de tráfego e do time de vendas, separadas;
 *  - pedidos fechados em grupos (internet × carteira) — carteira não é mídia;
 *  - o tempo de resposta e o "sumiu" por vendedor.
 *
 * Duas populações diferentes, e o relatório nunca as põe lado a lado como funil:
 *  - CONTATOS que chegaram no período (coorte): orçamentos, motivos, anúncios, vendedores;
 *  - PEDIDOS fechados no período (de contatos de qualquer época): vendas por origem.
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

// ---------------------------------------------------------------------------
// Linhas das RPCs
// ---------------------------------------------------------------------------

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
  /** não fabricamos + fora do escopo (compatibilidade) */
  nadaAVer: number
  naoFabricamos: number
  foraEscopo: number
  boi200: number
}

export interface VendaMkt {
  tipo: 'origem' | 'grupo' | 'criativo' | 'total'
  chave: string
  /** origem → nome do grupo; criativo → nome do criativo */
  nome: string | null
  vendas: number
  valor: number
}

export interface GastoLinhaMkt {
  tipo: 'codigo' | 'sem_codigo' | 'total'
  codigo: string | null
  gasto: number
  conversas: number
  anuncios: number
  carregadoAte: string | null
  campanhas: string | null
}

export interface VendedorMkt {
  vendedor: string
  contatos: number
  rastreaveis: number
  comOrcamento: number
  sumiu: number
  clienteEscreveu: number
  respondidos: number
  medianaRespostaMin: number | null
  ate1h: number
  semResposta24h: number
  medianaEnviadas: number | null
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
const numOuNulo = (v: unknown) => (v == null || v === '' ? null : Number(v))
const txt = (v: unknown) => (v == null ? null : String(v))

export function lerFonte(r: Record<string, unknown>): FonteMkt {
  const nadaAVer = num(r.nada_a_ver)
  return {
    tipo: String(r.tipo) as FonteMkt['tipo'],
    chave: String(r.chave ?? ''),
    nome: txt(r.nome),
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
    nadaAVer,
    // RPC antiga (sem as colunas novas): tudo cai em "não fabricamos" para não sumir da conta
    naoFabricamos: r.nao_fabricamos == null ? nadaAVer : num(r.nao_fabricamos),
    foraEscopo: num(r.fora_escopo),
    boi200: num(r.bovino_200_mais),
  }
}

export function lerVenda(r: Record<string, unknown>): VendaMkt {
  return { tipo: String(r.tipo) as VendaMkt['tipo'], chave: String(r.chave ?? ''), nome: txt(r.nome), vendas: num(r.vendas), valor: num(r.valor) }
}

export function lerGasto(r: Record<string, unknown>): GastoLinhaMkt {
  return {
    tipo: String(r.tipo) as GastoLinhaMkt['tipo'], codigo: txt(r.codigo), gasto: num(r.gasto), conversas: num(r.conversas),
    anuncios: num(r.anuncios), carregadoAte: txt(r.carregado_ate), campanhas: txt(r.campanhas),
  }
}

export function lerVendedor(r: Record<string, unknown>): VendedorMkt {
  return {
    vendedor: String(r.vendedor ?? ''), contatos: num(r.contatos), rastreaveis: num(r.rastreaveis), comOrcamento: num(r.com_orcamento),
    sumiu: num(r.sumiu), clienteEscreveu: num(r.cliente_escreveu), respondidos: num(r.respondidos),
    medianaRespostaMin: numOuNulo(r.mediana_resposta_min), ate1h: num(r.ate_1h), semResposta24h: num(r.sem_resposta_24h),
    medianaEnviadas: numOuNulo(r.mediana_enviadas),
  }
}

// ---------------------------------------------------------------------------
// Réguas
// ---------------------------------------------------------------------------

/** Abaixo disto, a taxa de um canal/anúncio é ruído: mostra, mas sem selo. */
export const AMOSTRA_MIN_MKT = 20

/** Um anúncio só recebe decisão de verba com volume: 100 contatos OU R$ 1.000 gastos no período. */
export const JULGAVEL_CONTATOS = 100
export const JULGAVEL_GASTO = 1000

export type SeloMkt = 'acima' | 'media' | 'abaixo' | 'pouco' | 'sem_fone'

/**
 * Selo da taxa de orçamento contra uma média, pela margem de erro de 95%: só é melhor ou pior quando
 * a margem inteira fica de um lado da média.
 */
export function seloProposta(r: Pick<FonteMkt, 'leads' | 'rastreaveis' | 'icMin' | 'icMax'>, media: number | null): SeloMkt {
  if (r.leads > 0 && r.rastreaveis / r.leads < 0.5) return 'sem_fone'
  if (r.rastreaveis < AMOSTRA_MIN_MKT || media == null || r.icMin == null || r.icMax == null) return 'pouco'
  if (r.icMin > media) return 'acima'
  if (r.icMax < media) return 'abaixo'
  return 'media'
}

export const SELO_TEXTO: Record<SeloMkt, string> = {
  acima: 'Melhor que a média',
  media: 'Igual à média',
  abaixo: 'Pior que a média',
  pouco: 'Pouco volume',
  sem_fone: 'Sem telefone',
}

export const SELO_AJUDA: Record<SeloMkt, string> = {
  acima: 'Gera mais orçamento que a média mesmo no pior caso da margem de erro.',
  media: 'A diferença para a média cabe na margem de erro: pode ser acaso.',
  abaixo: 'Gera menos orçamento que a média mesmo no melhor caso da margem de erro.',
  pouco: `Menos de ${AMOSTRA_MIN_MKT} contatos com telefone: a taxa ainda não diz nada.`,
  sem_fone: 'Menos da metade deixa telefone (Messenger, Instagram Direct): orçamento não se liga ao canal.',
}

export const taxa = (parte: number, todo: number) => (todo > 0 ? (100 * parte) / todo : null)

/** "&90 · Mini fábrica de ração" */
export function rotuloCriativo(codigo: string, nome: string | null): string {
  const n = (nome ?? '').trim()
  if (!n) return codigo
  if (n.startsWith('[')) return `${codigo} · ${n}`
  return `${codigo} · ${n.charAt(0) + n.slice(1).toLowerCase()}`
}

const brlCurto = (v: number) => (v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`
  : v >= 10_000 ? `R$ ${(v / 1_000).toFixed(1).replace('.', ',')} mil` : `R$ ${Math.round(v).toLocaleString('pt-BR')}`)
const pctTxt = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)
const dec1 = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','))
const minTxt = (m: number | null) => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1).replace('.', ',')} h`)
export { brlCurto, minTxt }

// ---------------------------------------------------------------------------
// Anúncio com gasto e decisão
// ---------------------------------------------------------------------------

export type DecisaoMkt = 'subir' | 'testar' | 'manter' | 'esperar' | 'cortar' | 'fora'

export const DECISAO_TEXTO: Record<DecisaoMkt, string> = {
  subir: 'Subir verba',
  testar: 'Testar com mais verba',
  manter: 'Manter',
  esperar: 'Esperar volume',
  cortar: 'Cortar ou refazer',
  fora: 'Não é de venda',
}

/** Sumiu = etiqueta NUNCA RESPONDEU ou NÃO RESPONDEU MAIS. */
export const sumiuDe = (f: FonteMkt) => f.nunca + f.sumiu

export interface AnuncioMkt {
  codigo: string
  nome: string | null
  campanhas: string | null
  fonte: FonteMkt | null
  gasto: number
  contatos: number
  orcamentos: number
  porCem: number | null
  custoContato: number | null
  custoOrcamento: number | null
  selo: SeloMkt
  decisao: DecisaoMkt
  porque: string
}

export interface ReguaMeta {
  /** base do custo médio: gasto dos anúncios com código que tiveram contato, e os orçamentos deles */
  gastoComCodigo?: number
  orcComCodigo?: number
  /** orçamentos a cada 100 contatos do canal Meta ADS (WhatsApp) */
  mediaPor100: number | null
  /** gasto dos anúncios com código ÷ orçamentos desses anúncios */
  custoOrcamento: number | null
  /** % de contatos do Meta que sumiram */
  sumiuPct: number | null
  /** % de contatos do Meta que pediram o que não fabricamos */
  naoFabPct: number | null
}

export function decidir(a: Omit<AnuncioMkt, 'decisao' | 'porque'>, r: ReguaMeta): { decisao: DecisaoMkt; porque: string } {
  if (a.campanhas && /vaga|emprego/i.test(a.campanhas)) return { decisao: 'fora', porque: 'Campanha de vaga de emprego.' }
  const julgavel = a.contatos >= JULGAVEL_CONTATOS || a.gasto >= JULGAVEL_GASTO
  if (!julgavel) {
    // Pequeno mas promissor: não fica parado esperando volume que ninguém vai dar.
    const barato = a.custoOrcamento != null && r.custoOrcamento != null && a.custoOrcamento <= 0.75 * r.custoOrcamento
    if (a.orcamentos >= 3 && (barato || a.selo === 'acima')) {
      return { decisao: 'testar', porque: `${a.orcamentos} orçamentos${a.custoOrcamento != null && r.custoOrcamento != null ? ` a ${brlCurto(a.custoOrcamento)} cada (média ${brlCurto(r.custoOrcamento)})` : ''}, mas ainda com pouco volume: levar a R$ ${JULGAVEL_GASTO.toLocaleString('pt-BR')} no período e reavaliar.` }
    }
    return { decisao: 'esperar', porque: `Ainda não tem ${JULGAVEL_CONTATOS} contatos nem R$ ${JULGAVEL_GASTO.toLocaleString('pt-BR')} gastos.` }
  }
  const f = a.fonte
  const sumiuPct = f ? taxa(sumiuDe(f), f.leads) : null
  const custoBom = a.custoOrcamento != null && r.custoOrcamento != null && a.custoOrcamento <= 0.75 * r.custoOrcamento
  const custoRuim = a.custoOrcamento != null && r.custoOrcamento != null && a.custoOrcamento >= 2 * r.custoOrcamento
  if (a.selo === 'abaixo') return { decisao: 'cortar', porque: 'Gera menos orçamento que a média do Meta, mesmo descontando a margem de erro.' }
  if (a.gasto >= JULGAVEL_GASTO && a.orcamentos === 0) return { decisao: 'cortar', porque: `${brlCurto(a.gasto)} gastos e nenhum orçamento.` }
  if (custoRuim) return { decisao: 'cortar', porque: `Cada orçamento custa ${brlCurto(a.custoOrcamento!)}, mais que o dobro da média (${brlCurto(r.custoOrcamento!)}).` }
  const sumiuOk = sumiuPct == null || r.sumiuPct == null || sumiuPct <= r.sumiuPct * 1.1
  if (a.orcamentos >= 3 && (a.selo === 'acima' || custoBom) && sumiuOk) {
    return {
      decisao: 'subir',
      porque: a.selo === 'acima'
        ? `${dec1(a.porCem)} orçamentos a cada 100 contatos, acima da média do Meta (${dec1(r.mediaPor100)}) mesmo descontando a margem de erro.`
        : `Cada orçamento custa ${brlCurto(a.custoOrcamento!)}, bem abaixo da média (${brlCurto(r.custoOrcamento!)}).`,
    }
  }
  if (!sumiuOk && sumiuPct != null) {
    return { decisao: 'manter', porque: `Manter a verba: o anúncio traz orçamento na média, mas ${Math.round(sumiuPct)}% dos contatos sumiram (média do Meta ${Math.round(r.sumiuPct!)}%) — cobrar o atendimento, não o anúncio.` }
  }
  return { decisao: 'manter', porque: 'Dentro da média: nem melhor nem pior de forma clara.' }
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface Destaque { chave: string; texto: string; tom: 'bom' | 'ruim' | 'neutro' }

export interface RelatorioMkt {
  total: FonteMkt | null
  canais: FonteMkt[]
  meta: FonteMkt | null
  regua: ReguaMeta
  anuncios: AnuncioMkt[]
  gastoTotal: number | null
  gastoSemCodigo: number
  anunciosSemCodigo: number
  gastoCarregadoAte: string | null
  vendasTotal: VendaMkt | null
  vendasGrupo: VendaMkt[]
  vendasOrigem: VendaMkt[]
  vendasCriativo: VendaMkt[]
  vendedores: VendedorMkt[]
  destaques: Destaque[]
  tarefasTrafego: string[]
  tarefasVendas: string[]
  /** período termina hoje: motivos e "sumiu" ainda vão crescer */
  emAndamento: boolean
}

const META_CANAL = 'Meta ADS (WhatsApp)'
const ORDEM_DECISAO: Record<DecisaoMkt, number> = { subir: 0, testar: 1, cortar: 2, manter: 3, esperar: 4, fora: 5 }

/** Espelho do WhatsApp do vendedor não chega ao banco: não dá para medir resposta. */
export const semEspelho = (v: VendedorMkt) => v.contatos >= 10 && (v.medianaEnviadas ?? 0) === 0

/** Contatos e "sumiu" somados só dos vendedores que etiquetam (base da média do time). */
export function sumiuDoTime(vs: VendedorMkt[], emAndamento = false): { c: number; s: number } {
  return vs.filter(v => v.contatos >= 10 && (emAndamento || !poucaEtiqueta(v))).reduce((t, v) => ({ c: t.c + v.contatos, s: t.s + v.sumiu }), { c: 0, s: 0 })
}

/** Menos de 5% de "sumiu" com 30+ contatos = o vendedor quase não marca etiqueta de perda (não é mérito). */
export const poucaEtiqueta = (v: VendedorMkt) => v.contatos >= 30 && (taxa(v.sumiu, v.contatos) ?? 0) < 5

export function montarRelatorio(
  fontes: FonteMkt[], vendas: VendaMkt[], gastos: GastoLinhaMkt[] = [], vendedores: VendedorMkt[] = [],
  opts: { emAndamento?: boolean } = {},
): RelatorioMkt {
  // Período que termina hoje: o vendedor ainda não encerrou (nem etiquetou) boa parte dos contatos,
  // então "sumiu" baixo não quer dizer que ele não etiqueta.
  const emAndamento = !!opts.emAndamento
  const poucaEtq = (v: VendedorMkt) => !emAndamento && poucaEtiqueta(v)
  const total = fontes.find(f => f.tipo === 'total') ?? null
  const canais = fontes.filter(f => f.tipo === 'canal' && f.leads > 0).sort((a, b) => b.leads - a.leads)
  const meta = canais.find(c => c.chave === META_CANAL) ?? null
  const criativos = fontes.filter(f => f.tipo === 'criativo')

  const gTotal = gastos.find(g => g.tipo === 'total') ?? null
  const gSem = gastos.find(g => g.tipo === 'sem_codigo') ?? null
  const gPorCod = new Map(gastos.filter(g => g.tipo === 'codigo' && g.codigo).map(g => [g.codigo!, g]))
  const temGasto = !!gTotal && gTotal.gasto > 0

  // Média de custo por orçamento: só anúncios com gasto E contato no CRM no mesmo período.
  let somaGasto = 0, somaOrc = 0
  for (const c of criativos) {
    const g = gPorCod.get(c.chave)
    if (g && g.gasto > 0) { somaGasto += g.gasto; somaOrc += c.comProposta }
  }
  const base = meta ?? total
  const regua: ReguaMeta = {
    gastoComCodigo: somaGasto, orcComCodigo: somaOrc,
    mediaPor100: base?.propPor100 ?? null,
    custoOrcamento: somaOrc > 0 ? somaGasto / somaOrc : null,
    sumiuPct: base ? taxa(sumiuDe(base), base.leads) : null,
    naoFabPct: base ? taxa(base.naoFabricamos, base.leads) : null,
  }

  const codigos = new Set([...criativos.map(c => c.chave), ...gPorCod.keys()])
  const anuncios: AnuncioMkt[] = []
  for (const cod of codigos) {
    const f = criativos.find(c => c.chave === cod) ?? null
    const g = gPorCod.get(cod)
    const gasto = g?.gasto ?? 0
    const contatos = f?.leads ?? 0
    if (contatos < 10 && gasto < 100) continue
    const orcamentos = f?.comProposta ?? 0
    // Sem nome no catálogo de criativos (LP, vaga): usa o nome da campanha no Meta.
    const nome = f?.nome ?? (g?.campanhas ? g.campanhas.split(' | ')[0] : null)
    const parcial = {
      codigo: cod, nome, campanhas: g?.campanhas ?? null, fonte: f, gasto, contatos, orcamentos,
      porCem: f?.propPor100 ?? null,
      custoContato: temGasto && contatos > 0 && gasto > 0 ? gasto / contatos : null,
      custoOrcamento: temGasto && orcamentos > 0 && gasto > 0 ? gasto / orcamentos : null,
      selo: f ? seloProposta(f, regua.mediaPor100) : 'pouco' as SeloMkt,
    }
    const d = decidir(parcial, temGasto ? regua : { ...regua, custoOrcamento: null })
    const venda = vendas.find(v => v.tipo === 'criativo' && v.chave === cod)
    if (d.decisao === 'cortar' && venda) {
      d.porque += ` Mas ${venda.vendas === 1 ? 'um pedido' : `${venda.vendas} pedidos`} de ${brlCurto(venda.valor)} fechado no período veio de contato antigo deste anúncio: refazer o criativo, não pausar de vez.`
    }
    const sp = f ? taxa(sumiuDe(f), f.leads) : null
    if (d.decisao === 'cortar' && sp != null && regua.sumiuPct != null && f && f.leads >= AMOSTRA_MIN_MKT && sp >= regua.sumiuPct * 1.1) {
      d.porque += ` E ${Math.round(sp)}% dos contatos sumiram (média ${Math.round(regua.sumiuPct)}%): parte da culpa é do atendimento.`
    }
    anuncios.push({ ...parcial, ...d })
  }
  anuncios.sort((a, b) => (ORDEM_DECISAO[a.decisao] - ORDEM_DECISAO[b.decisao]) || (b.gasto - a.gasto) || (b.contatos - a.contatos))

  const vendasTotal = vendas.find(v => v.tipo === 'total') ?? null
  const vendasGrupo = vendas.filter(v => v.tipo === 'grupo').sort((a, b) => b.valor - a.valor)
  const vendasOrigem = vendas.filter(v => v.tipo === 'origem').sort((a, b) => b.valor - a.valor)
  const vendasCriativo = vendas.filter(v => v.tipo === 'criativo').sort((a, b) => b.valor - a.valor)
  const vendOrd = [...vendedores].filter(v => v.contatos > 0).sort((a, b) => b.contatos - a.contatos)

  // ---- Em resumo ----
  const destaques: Destaque[] = []
  const media = total?.propPor100 ?? null
  const acima = canais.filter(c => seloProposta(c, media) === 'acima').sort((a, b) => (b.propPor100 ?? 0) - (a.propPor100 ?? 0))
  if (acima.length) {
    destaques.push({ chave: 'canal', tom: 'bom', texto: `Canais que trazem contato melhor: ${acima.map(c => `${c.chave} (${dec1(c.propPor100)} orçamentos a cada 100 contatos)`).join(', ')}. A média é ${dec1(media)}.` })
  } else if (canais.length) {
    destaques.push({ chave: 'canal', tom: 'neutro', texto: `Nenhum canal ficou claramente acima da média de ${dec1(media)} orçamentos a cada 100 contatos.` })
  }
  if (temGasto && gTotal) {
    destaques.push({ chave: 'verba', tom: 'neutro', texto: `Verba do Meta no período: ${brlCurto(gTotal.gasto)}${regua.custoOrcamento != null ? `, ${brlCurto(regua.custoOrcamento)} por orçamento nos anúncios com código` : ''}.${gSem && gSem.gasto > 0 ? ` ${brlCurto(gSem.gasto)} (${pctTxt(taxa(gSem.gasto, gTotal.gasto))}) foi em anúncios sem código &NN, que o CRM não consegue seguir.` : ''}` })
  }
  const sub = anuncios.filter(a => a.decisao === 'subir'), cor = anuncios.filter(a => a.decisao === 'cortar')
  if (sub.length) destaques.push({ chave: 'subir', tom: 'bom', texto: `Subir verba: ${sub.map(a => rotuloCriativo(a.codigo, a.nome)).join('; ')}.` })
  const tes = anuncios.filter(a => a.decisao === 'testar')
  if (tes.length) destaques.push({ chave: 'testar', tom: 'bom', texto: `Testar com mais verba (bom sinal, pouco volume): ${tes.map(a => rotuloCriativo(a.codigo, a.nome)).join('; ')}.` })
  if (cor.length) destaques.push({ chave: 'cortar', tom: 'ruim', texto: `Cortar ou refazer: ${cor.map(a => rotuloCriativo(a.codigo, a.nome)).join('; ')}.` })
  if (vendasTotal && vendasTotal.vendas > 0) {
    const net = vendasGrupo.find(g => g.chave.startsWith('Internet')), cart = vendasGrupo.find(g => g.chave.startsWith('Carteira'))
    destaques.push({ chave: 'venda', tom: 'neutro', texto: `${vendasTotal.vendas} pedidos fechados (${brlCurto(vendasTotal.valor)}), de contatos de qualquer época. Internet: ${net ? `${net.vendas} pedidos, ${pctTxt(taxa(net.valor, vendasTotal.valor))} do valor` : 'nenhum'}. Carteira e relacionamento (não é mídia): ${cart ? `${cart.vendas} pedidos, ${pctTxt(taxa(cart.valor, vendasTotal.valor))}` : 'nenhum'}.` })
  }
  const comVolume = anuncios.filter(a => a.fonte && a.contatos >= AMOSTRA_MIN_MKT)
  const maiorBoi = [...comVolume].filter(a => (a.fonte?.boi200 ?? 0) >= 3).sort((a, b) => b.fonte!.boi200 - a.fonte!.boi200)[0]
  if (maiorBoi) destaques.push({ chave: 'porte', tom: 'bom', texto: `Anúncio que mais traz produtor grande: ${rotuloCriativo(maiorBoi.codigo, maiorBoi.nome)}, ${maiorBoi.fonte!.boi200} com 200 cabeças de gado ou mais.` })

  // ---- Tarefas ----
  const tarefasTrafego: string[] = []
  for (const a of cor) tarefasTrafego.push(`${a.porque.includes('não pausar') ? 'Refazer' : 'Pausar ou refazer'} ${rotuloCriativo(a.codigo, a.nome)}: ${a.porque}`)
  for (const a of sub) tarefasTrafego.push(`Subir a verba de ${rotuloCriativo(a.codigo, a.nome)} em 20 a 30%, de 3 em 3 dias, enquanto o custo por orçamento segurar.`)
  for (const a of anuncios.filter(x => x.decisao === 'testar')) tarefasTrafego.push(`Testar ${rotuloCriativo(a.codigo, a.nome)} com mais verba: ${a.porque}`)
  const nfMedia = regua.naoFabPct ?? 0
  for (const a of comVolume) {
    const p = taxa(a.fonte!.naoFabricamos, a.contatos) ?? 0
    if (p >= Math.max(5, nfMedia * 2)) tarefasTrafego.push(`Rever a promessa e o público de ${rotuloCriativo(a.codigo, a.nome)}: ${pctTxt(p)} dos contatos pedem o que não fabricamos (média ${pctTxt(nfMedia)}).`)
  }
  for (const a of anuncios) {
    if (a.gasto >= 200 && a.contatos === 0 && a.decisao !== 'fora') tarefasTrafego.push(`Conferir ${a.codigo}: ${brlCurto(a.gasto)} gastos e nenhum contato com esse código no CRM (formulário ou landing page sem o código?).`)
  }
  if (temGasto && gSem && gTotal && gSem.gasto >= 0.1 * gTotal.gasto) {
    tarefasTrafego.push(`Pôr o código &NN no nome dos ${gSem.anuncios} anúncios que não têm: ${brlCurto(gSem.gasto)} (${pctTxt(taxa(gSem.gasto, gTotal.gasto))} da verba) não dá para medir.`)
  }
  const nuncaMed = total ? taxa(total.nunca, total.leads) ?? 0 : 0
  const parouMed = total ? taxa(total.sumiu, total.leads) ?? 0 : 0
  for (const c of canais) {
    if (c.leads < AMOSTRA_MIN_MKT) continue
    const nv = taxa(c.nunca, c.leads) ?? 0
    if (nv >= nuncaMed * 1.5 && nv - nuncaMed >= 10) tarefasTrafego.push(`${c.chave}: ${pctTxt(nv)} dos contatos nunca responderam (média ${pctTxt(nuncaMed)}) — conferir se o formulário/anúncio pega o telefone certo e se a promessa bate com o que o vendedor oferece.`)
  }
  const naoIdent = canais.find(c => c.chave === 'Não identificado')
  if (naoIdent && total && naoIdent.leads >= 0.1 * total.leads) {
    tarefasTrafego.push(`${naoIdent.leads} contatos (${pctTxt(taxa(naoIdent.leads, total.leads))}) chegaram sem origem: conferir o rastreio dos anúncios e das páginas.`)
  }

  const tarefasVendas: string[] = []
  for (const v of vendOrd) {
    const nome = nomeVendedor(v.vendedor)
    if (semEspelho(v)) { tarefasVendas.push(`${nome}: o WhatsApp dele não chega ao CRM — sem isso não dá para medir a resposta. Ligar o espelho.`); continue }
    if (v.clienteEscreveu < 10) continue
    const sem = taxa(v.semResposta24h, v.clienteEscreveu) ?? 0
    if (sem >= 20 || (v.medianaRespostaMin ?? 0) > 120) {
      tarefasVendas.push(`${nome}: responde em ${minTxt(v.medianaRespostaMin)} (mediana) e ${v.semResposta24h} de ${v.clienteEscreveu} clientes que escreveram ficaram mais de 24 h sem resposta.`)
    }
  }
  // Média do time só com quem etiqueta: quem quase não marca perda puxaria a média para baixo.
  const repass = sumiuDoTime(vendOrd, emAndamento)
  const sumiuTime = taxa(repass.s, repass.c)
  if (sumiuTime != null) {
    const ruins = vendOrd.filter(v => v.contatos >= 30 && !poucaEtq(v) && ((taxa(v.sumiu, v.contatos) ?? 0) >= sumiuTime * 1.25 || (taxa(v.sumiu, v.contatos) ?? 0) - sumiuTime >= 10))
    const melhor = [...vendOrd].filter(v => v.contatos >= 30 && !poucaEtq(v)).sort((a, b) => (taxa(a.sumiu, a.contatos) ?? 0) - (taxa(b.sumiu, b.contatos) ?? 0))[0]
    if (ruins.length) {
      tarefasVendas.push(`${ruins.map(v => `${nomeVendedor(v.vendedor)} (${pctTxt(taxa(v.sumiu, v.contatos))})`).join(' e ')} ${ruins.length === 1 ? 'perde' : 'perdem'} mais contatos repassados que a média do time (${pctTxt(sumiuTime)}): rever a abordagem e a cadência de retorno.${melhor ? ` ${nomeVendedor(melhor.vendedor)} perde só ${pctTxt(taxa(melhor.sumiu, melhor.contatos))} — usar a abordagem dele como modelo.` : ''}`)
    }
    const pe = vendOrd.filter(v => poucaEtq(v) && !semEspelho(v))
    if (pe.length) tarefasVendas.push(`${pe.map(v => nomeVendedor(v.vendedor)).join(', ')}: quase não ${pe.length === 1 ? 'marca' : 'marcam'} etiqueta de perda — sem isso não dá para saber quem sumiu nem por quê.`)
  }
  for (const c of canais) {
    if (c.leads < AMOSTRA_MIN_MKT) continue
    const pv = taxa(c.sumiu, c.leads) ?? 0
    if (pv >= parouMed * 1.5 && pv - parouMed >= 8) tarefasVendas.push(`${c.chave}: ${pctTxt(pv)} dos contatos pararam de responder no meio da conversa (média ${pctTxt(parouMed)}) — o contato é bom, a conversa é que esfria.`)
  }
  const manterSumiu = anuncios.filter(a => a.decisao === 'manter' && a.porque.startsWith('Manter a verba'))
  if (manterSumiu.length) tarefasVendas.push(`Contatos dos anúncios ${manterSumiu.map(a => a.codigo).join(', ')} estão sumindo mais que a média do Meta: o anúncio entrega, o atendimento é que perde.`)
  const semOrigem = vendasOrigem.find(o => o.chave === 'Não informado no pedido')
  if (semOrigem && vendasTotal) tarefasVendas.push(`Marcar a origem no pedido: ${semOrigem.vendas} de ${vendasTotal.vendas} pedidos (${brlCurto(semOrigem.valor)}) saíram sem dizer de onde veio o cliente.`)
  if (sumiuTime != null && sumiuTime >= 15) {
    tarefasVendas.push(`${repass.s} de ${repass.c} contatos repassados (${pctTxt(sumiuTime)}${emAndamento ? '' : ', entre os vendedores que etiquetam'}) sumiram: revisar a cadência de retorno (ligação + áudio) antes de pôr mais verba.`)
  }

  return {
    total, canais, meta, regua, anuncios,
    gastoTotal: temGasto ? gTotal!.gasto : null,
    gastoSemCodigo: gSem?.gasto ?? 0, anunciosSemCodigo: gSem?.anuncios ?? 0,
    gastoCarregadoAte: gTotal?.carregadoAte ?? null,
    vendasTotal, vendasGrupo, vendasOrigem, vendasCriativo,
    vendedores: vendOrd, destaques, tarefasTrafego, tarefasVendas, emAndamento,
  }
}

export function nomeVendedor(v: string): string {
  return v.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase())
}

/** Fatias do "por que fecha", na ordem da barra. */
export const MOTIVOS_MKT: { campo: keyof FonteMkt; rotulo: string; cor: string }[] = [
  { campo: 'nunca', rotulo: 'Nunca respondeu', cor: '#94a3b8' },
  { campo: 'sumiu', rotulo: 'Parou de responder', cor: '#cbd5e1' },
  { campo: 'preco', rotulo: 'Só preço / fora do orçamento', cor: '#f59e0b' },
  { campo: 'naoFabricamos', rotulo: 'Pediu o que não fabricamos', cor: '#ef4444' },
  { campo: 'foraEscopo', rotulo: 'Outro assunto (suporte, frete, etc.)', cor: '#fca5a5' },
  { campo: 'concorrente', rotulo: 'Comprou do concorrente', cor: '#8b5cf6' },
  { campo: 'semInteresse', rotulo: 'Sem interesse', cor: '#64748b' },
]
