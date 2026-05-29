// dispatch-poll v6: extensão do vendedor chama a cada 30s pedindo dispatches pendentes.
// Faz claim atômico (status=pending → sending) e devolve lista pra extensão enviar via WPP.
// 2026-05-18: reativado depois de neutralização em 15/05. Agora puxa de public.outbound_dispatch.
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

  // Auth: SHARED_SECRET (mesma da extensão)
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (auth !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { vendedor_nome?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const vendedorNome = String(body?.vendedor_nome ?? '').toUpperCase().trim();
  if (!vendedorNome) return json({ ok: false, error: 'vendedor_nome_required' }, { status: 400 });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // RECOVERY: rows presas em 'sending' há mais de 3min voltam pra 'pending' (SW pode ter morrido)
  const stuckCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await sb
    .from('outbound_dispatch')
    .update({ status: 'pending', erro: null })
    .eq('vendedor_nome', vendedorNome)
    .eq('status', 'sending')
    .lt('created_at', stuckCutoff);

  // CLAIM ATÔMICO: pega 1 pending mais antigo e marca como sending
  // Usa RPC-like pattern via UPDATE com RETURNING (PostgREST não suporta isso direto,
  // então fazemos SELECT + UPDATE com filtro de status pra garantir atomicidade)
  const { data: candidates } = await sb
    .from('outbound_dispatch')
    .select('id, vendedor_nome, cliente_telefone, cliente_nome, mensagem, created_at')
    .eq('vendedor_nome', vendedorNome)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!candidates || candidates.length === 0) {
    return json({ ok: true, leads: [] });
  }

  const lead = candidates[0];
  // UPDATE condicional: só vira sending se ainda for pending (proteção contra race)
  const { data: claimed, error: claimErr } = await sb
    .from('outbound_dispatch')
    .update({ status: 'sending' })
    .eq('id', lead.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (claimErr || !claimed) {
    // Race perdida — outro poll pegou antes. Fila vazia.
    return json({ ok: true, leads: [] });
  }

  return json({
    ok: true,
    leads: [{
      id: lead.id,
      telefone: lead.cliente_telefone,
      nome: lead.cliente_nome,
      mensagem: lead.mensagem,
    }],
  });
});
