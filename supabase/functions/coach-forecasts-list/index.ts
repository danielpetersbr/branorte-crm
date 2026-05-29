import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const { vendedor_nome, max_age_days } = body
  if (!vendedor_nome) {
    return new Response(JSON.stringify({ error: 'vendedor_nome obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const cutoff = new Date(Date.now() - (max_age_days || 7) * 86400_000).toISOString().slice(0, 10)

  // pega o forecast MAIS RECENTE por chat_id
  const { data, error } = await supa.from('coach_forecasts')
    .select('chat_id, probabilidade, saude, estagio, motivo, data_ref')
    .eq('vendedor_nome', vendedor_nome)
    .gte('data_ref', cutoff)
    .order('data_ref', { ascending: false })
    .limit(5000)

  if (error) {
    return new Response(JSON.stringify({ error: 'select_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // dedupe por chat_id (mantém o mais recente)
  const seen = new Set<string>()
  const out = []
  for (const r of (data || [])) {
    if (seen.has(r.chat_id)) continue
    seen.add(r.chat_id)
    out.push({ chat_id: r.chat_id, prob: r.probabilidade, saude: r.saude, estagio: r.estagio, motivo: r.motivo })
  }

  return new Response(JSON.stringify({ ok: true, vendedor_nome, count: out.length, forecasts: out }), {
    headers: { ...CORS, 'content-type': 'application/json' },
  })
})
