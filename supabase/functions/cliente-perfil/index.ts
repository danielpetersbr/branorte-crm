// cliente-perfil v1
// GET (action=get): retorna dados merged do cliente (cards.raw_data + auditoria + overrides do vendedor)
// PATCH (action=update): salva overrides em cards.raw_data.overrides — não modifica dados originais da Ana,
//   só adiciona uma camada de "edição do vendedor" que tem precedência no GET.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function clean(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  if (/^\{\{.*\}\}$/.test(s)) return null
  return s
}

function telVariants(raw: string): string[] {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (!d) return []
  const v = new Set<string>([d])
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') v.add(d.slice(0, 4) + d.slice(5))
  if (d.length === 12 && d.startsWith('55')) {
    const ddd = parseInt(d.slice(2, 4), 10)
    if (ddd >= 11) v.add(d.slice(0, 4) + '9' + d.slice(4))
  }
  return Array.from(v)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (auth !== SHARED) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? 'get').toLowerCase()
  const tel = String(body.telefone ?? '').replace(/\D/g, '')
  const vendedorNome = String(body.vendedor_nome ?? '').toUpperCase().trim()
  if (!tel) return new Response(JSON.stringify({ error: 'telefone_obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const supaAud = supa.schema('auditoria') as any
  const variants = telVariants(tel)

  // Vendor (opcional — usado em update pra registrar quem editou)
  let vendorId: string | null = null
  if (vendedorNome) {
    const { data: v } = await supa.from('vendors').select('id').or(`key.ilike.${vendedorNome},name.ilike.${vendedorNome}`).limit(1).maybeSingle()
    if (v) vendorId = v.id
  }

  // Card mais recente do telefone (pode ter qualquer owner ou stage)
  const { data: card } = await supa.from('cards')
    .select('id, contact_name, contact_phone, contact_phone_formatted, subject, first_message, raw_data, created_at, owner_id, pipeline_stage_id')
    .or(`contact_phone.eq.${tel}${variants[1] ? ',contact_phone.eq.' + variants[1] : ''}`)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()

  // Atendimento (auditoria) do telefone
  const { data: atendArr } = await supaAud.from('atendimentos_por_cliente')
    .select('nome, telefone, telefone_norm, qual_animal, quantidade, quantos_animais, finalidade_fabrica, capacidade_producao, quando_investir, motivo_contato, origem, ai_context_summary, last_message_text, qualificacao')
    .in('telefone_norm', variants)
    .limit(1)
  const atend = (atendArr && atendArr[0]) ?? null

  // Vendor designado (do card)
  let vendedorAtual = null
  if (card?.owner_id) {
    const { data: v } = await supa.from('vendors').select('name, telefone').eq('id', card.owner_id).maybeSingle()
    vendedorAtual = v
  }

  const dados = card?.raw_data?.dados ?? {}
  const overrides = card?.raw_data?.overrides ?? {}

  // Merge — overrides têm precedência (são edits do vendedor)
  function pick(...vals: any[]) {
    for (const v of vals) { const c = clean(v); if (c !== null) return c }
    return null
  }

  const profile = {
    telefone: tel,
    telefone_formatado: clean(card?.contact_phone_formatted),
    card_id: card?.id ?? null,
    vendedor_atual: vendedorAtual,
    pipeline_stage_id: card?.pipeline_stage_id ?? null,
    criado_em: card?.created_at ?? null,
    // Campos editáveis (cada um marcado se foi editado pelo vendedor)
    nome:        pick(overrides.nome, card?.contact_name, atend?.nome),
    animal:      pick(overrides.animal, dados.animal, atend?.qual_animal),
    quantidade:  pick(overrides.quantidade, dados.quantidade, atend?.quantidade, atend?.quantos_animais),
    formulacao:  pick(overrides.formulacao, dados.formulacao),
    finalidade:  pick(overrides.finalidade, dados.finalidade, atend?.finalidade_fabrica),
    urgencia:    pick(overrides.urgencia, dados.temperatura, atend?.quando_investir),
    equipamento: pick(overrides.equipamento, dados.equipamento),
    aplicacao:   pick(overrides.aplicacao, dados.aplicacao),
    contexto:    pick(overrides.contexto, dados.contexto, atend?.ai_context_summary),
    motivo:      pick(overrides.motivo, atend?.motivo_contato),
    origem:      pick(overrides.origem, dados.origem, atend?.origem),
    capacidade:  pick(overrides.capacidade, atend?.capacidade_producao),
    qualificacao: pick(atend?.qualificacao),
    notas_vendedor: clean(overrides.notas_vendedor),
    // Metadata
    _editado_em: overrides._updated_at ?? null,
    _editado_por: overrides._updated_by ?? null,
    _campos_editados: Object.keys(overrides).filter(k => !k.startsWith('_')),
  }

  if (action === 'get') {
    return new Response(JSON.stringify({ ok: true, profile }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  if (action === 'update') {
    if (!card) {
      return new Response(JSON.stringify({ ok: false, error: 'card_nao_encontrado_pra_esse_telefone' }), { status: 404, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const updates = body.updates ?? {}
    const validFields = ['nome', 'animal', 'quantidade', 'formulacao', 'finalidade', 'urgencia', 'equipamento', 'aplicacao', 'contexto', 'motivo', 'origem', 'capacidade', 'notas_vendedor']
    const sanitized: Record<string, any> = {}
    for (const k of validFields) {
      if (k in updates) {
        const v = updates[k]
        sanitized[k] = v === '' || v === null ? null : String(v).trim()
      }
    }
    if (Object.keys(sanitized).length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'sem_campos_validos' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const newOverrides = {
      ...(card.raw_data?.overrides ?? {}),
      ...sanitized,
      _updated_at: new Date().toISOString(),
      _updated_by: vendedorNome || null,
    }
    const newRawData = { ...(card.raw_data ?? {}), overrides: newOverrides }
    const { error: upErr } = await supa.from('cards').update({ raw_data: newRawData }).eq('id', card.id)
    if (upErr) {
      return new Response(JSON.stringify({ ok: false, error: upErr.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, updated: Object.keys(sanitized), card_id: card.id }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  return new Response(JSON.stringify({ ok: false, error: 'action_invalida' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
})
