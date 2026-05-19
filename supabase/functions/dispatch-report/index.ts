// dispatch-report v8: extensão reporta resultado do envio. Atualiza outbound_dispatch
// E, se enviado com sucesso, propaga o nome do vendedor pra auditoria.auditoria_atendimentos
// (resolve o bug de leads ficarem com responsavel=null mesmo quando o vendedor já
// respondeu via extensão).
//
// v8 (2026-05-19): aceita msg_id (whatsapp_msg_id) no payload pra preencher o
// outbound_dispatch.msg_id. Antes vinha sempre vazio (29 dispatches sem tracking).
//
// Status válidos: enviado | falhou | skipped.
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

// Cache em memória do mapa vendedor_nome (UPPERCASE) → nome canônico (Title Case).
// Edge functions reciclam, então isso só dura o lifetime da instância — ok pra
// reduzir queries em chamadas seguidas.
let vendorCache: Map<string, string> | null = null;
let vendorCacheAt = 0;
const VENDOR_CACHE_TTL_MS = 5 * 60_000; // 5 min

async function obterMapaVendedores(sb: ReturnType<typeof createClient>): Promise<Map<string, string>> {
  if (vendorCache && Date.now() - vendorCacheAt < VENDOR_CACHE_TTL_MS) return vendorCache;
  // Lê de auditoria.vendedores (fonte oficial dos nomes canônicos do CRM).
  // Chave: UPPER(primeiro nome) — bate com o vendedor_nome enviado pela extensão.
  const { data } = await sb.schema('auditoria').from('vendedores').select('nome, ativo');
  const map = new Map<string, string>();
  for (const v of (data ?? []) as Array<{ nome: string; ativo: boolean | null }>) {
    if (v.ativo === false) continue;
    const firstUp = String(v.nome || '').trim().split(/\s+/)[0]?.toUpperCase();
    if (firstUp) map.set(firstUp, v.nome);
  }
  // Aliases conhecidos da extensão (caso o usuário use abreviação diferente)
  if (map.has('EDILSON') && !map.has('EDILSON JR')) map.set('EDILSON JR', map.get('EDILSON')!);
  vendorCache = map;
  vendorCacheAt = Date.now();
  return map;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });

  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (auth !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { lead_id?: string; vendedor_nome?: string; status?: string; mensagem_enviada?: string; erro_msg?: string; msg_id?: string; whatsapp_msg_id?: string };
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

  // v8: também aceita msg_id (ID da mensagem no WhatsApp) quando a extensão envia.
  // Sem isso, dispatches viraram 'sent' mas perdiam o tracking de qual mensagem foi.
  const msgIdRaw = body.msg_id ?? body.whatsapp_msg_id ?? null;
  const patch: Record<string, unknown> = {
    status: statusCanon,
    sent_at: statusCanon === 'sent' ? new Date().toISOString() : null,
    erro: statusCanon === 'failed' ? (body.erro_msg ?? 'sem_detalhes').slice(0, 500) : null,
    ...(statusCanon === 'sent' && msgIdRaw ? { msg_id: String(msgIdRaw).slice(0, 200) } : {}),
  };

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1) Atualiza o dispatch (comportamento original)
  const { data: updatedDispatch, error } = await sb
    .from('outbound_dispatch')
    .update(patch)
    .eq('id', id)
    .select('cliente_telefone, vendedor_nome')
    .maybeSingle();
  if (error) return json({ ok: false, error: 'update_falhou', message: error.message }, { status: 500 });

  // 2) NOVO (v7): se enviado com sucesso, marca o vendedor como responsável no atendimento.
  // Só preenche se atualmente está null (não sobrescreve atribuição manual do CRM
  // nem atribuição via webhook-disparachat-events ia_transferred).
  //
  // ATENÇÃO ao formato de telefone:
  // - outbound_dispatch.cliente_telefone: às vezes 12 dígitos (5511991234567 sem 9 móvel)
  // - auditoria.auditoria_atendimentos.telefone_norm: geralmente 13 dígitos (com 9)
  // Tentamos N variantes pra cobrir essas inconsistências.
  let atendimentoUpdate: { matched: number; nome_canonico: string | null; variant_used: string | null } =
    { matched: 0, nome_canonico: null, variant_used: null };
  if (statusCanon === 'sent' && updatedDispatch?.cliente_telefone && updatedDispatch?.vendedor_nome) {
    const phoneDigits = String(updatedDispatch.cliente_telefone).replace(/[^0-9]/g, '');
    const vendedorUp = String(updatedDispatch.vendedor_nome).trim().toUpperCase();

    if (phoneDigits.length >= 10 && vendedorUp) {
      const mapa = await obterMapaVendedores(sb);
      const nomeCanonico = mapa.get(vendedorUp) ?? updatedDispatch.vendedor_nome;
      atendimentoUpdate.nome_canonico = nomeCanonico;

      // Gera variantes do telefone pra cobrir formato com/sem 9 móvel BR.
      // Ex: 551897295195 (12d) → também tenta 5518997295195 (13d, com 9 após DDD)
      const variants = new Set<string>();
      variants.add(phoneDigits);
      // Se 12 dígitos e começa com 55, insere 9 após DDD (posições 0-3)
      if (phoneDigits.length === 12 && phoneDigits.startsWith('55')) {
        variants.add(phoneDigits.slice(0, 4) + '9' + phoneDigits.slice(4));
      }
      // Se 13 dígitos com 9 móvel, também tenta sem o 9 (caso atendimento gravou sem)
      if (phoneDigits.length === 13 && phoneDigits.startsWith('55') && phoneDigits[4] === '9') {
        variants.add(phoneDigits.slice(0, 4) + phoneDigits.slice(5));
      }

      // Procura primeiro registro com qualquer variante + responsavel null
      const { data: candidatos, error: selErr } = await sb
        .schema('auditoria')
        .from('auditoria_atendimentos')
        .select('id, telefone_norm, responsavel')
        .in('telefone_norm', [...variants])
        .is('responsavel', null);

      if (selErr) {
        return json({ ok: true, lead_id: id, status: statusCanon, atendimento_select_warn: selErr.message });
      }

      const ids = (candidatos ?? []).map(c => c.id);
      if (ids.length > 0) {
        const { error: upErr } = await sb
          .schema('auditoria')
          .from('auditoria_atendimentos')
          .update({ responsavel: nomeCanonico })
          .in('id', ids);
        if (upErr) {
          return json({ ok: true, lead_id: id, status: statusCanon, atendimento_update_warn: upErr.message });
        }
        atendimentoUpdate.matched = ids.length;
        atendimentoUpdate.variant_used = (candidatos ?? [])[0]?.telefone_norm ?? null;
      }
    }
  }

  return json({
    ok: true,
    lead_id: id,
    status: statusCanon,
    atendimentos_atualizados: atendimentoUpdate.matched,
    vendedor_aplicado: atendimentoUpdate.nome_canonico,
    telefone_match: atendimentoUpdate.variant_used,
  });
});
