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

async function gerarEmbedding(texto: string): Promise<number[] | null> {
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texto.slice(0, 2000) }),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.data?.[0]?.embedding ?? null
  } catch { return null }
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

  const { vendedor_nome, chat_id, nome_contato, pergunta, resposta, estagio, saude, rating, comentario, contexto_resumo } = body
  if (!vendedor_nome || !pergunta || !resposta || (rating !== 1 && rating !== -1)) {
    return new Response(JSON.stringify({ error: 'campos obrigatorios: vendedor_nome, pergunta, resposta, rating(1|-1)' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  const { error: errInsert } = await supa.from('coach_feedback').insert({
    vendedor_nome, chat_id: chat_id || null, nome_contato: nome_contato || null,
    pergunta, resposta, estagio: estagio || null, saude: saude || null,
    rating, comentario: comentario || null, contexto_resumo: contexto_resumo || null,
  })
  if (errInsert) {
    return new Response(JSON.stringify({ error: 'insert_failed', detail: errInsert.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Se 👍, vira golden example com embedding
  let golden_id: number | null = null
  if (rating === 1) {
    const situacao = (contexto_resumo || pergunta).slice(0, 1500)
    const emb = await gerarEmbedding(situacao)
    const { data, error } = await supa.from('coach_golden_examples').insert({
      vendedor_nome,
      estagio: estagio || null,
      saude: saude || null,
      situacao_resumo: situacao,
      resposta_aprovada: resposta,
      embedding: emb,
    }).select('id').single()
    if (!error && data) golden_id = data.id
  }

  return new Response(JSON.stringify({ ok: true, golden_id }), {
    headers: { ...CORS, 'content-type': 'application/json' },
  })
})
