// dispatch-poll v7: extensão do vendedor chama a cada 30s pedindo dispatches pendentes.
// Faz claim atômico (status=pending → sending) e devolve lista pra extensão enviar via WPP.
// 2026-05-18: reativado depois de neutralização em 15/05. Agora puxa de public.outbound_dispatch.
// 2026-06-23: BLOQUEIO ANTI-DUPLICATA — recovery por claimed_at + guard de cooldown 30d (cross-vendor).
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

// Janela de cooldown: não reenvia automático pro mesmo número (QUALQUER vendedor) por N dias.
const COOLDOWN_DIAS = 30;

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

  // RECOVERY: rows presas em 'sending' voltam pra 'pending' se o claim foi há +3min (SW pode ter morrido).
  // Usa claimed_at (hora do CLAIM), NÃO created_at — evita ressuscitar/re-disparar um lead cujo envio
  // já saiu mas cujo report (sending→sent) atrasou. Esse era o bug que reenviava no mesmo dia.
  const stuckCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await sb
    .from('outbound_dispatch')
    .update({ status: 'pending', erro: null })
    .eq('vendedor_nome', vendedorNome)
    .eq('status', 'sending')
    .lt('claimed_at', stuckCutoff);
  // Fallback p/ rows legadas que ficaram em 'sending' sem claimed_at (antes desta versão)
  await sb
    .from('outbound_dispatch')
    .update({ status: 'pending', erro: null })
    .eq('vendedor_nome', vendedorNome)
    .eq('status', 'sending')
    .is('claimed_at', null)
    .lt('created_at', stuckCutoff);

  // CLAIM ATÔMICO: pega 1 pending mais antigo e marca como sending
  const { data: candidates } = await sb
    .from('outbound_dispatch')
    .select('id, vendedor_nome, cliente_telefone, cliente_telefone_norm, cliente_nome, mensagem, created_at')
    .eq('vendedor_nome', vendedorNome)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!candidates || candidates.length === 0) {
    return json({ ok: true, leads: [] });
  }

  const lead = candidates[0];
  // UPDATE condicional: só vira sending se ainda for pending (proteção contra race). Grava claimed_at.
  const { data: claimed, error: claimErr } = await sb
    .from('outbound_dispatch')
    .update({ status: 'sending', claimed_at: new Date().toISOString() })
    .eq('id', lead.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (claimErr || !claimed) {
    // Race perdida — outro poll pegou antes. Fila vazia.
    return json({ ok: true, leads: [] });
  }

  // GUARD ANTI-DUPLICATA: se este número já recebeu disparo 'sent' nos últimos COOLDOWN_DIAS
  // (por QUALQUER vendedor), NÃO reenvia — marca 'skipped' (auditável) e devolve fila vazia neste ciclo.
  // Próximo poll pega o próximo lead. Casa com o índice único que impede 2 ativos pro mesmo número.
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: jaEnviado } = await sb
    .from('outbound_dispatch')
    .select('sent_at, vendedor_nome')
    .eq('cliente_telefone_norm', lead.cliente_telefone_norm)
    .eq('status', 'sent')
    .gte('sent_at', cooldownCutoff)
    .neq('id', lead.id)
    .order('sent_at', { ascending: false })
    .limit(1);

  if (jaEnviado && jaEnviado.length > 0) {
    const ja = jaEnviado[0];
    await sb
      .from('outbound_dispatch')
      .update({
        status: 'skipped',
        erro: `dedup: ja enviado em ${ja.sent_at} por ${ja.vendedor_nome} (cooldown ${COOLDOWN_DIAS}d)`,
      })
      .eq('id', lead.id);
    return json({
      ok: true,
      leads: [],
      skipped: {
        reason: 'duplicate_within_cooldown',
        telefone: lead.cliente_telefone,
        ja_enviado_em: ja.sent_at,
        por: ja.vendedor_nome,
      },
    });
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
