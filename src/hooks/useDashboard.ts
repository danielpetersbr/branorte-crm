import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { foneCanon } from '@/lib/fone-canon'
import { supabase, supabaseAuditoria } from '@/lib/supabase'
import { ufFromTelefone, paisDoTelefone } from '@/lib/ddd-uf'
import { memoPorSnapshot } from '@/lib/memo-por-snapshot'
import { decodeDashboardSnapshot } from '@/lib/dashboard-snapshot'
import { RISCO_TOP, entraEmRisco, horasSemAtividade } from '@/lib/dashboard-risco'


// A RPC lê o conjunto completo (teto de 50 mil) uma vez. Período continua client-side
// para preservar forecast, séries e troca instantânea dos filtros.
const META_MENSAL_REAIS = 2_000_000

// '' = Tudo · presets fixos · `custom:YYYY-MM-DD:YYYY-MM-DD` = período personalizado.
export type DashboardPreset = '' | 'hoje' | 'ontem' | '7d' | '30d' | 'mes' | `custom:${string}`

export interface DashboardFilters {
  preset: DashboardPreset
}

// Nome dos estados BR + paises principais
export const UF_NOMES: Record<string, string> = {
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
export const PAIS_SIGLAS = new Set(['AR', 'PY', 'UY', 'CL', 'CO', 'BO', 'EC', 'VE', 'US', 'PT', 'MX', 'DE', 'FR', 'IT', 'GB', 'INTL'])

interface RawRow {
  id: string
  nome: string | null
  telefone: string | null
  responsavel: string | null
  criativo_codigo: string | null
  origem: string | null
  motivo_contato: string | null
  finalidade_fabrica: string | null
  qual_animal: string | null
  quantos_animais: string | null
  capacidade_producao: string | null
  quando_investir: string | null
  tocou_botao_em: string | null
  o_que_precisa: string | null
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

// Lista do catálogo Branorte (espelha src/hooks/useAtendimentos.ts BRANORTE_EQUIP_KEYWORDS)
const BRANORTE_EQUIP_KEYWORDS = [
  'aliment', 'balanc', 'balanç', 'brete', 'casquead',
  'cacamb', 'caçamb', 'caixa', 'compact', 'fabric', 'fábric',
  'descarga', 'elevador', 'caneca', 'sacaria', 'ensacad',
  'helico', 'rosca', 'mistur', 'moega', 'moinho', 'martelo',
  'passarela', 'peneira', 'limpeza', 'silo', 'big bag', 'bigbag',
  'transporta', 'esteira',
]

// Qualificado: igual a /atendimentos.
// - Fábrica:    motivo de fábrica + finalidade + animal preenchidos
// - Equipamento: motivo de equipamento + o_que_precisa bate em alguma keyword Branorte
function isQualificadoBranorte(r: RawRow): boolean {
  const motivo = (r.motivo_contato || '').toLowerCase()
  if (!motivo) return false
  const ehFabrica = /fab|fáb/.test(motivo)
  const ehEquip = /equip/.test(motivo)
  if (ehFabrica) {
    return !!(r.finalidade_fabrica && r.qual_animal)
  }
  if (ehEquip) {
    const oqp = (r.o_que_precisa || '').toLowerCase()
    if (!oqp) return false
    return BRANORTE_EQUIP_KEYWORDS.some(k => oqp.includes(k))
  }
  return false
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

// Período personalizado: preset no formato "custom:YYYY-MM-DD:YYYY-MM-DD".
// Retorna { from: início do dia FROM, to: fim do dia TO } ou null se inválido.
// COMPARTILHADO: os outros hooks do dashboard importam isto pra tratar o mesmo formato.
export function parseCustomRange(preset: DashboardPreset): { from: Date; to: Date } | null {
  if (typeof preset !== 'string' || !preset.startsWith('custom:')) return null
  const [, fromStr, toStr] = preset.split(':')
  if (!fromStr || !toStr) return null
  const from = new Date(`${fromStr}T00:00:00`)
  const to = new Date(`${toStr}T00:00:00`)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null
  // Se o vendedor inverter as datas, ordena.
  const [a, b] = from <= to ? [from, to] : [to, from]
  return { from: startOfDay(a), to: endOfDay(b) }
}

export function rangeForPreset(preset: DashboardPreset, now: Date): DateRange | null {
  if (!preset) return null
  const custom = parseCustomRange(preset)
  if (custom) return custom
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
  kpiNaoRespondeu: KpiSerie
  kpiEmAndamento: KpiSerie
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
  porCriativo: { codigo: string; nome: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number }[]
  porOrigem: { origem: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number; orcamentos: number; vendidos: number }[]
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

/** codigo do criativo -> nome exibido. Vem de `auditoria.criativos` (901 linhas, ~220 KB)
 *  em vez do jsonb `criativo_facebook` repetido em cada uma das 10 mil linhas (~1,7 MB).
 *  Provado equivalente em 06/08/2026: 0 divergência contra o nome que a view entrega; os
 *  códigos sem par são lixo de parsing de URL (`&54boa`, `&30Oque`), que já valia '—'. */
async function fetchCriativoNomes(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  const { data, error } = await supabaseAuditoria
    .from('criativos')
    .select('codigo, nome_oficial, headline')
  if (error) return m   // sem nome o dashboard ainda funciona (cai em '—')
  for (const c of (data ?? []) as { codigo?: string; nome_oficial?: string | null; headline?: string | null }[]) {
    if (!c?.codigo) continue
    const nome = (c.nome_oficial || '').trim() || (c.headline || '').trim()
    if (nome) m.set(c.codigo, nome)
  }
  return m
}

/** O que o fetch devolve e o cache guarda: o BRUTO, sem período aplicado. */
interface DashboardRaw {
  rows: RawRow[]
  orcValorByCanon: Map<string, number>
  /** fone_canon → epoch ms do ÚLTIMO orçamento montado (entra na "última atividade" do risco). */
  orcEmByCanon: Map<string, number>
  fechados: Set<string>
  criativoNomes: Map<string, string>
}

// Uma agregação por (bruto, preset), compartilhada por todos os observers — ver
// src/lib/memo-por-snapshot.ts.
const agregarPorPreset = memoPorSnapshot(aggregate)

export function useDashboard(filters: DashboardFilters = { preset: '' }) {
  const qc = useQueryClient()
  const preset = filters.preset
  // Troca de período SEM rede (29/09/2026). A key era ['dashboard-data-v2', filters]:
  // cada preset rebaixava as ~18 mil linhas (8 páginas em série, ~11 s sob carga) só
  // para rodar um filtro que é client-side — e o `placeholderData: prev => prev`
  // mostrava nesse meio-tempo os números do período ANTERIOR já com o rótulo novo
  // ("Hoje · 1.842 leads" = o total de 30 dias). Agora a key é fixa, o cache guarda o
  // bruto e o preset só escolhe o `select`: a troca é instantânea e o número nunca
  // aparece com o carimbo errado. A key mudou de nome (v2 → v3) porque o formato do
  // dado no cache mudou; o "Atualizar" do Dashboard invalida por prefixo 'dashboard'
  // e continua casando. Nenhum outro lugar lê essa key (conferido por grep).
  // Custo aceito: um preset novo é calculado sobre o bruto que já está no cache, que
  // pode ter até ~3 min (refetchInterval; refetchOnWindowFocus é false no App). O
  // cabeçalho mostra a hora do dado (dataUpdatedAt) e o "Atualizar" rebaixa na hora.
  const select = useCallback((raw: DashboardRaw) => agregarPorPreset(raw, preset), [preset])
  return useQuery({
    queryKey: ['dashboard-data-v3'],
    select,
    queryFn: async ({ signal }): Promise<DashboardRaw> => {
      // Antes cada página recalculava os mesmos 18 mil leads (~1,1s de SQL por página).
      // Snapshot compacto evita oito passagens pela view e repetições das chaves JSON.
      const { data: snapshot, error } = await supabaseAuditoria
        .rpc('dashboard_snapshot')
        .abortSignal(signal)
      if (error) throw error
      signal.throwIfAborted()
      const rows = decodeDashboardSnapshot(snapshot) as unknown as RawRow[]
      // Criativo muda raramente: cache próprio de 30 min, fora do refetch de 3 min do read
      // grande. fetchQuery dedupa entre abas/telas que já tenham buscado.
      const criativoNomes = await qc.fetchQuery({
        queryKey: ['criativo-nomes'],
        queryFn: fetchCriativoNomes,
        staleTime: 30 * 60_000,
      })

      // "Dinheiro parado" = valor do ÚLTIMO orçamento de cada lead (NÃO a soma das revisões,
      // que infla: há telefone com 32 orçamentos → R$82M somado vs R$47M no último).
      // Fonte: orcamentos_gerados.total_proposta via RPC orcamentos_por_telefone_canon,
      // casado por fone_canon (espelhado em foneCanon()).
      const canons = [...new Set(rows.map(r => foneCanon(r.telefone)).filter((x): x is string => !!x))]
      const orcValorByCanon = new Map<string, number>()
      const orcEmByCanon = new Map<string, number>()
      const fechados = new Set<string>()   // fone_canon com etiqueta VENDIDO ou MORTO → fora do "dinheiro parado"
      try {
        const [orcRes, sitRes] = await Promise.all([
          (supabase as any).rpc('orcamentos_por_telefone_canon', { p_canons: canons }).abortSignal(signal),
          (supabase as any).rpc('dashboard_fone_situacao').abortSignal(signal),
        ])
        if (!orcRes?.error) {
          for (const o of (orcRes?.data ?? []) as { fone_canon?: string; ultimo_valor?: number; ultimo_em?: string | null }[]) {
            if (!o?.fone_canon) continue
            orcValorByCanon.set(String(o.fone_canon), Number(o.ultimo_valor ?? 0))
            // ultimo_em = max(created_at) dos orçamentos do telefone. Orçamento montado
            // É atividade com o cliente — ver src/lib/dashboard-risco.ts.
            const em = o.ultimo_em ? new Date(o.ultimo_em).getTime() : NaN
            if (Number.isFinite(em)) orcEmByCanon.set(String(o.fone_canon), em)
          }
        }
        if (!sitRes?.error) {
          for (const s of (sitRes?.data ?? []) as { fone_canon?: string; situacao?: string }[]) {
            if (s?.fone_canon && (s.situacao === 'vendido' || s.situacao === 'morto')) fechados.add(String(s.fone_canon))
          }
        }
      } catch { /* maps vazios -> fallback; dashboard não quebra */ }
      signal.throwIfAborted()
      return { rows, orcValorByCanon, orcEmByCanon, fechados, criativoNomes }
    },
    staleTime: 120_000,
    refetchInterval: 180_000,
    // Uma repetição com backoff; sem empilhar retries por página sobre o banco.
    retry: 1,
    retryDelay: () => 3000,
    // Sem placeholderData: com a key fixa não existe "key nova ainda sem dado" na troca
    // de período — o select roda sobre o cache na hora. Era o placeholder que carimbava
    // o número velho com o rótulo novo.
  })
}

// ============================================================================
// AGREGADOR
// ============================================================================

function aggregate(raw: DashboardRaw, preset: DashboardPreset): DashboardData {
  const { rows, orcValorByCanon, orcEmByCanon, fechados, criativoNomes } = raw
  const now = new Date()
  const range = rangeForPreset(preset, now)
  const prev = previousRange(range)
  const todayIso = now.toISOString().slice(0, 10)

  // Filtra rows por DATA DE CHEGADA (data/created_at), igual /atendimentos.
  // Garante que Dashboard e Atendimentos mostram os mesmos números.
  const filtered = range ? rows.filter(r => inRange(r.data, range)) : rows
  const filteredPrev = prev ? rows.filter(r => inRange(r.data, prev)) : []

  // ============================ KPIs com tendencia =========================
  const computeKpis = (rs: RawRow[]) => {
    let hoje = 0, quentes = 0, qualificados = 0, comVendedor = 0, naoRespondeu = 0, emAndamento = 0
    for (const r of rs) {
      const day = dayKey(r.data)
      if (day === todayIso) hoje++
      // Quente = volume alto de animais (Bovinos/Suínos: 300+ | Aves: 5.000+)
      const qtdStr = (r.quantos_animais || '').replace(/[^\d]/g, '')
      const qtdAnimais = parseInt(qtdStr, 10) || 0
      const animalKpi = normAnimal(r.qual_animal)
      const isQuente = animalKpi === 'Aves'
        ? qtdAnimais >= 5000
        : qtdAnimais >= 300
      if (isQuente) quentes++
      // Qualificado = igual ao /atendimentos (fábrica completa OR equipamento Branorte)
      if (isQualificadoBranorte(r)) qualificados++
      // Com vendedor atribuído
      if (r.responsavel?.trim()) comVendedor++
      // Não respondeu = sem nenhum campo preenchido (não engajou com a IA)
      // BUGFIX: motivo e finKpi estavam sem declaração (refator antigo) → ReferenceError no dashboard
      const motivo = r.motivo_contato?.trim() || null
      const finKpi = normFinalidade(r.finalidade_fabrica)
      const animal = normAnimal(r.qual_animal)
      const qtd = r.quantos_animais?.trim() || null
      const engajou = !!motivo || !!finKpi || !!animal || !!qtd || !!r.tocou_botao_em
      if (!engajou) naoRespondeu++
      // Em andamento = engajou mas ainda não qualificou (respondeu algo mas faltam dados)
      if (engajou && !(motivo && finKpi)) emAndamento++
    }
    return { total: rs.length, hoje, quentes, qualificados, comVendedor, naoRespondeu, emAndamento }
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
  const kpiNaoRespondeu = mkKpi(cur.naoRespondeu, prevK.naoRespondeu, 'total')
  const kpiEmAndamento = mkKpi(cur.emAndamento, prevK.emAndamento, 'total')
  const kpiQuentes = mkKpi(cur.quentes, prevK.quentes, 'quentes')
  const kpiQualificados = mkKpi(cur.qualificados, prevK.qualificados, 'qualificados')
  const kpiBotao = mkKpi(cur.comVendedor, prevK.comVendedor, 'botao')

  // ============================ Restante (sobre `filtered`) ================

  const total = filtered.length
  // Funil de qualificação IA (esquerdo)
  let funilEntrou = 0        // total leads no período
  let funilEngajou = 0       // respondeu pelo menos 1 pergunta da IA
  let funilQualificou = 0    // motivo preenchido (quer algo que a Branorte fabrica)
  let funilVendedor = 0      // passou pro vendedor (tem responsavel)
  let funilOrcamento = 0     // orcamento_enviado = true OR orcamento_valor > 0
  let funilFechou = 0        // status_real = 'fechou' OR status_vendedor = 'fechou'

  let leadsBotNovo = 0
  let comTelefone = 0
  let qualificadosTotal = 0
  // Funil pós-bot (direito): Qualificou → Chegou no vendedor → Orçamento → Fechou
  let qualificadosBotNovo = 0
  let chegouVendedorTotal = 0
  let orcamentoEnviadoTotal = 0
  let vendidoTotal = 0

  const byDay = new Map<string, { total: number; qualificados: number }>()
  const byCriativo = new Map<string, { codigo: string; nome: string; total: number; qualificados: number; engajou: number; bovinos: number; suinos: number; aves: number }>()
  const byOrigem = new Map<string, { total: number; qualificados: number; engajou: number; bovinos: number; suinos: number; aves: number; orcamentos: number; vendidos: number }>()
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

  // Janela do gráfico "leads por dia" — SEMPRE últimos 30 dias (independente do filtro)
  const chart30start = new Date(now); chart30start.setDate(chart30start.getDate() - 29); chart30start.setHours(0, 0, 0, 0)
  const chartStartIso = chart30start.toISOString().slice(0, 10)

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

    // --- Funil de qualificação IA (esquerdo) ---
    funilEntrou++

    const statusLower = (r.status_real || '').toLowerCase()

    // Engajou = respondeu pelo menos 1 pergunta da IA (tem qualquer campo preenchido)
    const engajou = !!motivo || !!fin || !!animal || !!qtd || !!r.tocou_botao_em
    if (engajou) funilEngajou++

    // Qualificou = mesma regra de /atendimentos (fábrica + animal OU equip do catálogo)
    const isQualificado = isQualificadoBranorte(r)
    if (isQualificado) {
      funilQualificou++
      qualificadosTotal++
    }

    // Passou pro vendedor = tem responsavel
    const vendedor = r.responsavel?.trim() || null
    if (vendedor) funilVendedor++

    // Orçamento enviado = orcamento_enviado = true OU orcamento_valor > 0
    if (r.orcamento_enviado || (r.orcamento_valor && r.orcamento_valor > 0)) funilOrcamento++

    // Fechou = status_real = 'fechou' OU status_vendedor = 'fechou'
    if (statusLower === 'fechou' || (r.status_vendedor || '').toLowerCase() === 'fechou') funilFechou++

    // --- Funil pós-bot (direito): só bot novo que qualificou ---
    if (isBotNovo && isQualificado) qualificadosBotNovo++
    if (isBotNovo && isQualificado && r.chegou_no_vendedor) chegouVendedorTotal++
    if (isBotNovo && isQualificado && r.orcamento_enviado) orcamentoEnviadoTotal++
    if (isBotNovo && isQualificado && ((r.status_vendedor || '').toLowerCase() === 'fechou' || statusLower === 'fechou')) vendidoTotal++

    // Qualidade
    const camposPreenchidos = [motivo, fin, animal, qtd, momento, botao].filter(Boolean).length
    if (camposPreenchidos === 0) vazios++
    else if (camposPreenchidos >= 5) completos++
    else parciais++

    // (byDay populado separadamente abaixo — independente do filtro)

    if (r.criativo_codigo) {
      const codigo = r.criativo_codigo
      const nome = criativoNomes.get(codigo) ?? '—'
      const cc = byCriativo.get(codigo) ?? { codigo, nome, total: 0, qualificados: 0, engajou: 0, bovinos: 0, suinos: 0, aves: 0 }
      cc.total++
      if (isQualificado) cc.qualificados++
      if (engajou) cc.engajou++
      // Perfil de cliente atraído por este criativo (animal declarado pelo lead)
      if (animal === 'Bovinos') cc.bovinos++
      else if (animal === 'Suínos') cc.suinos++
      else if (animal === 'Aves') cc.aves++
      if (!cc.nome || cc.nome === '—') cc.nome = nome
      byCriativo.set(codigo, cc)
    }

    // Chave = origem CRUA (canal real: Meta ADS, Google, Instagram Formulario, Bio Instagram...).
    // Casa 1:1 com a RPC por_origem (ambas leem apc.origem). Ignora ruído de nº de vendedor.
    const origemRaw = (r.origem || '').trim()
    if (origemRaw && !/^whatsapp\s/i.test(origemRaw)) {
      const oc = byOrigem.get(origemRaw) ?? { total: 0, qualificados: 0, engajou: 0, bovinos: 0, suinos: 0, aves: 0, orcamentos: 0, vendidos: 0 }
      oc.total++
      if (isQualificado) oc.qualificados++           // "é coisa que a Branorte faz"
      if (engajou) oc.engajou++                       // "respondeu à IA"
      if (animal === 'Bovinos') oc.bovinos++
      else if (animal === 'Suínos') oc.suinos++
      else if (animal === 'Aves') oc.aves++
      if (r.orcamento_enviado || (r.orcamento_valor && r.orcamento_valor > 0)) oc.orcamentos++
      if (statusLower === 'fechou' || statusLower.includes('vendid') || (r.status_vendedor || '').toLowerCase() === 'fechou') oc.vendidos++
      byOrigem.set(origemRaw, oc)
    }

    // Vendedor (apenas com responsavel preenchido)
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

  }

  // Lead aging + leads em risco — SNAPSHOT sobre TODOS os leads (rows), não o período
  // filtrado. Com `filtered` (default 30d) nenhum lead alcança ageH>=720h → o bucket
  // "+30D" fica estruturalmente zero e some ~R$10M do maior monte. Igual forecast/byDay.
  for (const r of rows) {
    const status = (r.status_real || '').toLowerCase()
    const fc = foneCanon(r.telefone)
    // Exclui quem já VENDEU ou foi PERDIDO pela etiqueta do funil (status_real não captura isso).
    if (status.includes('vendid') || status.includes('perdid') || !r.last_message_at || (fc != null && fechados.has(fc))) continue
    const ageH = (now.getTime() - new Date(r.last_message_at).getTime()) / 3600000
    const valor = orcValorByCanon.get(fc ?? '') ?? 0
    if (ageH >= 24 && ageH < 48) { aging24++; agingValor24 += valor }
    else if (ageH >= 48 && ageH < 168) { aging48++; agingValor48 += valor }
    else if (ageH >= 168 && ageH < 720) { aging7d++; agingValor7d += valor }
    else if (ageH >= 720) { agingMais++; agingValorMais += valor }

    // Lead em risco = quente OU com orçamento, parado entre 24h e 14 dias (29/09/2026).
    // Sem o teto de 14 dias o card Crítico ficava preso em orçamentos grandes de 2-4
    // meses atrás; e "parado" agora conta o último orçamento montado como atividade,
    // não só a última mensagem do canal da IA. Regra e números: src/lib/dashboard-risco.ts.
    // O aging acima segue em `ageH` (última mensagem) de propósito — é outra pergunta.
    const momentoR = normQuando(r.quando_investir)
    const horasRisco = horasSemAtividade(r.last_message_at, orcEmByCanon.get(fc ?? ''), now.getTime())
    if (entraEmRisco(momentoR, valor, horasRisco)) {
      candidatosRisco.push({
        id: r.id,
        nome: r.nome,
        telefone: r.telefone,
        vendedor: r.responsavel?.trim() || null,
        horasSemResposta: horasRisco as number,
        valor: valor || null,
        momento: momentoR,
      })
    }
  }

  // ============================ Funil de qualificação IA ============================
  const funilRaw = [
    { etapa: 'Entrou',              valor: funilEntrou },
    { etapa: 'Engajou',             valor: funilEngajou },
    { etapa: 'Qualificou',          valor: funilQualificou },
    { etapa: 'Passou pro vendedor', valor: funilVendedor },
    { etapa: 'Orçamento enviado',   valor: funilOrcamento },
    { etapa: 'Fechou',              valor: funilFechou },
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

  // ============================ Funil de vendas (pós-qualificação) ============================
  // Topo = leads do bot novo que qualificaram. Etapas seguintes sao subset disso.
  const funilRealRaw = [
    { etapa: 'Qualificou',           valor: qualificadosBotNovo },
    { etapa: 'Chegou no vendedor',   valor: chegouVendedorTotal },
    { etapa: 'Orçamento enviado',    valor: orcamentoEnviadoTotal },
    { etapa: 'Fechou',               valor: vendidoTotal },
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
  // Popula byDay com TODOS os rows (independente do filtro) — gráfico sempre mostra 30 dias
  for (const r of rows) {
    const day = dayKey(r.data)
    if (day && day >= chartStartIso) {
      const cd = byDay.get(day) ?? { total: 0, qualificados: 0 }
      cd.total++
      if (isQualificadoBranorte(r)) cd.qualificados++
      byDay.set(day, cd)
    }
  }
  const allDays: { dia: string; total: number; qualificados: number }[] = []
  const cursor = new Date(chart30start)
  const endDate = now
  while (cursor <= endDate) {
    const k = cursor.toISOString().slice(0, 10)
    const d = byDay.get(k) ?? { total: 0, qualificados: 0 }
    allDays.push({ dia: k, total: d.total, qualificados: d.qualificados })
    cursor.setDate(cursor.getDate() + 1)
  }
  const firstActive = allDays.findIndex(d => d.total > 0)
  const leadsPorDia = firstActive >= 0 ? allDays.slice(firstActive) : allDays

  const porCriativo = Array.from(byCriativo.values())
    // Filtra códigos-lixo de parsing de URL (ex.: "&8Boa", "&mibextid" — 1 lead cada);
    // mostra TODOS os criativos reais, não só o top 10.
    .filter(c => c.total >= 5)
    .map(c => ({ ...c, ctr: c.total > 0 ? (c.qualificados / c.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 40)

  const porOrigem = Array.from(byOrigem.entries())
    .filter(([origem]) => origem !== 'Sem origem')
    .map(([origem, v]) => ({ origem, total: v.total, qualificados: v.qualificados, ctr: v.total > 0 ? (v.qualificados / v.total) * 100 : 0, engajou: v.engajou, bovinos: v.bovinos, suinos: v.suinos, aves: v.aves, orcamentos: v.orcamentos, vendidos: v.vendidos }))
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

  // ============================ Leads em risco (top RISCO_TOP) ============================
  const leadsEmRisco = candidatosRisco
    .sort((a, b) => {
      // Prioriza valor; em caso de empate, idade
      const va = a.valor || 0, vb = b.valor || 0
      if (va !== vb) return vb - va
      return b.horasSemResposta - a.horasSemResposta
    })
    .slice(0, RISCO_TOP)

  return {
    totalLeads: total,
    leadsBotNovo,
    kpiTotal,
    kpiHoje,
    kpiNaoRespondeu,
    kpiEmAndamento,
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
    // Bucketiza por r.data (chegada) — MESMO campo do KPI; senão a curva não bate com o número.
    const refIso = r.data
    if (!refIso) continue
    const t = new Date(refIso).getTime()
    if (t < range.from.getTime() || t > range.to.getTime()) continue
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t - range.from.getTime()) / bucketMs)))
    total[idx]++
    if (refIso.slice(0, 10) === today) hoje[idx]++
    if (normQuando(r.quando_investir) === 'Agora') quentes[idx]++
    if (isQualificadoBranorte(r)) qualificados[idx]++   // mesma def do KPI Qualificados
    if (r.tocou_botao_em) botao[idx]++
  }
  return { total, hoje, quentes, qualificados, botao }
}
