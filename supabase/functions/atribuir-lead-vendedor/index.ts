// atribuir-lead-vendedor: vendedor pega um lead pra si.
// TODO: remover SECRET_LEGACY_HARDCODED depois que user setar env var.
// Mantém por compatibilidade com extensão atual; melhorias seguranca:
// safe-eq + CORS allowlist.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// TRANSITION: SECRET_LEGACY_HARDCODED matches extensao atual.
// Pra rotacionar de verdade: setar env WA_SYNC_SHARED_SECRET com novo valor,
// atualizar extensao pra usar o novo, bump versao, e remover esta linha.
const SECRET_LEGACY_HARDCODED = 'branorte-wa-sync-2026'
const SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET')

const ALLOWED_ORIGINS = new Set(['https://branorte-crm.vercel.app'])

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith('chrome-extension://'))
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://branorte-crm.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function strip9(phone: string): string {
  const d = String(phone ?? '').replace(/[^\d]/g, '')
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') return d.slice(0, 4) + d.slice(5)
  return d
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
  const telefone = String(body.telefone ?? '').replace(/[^\d]/g, '')
  const vendedorNome = String(body.vendedor_nome ?? '').toUpperCase().trim()
  if (!telefone || telefone.length < 10) return new Response(JSON.stringify({ error: 'telefone_invalido' }), { status: 400, headers: { ...cors, 'content-type': 'application/json' } })
  if (!vendedorNome) return new Response(JSON.stringify({ error: 'vendedor_nome_obrigatorio' }), { status: 400, headers: { ...cors, 'content-type': 'application/json' } })

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const supaAud = supa.schema('auditoria') as any

  const { data: vendAud } = await supaAud.from('wa_vendedores').select('nome, nome_oficial')
  const mapaOficial: Record<string, string> = {}
  for (const v of (vendAud ?? [])) {
    mapaOficial[String(v.nome).toUpperCase().replace(/_/g, ' ')] = v.nome_oficial
  }
  const nomeOficial = mapaOficial[vendedorNome] ?? vendedorNome

  const telStrip = strip9(telefone)
  const { data: atendCheck } = await supaAud.from('auditoria_atendimentos').select('responsavel, telefone_norm')
    .or(`telefone_norm.eq.${telefone},telefone_norm.eq.${telStrip}`).limit(1).maybeSingle()
  if (atendCheck?.responsavel && atendCheck.responsavel !== nomeOficial) {
    return new Response(JSON.stringify({ ok: false, error: 'ja_atribuido', responsavel_atual: atendCheck.responsavel }), { status: 409, headers: { ...cors, 'content-type': 'application/json' } })
  }

  const { data: qtdResult } = await supa.rpc('atendimento_set_responsavel_by_phone', { p_phone: telefone, p_responsavel: nomeOficial })
  const qtdAtualizados = Number(qtdResult ?? 0)

  const { data: vendorRow } = await supa.from('vendors').select('id').ilike('name', vendedorNome).maybeSingle()
  if (vendorRow) {
    const tel12 = telefone.length >= 12 ? telefone : '55' + telefone
    const { data: existing } = await supa.from('contacts').select('id, vendor_id, status')
      .or(`phone.eq.${tel12},telefone_normalizado.eq.${tel12}`).limit(1).maybeSingle()
    if (existing) {
      const updates: any = { updated_at: new Date().toISOString() }
      if (existing.vendor_id !== vendorRow.id) updates.vendor_id = vendorRow.id
      if (existing.status === 'FECHADO') updates.status = 'ABERTO'
      await supa.from('contacts').update(updates).eq('id', existing.id)
    } else {
      await supa.from('contacts').insert({
        phone: tel12, telefone_normalizado: tel12, vendor_id: vendorRow.id,
        status: 'ABERTO', origin: 'pegar-pra-mim',
      })
    }
  }

  return new Response(JSON.stringify({
    ok: true, telefone, vendedor_nome: vendedorNome,
    nome_oficial: nomeOficial, auditoria_atualizados: qtdAtualizados,
  }), { headers: { ...cors, 'content-type': 'application/json' } })
})
