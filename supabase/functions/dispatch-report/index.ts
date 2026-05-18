// dispatch-report v6: extensão reporta resultado do envio. Atualiza outbound_dispatch.
// Status válidos: enviado | falhou. (Internamente: sent | failed)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const SHARED_SECRET = 'branorte-wa-sync-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });

  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (auth !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { lead_id?: string; vendedor_nome?: string; status?: string; mensagem_enviada?: string; erro_msg?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const id = String(body?.lead_id ?? '').trim();
  const statusBr = String(body?.status ?? '').toLowerCase().trim();
  if (!id) return json({ ok: false, error: 'lead_id_required' }, { status: 400 });

  // A extensão usa nomes em português; mapeamos pros valores canônicos da tabela.
  let statusCanon: 'sent' | 'failed' | 'skipped' | null = null;
  if (statusBr === 'enviado' || statusBr === 'sent') statusCanon = 'sent';
  else if (statusBr === 'falhou' || statusBr === 'failed') statusCanon = 'failed';
  else if (statusBr === 'skipped') statusCanon = 'skipped';
  if (!statusCanon) return json({ ok: false, error: 'status_invalido', received: statusBr }, { status: 400 });

  const patch: Record<string, unknown> = {
    status: statusCanon,
    sent_at: statusCanon === 'sent' ? new Date().toISOString() : null,
    erro: statusCanon === 'failed' ? (body.erro_msg ?? 'sem_detalhes').slice(0, 500) : null,
  };

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error } = await sb.from('outbound_dispatch').update(patch).eq('id', id);
  if (error) return json({ ok: false, error: 'update_falhou', message: error.message }, { status: 500 });

  return json({ ok: true, lead_id: id, status: statusCanon });
});
