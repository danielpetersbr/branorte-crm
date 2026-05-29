import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

// Parser pt-BR: "sexta 14:00", "amanhã 09:00", "hoje 16h", "em 2h", "30/05 10:00"
function parseQuandoPtBR(input: string, base: Date = new Date()): Date | null {
  if (!input) return null
  const s = input.toLowerCase().trim()
  const ref = new Date(base)
  let hora = 9, min = 0
  const mHora = s.match(/(\d{1,2})[:hH](\d{0,2})/)
  if (mHora) {
    hora = parseInt(mHora[1], 10)
    min = mHora[2] ? parseInt(mHora[2], 10) : 0
  }
  const mEm = s.match(/em\s+(\d+)\s*(min|m|h|hora|d|dia)/)
  if (mEm) {
    const n = parseInt(mEm[1], 10)
    const u = mEm[2]
    const ms = (u.startsWith('m') && !u.startsWith('h')) ? n * 60_000 :
               u.startsWith('h') ? n * 3600_000 : n * 86400_000
    return new Date(ref.getTime() + ms)
  }
  if (/\bhoje\b/.test(s)) { ref.setHours(hora, min, 0, 0); return ref }
  if (/amanhã|amanha/.test(s)) {
    ref.setDate(ref.getDate() + 1); ref.setHours(hora, min, 0, 0); return ref
  }
  const dias: Record<string, number> = { 'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6 }
  for (const [k, n] of Object.entries(dias)) {
    if (s.includes(k)) {
      const hoje = ref.getDay()
      let diff = (n - hoje + 7) % 7
      if (diff === 0) diff = 7
      ref.setDate(ref.getDate() + diff); ref.setHours(hora, min, 0, 0); return ref
    }
  }
  const mData = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (mData) {
    const d = parseInt(mData[1], 10), m = parseInt(mData[2], 10) - 1
    const y = mData[3] ? (mData[3].length === 2 ? 2000 + parseInt(mData[3], 10) : parseInt(mData[3], 10)) : ref.getFullYear()
    return new Date(y, m, d, hora, min, 0)
  }
  return null
}

// Fallback: se não conseguir parsear, agenda pra amanhã 9h
function parseOuFallback(input: string | null | undefined): Date {
  if (input) {
    const dt = parseQuandoPtBR(input)
    if (dt) return dt
  }
  const t = new Date()
  t.setDate(t.getDate() + 1)
  t.setHours(9, 0, 0, 0)
  return t
}

async function executarAction(supa: any, action: any): Promise<{ ok: boolean, resultado: any, erro?: string }> {
  const { vendedor_nome, chat_id, nome_contato, action_type, payload } = action
  const p = payload || {}
  try {
    if (action_type === 'criar_lembrete') {
      const dt = parseOuFallback(p.quando_relativo)
      const title = (p.mensagem || p.titulo || 'Lembrete').slice(0, 200)
      const { data, error } = await supa.from('wa_reminders').insert({
        vendedor_nome,
        title,
        body: p.descricao || null,
        chat_id: chat_id || null,
        contato_nome: nome_contato || null,
        remind_at: dt.toISOString(),
        status: 'pending',
        notify_self: true,
      }).select('id').single()
      if (error) return { ok: false, resultado: null, erro: error.message }
      return { ok: true, resultado: { reminder_id: data?.id, remind_at: dt.toISOString() } }
    }

    if (action_type === 'salvar_nota') {
      if (!chat_id) return { ok: false, resultado: null, erro: 'chat_id ausente (não-nulável em wa_notes)' }
      const body = p.texto || p.nota || ''
      if (!body) return { ok: false, resultado: null, erro: 'texto ausente' }
      const { data, error } = await supa.from('wa_notes').insert({
        vendedor_nome,
        chat_id,
        contato_nome: nome_contato || null,
        body,
      }).select('id').single()
      if (error) return { ok: false, resultado: null, erro: error.message }
      return { ok: true, resultado: { note_id: data?.id } }
    }

    if (action_type === 'agendar_followup_draft') {
      if (!chat_id) return { ok: false, resultado: null, erro: 'chat_id ausente (não-nulável em wa_scheduled_messages)' }
      const body = p.texto_msg || p.texto || ''
      if (!body) return { ok: false, resultado: null, erro: 'texto_msg ausente' }
      const dt = parseOuFallback(p.quando_relativo)
      const { data, error } = await supa.from('wa_scheduled_messages').insert({
        vendedor_nome,
        chat_id,
        contato_nome: nome_contato || null,
        body,
        scheduled_at: dt.toISOString(),
        // ⚠️ status custom: vendedor REVISA e altera pra 'pending' só quando aprovar pra envio
        status: 'aguardando_aprovacao',
      }).select('id').single()
      if (error) return { ok: false, resultado: null, erro: error.message }
      return { ok: true, resultado: { scheduled_id: data?.id, scheduled_at: dt.toISOString(), status: 'aguardando_aprovacao' } }
    }

    if (action_type === 'marcar_etiqueta_sugerida' || action_type === 'propor_kanban') {
      const etiq = p.etiqueta || p.coluna || ''
      if (chat_id) {
        const { error } = await supa.from('wa_notes').insert({
          vendedor_nome,
          chat_id,
          contato_nome: nome_contato || null,
          body: `[SUGESTÃO IA] ${action_type === 'marcar_etiqueta_sugerida' ? 'Etiqueta' : 'Kanban'}: ${etiq}\n${p.motivo || ''}`,
        })
        if (error) return { ok: false, resultado: null, erro: error.message }
      }
      return { ok: true, resultado: { sugestao_registrada: etiq } }
    }

    return { ok: false, resultado: null, erro: `action_type desconhecido: ${action_type}` }
  } catch (e) {
    return { ok: false, resultado: null, erro: String(e) }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const { action_id, decisao } = body
  if (!action_id || !['approve', 'reject'].includes(decisao)) {
    return new Response(JSON.stringify({ error: 'action_id e decisao(approve|reject) obrigatorios' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: action, error: errGet } = await supa.from('coach_actions').select('*').eq('id', action_id).single()
  if (errGet || !action) {
    return new Response(JSON.stringify({ error: 'action_not_found', detail: errGet?.message }), { status: 404, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (action.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'action_already_decided', status: action.status }), { status: 409, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  if (decisao === 'reject') {
    await supa.from('coach_actions').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', action_id)
    return new Response(JSON.stringify({ ok: true, status: 'rejected' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const r = await executarAction(supa, action)
  await supa.from('coach_actions').update({
    status: r.ok ? 'executed' : 'failed',
    decided_at: new Date().toISOString(),
    executed_at: r.ok ? new Date().toISOString() : null,
    resultado: r.ok ? r.resultado : { erro: r.erro },
  }).eq('id', action_id)

  return new Response(JSON.stringify({
    ok: r.ok,
    status: r.ok ? 'executed' : 'failed',
    resultado: r.resultado,
    erro: r.erro,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
