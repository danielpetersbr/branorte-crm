// campanha-poll v1: motor das campanhas de chamada em massa.
//
// A extensao do vendedor faz poll aqui a cada ~30s. Esta funcao decide se PODE
// mandar mais um agora e, se puder, faz claim atomico de 1 alvo e devolve junto
// com os passos da sequencia. Um alvo por chamada, nunca lote.
//
// POR QUE AS TRAVAS SAO SERVIDOR E NAO CLIENTE: o numero que dispara e o
// WhatsApp PESSOAL do vendedor. Se ele for banido, perde a carteira inteira.
// Trava no cliente e contornavel (basta editar a extensao ou rodar duas abas);
// aqui nao e. Referencia de risco: recomendacao corrente e ficar abaixo de
// ~30 msg/hora e nunca acima de 1/minuto em automacao nao-oficial.
//
// Difere de dispatch-poll de proposito:
//   - dispatch-poll = lead novo que acabou de chamar, vai NA HORA, 24/7;
//   - campanha-poll = disparo proativo pra base, so em horario comercial e devagar.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

// Mesma auth do resto da frota. Env var primeiro pra permitir rotacionar sem
// quebrar quem ainda estiver na versao antiga da extensao.
const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Intervalo base entre dois envios do MESMO vendedor, por ritmo.
const INTERVALO_SEG: Record<string, number> = {
  cauteloso: 150,  // ~24/hora
  normal:     90,  // ~40/hora
};
// Tetos duros, valem para qualquer ritmo.
const TETO_HORA = 40;
const TETO_DIA = 150;
// Janela comercial (America/Sao_Paulo), seg-sex.
const HORA_INICIO = 8;
const HORA_FIM = 18;
// Alvo presoem 'sending' por mais que isso volta pra fila (SW do Chrome morreu).
const RECOVERY_MIN = 5;

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

/** Hora e dia da semana em Sao Paulo, sem depender do TZ do runtime. */
function agoraEmSaoPaulo(): { hora: number; diaSemana: number; dataISO: string } {
  const agora = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  });
  const partes = Object.fromEntries(fmt.formatToParts(agora).map(p => [p.type, p.value]));
  const mapaDia: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hora: Number(partes.hour),
    diaSemana: mapaDia[partes.weekday as string] ?? 1,
    dataISO: `${partes.year}-${partes.month}-${partes.day}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });

  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (auth !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const acao = String(body?.action ?? 'poll');

  // ------------------------------------------------------------------ REPORT
  if (acao === 'report') {
    const alvoId = String(body?.alvo_id ?? '');
    const status = String(body?.status ?? '');
    if (!alvoId || !['sent', 'failed', 'skipped'].includes(status)) {
      return json({ ok: false, error: 'params_invalidos' }, { status: 400 });
    }
    const patch: Record<string, unknown> = { status, erro: body?.erro ? String(body.erro).slice(0, 500) : null };
    if (status === 'sent') patch.sent_at = new Date().toISOString();

    const { data: alvo, error } = await sb
      .from('wa_campanha_alvos').update(patch).eq('id', alvoId).eq('status', 'sending')
      .select('campanha_id').maybeSingle();
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    // Ja reportado por outra instancia: nao e erro, so nao ha o que fazer.
    if (!alvo) return json({ ok: true, duplicado: true });

    // Ultimo alvo da campanha? Fecha sozinha, pra nao ficar "ativa" pra sempre.
    const { count: restantes } = await sb
      .from('wa_campanha_alvos').select('id', { count: 'exact', head: true })
      .eq('campanha_id', alvo.campanha_id).in('status', ['pending', 'sending']);
    if ((restantes ?? 0) === 0) {
      await sb.from('wa_campanhas')
        .update({ status: 'concluida', finished_at: new Date().toISOString() })
        .eq('id', alvo.campanha_id).eq('status', 'ativa');
    }
    return json({ ok: true });
  }

  // -------------------------------------------------------------------- POLL
  const vendedor = String(body?.vendedor_nome ?? '').toUpperCase().trim();
  if (!vendedor) return json({ ok: false, error: 'vendedor_nome_required' }, { status: 400 });

  // Recovery antes de tudo: alvo preso em 'sending' volta pra fila. Usa claimed_at
  // (nao created_at) — licao do outbound_dispatch, onde recovery por created_at
  // ressuscitava lead cujo envio ja tinha saido.
  const limiteRecovery = new Date(Date.now() - RECOVERY_MIN * 60_000).toISOString();
  await sb.from('wa_campanha_alvos')
    .update({ status: 'pending', claimed_at: null })
    .eq('status', 'sending').lt('claimed_at', limiteRecovery);

  const { data: campanha } = await sb
    .from('wa_campanhas')
    .select('id, ritmo, titulo, sequencia_id')
    .eq('vendedor_nome', vendedor).eq('status', 'ativa')
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle();
  if (!campanha) return json({ ok: true, alvo: null, motivo: 'sem_campanha_ativa' });

  // Janela comercial. Disparo proativo pra base fora de hora incomoda e queima
  // reputacao do numero; a fila espera sozinha ate o proximo dia util.
  const { hora, diaSemana } = agoraEmSaoPaulo();
  if (diaSemana === 0 || diaSemana === 6 || hora < HORA_INICIO || hora >= HORA_FIM) {
    return json({ ok: true, alvo: null, motivo: 'fora_do_horario' });
  }

  // Tetos e espacamento contam envios de TODAS as campanhas do vendedor: o limite
  // e do numero dele, nao de uma campanha.
  const { data: campanhasDoVendedor } = await sb
    .from('wa_campanhas').select('id').eq('vendedor_nome', vendedor);
  const idsCampanhas = (campanhasDoVendedor ?? []).map((c: any) => c.id);
  if (idsCampanhas.length === 0) return json({ ok: true, alvo: null, motivo: 'sem_campanha_ativa' });

  const umaHoraAtras = new Date(Date.now() - 3_600_000).toISOString();
  const { count: naHora } = await sb
    .from('wa_campanha_alvos').select('id', { count: 'exact', head: true })
    .in('campanha_id', idsCampanhas).eq('status', 'sent').gte('sent_at', umaHoraAtras);
  if ((naHora ?? 0) >= TETO_HORA) return json({ ok: true, alvo: null, motivo: 'teto_hora' });

  const vinteQuatroHoras = new Date(Date.now() - 86_400_000).toISOString();
  const { count: noDia } = await sb
    .from('wa_campanha_alvos').select('id', { count: 'exact', head: true })
    .in('campanha_id', idsCampanhas).eq('status', 'sent').gte('sent_at', vinteQuatroHoras);
  if ((noDia ?? 0) >= TETO_DIA) return json({ ok: true, alvo: null, motivo: 'teto_dia' });

  // UM DE CADA VEZ. Sem isto, enquanto o alvo anterior esta em 'sending' (ainda
  // nao reportado) nao existe nenhum sent_at pra comparar, o intervalo abaixo nao
  // barra nada e o servidor entrega alvo atras de alvo -- exatamente a rajada que
  // essas travas existem pra impedir. Bug pego em teste: dois polls seguidos
  // devolveram dois alvos no mesmo segundo. O recovery (5min) desprende se travar.
  const { data: emVoo } = await sb
    .from('wa_campanha_alvos').select('id')
    .in('campanha_id', idsCampanhas).eq('status', 'sending').limit(1).maybeSingle();
  if (emVoo) return json({ ok: true, alvo: null, motivo: 'envio_em_andamento' });

  // Espacamento desde a ultima ATIVIDADE (envio concluido ou claim), com jitter:
  // cadencia de relogio (ex: exatos 90.0s) e justamente o que denuncia automacao.
  const [{ data: ultimoSent }, { data: ultimoClaim }] = await Promise.all([
    sb.from('wa_campanha_alvos').select('sent_at')
      .in('campanha_id', idsCampanhas).not('sent_at', 'is', null)
      .order('sent_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('wa_campanha_alvos').select('claimed_at')
      .in('campanha_id', idsCampanhas).not('claimed_at', 'is', null)
      .order('claimed_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const marcos = [ultimoSent?.sent_at, ultimoClaim?.claimed_at]
    .filter(Boolean).map(d => new Date(d as string).getTime());
  if (marcos.length > 0) {
    const base = INTERVALO_SEG[campanha.ritmo] ?? INTERVALO_SEG.cauteloso;
    const alvoSeg = base * (0.8 + Math.random() * 0.4);
    const desdeUltimo = (Date.now() - Math.max(...marcos)) / 1000;
    if (desdeUltimo < alvoSeg) {
      return json({ ok: true, alvo: null, motivo: 'aguardando_intervalo', faltam_seg: Math.ceil(alvoSeg - desdeUltimo) });
    }
  }

  // Claim atomico: pending -> sending. O .eq('status','pending') no update e o que
  // impede duas instancias da extensao pegarem o mesmo alvo.
  const { data: candidato } = await sb
    .from('wa_campanha_alvos').select('id')
    .eq('campanha_id', campanha.id).eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (!candidato) return json({ ok: true, alvo: null, motivo: 'fila_vazia' });

  const { data: alvo } = await sb
    .from('wa_campanha_alvos')
    .update({ status: 'sending', claimed_at: new Date().toISOString() })
    .eq('id', candidato.id).eq('status', 'pending')
    .select('id, telefone, nome').maybeSingle();
  if (!alvo) return json({ ok: true, alvo: null, motivo: 'claim_perdido' });

  const { data: sequencia } = await sb
    .from('quick_sequences').select('id, title, steps').eq('id', campanha.sequencia_id).maybeSingle();
  if (!sequencia) {
    // Sequencia apagada depois da campanha criada: devolve o alvo e para a campanha,
    // em vez de queimar a fila inteira em erro.
    await sb.from('wa_campanha_alvos').update({ status: 'pending', claimed_at: null }).eq('id', alvo.id);
    await sb.from('wa_campanhas').update({ status: 'pausada' }).eq('id', campanha.id);
    return json({ ok: true, alvo: null, motivo: 'sequencia_sumiu' });
  }

  return json({
    ok: true,
    alvo: { id: alvo.id, telefone: alvo.telefone, nome: alvo.nome },
    campanha: { id: campanha.id, titulo: campanha.titulo, ritmo: campanha.ritmo },
    sequencia: { id: sequencia.id, title: sequencia.title, steps: sequencia.steps },
  });
});
