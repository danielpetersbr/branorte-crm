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
  const { op, vendedor_nome, briefing_id } = body
  if (!op) return new Response(JSON.stringify({ error: 'op obrigatorio (pendente|marcar_visto)' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  if (op === 'pendente') {
    if (!vendedor_nome) return new Response(JSON.stringify({ error: 'vendedor_nome obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    const hoje = new Date().toISOString().slice(0, 10)
    const { data, error } = await supa.from('coach_briefings')
      .select('*')
      .eq('vendedor_nome', vendedor_nome)
      .eq('data_ref', hoje)
      .is('visualizado_extensao_at', null)
      .maybeSingle()
    if (error) return new Response(JSON.stringify({ error: 'select_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true, briefing: data || null }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  if (op === 'marcar_visto') {
    if (!briefing_id) return new Response(JSON.stringify({ error: 'briefing_id obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    const { error } = await supa.from('coach_briefings')
      .update({ visualizado_extensao_at: new Date().toISOString() })
      .eq('id', briefing_id)
    if (error) return new Response(JSON.stringify({ error: 'update_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  return new Response(JSON.stringify({ error: 'op invalido', op }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
})
