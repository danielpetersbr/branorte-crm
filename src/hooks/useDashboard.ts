import { useQuery } from '@tanstack/react-query'
import { supabaseAuditoria } from '@/lib/supabase'
import { ufFromTelefone, paisDoTelefone } from '@/lib/ddd-uf'

const DASHBOARD_LIMIT = 5000
const META_MENSAL_REAIS = 2_000_000

export type DashboardPreset = '' | 'hoje' | 'ontem' | '7d' | '30d' | 'mes'

export interface DashboardFilters {
  preset: DashboardPreset
}

// Nome dos estados BR + paises principais
const UF_NOMES: Record<string, string> = {
  AC: 'Acre',           AL: 'Alagoas',          AM: 'Amazonas',           AP: 'Amapá',
  BA: 'Bahia',          CE: 'Ceará',            DF: 'Distrito Federal',   ES: 'Espírito Santo',
  GO: 'Goiás',          MA: 'Maranhão',         MG: 'Minas Gerais',       MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',    PA: 'Pará',             PB: 'Paraíba',            PE: 'Pernambuco',
  PI: 'Piauí',          PR: 'Paraná',           RJ: 'Rio de Janeiro',     RN: 'Rio Grande do Norte',
  RO: 'Rondônia',       RR: 'Roraima',          RS: 'Rio Grande do Sul',  SC: 'Santa Catarina',
  SE: 'Sergipe',        SP: 'São Paulo',        TO: 'Tocantins',
  AR: 'Argentina',      PY: 'Paraguai',         UY: 'Uruguai',            CL: 'Chile',
  CO: 'Colômbia',       BO: 'Bolívia',          EC: 'Equador',
  VE: 'Venezuela',      US: 'EUA/Canadá',       PT: 'Portugal',
  MX: 'México',         DE: 'Alemanha',         FR: 'França',             IT: 'Itália',
  GB: 'Reino Unido',    INTL: 'Internacional',  SEM: 'Sem origem',
}
const PAIS_SIGLAS = new Set(['AR', 'PY', 'UY', 'CL', 'CO', 'BO', 'EC', 'VE', 'US', 'PT', 'MX', 'DE', 'FR', 'IT', 'GB', 'INTL'])

interface RawRow {
  id: string
  nome: string | null
  telefone: string | null
  responsavel: string | null
  criativo_codigo: string | null
  criativo_facebook: { codigo: string; nome_oficial: string | null; headline: string | null } | null
  origem: string | null
  motivo_contato: string | null
  finalidade_fabrica: string | null
  qual_animal: string | null
  quantos_animais: string | null
  capacidade_producao: string | null
  quando_investir: string | null
  tocou_botao_em: string | null
  data: string | null
  ultima_msg: string | null
  last_message_at: string | null
  is_internal: boolean | null
  // Campos pos-bot (vendas)
  chegou_no_vendedor: boolean | null
  orcamento_enviado: boolean | null
  orcamento_valor: number | null
  status_real: string | null
  status_vendedor: string | null
  finished_at: string | null
}

function stripEmoji(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normAnimal(v: string | null | undefined): string | null {
  const s = stripEmoji(v).toLowerCase()
  if (!s) return null
  if (/bovin|gado|boi|vaca/.test(s)) return 'Bovinos'
  if (/su[íi]n|porco/.test(s)) return 'Suínos'
  if (/ave|frango|galinha/.test(s)) return 'Aves'
  return null
}

function normFinalidade(v: string | null | undefined): string | null {
  const s = stripEmoji(v).toLowerCase()
  if (!s) return null
  if (/consumo.*vender|vender.*consumo|ambos/.test(s)) return 'Consumo e vender'
  if (/vender|venda/.test(s)) return 'Para vender'
  if (/consumo|próprio|proprio/.test(s)) return 'Para consumo'
  return stripEmoji(v)
}

function normQuando(v: string | null | undefined): 'Agora' | 'Em até 3 meses' | 'Pesquisando' | null {
  const s = stripEmoji(v).toLowerCase()
  if (!s) return null
  if (/agora|hoje|imediat/.test(s)) return 'Agora'
  if (/3\s*mes|três|tres|próximo|proximo/.test(s)) return 'Em até 3 meses'
  if (/pesquis|estudando|avaliando|olhando/.test(s)) return 'Pesquisando'
  return null
}

function normOrigem(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  if (!s) return 'Sem origem'
  if (/^instagram/i.test(s)) return 'Instagram'
  if (/whatsapp.*4502|wa.*4502/i.test(s)) return 'WhatsApp 4502'
  if (/whatsapp.*1144|wa.*1144/i.test(s)) return 'WhatsApp 1144'
  if (/whatsapp/i.test(s)) return 'WhatsApp'
  return s
}

function normalizedOrigemRaw(v: string | null | undefined): string | null {
  const o = normOrigem(v)
  return o === 'Sem origem' ? null : o
}

function ufFrom(tel: string | null): string {
  if (!tel) return 'SEM'
  const pais = paisDoTelefone(tel)
  if (pais) return pais.sigla
  return ufFromTelefone(tel)
}

function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  return iso.slice(0, 10)
}

function hourOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getHours()
}

function weekdayOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getDay()
}

function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0) }
function endOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999) }

interface DateRange { from: Date; to: Date }

function rangeForPreset(preset: DashboardPreset, now: Date): DateRange | null {
  if (!preset) return null
  if (preset === 'hoje') return { from: startOfDay(now), to: endOfDay(now) }
  if (preset === 'ontem') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { from: startOfDay(y), to: endOfDay(y) }
  }
  if (preset === '7d') {
    const f = new Date(now); f.setDate(f.getDate() - 6)
    return { from: startOfDay(f), to: endOfDay(now) }
  }
  if (preset === '30d') {
    const f = new Date(now); f.setDate(f.getDate() - 29)
    return { from: startOfDay(f), to: endOfDay(now) }
  }
  if (preset === 'mes') {
    return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(now) }
  }
  return null
}

// Janela "anterior" pro delta (mesma duracao, deslocada pra tras)
function previousRange(r: DateRange | null): DateRange | null {
  if (!r) return null
  const ms = r.to.getTime() - r.from.getTime()
  return {
    from: new Date(r.from.getTime() - ms - 1),
    to: new Date(r.from.getTime() - 1),
  }
}

function inRange(iso: string | null | undefined, r: DateRange | null): boolean {
  if (!r) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= r.from.getTime() && t <= r.to.getTime()
}

// ============================================================================
// TIPOS PUBLICOS
// ============================================================================

export interface KpiSerie {
  valor: number
  anterior: number
  deltaPct: number     // % de mudanca vs periodo anterior. Positivo = melhorou.
  sparkline: number[]  // 14 pontos
}

export interface FunilEtapa {
  etapa: string
  valor: number
  pctTopo: number
  pctAnterior: number
  perdidos: number     // quantos sumiram da etapa anterior
}

export interface LeadAging {
  faixa: string
  leads: number
  valor: number  // soma orcamento_valor (R$)
}

export interface SlaVendedor {
  vendedor: string
  pendentes: number      // leads sem chegou_no_vendedor=true
  idadeMediaHoras: number
  totalLeads: number
  qualificados: number
  orcamentos: number
  vendidos: number
  winRate: number       // % vendidos / total
}

export interface LeadEmRisco {
  id: string
  nome: string | null
  telefone: string | null
  vendedor: string | null
  horasSemResposta: number
  valor: number | null
  momento: string | null
}

export interface DashboardData {
  totalLeads: number
  leadsBotNovo: number
  // KPIs com tendencia
  kpiTotal: KpiSerie
  kpiHoje: KpiSerie
  kpiQuentes: KpiSerie
  kpiQualificados: KpiSerie
  kpiBotao: KpiSerie
  // Funil do bot
  funil: FunilEtapa[]
  // Funil real pos-bot
  funilReal: FunilEtapa[]
  // Series temporais
  leadsPorDia: { dia: string; total: number; qualificados: number }[]
  // Distribuicoes
  porCriativo: { codigo: string; nome: string; total: number; qualificados: number; ctr: number }[]
  porOrigem: { origem: string; total: number; qualificados: number; ctr: number }[]
  porMomento: { momento: string; valor: number; cor: string }[]
  porUf: { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }[]
  // Operacionais
  leadAging: LeadAging[]
  slaPorVendedor: SlaVendedor[]
  leadsEmRisco: LeadEmRisco[]
  forecast: {
    vendidoMes: number
    pedidosMes: number
    diaDoMes: number
    diasNoMes: number
    ritmoDia: number
    projecao: number
    meta: number
    pctMeta: number
    pctProjecao: number
  }
  // (mantidos pra /analytics)
  porAnimalFinalidade: { animal: string; vender: number; consumo: number; ambos: number; total: number }[]
  diaXHora: { weekday: number; hour: number; valor: number }[]
  qualidade: { completos: number; parciais: number; vazios: number; pctCompleto: number }
}

// ============================================================================
// HOOK
// ============================================================================

export function useDashboard(filters: DashboardFilters = { preset: '' }) {
  return useQuery({
    queryKey: ['dashboard-data-v2', filters],
    queryFn: async (): Promise<DashboardData> => {
      const { data, error } = await supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select(
          'id, nome, telefone, responsavel, criativo_codigo, criativo_facebook, origem, motivo_contato, finalidade_fabrica, qual_animal, quantos_animais, capacidade_producao, quando_investir, tocou_botao_em, data, ultima_msg, last_message_at, is_internal, chegou_no_vendedor, orcamento_enviado, orcamento_valor, status_real, status_vendedor, finished_at'
        )
        .eq('is_internal', false)
        .order('data', { ascending: false, nullsFirst: false })
        .limit(DASHBOARD_LIMIT)

      if (error) throw error
      const rows = (data ?? []) as RawRow[]
      return aggregate(rows, filters.preset)
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
  })
}

// ============================================================================
// AGREGADOR
// ============================================================================

function aggregate(rows: RawRow[], preset: DashboardPreset): DashboardData {
  const now = new Date()
  const range = rangeForPreset(preset, now)
  const prev = previousRange(range)
  const todayIso = now.toISOString().slice(0, 10)

  // Filtra rows pra periodo atual usando ATIVIDADE (last_message_at).
  // Isso alinha com /atendimentos. Lead antigo que voltou a falar hoje conta como "Hoje".
  const filtered = range ? rows.filter(r => inRange(r.last_message_at ?? r.data, range)) : rows
  const filteredPrev = prev ? rows.filter(r => inRange(r.last_message_at ?? r.data, prev)) : []

  // ============================ KPIs com tendencia =========================
  const computeKpis = (rs: RawRow[]) => {
    let hoje = 0, quentes = 0, qualificados = 0, tocouBotaoKpi = 0
    for (const r of rs) {
      // "Hoje" = teve atividade hoje (last_message_at), nao chegada (data)
      const ativIso = r.last_message_at ?? r.data
      const day = dayKey(ativIso)
      if (day === todayIso) hoje++
      const fin = normFinalidade(r.finalidade_fabrica)
      const animal = normAnimal(r.qual_animal)
      const qtd = r.quantos_animais?.trim() || null
      const momento = normQuando(r.quando_investir)
      if (momento === 'Agora') quentes++
      if (fin && animal && qtd && momento) qualificados++
      // Tocou no botao = tocou em qualquer momento (nao exige qualificar antes)
      if (r.tocou_botao_em) tocouBotaoKpi++
    }
    return { total: rs.length, hoje, quentes, qualificados, tocouBotaoKpi }
  }

  const cur = computeKpis(filtered)
  const prevK = computeKpis(filteredPrev)

  // Sparklines: 14 pontos do periodo. Se nao tem range, ultimos 14 dias.
  const sparkRange = range ?? { from: new Date(now.getTime() - 13 * 86400000), to: now }
  const sparkSeries = buildSparkSeries(rows, sparkRange, 14)

  const mkKpi = (vAtual: number, vAnterior: number, key: keyof typeof sparkSeries): KpiSerie => {
    const deltaPct = vAnterior > 0 ? ((vAtual - vAnterior) / vAnterior) * 100 : (vAtual > 0 ? 100 : 0)
    return { valor: vAtual, anterior: vAnterior, deltaPct, sparkline: sparkSeries[key] }
  }

  const kpiTotal = mkKpi(cur.total, prevK.total, 'total')
  const kpiHoje = mkKpi(cur.hoje, prevK.hoje, 'hoje')
  const kpiQuentes = mkKpi(cur.quentes, prevK.quentes, 'quentes')
  const kpiQualificados = mkKpi(cur.qualificados, prevK.qualificados, 'qualificados')
  const kpiBotao = mkKpi(cur.tocouBotaoKpi, prevK.tocouBotaoKpi, 'botao')

  // ============================ Restante (sobre `filtered`) ================

  const total = filtered.length
  let entrouNoBot = 0, clicouMotivo = 0, escolheuFinalidade = 0
  let escolheuAnimal = 0, escolheuQtd = 0, escolheuMomento = 0, tocouBotao = 0
  let leadsBotNovo = 0
  let comTelefone = 0
  let qualificadosTotal = 0
  let qualificadosBotNovo = 0   // qualificou + entrou via bot novo (topo do funil real)
  let chegouVendedorTotal = 0
  let orcamentoEnviadoTotal = 0
  let vendidoTotal = 0

  const byDay = new Map<string, { total: number; qualificados: number }>()
  const byCriativo = new Map<string, { codigo: string; nome: string; total: number; qualificados: number }>()
  const byOrigem = new Map<string, { total: number; qualificados: number }>()
  const byVendor = new Map<string, {
    vendedor: string; total: number; qualificados: number;
    chegouVendedor: number; orcamentos: number; vendidos: number;
    pendentes: number; idadesHoras: number[];
  }>()
  const byMomento = new Map<string, number>()
  const byAnimalFinalidade = new Map<string, { animal: string; vender: number; consumo: number; ambos: number; total: number }>()
  const byUf = new Map<string, number>()
  const byDayHour = new Map<string, number>()

  // Lead aging buckets
  let aging24 = 0, aging48 = 0, aging7d = 0, agingMais = 0
  let agingValor24 = 0, agingValor48 = 0, agingValor7d = 0, agingValorMais = 0

  // Lead em risco (top 5)
  const candidatosRisco: LeadEmRisco[] = []

  // Forecast — sempre calcula sobre rows TOTAIS (independente do filter)
  const startMes = new Date(now.getFullYear(), now.getMonth(), 1)
  let vendidoMes = 0
  let pedidosMes = 0
  for (const r of rows) {
    if ((r.status_real || '').toLowerCase().includes('vendid')) {
      const dt = r.finished_at || r.data
      if (dt && new Date(dt) >= startMes) {
        vendidoMes += r.orcamento_valor || 0
        pedidosMes++
      }
    }
  }
  const diaDoMes = now.getDate()
  const diasNoMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const ritmoDia = diaDoMes > 0 ? vendidoMes / diaDoMes : 0
  const projecao = ritmoDia * diasNoMes

  // Janela 30d pra serie temporal de "leads por dia"
  const start30 = new Date(now); start30.setDate(start30.getDate() - 29); start30.setHours(0, 0, 0, 0)
  const start30Iso = start30.toISOString().slice(0, 10)

  let completos = 0, parciais = 0, vazios = 0

  for (const r of filtered) {
    const created = r.data
    const day = dayKey(created)

    if (r.telefone && r.telefone.trim() !== '') comTelefone++

    const motivo = r.motivo_contato?.trim() || null
    const fin = normFinalidade(r.finalidade_fabrica)
    const animal = normAnimal(r.qual_animal)
    const qtd = r.quantos_animais?.trim() || null
    const momento = normQuando(r.quando_investir)
    const botao = !!r.tocou_botao_em

    const isBotNovo = !!normalizedOrigemRaw(r.origem)
    if (isBotNovo) leadsBotNovo++

    if (isBotNovo) {
      entrouNoBot++
      if (motivo) clicouMotivo++
      if (motivo && fin) escolheuFinalidade++
      if (motivo && fin && animal) escolheuAnimal++
      if (motivo && fin && animal && qtd) escolheuQtd++
      if (motivo && fin && animal && qtd && momento) escolheuMomento++
      // Botao final exige TODAS as etapas anteriores — funil monotonico
      if (motivo && fin && animal && qtd && momento && botao) tocouBotao++
    }

    const isQualificado = !!fin && !!animal && !!qtd && !!momento
    if (isQualificado) qualificadosTotal++
    // Funil pos-bot — so conta leads do bot novo (origem preenchida) que qualificaram.
    // Sem isso, mistura leads antigos do Digisac onde chegou_no_vendedor ja era true.
    if (isBotNovo && isQualificado) qualificadosBotNovo++
    if (isBotNovo && isQualificado && r.chegou_no_vendedor) chegouVendedorTotal++
    if (isBotNovo && isQualificado && r.orcamento_enviado) orcamentoEnviadoTotal++
    if (isBotNovo && isQualificado && r.status_vendedor === 'fechou') vendidoTotal++

    // Qualidade
    const camposPreenchidos = [motivo, fin, animal, qtd, momento, botao].filter(Boolean).length
    if (camposPreenchidos === 0) vazios++
    else if (camposPreenchidos >= 5) completos++
    else parciais++

    // Series por dia (ultimos 30)
    if (day && day >= start30Iso) {
      const cd = byDay.get(day) ?? { total: 0, qualificados: 0 }
      cd.total++
      if (isQualificado) cd.qualificados++
      byDay.set(day, cd)
    }

    if (r.criativo_codigo) {
      const codigo = r.criativo_codigo
      const nome = r.criativo_facebook?.nome_oficial ?? r.criativo_facebook?.headline ?? '—'
      const cc = byCriativo.get(codigo) ?? { codigo, nome, total: 0, qualificados: 0 }
      cc.total++
      if (isQualificado) cc.qualificados++
      if (!cc.nome || cc.nome === '—') cc.nome = nome
      byCriativo.set(codigo, cc)
    }

    const origem = normOrigem(r.origem)
    const oc = byOrigem.get(origem) ?? { total: 0, qualificados: 0 }
    oc.total++
    if (isQualificado) oc.qualificados++
    byOrigem.set(origem, oc)

    // Vendedor (apenas com responsavel preenchido)
    const vendedor = r.responsavel?.trim() || null
    if (vendedor) {
      const vc = byVendor.get(vendedor) ?? {
        vendedor, total: 0, qualificados: 0, chegouVendedor: 0,
        orcamentos: 0, vendidos: 0, pendentes: 0, idadesHoras: [],
      }
      vc.total++
      if (isQualificado) vc.qualificados++
      if (r.chegou_no_vendedor) vc.chegouVendedor++
      if (r.orcamento_enviado) vc.orcamentos++
      if ((r.status_real || '').toLowerCase().includes('vendid')) vc.vendidos++

      // Pendente = qualificou mas vendedor ainda não chegou no lead (sem first reply)
      if (isQualificado && !r.chegou_no_vendedor) {
        vc.pendentes++
        const ageMs = r.last_message_at ? now.getTime() - new Date(r.last_message_at).getTime() : 0
        if (ageMs > 0) vc.idadesHoras.push(ageMs / 3600000)
      }
      byVendor.set(vendedor, vc)
    }

    if (momento) byMomento.set(momento, (byMomento.get(momento) ?? 0) + 1)
    else byMomento.set('Não respondeu', (byMomento.get('Não respondeu') ?? 0) + 1)

    if (animal) {
      const cur = byAnimalFinalidade.get(animal) ?? { animal, vender: 0, consumo: 0, ambos: 0, total: 0 }
      cur.total++
      if (fin === 'Para vender') cur.vender++
      else if (fin === 'Para consumo') cur.consumo++
      else if (fin === 'Consumo e vender') cur.ambos++
      byAnimalFinalidade.set(animal, cur)
    }

    const uf = ufFrom(r.telefone)
    byUf.set(uf, (byUf.get(uf) ?? 0) + 1)

    const wd = weekdayOf(created)
    const hr = hourOf(created)
    if (wd !== null && hr !== null) {
      byDayHour.set(`${wd}-${hr}`, (byDayHour.get(`${wd}-${hr}`) ?? 0) + 1)
    }

    // Lead aging — leads ATIVOS (status nao Vendido/Perdido) sem resposta recente
    const status = (r.status_real || '').toLowerCase()
    const isAtivo = !status.includes('vendid') && !status.includes('perdid')
    if (isAtivo && r.last_message_at) {
      const ageH = (now.getTime() - new Date(r.last_message_at).getTime()) / 3600000
      const valor = r.orcamento_valor || 0
      if (ageH >= 24 && ageH < 48) { aging24++; agingValor24 += valor }
      else if (ageH >= 48 && ageH < 168) { aging48++; agingValor48 += valor }
      else if (ageH >= 168 && ageH < 720) { aging7d++; agingValor7d += valor }
      else if (ageH >= 720) { agingMais++; agingValorMais += valor }

      // Lead em risco = quente OU com orcamento + sem resposta > 24h
      const eQuente = momento === 'Agora'
      if ((eQuente || valor > 0) && ageH > 24) {
        candidatosRisco.push({
          id: r.id,
          nome: r.nome,
          telefone: r.telefone,
          vendedor,
          horasSemResposta: ageH,
          valor: valor || null,
          momento,
        })
      }
    }
  }

  // ============================ Funil do bot ============================
  const funilRaw = [
    { etapa: 'Entrou no bot',       valor: entrouNoBot },
    { etapa: 'Clicou motivo',       valor: clicouMotivo },
    { etapa: 'Escolheu finalidade', valor: escolheuFinalidade },
    { etapa: 'Escolheu animal',     valor: escolheuAnimal },
    { etapa: 'Escolheu qtd',        valor: escolheuQtd },
    { etapa: 'Escolheu momento',    valor: escolheuMomento },
    { etapa: 'Tocou botão final',   valor: tocouBotao },
  ]
  const topo = funilRaw[0].valor || 1
  const funil: FunilEtapa[] = funilRaw.map((e, i) => {
    const previo = i > 0 ? funilRaw[i - 1].valor : e.valor
    return {
      etapa: e.etapa,
      valor: e.valor,
      pctTopo: (e.valor / topo) * 100,
      pctAnterior: previo > 0 ? (e.valor / previo) * 100 : 0,
      perdidos: i > 0 ? Math.max(0, previo - e.valor) : 0,
    }
  })

  // ============================ Funil REAL pos-bot ============================
  // Topo = leads do bot novo que qualificaram. Etapas seguintes sao subset disso.
  const funilRealRaw = [
    { etapa: 'Qualificou',          valor: qualificadosBotNovo },
    { etapa: 'Chegou no vendedor',  valor: chegouVendedorTotal },
    { etapa: 'Orçamento enviado',   valor: orcamentoEnviadoTotal },
    { etapa: 'Fechou',              valor: vendidoTotal },
  ]
  const topoReal = funilRealRaw[0].valor || 1
  const funilReal: FunilEtapa[] = funilRealRaw.map((e, i) => {
    const previo = i > 0 ? funilRealRaw[i - 1].valor : e.valor
    return {
      etapa: e.etapa,
      valor: e.valor,
      pctTopo: (e.valor / topoReal) * 100,
      pctAnterior: previo > 0 ? (e.valor / previo) * 100 : 0,
      perdidos: i > 0 ? Math.max(0, previo - e.valor) : 0,
    }
  })

  // ============================ Series temporais ============================
  const allDays: { dia: string; total: number; qualificados: number }[] = []
  const cursor = new Date(start30)
  for (let i = 0; i < 30; i++) {
    const k = cursor.toISOString().slice(0, 10)
    const d = byDay.get(k) ?? { total: 0, qualificados: 0 }
    allDays.push({ dia: k, total: d.total, qualificados: d.qualificados })
    cursor.setDate(cursor.getDate() + 1)
  }
  const firstActive = allDays.findIndex(d => d.total > 0)
  const leadsPorDia = firstActive >= 0 ? allDays.slice(firstActive) : allDays

  const porCriativo = Array.from(byCriativo.values())
    .map(c => ({ ...c, ctr: c.total > 0 ? (c.qualificados / c.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  const porOrigem = Array.from(byOrigem.entries())
    .filter(([origem]) => origem !== 'Sem origem')
    .map(([origem, v]) => ({ origem, total: v.total, qualificados: v.qualificados, ctr: v.total > 0 ? (v.qualificados / v.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)

  const COR_MOMENTO: Record<string, string> = {
    'Agora': 'hsl(0 72% 51%)',
    'Em até 3 meses': 'hsl(38 92% 50%)',
    'Pesquisando': 'hsl(217 91% 60%)',
    'Não respondeu': 'hsl(240 5% 35%)',  // cinza pra "n/d"
  }
  // Ordena: Agora primeiro (mais urgente), depois 3 meses, Pesquisando, e 'Nao respondeu' por ultimo
  const ORDEM_MOMENTO = ['Agora', 'Em até 3 meses', 'Pesquisando', 'Não respondeu']
  const porMomento = Array.from(byMomento.entries())
    .map(([momento, valor]) => ({ momento, valor, cor: COR_MOMENTO[momento] ?? 'hsl(240 5% 45%)' }))
    .sort((a, b) => ORDEM_MOMENTO.indexOf(a.momento) - ORDEM_MOMENTO.indexOf(b.momento))

  const porAnimalFinalidade = Array.from(byAnimalFinalidade.values()).sort((a, b) => b.total - a.total)

  const totalGeo = Array.from(byUf.entries()).filter(([uf]) => uf !== 'SEM').reduce((s, [, n]) => s + n, 0)
  const porUf = Array.from(byUf.entries())
    .filter(([uf]) => uf !== 'SEM')
    .map(([uf, total]) => ({
      uf, nome: UF_NOMES[uf] ?? uf, total,
      pct: totalGeo > 0 ? (total / totalGeo) * 100 : 0,
      isBrasil: UF_NOMES[uf] !== undefined && uf !== 'INTL' && !PAIS_SIGLAS.has(uf),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)

  const diaXHora: { weekday: number; hour: number; valor: number }[] = []
  for (let wd = 0; wd < 7; wd++) {
    for (let h = 0; h < 24; h++) {
      diaXHora.push({ weekday: wd, hour: h, valor: byDayHour.get(`${wd}-${h}`) ?? 0 })
    }
  }

  // ============================ Lead Aging ============================
  const leadAging: LeadAging[] = [
    { faixa: '24-48h',  leads: aging24,  valor: agingValor24 },
    { faixa: '48h-7d',  leads: aging48,  valor: agingValor48 },
    { faixa: '7d-30d',  leads: aging7d,  valor: agingValor7d },
    { faixa: '+30d',    leads: agingMais, valor: agingValorMais },
  ]

  // ============================ SLA / Win rate ============================
  const slaPorVendedor: SlaVendedor[] = Array.from(byVendor.values()).map(v => {
    const idadeMediaHoras = v.idadesHoras.length > 0
      ? v.idadesHoras.reduce((s, h) => s + h, 0) / v.idadesHoras.length
      : 0
    return {
      vendedor: v.vendedor,
      pendentes: v.pendentes,
      idadeMediaHoras,
      totalLeads: v.total,
      qualificados: v.qualificados,
      orcamentos: v.orcamentos,
      vendidos: v.vendidos,
      winRate: v.total > 0 ? (v.vendidos / v.total) * 100 : 0,
    }
  }).sort((a, b) => b.totalLeads - a.totalLeads)

  // ============================ Leads em risco (top 5) ============================
  const leadsEmRisco = candidatosRisco
    .sort((a, b) => {
      // Prioriza valor; em caso de empate, idade
      const va = a.valor || 0, vb = b.valor || 0
      if (va !== vb) return vb - va
      return b.horasSemResposta - a.horasSemResposta
    })
    .slice(0, 8)

  return {
    totalLeads: total,
    leadsBotNovo,
    kpiTotal,
    kpiHoje,
    kpiQuentes,
    kpiQualificados,
    kpiBotao,
    funil,
    funilReal,
    leadsPorDia,
    porCriativo,
    porOrigem,
    porMomento,
    porUf,
    leadAging,
    slaPorVendedor,
    leadsEmRisco,
    forecast: {
      vendidoMes,
      pedidosMes,
      diaDoMes,
      diasNoMes,
      ritmoDia,
      projecao,
      meta: META_MENSAL_REAIS,
      pctMeta: (vendidoMes / META_MENSAL_REAIS) * 100,
      pctProjecao: (projecao / META_MENSAL_REAIS) * 100,
    },
    porAnimalFinalidade,
    diaXHora,
    qualidade: {
      completos, parciais, vazios,
      pctCompleto: total > 0 ? (completos / total) * 100 : 0,
    },
  }
}

// Builda 4 sparklines (14 buckets temporais) sobre a janela atual
function buildSparkSeries(
  rows: RawRow[],
  range: DateRange,
  buckets: number,
): { total: number[]; hoje: number[]; quentes: number[]; qualificados: number[]; botao: number[] } {
  const total = new Array(buckets).fill(0)
  const hoje = new Array(buckets).fill(0)
  const quentes = new Array(buckets).fill(0)
  const qualificados = new Array(buckets).fill(0)
  const botao = new Array(buckets).fill(0)
  const ms = range.to.getTime() - range.from.getTime()
  const bucketMs = ms / buckets || 1
  const today = new Date().toISOString().slice(0, 10)

  for (const r of rows) {
    const refIso = r.last_message_at ?? r.data
    if (!refIso) continue
    const t = new Date(refIso).getTime()
    if (t < range.from.getTime() || t > range.to.getTime()) continue
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t - range.from.getTime()) / bucketMs)))
    total[idx]++
    if (refIso.slice(0, 10) === today) hoje[idx]++
    if (normQuando(r.quando_investir) === 'Agora') quentes[idx]++
    const fin = normFinalidade(r.finalidade_fabrica)
    const animal = normAnimal(r.qual_animal)
    const qtd = r.quantos_animais?.trim() || null
    const momento = normQuando(r.quando_investir)
    if (fin && animal && qtd && momento) qualificados[idx]++
    if (r.tocou_botao_em) botao[idx]++
  }
  return { total, hoje, quentes, qualificados, botao }
}
