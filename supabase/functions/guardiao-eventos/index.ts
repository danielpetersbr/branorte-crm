// supabase/functions/guardiao-eventos/index.ts
// Recebe eventos do Guardião de Etiqueta (popup que aparece quando vendedor
// sai de um chat sem atualizar a etiqueta) e grava em guardiao_eventos.
//
// Body:
//   {
//     vendedor_nome: "DANIEL",
//     client_version: "1.5.24",
//     eventos: [
//       {
//         chat_id: "5533999466579@c.us",
//         phone: "5533999466579",
//         contact_name: "Edilson",
//         acao: "aplicou" | "confirmou" | "silenciou_7d",
//         etiqueta_de_id: "12" | null,
//         etiqueta_de:    "FOLLOW UP" | null,
//         etiqueta_para_id: "8" | null,
//         etiqueta_para:    "LEAD QUENTE" | null,
//         silenciado_ate: "2026-05-16T13:00:00Z"
//       },
//       ...
//     ]
//   }
//
// Deploy: supabase functions deploy guardiao-eventos
// Env vars: SHARED_SECRET (= "branorte-wa-sync-2026"), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ACOES_VALIDAS = new Set(['aplicou', 'confirmou', 'silenciou_7d'])

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${SHARED_SECRET}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: cors })
  }

  const { vendedor_nome, eventos, client_version } = body
  if (!vendedor_nome || !Array.isArray(eventos) || eventos.length === 0) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers: cors })
  }

  const vendedor = String(vendedor_nome).toUpperCase()
  const cv = client_version ? String(client_version).slice(0, 20) : null

  const rows = eventos
    .filter((e: any) => e && typeof e.chat_id === 'string' && ACOES_VALIDAS.has(e.acao))
    .slice(0, 200) // proteção
    .map((e: any) => ({
      vendedor_nome: vendedor,
      chat_id: String(e.chat_id),
      phone: e.phone ? String(e.phone).replace(/\D/g, '') : null,
      contact_name: e.contact_name ? String(e.contact_name).slice(0, 100) : null,
      acao: e.acao,
      etiqueta_de_id: e.etiqueta_de_id ? String(e.etiqueta_de_id) : null,
      etiqueta_de: e.etiqueta_de ? String(e.etiqueta_de).slice(0, 60) : null,
      etiqueta_para_id: e.etiqueta_para_id ? String(e.etiqueta_para_id) : null,
      etiqueta_para: e.etiqueta_para ? String(e.etiqueta_para).slice(0, 60) : null,
      silenciado_ate: e.silenciado_ate || null,
      client_version: cv,
    }))

  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { error } = await sb.from('guardiao_eventos').insert(rows)
  if (error) {
    console.error('guardiao_eventos insert error', error)
    return new Response(JSON.stringify({ error: 'insert_failed', detail: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, inserted: rows.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
