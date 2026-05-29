// leads-pegar-pra-mim v3: safe-eq + CORS allowlist + ready pra rotacao real.
// TODO: remover SECRET_LEGACY_HARDCODED depois que user setar env var nova
// e atualizar extensão com novo secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET_LEGACY_HARDCODED = 'branorte-wa-sync-2026'
const SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET')

const ALLOWED_ORIGINS = new Set(['https://branorte-crm.vercel.app'])

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith('chrome-extension://'))
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://branorte-crm.vercel.app',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Vary': 'Origin',
  }
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function authOk(token: string): boolean {
  if (SECRET && safeEq(token, SECRET)) return true
  if (safeEq(token, SECRET_LEGACY_HARDCODED)) return true
  return false
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!authOk(auth)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...cors, 'content-type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => ({}))
  const limit = Math.min(Number(body.limit ?? 50), 100)

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const supaAud = supa.schema('auditoria') as any

  const { data: filtered } = await supa.rpc('leads_pegar_pra_mim_filtrado', { p_limit: limit })
  const ids = (filtered ?? []).map((l: any) => l.id)
  const totalFiltrado = (filtered ?? []).length

  const { data } = await supaAud.from('atendimentos_por_cliente')
    .select('id, telefone, telefone_norm, nome, data, ultima_msg, last_message_text, qualificacao, motivo_contato, qual_animal, origem, criativo_facebook, channel_type')
    .in('id', ids)
    .order('ultima_msg', { ascending: false, nullsFirst: false })

  return new Response(JSON.stringify({
    ok: true,
    total: totalFiltrado,
    leads: (data ?? []).map((l: any) => ({
      id: l.id, telefone: l.telefone, telefone_norm: l.telefone_norm, nome: l.nome,
      ultima_msg: l.ultima_msg,
      preview: l.last_message_text ? String(l.last_message_text).slice(0, 80) : null,
      qualificacao: l.qualificacao, motivo: l.motivo_contato, animal: l.qual_animal,
      origem: l.origem,
      criativo: l.criativo_facebook?.nome_oficial ?? l.criativo_facebook?.codigo ?? null,
      canal: l.channel_type,
    })),
  }), { headers: { ...cors, 'content-type': 'application/json' } })
})
