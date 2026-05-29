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

  // Autoriza: GET pode ser público (consumido pelo painel web).
  // POST exige Bearer (interno).
  if (req.method === 'POST') {
    const auth = req.headers.get('authorization') ?? ''
    if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
    }
  }

  // Aceita vendedor_nome via query (?vendedor=X) ou body (POST)
  let vendedor_nome: string | null = null
  const u = new URL(req.url)
  vendedor_nome = u.searchParams.get('vendedor') || u.searchParams.get('vendedor_nome')
  if (!vendedor_nome && req.method === 'POST') {
    try { const body = await req.json(); vendedor_nome = body?.vendedor_nome ?? null } catch {}
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  // Busca cards + stage + vendor — direto via query builder
  let q = supa.from('cards')
    .select('id, last_message_at, pipeline_stages!inner(name, position), vendors:owner_id(name)')
    .eq('is_archived', false)
  if (vendedor_nome) q = q.eq('vendors.name', vendedor_nome)
  const { data: cards, error } = await q.limit(10000)
  if (error) {
    return new Response(JSON.stringify({ error: 'select_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const agora = Date.now()
  const DIA = 86400_000
  // Buckets temporais (compatíveis com o painel /etiquetas-zap/painel)
  // - Fresco: últimas 24h
  // - Recente: 24h-3d
  // - Parado: 3d-30d
  // - SemDado: >30d ou null
  type Bucket = 'fresco' | 'recente' | 'parado' | 'sem_dado'
  function classificar(ts: string | null): Bucket {
    if (!ts) return 'sem_dado'
    const dt = new Date(ts).getTime()
    const diff = agora - dt
    if (diff < 1 * DIA) return 'fresco'
    if (diff < 3 * DIA) return 'recente'
    if (diff < 30 * DIA) return 'parado'
    return 'sem_dado'
  }

  // Agrega: etiqueta -> { fresco, recente, parado, sem_dado, total, position }
  const mapa = new Map<string, { etiqueta: string, position: number, fresco: number, recente: number, parado: number, sem_dado: number, total: number }>()
  for (const c of (cards || [])) {
    const etiq = c.pipeline_stages?.name || 'SEM ETIQUETA'
    const pos = c.pipeline_stages?.position ?? 999
    let r = mapa.get(etiq)
    if (!r) {
      r = { etiqueta: etiq, position: pos, fresco: 0, recente: 0, parado: 0, sem_dado: 0, total: 0 }
      mapa.set(etiq, r)
    }
    r.total++
    r[classificar(c.last_message_at)]++
  }

  // Ordena por posição do pipeline
  const linhas = Array.from(mapa.values()).sort((a, b) => a.position - b.position)

  // Totais agregados
  const totais = linhas.reduce((acc, l) => ({
    fresco: acc.fresco + l.fresco,
    recente: acc.recente + l.recente,
    parado: acc.parado + l.parado,
    sem_dado: acc.sem_dado + l.sem_dado,
    total: acc.total + l.total,
  }), { fresco: 0, recente: 0, parado: 0, sem_dado: 0, total: 0 })

  return new Response(JSON.stringify({
    ok: true,
    vendedor_nome,
    gerado_em: new Date().toISOString(),
    totais,
    linhas,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
