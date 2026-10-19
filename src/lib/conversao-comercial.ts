/** Conversion uses the same customers from a completed observation cohort. */
export interface Vendedor { key: string; name: string }

export interface ConversaoClient {
  id: string
  name: string
  phone: string
  classification: 'commercial' | 'internal' | 'pending'
  /** Server supplies only this date, never another seller's order details. */
  firstCompanyPurchaseDate?: string | null
}

export interface ConversaoAttendance {
  id: string
  clientId: string
  sellerKey: string
  inboundAt: string | null
  outboundAt: string | null
  answeredCallAt: string | null
  source: 'historical' | 'tracked'
  lastEventAt: string
}

export interface ConversaoSale {
  id: string
  orderNumber: string
  date: string
  clientId: string | null
  sellerKeys: string[]
  material: boolean
  link: 'phone' | 'manual' | null
  sameDayConfirmed?: boolean
}

export interface ConversaoMetrics {
  /** Non-internal customers with qualified attendance inside the cohort. */
  attended: number
  mature: number
  pending: number
  buyers: number
  linkedOrders: number
  ratePct: number | null
  clientsPerBuyer: number | null
  recurrent: number
  unclassified: number
}

export interface ConversaoClientDetail {
  id: string
  clientId: string
  name: string
  phone: string
  sellerKey: string
  firstAttendedAt: string
  /** Civil date in São Paulo: first day after the observation window ends. */
  maturesAt: string
  status: 'pending' | 'buyer' | 'not_buyer' | 'unclassified' | 'recurrent'
  sales: { id: string; date: string; orderNumber: string }[]
  evidence: {
    inboundAt: string | null
    outboundAt: string | null
    answeredCallAt: string | null
    source: 'historical' | 'tracked'
  }
}

export interface ConversaoInput {
  from: string
  to: string
  windowDays: number
  cutoffAt: string
  sellers: Vendedor[]
  clients: ConversaoClient[]
  attendances: ConversaoAttendance[]
  sales: ConversaoSale[]
  captureSince: string | null
  captureVerified: boolean
}

export interface ConversaoResult {
  summary: ConversaoMetrics
  sellers: (Vendedor & ConversaoMetrics)[]
  clients: ConversaoClientDetail[]
  quality: {
    status: 'partial' | 'verified'
    captureSince: string | null
    unlinkedSales: number
    missingIdentity: number
    gaps: string[]
  }
}

const dayMs = 86_400_000
const civilFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** UTC is used only as an ordinal for calendar arithmetic, not a civil instant. */
function civilOrdinal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1900 || year > 9999) return null
  const ordinal = Date.UTC(year, month - 1, day) / dayMs
  const date = new Date(ordinal * dayMs)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ordinal : null
}

function civilDate(ordinal: number): string { return new Date(ordinal * dayMs).toISOString().slice(0, 10) }

function instant(value: string | null): number | null {
  if (value === null) return null
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts || civilOrdinal(parts[1]) === null || +parts[2] > 23 || +parts[3] > 59 || +(parts[4] ?? 0) > 59) return null
  if (parts[5] !== 'Z' && (+parts[5].slice(1, 3) > 23 || +parts[5].slice(4, 6) > 59)) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function civilAt(value: number): number {
  const parts = civilFormatter.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value
  return civilOrdinal(`${part('year')}-${part('month')}-${part('day')}`)!
}

type Event = { at: number; source: ConversaoAttendance['source'] }
type Qualified = {
  id: string
  clientId: string
  sellerKey: string
  at: number
  day: number
  inbound: Event | null
  outbound: Event | null
  call: Event | null
  source: ConversaoAttendance['source']
}
type Bucket = Omit<Qualified, 'at' | 'day' | 'source'>
type Sale = ConversaoSale & { day: number }
const earliest = (a: Event | null, b: Event | null) => !a || b && b.at < a.at ? b : a
const metrics = (): ConversaoMetrics => ({ attended: 0, mature: 0, pending: 0, buyers: 0, linkedOrders: 0, ratePct: null, clientsPerBuyer: null, recurrent: 0, unclassified: 0 })
const iso = (event: Event | null) => event ? new Date(event.at).toISOString() : null

/**
 * Pure engine. The caller authorizes sellers and resolves stable customer IDs.
 * It still discards attendance/orders outside sellers, as a defensive boundary.
 * No data inside the current civil day enter a completed-day report.
 */
export function calcularConversao(input: ConversaoInput): ConversaoResult {
  const from = civilOrdinal(input.from), to = civilOrdinal(input.to), cutoff = instant(input.cutoffAt)
  if (from === null || to === null || from >= to || cutoff === null || !Number.isInteger(input.windowDays) || input.windowDays < 1 || input.windowDays > 365) throw new Error('periodo_conversao_invalido')
  const cutoffDay = civilAt(cutoff)
  const gaps = new Set<string>()
  const sellers = [...new Map(input.sellers.filter(s => s.key).map(s => [s.key, s])).values()]
  const allowed = new Set(sellers.map(s => s.key))
  const referencedClients = new Set([
    ...input.attendances.filter(a => allowed.has(a.sellerKey)).map(a => a.clientId),
    ...input.sales.filter(s => s.sellerKeys.some(key => allowed.has(key))).map(s => s.clientId),
  ])
  const clients = new Map<string, ConversaoClient>()
  for (const client of input.clients) {
    if (!referencedClients.has(client.id)) continue
    const previous = clients.get(client.id)
    if (previous && previous.classification !== client.classification) {
      gaps.add('classificacao_conflitante')
      clients.set(client.id, { ...previous, classification: 'pending' })
    } else if (!previous) clients.set(client.id, client)
  }
  const missing = new Set<string>()
  const buckets = new Map<string, Bucket>()
  for (const row of input.attendances) {
    if (!allowed.has(row.sellerKey)) continue
    if (!row.clientId || !row.id) { missing.add(`attendance:${row.id}`); continue }
    const key = JSON.stringify([row.clientId, row.sellerKey])
    const bucket = buckets.get(key) ?? { id: row.id, clientId: row.clientId, sellerKey: row.sellerKey, inbound: null, outbound: null, call: null }
    if (row.id < bucket.id) bucket.id = row.id
    for (const [field, value] of [['inbound', row.inboundAt], ['outbound', row.outboundAt], ['call', row.answeredCallAt]] as const) {
      const at = instant(value)
      if (value !== null && at === null) gaps.add('data_de_atendimento_invalida')
      if (at !== null && civilAt(at) < cutoffDay) bucket[field] = earliest(bucket[field], { at, source: row.source })
    }
    buckets.set(key, bucket)
  }
  const qualified: Qualified[] = []
  for (const bucket of buckets.values()) {
    const bilateral = bucket.inbound && bucket.outbound ? Math.max(bucket.inbound.at, bucket.outbound.at) : null
    const at = bilateral === null ? bucket.call?.at : bucket.call ? Math.min(bilateral, bucket.call.at) : bilateral
    if (at === null || at === undefined) continue
    const source = bucket.call?.at === at ? bucket.call.source : bucket.inbound?.source === 'historical' || bucket.outbound?.source === 'historical' ? 'historical' : 'tracked'
    qualified.push({ ...bucket, at, day: civilAt(at), source })
  }
  qualified.sort((a, b) => a.at - b.at || a.sellerKey.localeCompare(b.sellerKey) || a.id.localeCompare(b.id))

  const salesById = new Map<string, Sale>()
  const conflictingSales = new Set<string>()
  for (const row of input.sales) {
    if (!row.material || !row.sellerKeys.some(s => allowed.has(s))) continue
    if (!row.id) { gaps.add('identificador_de_pedido_ausente'); continue }
    const day = civilOrdinal(row.date)
    if (day === null) { gaps.add('data_de_venda_invalida'); continue }
    if (day >= cutoffDay) continue
    const sellerKeys = [...new Set(row.sellerKeys.filter(s => allowed.has(s)))]
    const previous = salesById.get(row.id)
    if (previous && (previous.clientId !== row.clientId || previous.date !== row.date)) {
      conflictingSales.add(row.id)
      gaps.add('pedido_com_vinculo_conflitante')
    } else if (previous) {
      salesById.set(row.id, { ...previous, sellerKeys: [...new Set([...previous.sellerKeys, ...sellerKeys])], link: previous.link ?? row.link, sameDayConfirmed: previous.sameDayConfirmed === true || row.sameDayConfirmed === true })
    } else salesById.set(row.id, { ...row, sellerKeys, day })
  }
  for (const id of conflictingSales) salesById.delete(id)
  const sales = [...salesById.values()].sort((a, b) => a.day - b.day || a.id.localeCompare(b.id))
  // A sale after the cohort's final entry can still convert that customer.
  const relevantSale = (sale: Sale) => sale.day >= from && sale.day < to + input.windowDays
  const unlinkedSales = sales.filter(s => relevantSale(s) && (!s.clientId || !s.link || !clients.has(s.clientId))).length + conflictingSales.size
  if (unlinkedSales) gaps.add('vendas_sem_vinculo_confirmado')
  for (const sale of sales) if (relevantSale(sale) && sale.clientId && !clients.has(sale.clientId)) missing.add(`client:${sale.clientId}`)
  const linked = sales.filter(s => s.clientId && s.link && clients.has(s.clientId))
  const salesByClient = new Map<string, Sale[]>()
  for (const sale of linked) {
    const collection = salesByClient.get(sale.clientId!) ?? []
    collection.push(sale)
    salesByClient.set(sale.clientId!, collection)
  }

  const summarize = (rows: Qualified[], sellerKey: string | null) => {
    const result = metrics()
    const details: ConversaoClientDetail[] = []
    for (const row of rows) {
      if (row.day < from || row.day >= to || row.day >= cutoffDay) continue
      const client = clients.get(row.clientId)
      if (client?.classification === 'internal') continue
      result.attended++
      if (!client) missing.add(`client:${row.clientId}`)
      const clientSales = salesByClient.get(row.clientId) ?? []
      const scopedSales = sellerKey === null ? clientSales : clientSales.filter(s => s.sellerKeys.includes(sellerKey))
      const firstCompanyPurchase = client?.firstCompanyPurchaseDate ? civilOrdinal(client.firstCompanyPurchaseDate) : null
      if (client?.firstCompanyPurchaseDate && firstCompanyPurchase === null) gaps.add('data_de_compra_anterior_invalida')
      const recurrent = firstCompanyPurchase !== null && firstCompanyPurchase < row.day || clientSales.some(s => s.day < row.day)
      const withinWindow = scopedSales.filter(s => s.day >= row.day && s.day <= row.day + input.windowDays)
      const ambiguousDayZero = withinWindow.some(s => s.day === row.day && s.sameDayConfirmed !== true)
        || firstCompanyPurchase === row.day && !withinWindow.some(s => s.day === row.day && s.sameDayConfirmed === true)
      const confirmed = withinWindow.filter(s => s.day !== row.day || s.sameDayConfirmed === true)
      const mature = row.day + input.windowDays < cutoffDay
      let status: ConversaoClientDetail['status']
      if (!client || client.classification === 'pending') {
        status = 'unclassified'
        result.unclassified++
        gaps.add('clientes_sem_classificacao')
      } else if (recurrent) {
        status = 'recurrent'
        result.recurrent++
      } else if (!mature || ambiguousDayZero) {
        status = 'pending'
        result.pending++
        if (ambiguousDayZero) gaps.add('compra_no_mesmo_dia_sem_ordem_confirmada')
      } else {
        result.mature++
        result.linkedOrders += confirmed.length
        if (confirmed.length) { status = 'buyer'; result.buyers++ } else status = 'not_buyer'
      }
      details.push({
        id: row.id, clientId: row.clientId, name: client?.name ?? '', phone: client?.phone ?? '', sellerKey: row.sellerKey,
        firstAttendedAt: new Date(row.at).toISOString(), maturesAt: civilDate(row.day + input.windowDays + 1), status,
        sales: withinWindow.map(s => ({ id: s.id, date: s.date, orderNumber: s.orderNumber })),
        evidence: { inboundAt: iso(row.inbound), outboundAt: iso(row.outbound), answeredCallAt: iso(row.call), source: row.source },
      })
    }
    result.ratePct = result.mature ? result.buyers / result.mature * 100 : null
    result.clientsPerBuyer = result.buyers ? result.mature / result.buyers : null
    return { result, details }
  }

  const firstByClient = new Map<string, Qualified>()
  for (const row of qualified) if (!firstByClient.has(row.clientId)) firstByClient.set(row.clientId, row)
  const summary = summarize([...firstByClient.values()], null).result
  const details: ConversaoClientDetail[] = []
  const sellerResults = sellers.map(seller => {
    const { result, details: ownDetails } = summarize(qualified.filter(a => a.sellerKey === seller.key), seller.key)
    details.push(...ownDetails)
    return { ...seller, ...result }
  })
  if (!input.captureVerified) gaps.add('captura_ainda_nao_verificada')
  const captureAt = instant(input.captureSince)
  if (captureAt === null) gaps.add('inicio_da_captura_nao_confirmado')
  else {
    const captureDay = civilAt(captureAt)
    // Starting capture halfway through the selected first day leaves a gap.
    const captureClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(captureAt))
    if (captureDay > from || captureDay === from && (captureClock !== '00:00:00' || captureAt % 1000 !== 0)) gaps.add('coorte_anterior_ao_inicio_da_captura')
  }
  if (missing.size) gaps.add('identidades_ausentes')
  return {
    summary, sellers: sellerResults, clients: details,
    quality: { status: gaps.size ? 'partial' : 'verified', captureSince: input.captureSince, unlinkedSales, missingIdentity: missing.size, gaps: [...gaps].sort() },
  }
}
