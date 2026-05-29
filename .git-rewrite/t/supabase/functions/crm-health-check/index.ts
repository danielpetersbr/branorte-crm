// crm-health-check v1 (2026-05-19) — Auditoria automática do CRM Branorte
//
// Roda a cada 30 minutos via pg_cron. Lê a view auditoria.crm_health_view
// (todas as métricas consolidadas) e grava o resultado em
// auditoria.crm_health_runs pra histórico.
//
// Endpoint: POST /functions/v1/crm-health-check
// Auth: Authorization: Bearer SHARED_SECRET ou Bearer SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const SHARED_SECRET = 'branorte-health-check-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

// Severity por métrica. 'error' = atrapalha operação; 'warn' = sujo mas funciona;
// 'info' = só contador (não afeta status).
// threshold = valor a partir do qual vira fail/warn.
type Severity = 'error' | 'warn' | 'info';
interface CheckDef {
  id: keyof HealthRow;
  label: string;
  severity: Severity;
  threshold: number;
}

interface HealthRow {
  dups_telefone: number;
  dups_canal_fb_ig: number;
  criativos_malformados: number;
  criativos_sem_match: number;
  responsavel_inconsistente: number;
  responsavel_inativo: number;
  resolvido_inconsistente: number;
  data_no_futuro: number;
  last_message_anterior_data: number;
  dispatches_sent_sem_msg_id_24h: number;
  dispatches_pending_old: number;
  dispatches_sent_sem_responsavel: number;
  extensoes_wa_paradas: number;
  telefone_curto: number;
  status_invalido: number;
  leads_24h_total: number;
  leads_pra_pegar_24h: number;
}

const CHECKS: CheckDef[] = [
  { id: 'dups_telefone', label: 'Duplicatas por telefone', severity: 'error', threshold: 0 },
  { id: 'dups_canal_fb_ig', label: 'Duplicatas FB/IG↔WA do mesmo lead', severity: 'error', threshold: 0 },
  { id: 'criativos_malformados', label: 'Criativos com código inválido', severity: 'warn', threshold: 0 },
  { id: 'criativos_sem_match', label: 'Criativos sem entry em auditoria.criativos', severity: 'warn', threshold: 0 },
  { id: 'responsavel_inconsistente', label: 'Vendedor responsável fora de auditoria.vendedores', severity: 'warn', threshold: 0 },
  { id: 'responsavel_inativo', label: 'Atendimentos atribuídos a vendedor inativo', severity: 'warn', threshold: 0 },
  { id: 'resolvido_inconsistente', label: 'Resolvidos sem finished_at OU sem responsável', severity: 'warn', threshold: 50 },
  { id: 'data_no_futuro', label: 'Atendimento com data no futuro', severity: 'error', threshold: 0 },
  { id: 'last_message_anterior_data', label: 'last_message_at anterior ao primeiro contato', severity: 'warn', threshold: 0 },
  { id: 'dispatches_sent_sem_msg_id_24h', label: 'Dispatches enviados sem msg_id (perde tracking)', severity: 'warn', threshold: 5 },
  { id: 'dispatches_pending_old', label: 'Dispatches pending > 1h (travados)', severity: 'warn', threshold: 0 },
  { id: 'dispatches_sent_sem_responsavel', label: 'Dispatch sent sem vendedor no atendimento', severity: 'warn', threshold: 0 },
  { id: 'extensoes_wa_paradas', label: 'Extensões Wascript com sync > 30min atrás', severity: 'warn', threshold: 2 },
  { id: 'telefone_curto', label: 'Telefones com menos de 12 dígitos', severity: 'warn', threshold: 2 },
  { id: 'status_invalido', label: 'Status fora do enum esperado', severity: 'error', threshold: 0 },
  { id: 'leads_24h_total', label: 'Total leads nas últimas 24h', severity: 'info', threshold: 1_000_000 },
  { id: 'leads_pra_pegar_24h', label: 'Leads pra pegar (sem vendedor) últimas 24h', severity: 'info', threshold: 1_000_000 },
];

interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  value: number;
  threshold: number;
  status: 'ok' | 'warn' | 'fail';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Auth aceita SHARED_SECRET ou SERVICE_KEY (pra disparo via pg_cron)
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (auth !== SHARED_SECRET && auth !== SERVICE_KEY) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const startedAt = Date.now();

  // 1) Lê todas as métricas da view consolidada (1 query)
  const { data: rowsRaw, error: viewErr } = await sb
    .schema('auditoria')
    .from('crm_health_view')
    .select('*');

  if (viewErr || !rowsRaw || rowsRaw.length === 0) {
    return json({
      ok: false,
      error: 'view_unavailable',
      detail: viewErr?.message ?? 'empty result',
    }, { status: 500 });
  }
  const row = rowsRaw[0] as HealthRow;

  // 2) Classifica cada métrica como ok/warn/fail
  const results: CheckResult[] = CHECKS.map(def => {
    const value = Number(row[def.id] ?? 0);
    let status: CheckResult['status'] = 'ok';
    if (def.severity !== 'info') {
      if (value > def.threshold) {
        status = def.severity === 'warn' ? 'warn' : 'fail';
      }
    }
    return {
      id: def.id,
      label: def.label,
      severity: def.severity,
      value,
      threshold: def.threshold,
      status,
    };
  });

  const elapsedMs = Date.now() - startedAt;
  const failed = results.filter(r => r.status === 'fail');
  const warned = results.filter(r => r.status === 'warn');
  const overallStatus: 'healthy' | 'degraded' | 'critical' =
    failed.length > 0 ? 'critical' : warned.length > 0 ? 'degraded' : 'healthy';

  // 3) Persiste no histórico
  try {
    await sb.schema('auditoria').from('crm_health_runs').insert({
      ran_at: new Date().toISOString(),
      elapsed_ms: elapsedMs,
      status: overallStatus,
      total_checks: results.length,
      ok_count: results.filter(r => r.status === 'ok').length,
      warn_count: warned.length,
      fail_count: failed.length,
      results,
    });
  } catch (e) {
    console.error('Failed to persist crm_health_runs:', (e as Error).message);
  }

  return json({
    ok: true,
    status: overallStatus,
    elapsed_ms: elapsedMs,
    summary: {
      total: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      warn: warned.length,
      fail: failed.length,
    },
    results,
  });
});
