// frete-disparar — dispara o link de cotação pras transportadoras escolhidas.
// Chamado pelo Jardel/admin na fila /frete/aprovar (verify_jwt=true).
// AUTORIZAÇÃO: exige permissão frete.aprovar (não basta estar logado).
// ANTI-SPAM: não reenfileira uma transportadora cujo lance já tem mensagem
// pending/sent (re-clicar "Disparar" não duplica WhatsApp).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'content-type': 'application/json' } })
}

function decodeJwt(token: string): any {
  try {
    const p = token.split('.')
    if (p.length !== 3) return null
    const payload = p[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload + '='.repeat((4 - payload.length % 4) % 4)))
  } catch { return null }
}

function normalizeFone(raw: unknown): string {
  let d = String(raw || '').replace(/\D/g, '').replace(/^0+/, '') // tira zeros à esquerda (DDD com 0)
  if (!d) return ''
  if (d.length <= 11) d = '55' + d // DDD+numero -> +55
  return d
}

function resumoEquip(itens: any, descricao: any): string {
  try {
    const arr = Array.isArray(itens) ? itens : []
    if (arr.length) {
      return arr.map((i: any) => `${i.qtd && i.qtd > 1 ? i.qtd + 'x ' : ''}${i.nome || i.nome_curto || 'equipamento'}`).join(' + ')
    }
  } catch { /* noop */ }
  return String(descricao || 'Equipamento Branorte')
}

function montarMsg(transp: any, solic: any, equip: string, destino: string, link: string): string {
  const linhas: string[] = []
  linhas.push(`*Branorte — Cotação de Frete*${solic.codigo ? ' ' + solic.codigo : ''}`)
  linhas.push('')
  linhas.push(`Olá${transp.contato_nome ? ', ' + transp.contato_nome : ''}! Precisamos de uma cotação de frete:`)
  linhas.push('')
  linhas.push(`📦 ${equip}`)
  linhas.push(`📍 Destino: ${destino}${solic.distancia_km ? ` (~${Math.round(Number(solic.distancia_km))} km de Grão Pará/SC)` : ''}`)
  if (solic.peso_total_kg) linhas.push(`⚖️ Peso aprox.: ${Math.round(Number(solic.peso_total_kg))} kg`)
  if (solic.carga_indivisivel) linhas.push(`⚠️ Carga indivisível (não fraciona)`)
  if (solic.prazo_desejado) linhas.push(`🗓️ Prazo desejado: ${solic.prazo_desejado}`)
  linhas.push('')
  linhas.push(`👉 Preencha seu valor aqui (leva 30s):`)
  linhas.push(link)
  return linhas.join('\n')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = decodeJwt(authHeader.replace(/^Bearer\s+/i, ''))
  if (!jwt || jwt.role !== 'authenticated' || !jwt.sub) return json({ error: 'unauthorized' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // AUTORIZAÇÃO: precisa de frete.aprovar (mesma fonte do useCan: user_profiles.role + role_permissions)
  const { data: prof } = await sb.from('user_profiles').select('role, display_name').eq('id', jwt.sub).maybeSingle()
  const role = prof?.role
  let temPerm = false
  if (role) {
    const { data: rp } = await sb.from('role_permissions').select('permissions').eq('role', role).maybeSingle()
    temPerm = rp?.permissions?.['frete.aprovar'] === true
  }
  if (!temPerm) return json({ error: 'forbidden', detail: 'requer permissão frete.aprovar' }, 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const solicitacao_id = String(body.solicitacao_id || '')
  const transportadora_ids = Array.isArray(body.transportadora_ids) ? body.transportadora_ids : []
  if (!solicitacao_id) return json({ error: 'solicitacao_id_required' }, 400)
  if (!transportadora_ids.length) return json({ error: 'sem_transportadoras' }, 400)

  const { data: cfgRows } = await sb.from('frete_config').select('chave,valor')
  const cfg: Record<string, string> = Object.fromEntries((cfgRows || []).map((r: any) => [r.chave, r.valor]))
  const vendedorNome = String(cfg.vendedor_nome_disparo || 'JARDEL').toUpperCase()
  const disparoAtivo = String(cfg.disparo_ativo ?? 'true') === 'true'
  const linkBase = String(cfg.link_base || 'https://branorte-crm.vercel.app').replace(/\/+$/, '')

  const { data: solic } = await sb.from('frete_solicitacoes').select('*').eq('id', solicitacao_id).maybeSingle()
  if (!solic) return json({ error: 'solicitacao_nao_encontrada' }, 404)

  const aprovadorNome = prof?.display_name ?? jwt.email ?? null
  const equip = resumoEquip(solic.equipamentos_itens, solic.descricao_carga)
  const destino = `${solic.cidade_destino || '?'}/${solic.uf_destino || '?'}`
  const results: any[] = []

  for (const tidRaw of transportadora_ids) {
    const tid = Number(tidRaw)
    const { data: transp } = await sb.from('frete_transportadoras_parceiras')
      .select('id,nome,telefone,contato_nome').eq('id', tid).maybeSingle()
    if (!transp) { results.push({ transportadora_id: tid, erro: 'nao_encontrada' }); continue }

    // 1 lance por (solicitacao, transportadora)
    const { data: existing } = await sb.from('frete_lances').select('*')
      .eq('solicitacao_id', solicitacao_id).eq('transportadora_id', tid).maybeSingle()
    let lance = existing
    if (!lance) {
      const { data: novo, error: ie } = await sb.from('frete_lances').insert({
        solicitacao_id, transportadora_id: tid,
        transportadora_nome: transp.nome, transportadora_telefone: transp.telefone,
        status: 'enviado',
      }).select().single()
      if (ie) { results.push({ transportadora_id: tid, nome: transp.nome, erro: ie.message }); continue }
      lance = novo
    }

    const link = `${linkBase}/cotar-frete/${lance.token}`
    const fone = normalizeFone(transp.telefone)

    // ANTI-SPAM: já tem mensagem pendente/enviada pra essa transportadora → não reenvia
    const jaEnviado = !!lance.wa_message_id && (lance.wa_status === 'pending' || lance.wa_status === 'sent')
    if (jaEnviado) {
      results.push({ transportadora_id: tid, nome: transp.nome, telefone: fone, link, enqueued: false, ja_enviado: true })
      continue
    }

    let enqueued = false
    let wa_message_id: string | null = null
    if (disparoAtivo && fone && fone.length >= 12) {
      const { data: sched, error: schErr } = await sb.from('wa_scheduled_messages').insert({
        vendedor_nome: vendedorNome,
        chat_id: `${fone}@c.us`,
        contato_numero: fone,
        contato_nome: transp.nome,
        body: montarMsg(transp, solic, equip, destino, link),
        scheduled_at: new Date().toISOString(),
        status: 'pending',
      }).select('id').single()
      if (!schErr && sched) { enqueued = true; wa_message_id = sched.id }
    }

    await sb.from('frete_lances').update({
      status: 'enviado', enviado_em: new Date().toISOString(),
      wa_message_id, wa_status: enqueued ? 'pending' : null,
      transportadora_nome: transp.nome, transportadora_telefone: transp.telefone,
    }).eq('id', lance.id)

    results.push({
      transportadora_id: tid, nome: transp.nome, telefone: fone, link,
      enqueued, wa_message_id,
      sem_telefone: !(fone && fone.length >= 12),
    })
  }

  // solicitação -> em_cotacao + marca aprovação se ainda não tinha
  const patch: Record<string, unknown> = { status: 'em_cotacao' }
  if (!solic.aprovado_em) {
    patch.aprovado_em = new Date().toISOString()
    patch.aprovado_por = jwt.sub
    if (aprovadorNome) patch.aprovado_por_nome = aprovadorNome
  }
  await sb.from('frete_solicitacoes').update(patch).eq('id', solicitacao_id)

  return json({ ok: true, disparo_ativo: disparoAtivo, vendedor_nome: vendedorNome, results })
})
