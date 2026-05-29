import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method === 'POST') {
    const auth = req.headers.get('authorization') ?? ''
    if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
    }
  }

  const u = new URL(req.url)
  const incluirSemCards = u.searchParams.get('incluir_sem_cards') === '1'

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: vendedores } = await supa.from('vendors').select('id, name, key, ativo').eq('ativo', true).order('name')
  if (!vendedores) return new Response(JSON.stringify({ error: 'sem_vendedores' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })

  // Pega TODOS os chats reais do WhatsApp Web com last_message_at
  const { data: chats, error: errChats } = await supa.from('wa_chat_labels')
    .select('vendedor_nome, phone, label_ids, last_message_at')
    .limit(50000)
  if (errChats) return new Response(JSON.stringify({ error: 'select_failed', detail: errChats.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })

  // Mapping label_id (Wascript) → nome canônico
  const { data: mapaLabels } = await supa.from('wascript_etiquetas')
    .select('vendedor_nome, etiqueta_id_wascript, etiqueta_nome_normalizado')
  const labelMap = new Map<string, string>()
  for (const m of (mapaLabels || [])) {
    if (!m.etiqueta_nome_normalizado) continue
    labelMap.set(`${m.vendedor_nome}::${m.etiqueta_id_wascript}`, String(m.etiqueta_nome_normalizado).toUpperCase().trim())
  }

  // Classificador temporal
  const agora = Date.now()
  const DIA = 86400_000
  function classificarStatus(ts: string | null): 'fresco' | 'recente' | 'parado' | 'sem_dado' {
    if (!ts) return 'sem_dado'
    const diff = agora - new Date(ts).getTime()
    if (diff < 1 * DIA) return 'fresco'
    if (diff < 3 * DIA) return 'recente'
    if (diff < 30 * DIA) return 'parado'
    return 'sem_dado'
  }

  type Cell = { total: number, fresco: number, recente: number, parado: number, sem_dado: number }
  const matriz = new Map<string, Map<string, Cell>>()
  const totalPorVendor = new Map<string, number>()
  const totalPorEtiqueta = new Map<string, number>()
  const semEtiquetaPorVendor = new Map<string, Cell>()

  function ensureCell(map: Map<string, Cell>, key: string): Cell {
    if (!map.has(key)) map.set(key, { total: 0, fresco: 0, recente: 0, parado: 0, sem_dado: 0 })
    return map.get(key)!
  }

  for (const c of (chats || [])) {
    const v = String(c.vendedor_nome || '')
    if (!v) continue
    const status = classificarStatus(c.last_message_at)
    totalPorVendor.set(v, (totalPorVendor.get(v) || 0) + 1)
    const ids = Array.isArray(c.label_ids) ? c.label_ids : []
    if (ids.length === 0) {
      const cell = ensureCell(semEtiquetaPorVendor as any, v)
      cell.total++
      cell[status]++
      continue
    }
    if (!matriz.has(v)) matriz.set(v, new Map())
    const linha = matriz.get(v)!
    let etiquetaCanonical: string | null = null
    for (const id of ids) {
      const nome = labelMap.get(`${v}::${id}`)
      if (nome) { etiquetaCanonical = nome; break }
    }
    if (!etiquetaCanonical) continue  // label_id não mapeado
    const cell = ensureCell(linha, etiquetaCanonical)
    cell.total++
    cell[status]++
    totalPorEtiqueta.set(etiquetaCanonical, (totalPorEtiqueta.get(etiquetaCanonical) || 0) + 1)
  }

  const linhasOut = vendedores
    .filter(v => incluirSemCards || (totalPorVendor.get(v.name) || 0) > 0)
    .map(v => {
      const linha = matriz.get(v.name)
      const celulas: Record<string, Cell> = {}
      for (const [etiq, cell] of (linha || [])) {
        celulas[etiq] = cell
      }
      return {
        vendedor_id: v.id,
        vendedor: v.name,
        total: totalPorVendor.get(v.name) || 0,
        sem_etiqueta: semEtiquetaPorVendor.get(v.name) || { total: 0, fresco: 0, recente: 0, parado: 0, sem_dado: 0 },
        celulas,
      }
    })
    .sort((a, b) => b.total - a.total)

  const colunas = Array.from(totalPorEtiqueta.entries())
    .map(([etiqueta, total]) => ({
      stage_id: etiqueta,
      etiqueta,
      position: 999,
      total,
    }))
    .sort((a, b) => b.total - a.total)

  let totalSemEtiqueta = 0
  for (const cell of semEtiquetaPorVendor.values()) totalSemEtiqueta += cell.total

  return new Response(JSON.stringify({
    ok: true,
    gerado_em: new Date().toISOString(),
    fonte: 'wa_chat_labels',
    vendedores_sincronizando: linhasOut.length,
    vendedores_total_ativos: vendedores.length,
    total_geral: (chats || []).length,
    total_sem_etiqueta: totalSemEtiqueta,
    colunas,
    linhas: linhasOut,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
