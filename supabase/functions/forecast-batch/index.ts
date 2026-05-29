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

const MAPA_ESTAGIO: Record<string, { prob: number, estagio: string, saude: string }> = {
  'LEAD QUENTE':         { prob: 75, estagio: '7-Close',                  saude: 'QUENTE' },
  'ORCAMENTO ENVIADO':   { prob: 55, estagio: '5-Solution Presentation',  saude: 'MORNO'  },
  'FOLLOW UP':           { prob: 45, estagio: '6-Objection Handling',     saude: 'MORNO'  },
  'NOVO LEAD':           { prob: 30, estagio: '3-Value Proposition',      saude: 'MORNO'  },
  '2a TENTATIVA':        { prob: 15, estagio: '4-Needs Analysis',         saude: 'FRIO'   },
  'INTERESSE FUTURO':    { prob: 18, estagio: '6-Objection Handling',     saude: 'FRIO'   },
  'PROSPECCAO':          { prob: 10, estagio: '2-Qualification',          saude: 'FRIO'   },
  'VENDIDO':             { prob: 100, estagio: '7-Close',                  saude: 'QUENTE' },
  'NUNCA RESPONDEU':     { prob: 2,   estagio: '8-End',                    saude: 'PERDIDO' },
  'NAO RESPONDEU MAIS':  { prob: 3,   estagio: '8-End',                    saude: 'PERDIDO' },
  'NAO TEM INTERESSE':   { prob: 1,   estagio: '8-End',                    saude: 'PERDIDO' },
  'FORA DO ORCAMENTO':   { prob: 8,   estagio: '6-Objection Handling',     saude: 'FRIO'   },
  'SO BASE DE PRECO':    { prob: 5,   estagio: '8-End',                    saude: 'PERDIDO' },
  'NAO FABRICAMOS':      { prob: 0,   estagio: '8-End',                    saude: 'PERDIDO' },
  'COMPROU DO CONCORRENTE': { prob: 0,estagio: '8-End',                    saude: 'PERDIDO' },
  'OUTROS ASSUNTOS':     { prob: 5,   estagio: '8-End',                    saude: 'FRIO'   },
  'BRANORTE':            { prob: 0,   estagio: '8-End',                    saude: 'PERDIDO' },
  'RESOLVIDOS':          { prob: 0,   estagio: '8-End',                    saude: 'PERDIDO' },
}

function telefoneParaChatId(phone: string | null | undefined): string | null {
  if (!phone) return null
  const limpo = String(phone).replace(/\D/g, '')
  if (limpo.length < 10) return null
  return `${limpo}@c.us`
}

function calcularProbabilidade(card: any): { prob: number, estagio: string, saude: string, motivo: string, features: any } {
  const stageName = (card.stage_name || '').toUpperCase().trim()
  const map = MAPA_ESTAGIO[stageName] || { prob: 5, estagio: 'desconhecido', saude: 'FRIO' }
  let prob = map.prob
  let saude = map.saude
  const motivos: string[] = []
  let diasParado = 999
  if (card.last_message_at) {
    const last = new Date(card.last_message_at).getTime()
    diasParado = Math.round((Date.now() - last) / 86400_000)
    if (diasParado < 1) {
      prob += 8; motivos.push('respondendo agora')
      if (saude === 'FRIO') saude = 'MORNO'
    } else if (diasParado <= 2) {
      prob += 3
    } else if (diasParado >= 30) {
      prob -= 25; motivos.push(`${diasParado}d parado`)
      if (saude === 'QUENTE') saude = 'MORNO'
      if (saude === 'MORNO') saude = 'FRIO'
    } else if (diasParado >= 7) {
      prob -= 10; motivos.push(`${diasParado}d parado`)
      if (saude === 'QUENTE') saude = 'MORNO'
    } else if (diasParado >= 3) {
      prob -= 4
    }
  } else {
    prob -= 5; motivos.push('nunca interagiu')
  }
  const fm = String(card.first_message || '').toLowerCase()
  if (/(\bquanto|\bpre[cç]o|\borcamento|\bvalor|\bcompr|\bquero\b|\binteresse)/.test(fm)) {
    prob += 5; motivos.push('msg inicial já com sinal de compra')
  }
  prob = Math.max(0, Math.min(100, Math.round(prob)))
  if (motivos.length === 0) motivos.push(`estágio ${stageName}`)
  return {
    prob,
    estagio: map.estagio,
    saude,
    motivo: motivos.join(' + '),
    features: { stage: stageName, diasParado, last_message_at: card.last_message_at, total_value_cents: card.total_value_cents },
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const { vendedor_nome, incluir_inativos } = body

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  let q = supa.from('cards')
    .select('id, contact_name, contact_phone, contact_phone_formatted, last_message_at, total_value_cents, first_message, loss_reason, pipeline_stage_id, owner_id, pipeline_stages!inner(name), vendors:owner_id(name, key)')
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
  if (!incluir_inativos) q = q.is('loss_reason', null)
  if (vendedor_nome) q = q.eq('vendors.name', vendedor_nome)

  const { data: cards, error } = await q.limit(5000)
  if (error) {
    return new Response(JSON.stringify({ error: 'select_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    return new Response(JSON.stringify({ ok: true, processados: 0, motivo: 'nenhum card encontrado' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const hoje = new Date().toISOString().slice(0, 10)
  // Map por chat_id pra dedupe (mantém a row de MAIOR probabilidade)
  const porChatId = new Map<string, any>()
  let pulados = 0
  for (const c of cards) {
    const phone = c.contact_phone_formatted || c.contact_phone
    const chat_id = telefoneParaChatId(phone)
    if (!chat_id) { pulados++; continue }
    const stageName = c.pipeline_stages?.name || 'PROSPECCAO'
    const vendorName = c.vendors?.name || c.vendors?.key || 'desconhecido'
    const calc = calcularProbabilidade({
      stage_name: stageName,
      last_message_at: c.last_message_at,
      first_message: c.first_message,
      total_value_cents: c.total_value_cents,
    })
    const row = {
      vendedor_nome: vendorName,
      chat_id,
      nome_contato: c.contact_name || null,
      probabilidade: calc.prob,
      estagio: calc.estagio,
      saude: calc.saude,
      features: calc.features,
      motivo: calc.motivo,
      data_ref: hoje,
    }
    const existing = porChatId.get(chat_id)
    if (!existing || row.probabilidade > existing.probabilidade) {
      porChatId.set(chat_id, row)
    }
  }
  const rows = Array.from(porChatId.values())

  let inseridos = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const { error: errIns } = await supa.from('coach_forecasts')
      .upsert(slice, { onConflict: 'chat_id,data_ref' })
    if (errIns) {
      return new Response(JSON.stringify({ error: 'upsert_failed', detail: errIns.message, ja_inseridos: inseridos }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    inseridos += slice.length
  }

  const stats = {
    quentes:  rows.filter(r => r.probabilidade >= 60).length,
    mornos:   rows.filter(r => r.probabilidade >= 30 && r.probabilidade < 60).length,
    frios:    rows.filter(r => r.probabilidade < 30 && r.probabilidade > 5).length,
    perdidos: rows.filter(r => r.probabilidade <= 5).length,
    por_vendedor: rows.reduce((acc: any, r: any) => { acc[r.vendedor_nome] = (acc[r.vendedor_nome] || 0) + 1; return acc }, {}),
  }

  return new Response(JSON.stringify({
    ok: true,
    processados: inseridos,
    pulados_sem_phone: pulados,
    duplicados_dedupados: cards.length - rows.length - pulados,
    total_cards: cards.length,
    stats,
    data_ref: hoje,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
