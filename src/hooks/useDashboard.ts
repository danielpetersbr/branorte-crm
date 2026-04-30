import { useQuery } from '@tanstack/react-query'
import { supabaseAuditoria } from '@/lib/supabase'
import { ufFromTelefone, paisDoTelefone } from '@/lib/ddd-uf'

// Linhas brutas que pegamos da view. Limitamos a 5k por seguranca; cresce > isso a gente troca pra RPC.
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
  is_internal: boolean | null
}

const DASHBOARD_LIMIT = 5000

// Nome dos estados BR + paises principais (pra mostrar no grafico de UF)
const UF_NOMES: Record<string, string> = {
  AC: 'Acre',           AL: 'Alagoas',          AM: 'Amazonas',           AP: 'Amapá',
  BA: 'Bahia',          CE: 'Ceará',            DF: 'Distrito Federal',   ES: 'Espírito Santo',
  GO: 'Goiás',          MA: 'Maranhão',         MG: 'Minas Gerais',       MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',    PA: 'Pará',             PB: 'Paraíba',            PE: 'Pernambuco',
  PI: 'Piauí',          PR: 'Paraná',           RJ: 'Rio de Janeiro',     RN: 'Rio Grande do Norte',
  RO: 'Rondônia',       RR: 'Roraima',          RS: 'Rio Grande do Sul',  SC: 'Santa Catarina',
  SE: 'Sergipe',        SP: 'São Paulo',        TO: 'Tocantins',
  // Internacionais
  AR: 'Argentina',      PY: 'Paraguai',         UY: 'Uruguai',            CL: 'Chile',
  CO: 'Colômbia',       PE_PAIS: 'Peru',        BO: 'Bolívia',            EC: 'Equador',
  VE: 'Venezuela',      US: 'EUA/Canadá',       PT: 'Portugal',           ES_PAIS: 'Espanha',
  MX: 'México',         DE: 'Alemanha',         FR: 'França',             IT: 'Itália',
  GB: 'Reino Unido',    INTL: 'Internacional',  SEM: 'Sem origem',
}

// Conjunto de siglas que representam paises (nao estados BR)
const PAIS_SIGLAS = new Set(['AR', 'PY', 'UY', 'CL', 'CO', 'BO', 'EC', 'VE', 'US', 'PT', 'MX', 'DE', 'FR', 'IT', 'GB', 'INTL'])

export type DashboardPreset = '' | 'hoje' | 'ontem' | '7d' | '30d' | 'mes'

export interface DashboardFilters {
  preset: DashboardPreset
}

function dateRangeFromPreset(preset: DashboardPreset): { from?: string; to?: string } {
  if (!preset) return {}
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  if (preset === 'hoje') {
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === 'ontem') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() }
  }
  if (preset === '7d') {
    const f = new Date(now); f.setDate(f.getDate() - 6)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === '30d') {
    const f = new Date(now); f.setDate(f.getDate() - 29)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === 'mes') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  return {}
}

function stripEmoji(s: string | null | undefined): string {
  if (!s) return ''
  // Remove emojis + chars de controle, normaliza whitespace
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
  // Fluxo novo do bot so tem Bovinos/Suinos/Aves. Valores legados
  // (avulso, esteira transportadora, extrusora, etc.) sao equipamentos
  // do fluxo antigo — descartar pra nao poluir o grafico.
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

// Retorna origem se ela é "valida" (lead chegou via webhook do bot novo). Null se nao tem origem.
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
  return iso.slice(0, 10) // YYYY-MM-DD
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
  return d.getDay() // 0=Dom, 6=Sab
}

export interface FunilEtapa {
  etapa: string
  valor: number
  pctTopo: number       // % vs topo do funil (Iniciou bot)
  pctAnterior: number   // % conversao da etapa anterior pra essa
}

export interface DashboardData {
  totalLeads: number
  leadsBotNovo: number  // leads que entraram via webhook do bot novo
  hoje: number
  quentes: number
  qualificados: number
  comTelefone: number
  // Funil (so leads do bot novo)
  funil: FunilEtapa[]
  // Series
  leadsPorDia: { dia: string; total: number; qualificados: number }[]
  porCriativo: { codigo: string; nome: string; total: number; qualificados: number; ctr: number }[]
  porOrigem: { origem: string; total: number; qualificados: number; ctr: number }[]
  porVendedor: { vendedor: string; total: number; qualificados: number }[]
  porMomento: { momento: string; valor: number; cor: string }[]
  porAnimalFinalidade: { animal: string; vender: number; consumo: number; ambos: number; total: number }[]
  porUf: { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }[]
  diaXHora: { weekday: number; hour: number; valor: number }[]
  qualidade: { completos: number; parciais: number; vazios: number; pctCompleto: number }
}

export function useDashboard(filters: DashboardFilters = { preset: '' }) {
  const range = dateRangeFromPreset(filters.preset)
  return useQuery({
    queryKey: ['dashboard-data', filters],
    queryFn: async (): Promise<DashboardData> => {
      let q = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select(
          'id, nome, telefone, responsavel, criativo_codigo, criativo_facebook, origem, motivo_contato, finalidade_fabrica, qual_animal, quantos_animais, capacidade_producao, quando_investir, tocou_botao_em, data, ultima_msg, is_internal'
        )
        .eq('is_internal', false)
        .order('data', { ascending: false, nullsFirst: false })
        .limit(DASHBOARD_LIMIT)

      // Filtra por data de chegada (data) — alinhado com semantica "leads que chegaram"
      if (range.from) q = q.gte('data', range.from)
      if (range.to)   q = q.lte('data', range.to)

      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as RawRow[]
      return aggregate(rows)
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
  })
}

function aggregate(rows: RawRow[]): DashboardData {
  const total = rows.length
  const todayIso = new Date().toISOString().slice(0, 10)

  let hoje = 0
  let quentes = 0
  let qualificados = 0
  let comTelefone = 0
  let leadsBotNovo = 0
  // Etapas do funil — SO contam leads que entraram pelo webhook do bot novo.
  // Detecta pelo "origem" preenchida (WhatsApp 4502/1144/Instagram).
  let entrouNoBot = 0
  let clicouMotivo = 0
  let escolheuFinalidade = 0
  let escolheuAnimal = 0
  let escolheuQtd = 0
  let escolheuMomento = 0
  let tocouBotao = 0

  // Maps
  const byDay = new Map<string, { total: number; qualificados: number }>()
  const byCriativo = new Map<string, { codigo: string; nome: string; total: number; qualificados: number }>()
  const byOrigem = new Map<string, { total: number; qualificados: number }>()
  const byVendor = new Map<string, { total: number; qualificados: number }>()
  const byMomento = new Map<string, number>()
  const byAnimalFinalidade = new Map<string, { animal: string; vender: number; consumo: number; ambos: number; total: number }>()
  const byUf = new Map<string, number>()
  const byDayHour = new Map<string, number>() // key: weekday-hour

  // Janela de 30 dias pra timeline
  const start30 = new Date()
  start30.setDate(start30.getDate() - 29)
  start30.setHours(0, 0, 0, 0)
  const start30Iso = start30.toISOString().slice(0, 10)

  let completos = 0
  let parciais = 0
  let vazios = 0

  for (const r of rows) {
    const created = r.data
    const day = dayKey(created)

    if (day === todayIso) hoje++

    if (r.telefone && r.telefone.trim() !== '') comTelefone++

    const motivo = r.motivo_contato?.trim() || null
    const fin = normFinalidade(r.finalidade_fabrica)
    const animal = normAnimal(r.qual_animal)
    const qtd = r.quantos_animais?.trim() || null
    const momento = normQuando(r.quando_investir)
    const botao = !!r.tocou_botao_em

    // Lead "do bot novo" = entrou via webhook do bot atual (tem origem)
    const isBotNovo = !!normalizedOrigemRaw(r.origem)
    if (isBotNovo) leadsBotNovo++

    // Funil so conta leads do bot novo (monotonico decrescente)
    if (isBotNovo) {
      entrouNoBot++
      if (motivo) clicouMotivo++
      if (motivo && fin) escolheuFinalidade++
      if (motivo && fin && animal) escolheuAnimal++
      if (motivo && fin && animal && qtd) escolheuQtd++
      if (motivo && fin && animal && qtd && momento) escolheuMomento++
      if (botao) tocouBotao++
    }

    if (momento === 'Agora') quentes++
    const isQualificado = !!fin && !!animal && !!qtd && !!momento
    if (isQualificado) qualificados++

    // Qualidade
    const camposPreenchidos = [motivo, fin, animal, qtd, momento, botao].filter(Boolean).length
    if (camposPreenchidos === 0) vazios++
    else if (camposPreenchidos >= 5) completos++
    else parciais++

    // Series por dia (ultimos 30)
    if (day && day >= start30Iso) {
      const cur = byDay.get(day) ?? { total: 0, qualificados: 0 }
      cur.total++
      if (isQualificado) cur.qualificados++
      byDay.set(day, cur)
    }

    // Por criativo
    if (r.criativo_codigo) {
      const codigo = r.criativo_codigo
      const nome = r.criativo_facebook?.nome_oficial ?? r.criativo_facebook?.headline ?? '—'
      const cur = byCriativo.get(codigo) ?? { codigo, nome, total: 0, qualificados: 0 }
      cur.total++
      if (isQualificado) cur.qualificados++
      if (!cur.nome || cur.nome === '—') cur.nome = nome
      byCriativo.set(codigo, cur)
    }

    // Por origem
    const origem = normOrigem(r.origem)
    const oc = byOrigem.get(origem) ?? { total: 0, qualificados: 0 }
    oc.total++
    if (isQualificado) oc.qualificados++
    byOrigem.set(origem, oc)

    // Por vendedor
    const vendedor = r.responsavel?.trim() || 'Sem vendedor'
    const vc = byVendor.get(vendedor) ?? { total: 0, qualificados: 0 }
    vc.total++
    if (isQualificado) vc.qualificados++
    byVendor.set(vendedor, vc)

    // Momento de compra
    if (momento) {
      byMomento.set(momento, (byMomento.get(momento) ?? 0) + 1)
    }

    // Animal x Finalidade
    if (animal) {
      const cur = byAnimalFinalidade.get(animal) ?? { animal, vender: 0, consumo: 0, ambos: 0, total: 0 }
      cur.total++
      if (fin === 'Para vender') cur.vender++
      else if (fin === 'Para consumo') cur.consumo++
      else if (fin === 'Consumo e vender') cur.ambos++
      byAnimalFinalidade.set(animal, cur)
    }

    // UF
    const uf = ufFrom(r.telefone)
    byUf.set(uf, (byUf.get(uf) ?? 0) + 1)

    // Dia x Hora
    const wd = weekdayOf(created)
    const hr = hourOf(created)
    if (wd !== null && hr !== null) {
      const k = `${wd}-${hr}`
      byDayHour.set(k, (byDayHour.get(k) ?? 0) + 1)
    }
  }

  // Funil — etapas monotonicas (cada etapa exige todas anteriores).
  // pctTopo = % do total que chegou ate a etapa
  // pctAnterior = % de conversao DA etapa anterior PRA essa
  const etapasRaw = [
    { etapa: 'Entrou no bot',      valor: entrouNoBot },
    { etapa: 'Clicou motivo',      valor: clicouMotivo },
    { etapa: 'Escolheu finalidade', valor: escolheuFinalidade },
    { etapa: 'Escolheu animal',    valor: escolheuAnimal },
    { etapa: 'Escolheu qtd',       valor: escolheuQtd },
    { etapa: 'Escolheu momento',   valor: escolheuMomento },
    { etapa: 'Tocou botão final',  valor: tocouBotao },
  ]
  const topo = etapasRaw[0].valor || 1
  const funil: FunilEtapa[] = etapasRaw.map((e, i) => {
    const prev = i > 0 ? etapasRaw[i - 1].valor : e.valor
    return {
      etapa: e.etapa,
      valor: e.valor,
      pctTopo: (e.valor / topo) * 100,
      pctAnterior: prev > 0 ? (e.valor / prev) * 100 : 0,
    }
  })

  // Leads por dia — corta dias zerados ANTES do primeiro dia com dado.
  const leadsPorDia: { dia: string; total: number; qualificados: number }[] = []
  const allDays: { dia: string; total: number; qualificados: number }[] = []
  const cursor = new Date(start30)
  for (let i = 0; i < 30; i++) {
    const k = cursor.toISOString().slice(0, 10)
    const d = byDay.get(k) ?? { total: 0, qualificados: 0 }
    allDays.push({ dia: k, total: d.total, qualificados: d.qualificados })
    cursor.setDate(cursor.getDate() + 1)
  }
  // Encontra primeiro dia com lead (pelo menos 1)
  const firstActive = allDays.findIndex(d => d.total > 0)
  if (firstActive >= 0) leadsPorDia.push(...allDays.slice(firstActive))
  else leadsPorDia.push(...allDays)

  // Por criativo (top 10 por total, com CTR)
  const porCriativo = Array.from(byCriativo.values())
    .map(c => ({ ...c, ctr: c.total > 0 ? (c.qualificados / c.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // Por origem — exclui "Sem origem" (legado, distorce escala)
  const porOrigem = Array.from(byOrigem.entries())
    .filter(([origem]) => origem !== 'Sem origem')
    .map(([origem, v]) => ({ origem, total: v.total, qualificados: v.qualificados, ctr: v.total > 0 ? (v.qualificados / v.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)

  // Por vendedor
  const porVendedor = Array.from(byVendor.entries())
    .map(([vendedor, v]) => ({ vendedor, total: v.total, qualificados: v.qualificados }))
    .sort((a, b) => b.total - a.total)

  // Momento de compra (com cores semânticas)
  const COR_MOMENTO: Record<string, string> = {
    'Agora': 'hsl(0 72% 51%)',
    'Em até 3 meses': 'hsl(38 92% 50%)',
    'Pesquisando': 'hsl(217 91% 60%)',
  }
  const porMomento = Array.from(byMomento.entries())
    .map(([momento, valor]) => ({ momento, valor, cor: COR_MOMENTO[momento] ?? 'hsl(240 5% 45%)' }))
    .sort((a, b) => b.valor - a.valor)

  // Animal x Finalidade
  const porAnimalFinalidade = Array.from(byAnimalFinalidade.values()).sort((a, b) => b.total - a.total)

  // UF — enriquecida com nome completo, % do total e flag BR vs Internacional
  const totalGeo = Array.from(byUf.entries()).filter(([uf]) => uf !== 'SEM').reduce((s, [, n]) => s + n, 0)
  const porUf = Array.from(byUf.entries())
    .filter(([uf]) => uf !== 'SEM')  // exclui sem geo
    .map(([uf, total]) => ({
      uf,
      nome: UF_NOMES[uf] ?? uf,
      total,
      pct: totalGeo > 0 ? (total / totalGeo) * 100 : 0,
      isBrasil: UF_NOMES[uf] !== undefined && uf !== 'INTL' && !PAIS_SIGLAS.has(uf),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)

  // Dia x Hora — todas as 24*7 cells
  const diaXHora: { weekday: number; hour: number; valor: number }[] = []
  for (let wd = 0; wd < 7; wd++) {
    for (let h = 0; h < 24; h++) {
      diaXHora.push({ weekday: wd, hour: h, valor: byDayHour.get(`${wd}-${h}`) ?? 0 })
    }
  }

  return {
    totalLeads: total,
    leadsBotNovo,
    hoje,
    quentes,
    qualificados,
    comTelefone,
    funil,
    leadsPorDia,
    porCriativo,
    porOrigem,
    porVendedor,
    porMomento,
    porAnimalFinalidade,
    porUf,
    diaXHora,
    qualidade: {
      completos,
      parciais,
      vazios,
      pctCompleto: total > 0 ? (completos / total) * 100 : 0,
    },
  }
}
