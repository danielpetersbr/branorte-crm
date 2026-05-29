import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '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'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

async function embedBatch(textos: string[]): Promise<(number[] | null)[]> {
  if (!textos.length) return []
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: textos.map(t => t.slice(0, 4000)) }),
    })
    if (!r.ok) return textos.map(() => null)
    const j = await r.json()
    return (j.data || []).map((d: any) => d.embedding || null)
  } catch { return textos.map(() => null) }
}

function extrairTextoMsg(m: any): string {
  if (m.body) return String(m.body)
  if (m.transcricao) return `[áudio] ${m.transcricao}`
  if (m.caption) return String(m.caption)
  return ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const op = body.op

  // ============================================================
  // OP: index — indexa lote de mensagens de um chat
  // ============================================================
  if (op === 'index') {
    const { chat_id, vendedor_nome, mensagens } = body
    if (!chat_id || !Array.isArray(mensagens)) {
      return new Response(JSON.stringify({ error: 'chat_id e mensagens[] obrigatorios' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    // Filtra com texto útil + dedupe via msg_id
    const candidatos = mensagens
      .map((m: any) => ({ m, texto: extrairTextoMsg(m).trim() }))
      .filter((x: any) => x.texto.length >= 5 && x.texto.length <= 2000)
      .slice(0, 80)
    if (!candidatos.length) {
      return new Response(JSON.stringify({ ok: true, indexed: 0, skipped: 'sem_texto_util' }), { headers: { ...CORS, 'content-type': 'application/json' } })
    }
    // Chega já indexados
    const ids = candidatos.map((x: any) => x.m.id || x.m.msg_id).filter(Boolean)
    let jaIndexados = new Set<string>()
    if (ids.length) {
      const { data } = await supa.from('wa_chat_embeddings').select('msg_id').eq('chat_id', chat_id).in('msg_id', ids)
      if (Array.isArray(data)) jaIndexados = new Set(data.map((d: any) => d.msg_id))
    }
    const novos = candidatos.filter((x: any) => {
      const mid = x.m.id || x.m.msg_id
      return !mid || !jaIndexados.has(mid)
    })
    if (!novos.length) {
      return new Response(JSON.stringify({ ok: true, indexed: 0, skipped: 'todos_ja_indexados' }), { headers: { ...CORS, 'content-type': 'application/json' } })
    }
    // Embeddings em lote
    const textos = novos.map((x: any) => x.texto)
    const embs = await embedBatch(textos)
    const rows = novos.map((x: any, i: number) => ({
      chat_id,
      vendedor_nome: vendedor_nome || null,
      msg_id: x.m.id || x.m.msg_id || null,
      conteudo: x.texto,
      from_me: !!x.m.fromMe,
      msg_type: x.m.type || null,
      data_msg: x.m.t ? new Date(x.m.t * 1000).toISOString() : null,
      embedding: embs[i],
    })).filter((r: any) => r.embedding)
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: true, indexed: 0, skipped: 'embed_failed' }), { headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const { error } = await supa.from('wa_chat_embeddings').upsert(rows, { onConflict: 'chat_id,msg_id', ignoreDuplicates: true })
    if (error) return new Response(JSON.stringify({ error: 'insert_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true, indexed: rows.length }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // ============================================================
  // OP: search — busca semantica nas mensagens de um chat
  // ============================================================
  if (op === 'search') {
    const { chat_id, query, limit, threshold } = body
    if (!chat_id || !query) {
      return new Response(JSON.stringify({ error: 'chat_id e query obrigatorios' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const [emb] = await embedBatch([query])
    if (!emb) return new Response(JSON.stringify({ error: 'embed_failed' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    const { data, error } = await supa.rpc('match_chat_messages', {
      query_embedding: emb,
      match_chat_id: chat_id,
      match_count: Math.min(20, parseInt(limit || 5, 10)),
      match_threshold: typeof threshold === 'number' ? threshold : 0.55,
    })
    if (error) return new Response(JSON.stringify({ error: 'rpc_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true, hits: data || [] }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  return new Response(JSON.stringify({ error: 'op invalido (use index ou search)' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
})
