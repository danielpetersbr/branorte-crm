// roteamento-atribuir-lead: DESCONTINUADO em 2026-05-15.
//
// Este endpoint foi construido por engano sem saber que ja existia a RPC
// public.wa_atribuir_vendedor_ana que faz o mesmo trabalho com mais features
// (anti-duplicidade 30 dias, validação de nome, cria card NOVO LEAD no CRM
// do vendedor, normalizacao BR de telefone, contadores, fallback round-robin).
//
// Ana / ReplyAgent / n8n: usar a RPC existente atraves do PostgREST:
//   POST https://flwbeevtvjiouxdjmziv.supabase.co/rest/v1/rpc/wa_atribuir_vendedor_ana
//   Headers: apikey + Authorization (JWT)
//   Body: { p_cliente_phone, p_cliente_nome, p_interesse?, p_dados?, p_first_message? }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  console.log('[roteamento-atribuir-lead:descontinuado]', req.method, 'ua:', req.headers.get('user-agent') ?? '?')
  return new Response(JSON.stringify({
    ok: false,
    error: 'endpoint_descontinuado',
    message: 'Use a RPC public.wa_atribuir_vendedor_ana via PostgREST. Endpoint correto: POST /rest/v1/rpc/wa_atribuir_vendedor_ana com apikey + Authorization (JWT).',
    rpc_url: 'https://flwbeevtvjiouxdjmziv.supabase.co/rest/v1/rpc/wa_atribuir_vendedor_ana',
    desativado_em: '2026-05-15',
  }), { status: 410, headers: { ...CORS, 'content-type': 'application/json' } })
})
