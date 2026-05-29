// orcamento-enviar-meu-zap v4: resolve vendedor via JWT email + vendors.email
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function decodeJwt(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(payload + '='.repeat((4 - payload.length % 4) % 4))
    return JSON.parse(json)
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const body = await req.json().catch(() => ({}))
  const vendedor = String(body.vendedor_nome || '').trim().toUpperCase()
  const telefoneDireto = String(body.telefone_destino || '').replace(/[^\d]/g, '')
  const pdfUrl = String(body.pdf_url || '').trim()
  const filename = String(body.filename || 'orcamento.pdf').trim()
  const clienteNome = String(body.cliente_nome || '').trim()
  const caption = String(body.caption || '').trim()

  if (!pdfUrl) return new Response(JSON.stringify({ error: 'sem_pdf_url' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  let telefone = ''
  let vendedorResolvido = vendedor

  // PRIORIDADE 1: telefone_destino direto (vindo da extensão)
  if (telefoneDireto && telefoneDireto.length >= 10 && telefoneDireto.length <= 15) {
    telefone = telefoneDireto
  }

  // PRIORIDADE 2: nome do vendedor (passado pelo front)
  if (!telefone && vendedor) {
    const { data: v } = await supa.from('vendors').select('name, telefone').eq('name', vendedor).maybeSingle()
    if (v?.telefone) { telefone = String(v.telefone).replace(/[^\d]/g, ''); vendedorResolvido = v.name }
  }

  // PRIORIDADE 3: email do JWT (login do branorte-crm) → vendors.email
  if (!telefone) {
    const authHeader = req.headers.get('authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const jwt = decodeJwt(token)
    const email = String(jwt?.email || '').toLowerCase().trim()
    if (email) {
      const { data: v } = await supa.from('vendors').select('name, telefone').ilike('email', email).maybeSingle()
      if (v?.telefone) {
        telefone = String(v.telefone).replace(/[^\d]/g, '')
        vendedorResolvido = v.name
      }
    }
  }

  if (!telefone) {
    return new Response(JSON.stringify({
      error: 'sem_telefone',
      detail: 'Não consegui identificar seu telefone. Opções: 1) Recarregar extensão pra v1.4.5+ 2) Admin popular vendors.email com seu email de login 3) Passar telefone_destino manual.',
    }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Se ainda não resolvi o vendedor, tenta pelo telefone
  if (!vendedorResolvido) {
    const { data: vById } = await supa.from('vendors').select('name').eq('telefone', telefone).maybeSingle()
    if (vById?.name) vendedorResolvido = vById.name
  }
  if (!vendedorResolvido) vendedorResolvido = 'DESCONHECIDO'

  const chatId = `${telefone}@c.us`
  const bodyMsg = caption || `📄 Orçamento ${clienteNome ? '— ' + clienteNome : ''}\n\nGerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`

  const { data: sched, error: schErr } = await supa.from('wa_scheduled_messages').insert({
    vendedor_nome: vendedorResolvido,
    chat_id: chatId,
    contato_numero: telefone,
    contato_nome: 'Eu (orçamento)',
    body: bodyMsg,
    media_url: pdfUrl,
    media_filename: filename,
    media_type: 'document',
    scheduled_at: new Date().toISOString(),
    status: 'pending',
  }).select('id').single()

  if (schErr) {
    return new Response(JSON.stringify({ error: 'schedule_failed', detail: schErr.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  return new Response(JSON.stringify({
    ok: true,
    scheduled_id: sched.id,
    vendedor: vendedorResolvido,
    telefone,
    msg: `Orçamento agendado pra ${vendedorResolvido} (+${telefone}). Chega em até 30s.`,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
