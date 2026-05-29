// leads-meus-novos v6
// Filtros: telefone BR valido + apenas leads recentes/ia_handled
// + esconde leads que o vendedor JÁ está atendendo (tem etiqueta WA OU mandou msg)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const STAGE_NOVO_LEAD = '7c151f2e-5b3c-4118-9cc1-c0d65287696f'
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

function isValidBrazilianPhone(raw: string): boolean {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return false
  if (d.length >= 12 && !d.startsWith('55')) return false
  return true
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (auth !== SHARED) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })

  const body = await req.json().catch(() => ({}))
  const vendedorNome = String(body.vendedor_nome ?? '').toUpperCase().trim()
  const limit = Math.min(Number(body.limit ?? 50), 100)
  const includeStale = !!body.include_stale
  const includeAttended = !!body.include_attended  // override pra debug
  if (!vendedorNome) return new Response(JSON.stringify({ error: 'vendedor_nome_obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const supaAud = supa.schema('auditoria') as any

  const { data: vendor } = await supa.from('vendors')
    .select('id, name, key, telefone, ativo')
    .or(`key.ilike.${vendedorNome},name.ilike.${vendedorNome}`)
    .limit(1).maybeSingle()
  if (!vendor) {
    return new Response(JSON.stringify({ ok: true, vendedor_nome: vendedorNome, total: 0, leads: [], aviso: 'vendor_nao_encontrado' }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // 1) Pega cards NOVO LEAD do vendedor (recentes ou ia_handled)
  let query = supa.from('cards')
    .select('id, contact_name, contact_phone, contact_phone_formatted, subject, first_message, created_at, last_message_at, raw_data, ad_source, ia_transferred_to, ia_handled')
    .eq('owner_id', vendor.id)
    .eq('pipeline_stage_id', STAGE_NOVO_LEAD)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(limit * 2)

  if (!includeStale) {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    query = query.or(`ia_handled.eq.true,created_at.gte.${cutoff}`)
  }

  const { data: rawCards, error } = await query
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Filtra telefones BR válidos
  const validCards = (rawCards ?? []).filter((c: any) => isValidBrazilianPhone(c.contact_phone))

  // 2) Filtra cards onde o vendedor JÁ está atendendo (etiqueta WA OU msg enviada).
  // wa_chat_labels: phone normalizado, label_ids array, last_message_from_me bool.
  let cards = validCards
  if (!includeAttended && validCards.length > 0) {
    const allTels = new Set<string>()
    for (const c of validCards) for (const t of telVariants(c.contact_phone)) allTels.add(t)
    const { data: chatLabels } = await supa.from('wa_chat_labels')
      .select('phone, label_ids, last_message_from_me')
      .ilike('vendedor_nome', vendedorNome)
      .in('phone', Array.from(allTels))
    const excluir = new Set<string>()
    for (const cl of (chatLabels ?? [])) {
      const temLabel = Array.isArray(cl.label_ids) && cl.label_ids.length > 0
      const enviouMsg = !!cl.last_message_from_me
      if (temLabel || enviouMsg) {
        for (const t of telVariants(cl.phone)) excluir.add(t)
      }
    }
    cards = validCards.filter((c: any) => {
      for (const t of telVariants(c.contact_phone)) if (excluir.has(t)) return false
      return true
    })
  }
  cards = cards.slice(0, limit)

  // 3) Enriquece com auditoria.atendimentos_por_cliente (fallback pros campos placeholder)
  const allTels = new Set<string>()
  for (const c of cards) for (const t of telVariants(c.contact_phone)) allTels.add(t)
  let atendByTel: Record<string, any> = {}
  if (allTels.size > 0) {
    const { data: atends } = await supaAud.from('atendimentos_por_cliente')
      .select('telefone, telefone_norm, nome, qualificacao, qual_animal, quantidade, quantos_animais, o_que_precisa, finalidade_fabrica, capacidade_producao, quando_investir, motivo_contato, origem, last_message_text, ai_context_summary')
      .in('telefone_norm', Array.from(allTels))
    for (const a of (atends ?? [])) {
      atendByTel[String(a.telefone_norm)] = a
      atendByTel[String(a.telefone)] = a
    }
  }
  function findAtend(phone: string) {
    for (const t of telVariants(phone)) if (atendByTel[t]) return atendByTel[t]
    return null
  }

  return new Response(JSON.stringify({
    ok: true,
    vendedor_nome: vendedorNome,
    vendor_id: vendor.id,
    total: cards.length,
    leads: cards.map((c: any) => {
      const dados = c.raw_data?.dados ?? {}
      const a = findAtend(c.contact_phone) ?? {}
      const nome = clean(c.contact_name) ?? clean(a.nome) ?? null
      const animal = clean(dados.animal) ?? clean(a.qual_animal) ?? null
      const quantidade = clean(dados.quantidade) ?? clean(a.quantidade) ?? clean(a.quantos_animais) ?? null
      const formulacao = clean(dados.formulacao) ?? null
      const finalidade = clean(dados.finalidade) ?? clean(a.finalidade_fabrica) ?? null
      const equipamento = clean(dados.equipamento) ?? null
      const aplicacao = clean(dados.aplicacao) ?? null
      const variante = clean(dados.variante) ?? null
      const temperatura = clean(dados.temperatura) ?? null
      const quandoInvestir = clean(a.quando_investir) ?? null
      const contexto = clean(dados.contexto) ?? clean(a.ai_context_summary) ?? clean(a.o_que_precisa) ?? null
      const motivo = clean(a.motivo_contato) ?? null
      const qualificacao = clean(a.qualificacao) ?? null
      const preview = clean(c.first_message) ?? clean(a.last_message_text) ?? null
      const interesse = clean(c.raw_data?.interesse) ?? null
      const origem = clean(c.ad_source) ?? clean(c.raw_data?.origem) ?? clean(a.origem) ?? null
      const criativo = clean(dados.criativo) ?? null
      const capacidade = clean(a.capacidade_producao) ?? null

      return {
        id: c.id, telefone: c.contact_phone, telefone_formatado: c.contact_phone_formatted,
        nome, criado_em: c.created_at, ultima_msg: c.last_message_at ?? c.created_at,
        preview, assunto: clean(c.subject), origem, interesse,
        animal, quantidade, formulacao, finalidade,
        equipamento, variante, aplicacao, contexto, temperatura,
        quando_investir: quandoInvestir, motivo, qualificacao, capacidade, criativo,
        ia_handled: !!c.ia_handled,
        transferido_pela_ana_em: c.ia_transferred_to ? c.created_at : null,
      }
    }),
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
