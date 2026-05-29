import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
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
  // Path: /wa-contact-hub/<resource> ; resource in {notes, scheduled, reminders, calendar}
  const parts = url.pathname.split('/').filter(Boolean)
  const resource = parts[parts.length - 1]
  const tabela = TABELAS[resource as keyof typeof TABELAS]
  if (!tabela) {
    return json({ error: 'invalid_resource', valid: Object.keys(TABELAS) }, 400)
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

      // Ordenação default por recurso
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
        // Update
        const id = String(body.id)
        delete body.id
        // Sempre atualiza updated_at se a tabela tiver
        if (resource === 'notes') (body as any).updated_at = new Date().toISOString()
        const { data, error } = await sb.from(tabela).update(body).eq('id', id).select().single()
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true, item: data })
      }
      const { data, error } = await sb.from(tabela).insert(body).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, item: data }, 201)
    }

    // ===== PATCH: atualização parcial via querystring id =====
    if (req.method === 'PATCH') {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id_required' }, 400)
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      if (resource === 'notes') (body as any).updated_at = new Date().toISOString()
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
