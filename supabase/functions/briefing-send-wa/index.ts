import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WASCRIPT_BASE = 'https://api-whatsapp.wascript.com.br'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

async function enviarWascript(token: string, phone: string, mensagem: string): Promise<{ ok: boolean, detail?: string }> {
  const phoneNum = normalizePhone(phone)
  // Wascript real: POST /api/enviar-texto/{token} body: { phone, message }
  const url = `${WASCRIPT_BASE}/api/enviar-texto/${token}`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneNum, message: mensagem }),
    })
    const txt = await r.text()
    if (!r.ok) return { ok: false, detail: `${r.status}: ${txt.slice(0, 300)}` }
    return { ok: true, detail: txt.slice(0, 300) }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
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
  const { vendedor_nome, force_resend, mensagem_extra } = body
  if (!vendedor_nome) {
    return new Response(JSON.stringify({ error: 'vendedor_nome obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: vendor, error: errV } = await supa.from('vendors')
    .select('name, phone_self, wascript_token, ativo')
    .eq('name', vendedor_nome)
    .single()
  if (errV || !vendor) {
    return new Response(JSON.stringify({ error: 'vendor_not_found', vendedor_nome }), { status: 404, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (!vendor.ativo) {
    return new Response(JSON.stringify({ ok: false, motivo: 'vendor_inativo' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (!vendor.phone_self) {
    return new Response(JSON.stringify({ ok: false, motivo: 'phone_self_nao_cadastrado' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (!vendor.wascript_token) {
    return new Response(JSON.stringify({ ok: false, motivo: 'wascript_token_ausente' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const { data: briefing } = await supa.from('coach_briefings')
    .select('*')
    .eq('vendedor_nome', vendedor_nome)
    .eq('data_ref', hoje)
    .maybeSingle()

  if (!briefing) {
    return new Response(JSON.stringify({ ok: false, motivo: 'briefing_nao_existe_hoje' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (briefing.enviado_wa && !force_resend) {
    return new Response(JSON.stringify({ ok: true, ja_enviado: true, enviado_at: briefing.enviado_at }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let texto = String(briefing.resumo_md || '')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^##\s+/gm, '')
    .replace(/^#\s+/gm, '')
  if (mensagem_extra) texto += `\n\n${mensagem_extra}`

  const r = await enviarWascript(vendor.wascript_token, vendor.phone_self, texto)

  await supa.from('coach_briefings').update({
    enviado_wa: r.ok,
    enviado_at: r.ok ? new Date().toISOString() : null,
  }).eq('id', briefing.id)

  return new Response(JSON.stringify({
    ok: r.ok,
    vendedor_nome,
    phone_self: vendor.phone_self,
    detail: r.detail,
    preview_texto: texto.slice(0, 200),
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
