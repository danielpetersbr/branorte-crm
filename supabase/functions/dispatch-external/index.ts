// dispatch-external: NEUTRALIZADO em 2026-05-15.
// Era webhook externo (ReplyAgent/n8n) que enfileirava disparos via extensao. Descontinuado.
// Se ReplyAgent/n8n precisar atribuir leads, usar atribuir-lead-vendedor (roteamento sem envio).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  console.log('[disparo-desativado:dispatch-external]', req.method, 'ua:', req.headers.get('user-agent') ?? '?', 'apikey:', req.headers.get('x-api-key')?.slice(0, 12) ?? '?')
  return new Response(JSON.stringify({
    ok: false,
    error: 'disparo_via_extensao_descontinuado',
    message: 'O endpoint dispatch-external foi desativado em 2026-05-15. Envio de mensagens nao e mais feito via extensao dos vendedores. Para atribuir lead a vendedor sem enviar mensagem, use o endpoint atribuir-lead-vendedor.',
  }), { status: 410, headers: { ...CORS, 'content-type': 'application/json' } })
})
