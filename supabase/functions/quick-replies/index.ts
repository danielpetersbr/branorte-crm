import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (token !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS, 'content-type': 'application/json' },
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  const url = new URL(req.url)

  if (req.method === 'GET') {
    const vendedor = (url.searchParams.get('vendedor') ?? '').toUpperCase().trim()
    if (!vendedor) {
      return new Response(JSON.stringify({ error: 'vendedor obrigatório' }), {
        status: 400, headers: { ...CORS, 'content-type': 'application/json' },
      })
    }
    const { data, error } = await sb
      .from('quick_replies')
      .select('*')
      .or(`vendedor_nome.eq.${vendedor},is_shared.eq.true`)
      .order('usage_count', { ascending: false })
      .order('title')
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, items: data ?? [] }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  if (req.method === 'POST') {
    let body: any
    try { body = await req.json() } catch {
      return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    }

    if (body.id) {
      const update: any = {
        title: body.title,
        body: body.body ?? '',
        slug: body.slug ?? null,
        category: body.category ?? 'GERAL',
        type: body.type ?? 'text',
        variables: body.variables ?? [],
        is_shared: !!body.is_shared,
        updated_at: new Date().toISOString(),
      }
      // Mantem ou substitui campos de mídia se mandados
      if ('media_url' in body) update.media_url = body.media_url
      if ('media_type' in body) update.media_type = body.media_type
      if ('media_filename' in body) update.media_filename = body.media_filename
      if ('media_size_kb' in body) update.media_size_kb = body.media_size_kb

      const { data, error } = await sb
        .from('quick_replies')
        .update(update)
        .eq('id', body.id)
        .select()
        .single()
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ ok: true, item: data }), { headers: { ...CORS, 'content-type': 'application/json' } })
    }

    if (body.action === 'use' && body.id_uso) {
      await sb.rpc('increment_quick_reply_usage', { reply_id: body.id_uso }).then(() => {}, () => {})
      const { data: cur } = await sb.from('quick_replies').select('usage_count').eq('id', body.id_uso).single()
      await sb.from('quick_replies').update({
        usage_count: (cur?.usage_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      }).eq('id', body.id_uso)
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'content-type': 'application/json' } })
    }

    const vendedor = (body.vendedor_nome ?? '').toUpperCase().trim()
    if (!vendedor || !body.title) {
      return new Response(JSON.stringify({ error: 'vendedor_nome e title são obrigatórios' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const insert: any = {
      vendedor_nome: vendedor,
      title: body.title,
      body: body.body ?? '',
      slug: body.slug ?? null,
      category: body.category ?? 'GERAL',
      type: body.type ?? 'text',
      variables: body.variables ?? [],
      is_shared: !!body.is_shared,
    }
    if (body.media_url) insert.media_url = body.media_url
    if (body.media_type) insert.media_type = body.media_type
    if (body.media_filename) insert.media_filename = body.media_filename
    if (body.media_size_kb) insert.media_size_kb = body.media_size_kb

    const { data, error } = await sb.from('quick_replies').insert(insert).select().single()
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true, item: data }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return new Response(JSON.stringify({ error: 'id obrigatório' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    const { error } = await sb.from('quick_replies').delete().eq('id', id)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  return new Response('method not allowed', { status: 405, headers: CORS })
})
