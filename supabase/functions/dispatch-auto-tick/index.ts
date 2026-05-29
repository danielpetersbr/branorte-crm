// dispatch-auto-tick: NEUTRALIZADO em 2026-05-15.
// Era o tick da automacao 'Pegar pra mim' que enfileirava disparos via extensao. Descontinuado.
// Se houver cron schedule chamando isso, pode ser removido com seguranca.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  console.log('[disparo-desativado:dispatch-auto-tick]', req.method, 'ua:', req.headers.get('user-agent') ?? '?')
  return new Response(JSON.stringify({
    ok: false,
    error: 'disparo_via_extensao_descontinuado',
    skipped: 'desativado_permanentemente',
    message: 'A automacao Pegar-pra-mim que disparava via extensao foi desativada em 2026-05-15. Envio e responsabilidade do ReplyAgent.',
  }), { status: 410, headers: { ...CORS, 'content-type': 'application/json' } })
})
