import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Checa o heartbeat do daemon sync-orcamentos.mjs (PC do admin) e, se estiver
// caido (sem heartbeat) ou com a pasta Z: inacessivel, dispara um alerta no
// WhatsApp do admin via Wascript. Roda 100% server-side (chamado pelo pg_cron
// "sync-health-alert-5min"), entao funciona mesmo se o PC do escritorio estiver
// desligado. Dedup via alert_recuperado/alerted_at na tabela sync_heartbeat.

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WASCRIPT_BASE = 'https://api-whatsapp.wascript.com.br'

const SERVICE = 'orcamentos-z-sync'
const STALE_MIN = 20      // sem heartbeat por 20min = daemon caido
const REALERT_MIN = 120   // re-lembrar a cada 2h enquanto continua com problema

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

async function enviarWascript(token: string, phone: string, mensagem: string) {
  const url = `${WASCRIPT_BASE}/api/enviar-texto/${token}`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalizePhone(phone), message: mensagem }),
    })
    const txt = await r.text()
    return { ok: r.ok, detail: txt.slice(0, 200) }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (auth !== SHARED_SECRET && auth !== SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: hb } = await supa.from('sync_heartbeat').select('*').eq('service', SERVICE).maybeSingle()
  if (!hb) {
    return new Response(JSON.stringify({ ok: false, motivo: 'sem heartbeat row' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const agora = Date.now()
  const lastTick = hb.last_tick ? new Date(hb.last_tick).getTime() : 0
  const minsSemTick = Math.floor((agora - lastTick) / 60000)
  const daemonCaido = minsSemTick >= STALE_MIN
  const zForaTbm = hb.z_ok === false
  const comProblema = daemonCaido || zForaTbm

  let motivo = ''
  if (daemonCaido) motivo = `Daemon de sync parado ha ${minsSemTick} min (sem heartbeat).`
  else if (zForaTbm) motivo = `Daemon vivo, mas a pasta Z: esta INACESSIVEL (${hb.detail ?? ''}).`

  const alertedAt = hb.alerted_at ? new Date(hb.alerted_at).getTime() : 0
  const minsDesdeAlerta = Math.floor((agora - alertedAt) / 60000)

  let acao = 'nada'
  if (comProblema) {
    if (hb.alert_recuperado !== false) acao = 'alertar'
    else if (minsDesdeAlerta >= REALERT_MIN) acao = 'realertar'
  } else {
    if (hb.alert_recuperado === false) acao = 'recuperado'
  }

  if (acao === 'nada') {
    return new Response(JSON.stringify({ ok: true, acao, daemonCaido, zForaTbm, minsSemTick }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const vendorNome = hb.alert_vendor_nome || 'DANIEL'
  const { data: vendor } = await supa.from('vendors').select('name, telefone, wascript_token, ativo').eq('name', vendorNome).maybeSingle()
  if (!vendor?.telefone || !vendor?.wascript_token) {
    return new Response(JSON.stringify({ ok: false, motivo: 'destinatario sem telefone/token', vendorNome }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const msg = acao === 'recuperado'
    ? `✅ *Sync de orcamentos normalizado*\nVoltou a entregar na pasta Z: (${hb.detail ?? 'ok'}).`
    : `⚠️ *Sync de orcamentos com problema*\n\n${motivo}\n\nOrcamentos podem NAO estar chegando na pasta Z:. Confira o PC do escritorio (daemon sync-orcamentos.mjs) e o drive Z:.\n\nUltimo sinal: ${hb.last_tick ?? '-'}`

  const r = await enviarWascript(vendor.wascript_token, vendor.telefone, msg)

  await supa.from('sync_heartbeat').update({
    alerted_at: new Date().toISOString(),
    alert_recuperado: !comProblema,
  }).eq('service', SERVICE)

  return new Response(JSON.stringify({ ok: r.ok, acao, enviado: r.ok, vendor: vendorNome, detail: r.detail }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
