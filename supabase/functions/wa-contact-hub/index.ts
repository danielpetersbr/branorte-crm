import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '86400',
}

const TABELAS = {
  notes: 'wa_notes',
  scheduled: 'wa_scheduled_messages',
  reminders: 'wa_reminders',
  calendar: 'wa_calendar_events',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // Auth
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return json({ error: 'unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const resource = parts[parts.length - 1]

  // ANA only: the shared-auth worker never receives the service credential or bypasses the CRM decision.
  if (req.method === 'POST' && resource === 'ana-automation-gate') {
    try {
      const raw = await req.text()
      if (raw.length > 2048) return json({ allowed: false, reason: 'invalid_gate_request' }, 413)
      const body = JSON.parse(raw) as Record<string, unknown>
      if (body.vendedor_nome !== 'ANA' || typeof body.chat_id !== 'string' || !/^\d{1,40}@(lid|c\.us)$/.test(body.chat_id)) {
        return json({ allowed: false, reason: 'invalid_gate_request' }, 400)
      }
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const hasClose = Object.prototype.hasOwnProperty.call(body, 'close')
      if (hasClose && (!body.close || typeof body.close !== 'object' || Array.isArray(body.close))) return json({ allowed: false, reason: 'invalid_gate_request' }, 400)
      const { data, error } = hasClose
        ? await sb.rpc('crm_ana_close_label_gate', { p_chat_id: body.chat_id, p_close: body.close })
        : await sb.rpc('crm_ana_automation_gate', { p_chat_id: body.chat_id })
      if (error || !data || typeof data.allowed !== 'boolean') return json({ allowed: false, reason: 'gate_unavailable' }, 503)
      return json(data)
    } catch { return json({ allowed: false, reason: 'gate_unavailable' }, 503) }
  }

  // Server-side private Broadcast -> authenticated VPS stream. No client data or JWT is exposed.
  if (req.method === 'GET' && resource === 'crm-events') {
    if (url.searchParams.get('vendedor') !== 'ANA') return json({ error: 'invalid_worker' }, 400)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const encoder = new TextEncoder()
    let channel: ReturnType<typeof sb.channel>, pulse: ReturnType<typeof setInterval>, expiry: ReturnType<typeof setTimeout>
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(pulse); clearTimeout(expiry)
      req.signal.removeEventListener('abort', close)
      if (channel) void sb.removeChannel(channel)
    }
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (frame: string) => { if (!closed) { try { controller.enqueue(encoder.encode(frame)) } catch { close() } } }
        const finish = () => { if (!closed) { close(); try { controller.close() } catch {} } }
        if (req.signal.aborted) { finish(); return }
        req.signal.addEventListener('abort', close, { once: true })
        pulse = setInterval(() => send(': heartbeat\n\n'), 15000)
        expiry = setTimeout(finish, 110000)
        send(': connecting\n\n')
        try { await sb.realtime.setAuth(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) } catch { finish(); return }
        if (closed) return
        channel = sb.channel('crm-worker:ANA', { config: { private: true } })
          .on('broadcast', { event: 'wake' }, () => send('event: wake\ndata: {}\n\n'))
          .subscribe((status, error) => {
            if (status === 'SUBSCRIBED') send('event: ready\ndata: {}\n\n')
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { console.warn('[crm-stream]', status, error?.message?.slice(0, 160)); finish() }
          })
      },
      cancel: close,
    })
    return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } })
  }

  // BULK aditivo: reminders + scheduled de TODOS os vendedores numa unica chamada.
  // Substitui o loop por vendedor (N x 2 chamadas) por 1 chamada. Paths antigos seguem iguais.
  if (req.method === 'GET' && resource === 'bulk') {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const status = url.searchParams.get('status')
    const vendedor = url.searchParams.get('vendedor')
    async function load(tab: string, orderCol: string) {
      let q = sb.from(tab).select('*')
      if (status) q = q.eq('status', status)
      if (vendedor) q = q.eq('vendedor_nome', vendedor.toUpperCase())
      const { data, error } = await q.order(orderCol, { ascending: true }).limit(2000)
      if (error) throw new Error(error.message)
      return data ?? []
    }
    try {
      const [reminders, scheduled] = await Promise.all([
        load('wa_reminders', 'remind_at'),
        load('wa_scheduled_messages', 'scheduled_at'),
      ])
      return json({ reminders, scheduled })
    } catch (e) {
      return json({ error: 'server_error', detail: String(e).slice(0, 300) }, 500)
    }
  }

  // ANUNCIO (v8, 17/09/2026) — ADITIVO, no mesmo padrao do `bulk`.
  // Mostra pro vendedor QUAL ANUNCIO o cliente viu antes de cair no WhatsApp dele,
  // com o link do video/arte. Medido em 17/09: 71% dos leads entregues sabem o anuncio
  // e 61,6% tem o link do video.
  //   GET /wa-contact-hub/anuncio?phone=5548999...
  // Resposta: { ok, tem: bool, anuncio: {...} | null }
  if (req.method === 'GET' && resource === 'anuncio') {
    const phone = url.searchParams.get('phone') ?? url.searchParams.get('telefone')
    if (!phone) return json({ error: 'phone_required' }, 400)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    try {
      const { data, error } = await sb.rpc('anuncio_do_cliente', { p_telefone: phone })
      if (error) return json({ error: error.message }, 500)
      const item = Array.isArray(data) ? data[0] : data
      return json({ ok: true, tem: !!item, anuncio: item ?? null })
    } catch (e) {
      return json({ error: 'server_error', detail: String(e).slice(0, 300) }, 500)
    }
  }

  const tabela = TABELAS[resource as keyof typeof TABELAS]
  if (!tabela) {
    return json({ error: 'invalid_resource', valid: [...Object.keys(TABELAS), 'bulk', 'anuncio'] }, 400)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // ===== GET: lista =====
    if (req.method === 'GET') {
      const vendedor = url.searchParams.get('vendedor')
      const chatId = url.searchParams.get('chat_id')
      const status = url.searchParams.get('status')
      let q = sb.from(tabela).select('*')
      if (vendedor) q = q.eq('vendedor_nome', vendedor.toUpperCase())
      if (chatId) q = q.eq('chat_id', chatId)
      if (status) q = q.eq('status', status)

      if (resource === 'notes') q = q.order('is_pinned', { ascending: false }).order('created_at', { ascending: false })
      else if (resource === 'scheduled') q = q.order('scheduled_at', { ascending: true })
      else if (resource === 'reminders') q = q.order('remind_at', { ascending: true })
      else q = q.order('starts_at', { ascending: true })

      const { data, error } = await q.limit(500)
      if (error) return json({ error: error.message }, 500)
      return json({ items: data ?? [] })
    }

    // ===== POST: cria (id) ou atualiza (com id) =====
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      if (body.vendedor_nome) body.vendedor_nome = String(body.vendedor_nome).toUpperCase()
      if (body.id) {
        const id = String(body.id)
        delete body.id
        if (resource === 'notes') (body as any).updated_at = new Date().toISOString()
        const { data, error } = await sb.from(tabela).update(body).eq('id', id).select().single()
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true, item: data })
      }
      const { data, error } = await sb.from(tabela).insert(body).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, item: data }, 201)
    }

    // ===== PATCH: atualizacao parcial via querystring id =====
    if (req.method === 'PATCH') {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id_required' }, 400)
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      if (resource === 'notes') (body as any).updated_at = new Date().toISOString()
      // Claim compare-and-set: duas instâncias nunca recebem sucesso para o mesmo envio.
      // Também impede ressuscitar uma mensagem cancelada quando o vendedor assume a conversa.
      if (resource === 'scheduled' && body.status === 'sending') {
        const { data, error } = await sb.rpc('crm_chat_queue_claim', { p_id: id })
        if (error) return json({ error: error.message }, 500)
        if (!data) return json({ error: 'message_not_pending' }, 409)
        return json({ ok: true, item: data })
      }
      const { data, error } = await sb.from(tabela).update(body).eq('id', id).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, item: data })
    }

    // ===== DELETE =====
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id_required' }, 400)
      const { error } = await sb.from(tabela).delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ error: 'method_not_allowed' }, 405)
  } catch (e) {
    return json({ error: 'server_error', detail: String(e).slice(0, 300) }, 500)
  }
})
