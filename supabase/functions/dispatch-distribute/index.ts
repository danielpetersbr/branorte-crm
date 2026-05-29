// dispatch-distribute: NEUTRALIZADO em 2026-05-15.
// Era distribuicao de leads de campanha pra fila de envio via extensao. Descontinuado.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  console.log('[disparo-desativado:dispatch-distribute]', req.method, 'ua:', req.headers.get('user-agent') ?? '?')
  return new Response(JSON.stringify({
    ok: false,
    error: 'disparo_via_extensao_descontinuado',
    message: 'Disparo via extensao dos vendedores foi desativado em 2026-05-15. Envio e responsabilidade do ReplyAgent.',
  }), { status: 410, headers: { ...CORS, 'content-type': 'application/json' } })
})
