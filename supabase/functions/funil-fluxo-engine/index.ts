import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ENGINE DOS FLUXOS DO FUNIL (v3): executa os fluxos desenhados no editor do CRM.
// v3: (1) acao 'ia_assumir' liga a IA atendente pro chat (upsert ia_atendimentos,
// mesmo mecanismo do auto_scan); (2) decisao com criterio 'respondeu_alguma_vez'
// (instantanea, separa NUNCA RESPONDEU de NAO RESPONDEU MAIS); (3) {nome}/{{primeiro_nome}}
// nas mensagens so preenche quando o pushname/contact_name parece NOME DE GENTE de
// verdade (nomeReal) — senao a msg sai sem nome, limpa.
// v2 (mantido): decisao conta janela de max(ultima_msg, entrada_no_no); dedup de
// mover_etiqueta pela ETIQUETA; conclusao registra o no onde terminou.

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MAX_ENTRADAS_CICLO = 200
const MAX_ACOES_VENDEDOR_CICLO = 30
const MAX_PASSOS_POR_ESTADO = 10

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' }
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } })
const norm = (s: any) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

// Nome do cliente pra {nome}: SO devolve quando parece NOME DE GENTE de verdade.
// Rejeita numero/telefone, frases longas, e genericos/empresa ("Gratidao gera gratidao",
// "Deus e fiel", "... LTDA", agro/nutri/comercio...). Senao devolve '' → msg sem nome.
function nomeReal(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/\d/.test(s)) return ''
  if (/^[\d\s()+\-]+$/.test(s)) return ''
  const palavras = s.split(/\s+/)
  if (palavras.length > 3) return ''
  const primeiro = palavras[0]
  if (primeiro.length < 2 || primeiro.length > 20) return ''
  if (!/^[a-zà-ÿ']+$/i.test(primeiro)) return ''
  if (/(gratid|deus|jesus|cristo|am[eé]m|aben[çc]|nossa senhora|\bsanta\b|\bsanto\b|\bltda\b|\bme\b|\bepp\b|\beireli\b|com[eé]rcio|comercial|ind[uú]stria|\bagro|nutri|fazenda|s[ií]tio|granja|represent|distribu|transport)/i.test(s)) return ''
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}

// Preenche {nome} / {{primeiro_nome}} / {{nome}}. Com nome → substitui. Sem nome →
// remove o token E limpa a pontuacao/espaco orfao ("Ola {nome}, tudo?" → "Ola, tudo?";
// "{nome}, vou..." → "Vou...").
function preencheNome(txt: string, nome: string): string {
  const RE = /\{\{?\s*(?:nome|primeiro_nome)\s*\}?\}/gi
  if (nome) return txt.replace(RE, nome)
  return txt
    .replace(/\s*\{\{?\s*(?:nome|primeiro_nome)\s*\}?\}\s*/gi, ' ')
    .replace(/\s+([,!?.:;])/g, '$1')
    .replace(/^\s*[,;:]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^([a-zà-ÿ])/i, (c) => c.toUpperCase())
    .trim()
}

async function concluir(supa: any, estadoId: number, motivo: string, nodeId?: string) {
  const upd: any = { concluido: true, motivo_conclusao: motivo }
  if (nodeId) upd.node_atual = nodeId
  await supa.from('funil_fluxo_estados').update(upd).eq('id', estadoId)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) return j({ error: 'unauthorized' }, 401)

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: any = {}
  try { body = await req.json() } catch {}
  const action = body.action || 'executar'

  try {
    if (action === 'acoes_pendentes') {
      const { vendedor_nome } = body
      if (!vendedor_nome) return j({ ok: false, error: 'vendedor_nome obrigatorio' }, 400)
      const { data } = await supa.from('funil_fluxo_acoes')
        .select('id, chat_id, tipo, payload')
        .ilike('vendedor_nome', vendedor_nome).eq('status', 'pendente').eq('tipo', 'mover_etiqueta')
        .order('id', { ascending: true }).limit(10)
      return j({ ok: true, acoes: data || [] })
    }
    if (action === 'acao_concluida') {
      const { id, ok, erro } = body
      if (!id) return j({ ok: false, error: 'id obrigatorio' }, 400)
      await supa.from('funil_fluxo_acoes').update({ status: ok ? 'executada' : 'erro', erro: ok ? null : String(erro || '').slice(0, 200), executado_em: new Date().toISOString() }).eq('id', id)
      return j({ ok: true })
    }

    if (action !== 'executar') return j({ ok: false, error: 'action invalida' }, 400)

    const { data: fluxos } = await supa.from('funil_fluxos').select('*').eq('ativo', true).neq('modo', 'desativado')
    if (!fluxos || !fluxos.length) return j({ ok: true, msg: 'nenhum fluxo ativo' })

    const { data: ets } = await supa.from('wascript_etiquetas').select('vendedor_nome, etiqueta_id_wascript, etiqueta_nome')
    const mapaEt = new Map<string, Map<string, string>>()
    for (const e of (ets || [])) {
      const v = norm(e.vendedor_nome)
      if (!mapaEt.has(v)) mapaEt.set(v, new Map())
      mapaEt.get(v)!.set(String(e.etiqueta_id_wascript), norm(e.etiqueta_nome))
    }

    const desde14 = new Date(Date.now() - 14 * 86400_000).toISOString()
    const { data: chats } = await supa.from('wa_chat_labels')
      .select('vendedor_nome, phone, chat_id, label_ids, contact_name, last_message_from_me, last_message_at, label_changed_at, updated_at')
      .gt('updated_at', desde14).limit(20000)
    const chatKey = (v: string, c: string) => norm(v) + '|' + c
    const chatsMap = new Map<string, any>()
    for (const c of (chats || [])) chatsMap.set(chatKey(c.vendedor_nome, c.chat_id), c)
    const etiquetasDoChat = (c: any): Set<string> => {
      const m = mapaEt.get(norm(c.vendedor_nome))
      const out = new Set<string>()
      for (const id of (c.label_ids || [])) { const n = m?.get(String(id)); if (n) out.add(n) }
      return out
    }

    const resumo: any = { fluxos: fluxos.length, entradas: 0, avancos: 0, simuladas: 0, pendentes: 0, executadas: 0, puladas: 0, concluidos: 0, ia_ligadas: 0 }
    const agora = Date.now()

    for (const fluxo of fluxos) {
      const def = fluxo.definicao || {}
      const nodes: any[] = Array.isArray(def.nodes) ? def.nodes : []
      const edges: any[] = Array.isArray(def.edges) ? def.edges : []
      const byId = new Map(nodes.map((n: any) => [String(n.id), n]))
      const saidas = (id: string, quando?: string) => {
        const es = edges.filter((e: any) => String(e.from) === id)
        if (quando !== undefined) return es.find((e: any) => e.quando === quando)
        return es.find((e: any) => !e.quando) || es[0]
      }
      const inicio = nodes.find((n: any) => n.tipo === 'inicio')
      if (!inicio) continue
      const etInicio = norm(inicio.config?.etiqueta)
      if (!etInicio) continue
      const etsFluxo = new Set<string>([etInicio])
      for (const n of nodes) {
        if (n.config?.etiqueta) etsFluxo.add(norm(n.config.etiqueta))
        if (n.config?.se_ainda_em) etsFluxo.add(norm(n.config.se_ainda_em))
      }

      const { data: jaTem } = await supa.from('funil_fluxo_estados').select('chat_id').eq('fluxo_id', fluxo.id)
      const jaSet = new Set((jaTem || []).map((r: any) => r.chat_id))
      const janelaMs = (fluxo.janela_entrada_dias || 3) * 86400_000
      let entradas = 0
      for (const c of (chats || [])) {
        if (entradas >= MAX_ENTRADAS_CICLO) break
        if (fluxo.escopo_vendedor && norm(c.vendedor_nome) !== norm(fluxo.escopo_vendedor)) continue
        if (jaSet.has(c.chat_id)) continue
        if (!etiquetasDoChat(c).has(etInicio)) continue
        const ref = new Date(c.label_changed_at || c.last_message_at || c.updated_at || 0).getTime()
        if (!ref || agora - ref > janelaMs) continue
        await supa.from('funil_fluxo_estados').insert({ fluxo_id: fluxo.id, chat_id: c.chat_id, vendedor_nome: c.vendedor_nome, node_atual: String(inicio.id) })
        entradas++
      }
      resumo.entradas += entradas

      const { data: estados } = await supa.from('funil_fluxo_estados').select('*').eq('fluxo_id', fluxo.id).eq('concluido', false).limit(500)
      const acoesPorVendedor = new Map<string, number>()
      for (const st of (estados || [])) {
        const chat = chatsMap.get(chatKey(st.vendedor_nome, st.chat_id))
        if (!chat) { await concluir(supa, st.id, 'chat_sumiu'); resumo.concluidos++; continue }
        const etsChat = etiquetasDoChat(chat)
        if (etsChat.size && ![...etsChat].some(e => etsFluxo.has(e))) { await concluir(supa, st.id, 'vendedor_moveu'); resumo.concluidos++; continue }
        // v3: o cliente respondeu em algum momento? (pra decisao 'respondeu_alguma_vez')
        const respondeuAlgumaVez = st.respondeu_alguma_vez === true || chat.last_message_from_me === false
        let nodeId = String(st.node_atual)
        let entrou = new Date(st.entrou_no_node_em).getTime()
        let passos = 0, mudou = false
        while (passos++ < MAX_PASSOS_POR_ESTADO) {
          const node = byId.get(nodeId)
          if (!node) { await concluir(supa, st.id, 'node_invalido', nodeId); resumo.concluidos++; mudou = false; break }
          if (node.tipo === 'fim') { await concluir(supa, st.id, 'fim', nodeId); resumo.concluidos++; mudou = false; break }
          if (node.tipo === 'inicio') {
            const e = saidas(nodeId); if (!e) { await concluir(supa, st.id, 'sem_aresta', nodeId); resumo.concluidos++; mudou = false; break }
            nodeId = String(e.to); entrou = agora; mudou = true; continue
          }
          if (node.tipo === 'espera') {
            const h = Number(node.config?.horas) || 0
            if (agora - entrou < h * 3600_000) break
            const e = saidas(nodeId); if (!e) { await concluir(supa, st.id, 'sem_aresta', nodeId); resumo.concluidos++; mudou = false; break }
            nodeId = String(e.to); entrou = agora; mudou = true; continue
          }
          if (node.tipo === 'decisao') {
            let quando: string | null = null
            if (node.config?.criterio === 'respondeu_alguma_vez') {
              // decisao INSTANTANEA: separa quem nunca respondeu de quem respondeu e parou.
              quando = respondeuAlgumaVez ? 'sim' : 'nao'
            } else {
              const janelaH = Number(node.config?.janela_h) || 24
              const ultMs = new Date(chat.last_message_at || 0).getTime()
              // v2: janela conta do MAIS RECENTE entre ultima msg e a CHEGADA neste no.
              const refMs = Math.max(ultMs || 0, entrou)
              if (chat.last_message_from_me === false) quando = 'sim'
              else if (agora - refMs > janelaH * 3600_000) quando = 'nao'
            }
            if (!quando) break
            const e = saidas(nodeId, quando) || saidas(nodeId)
            if (!e) { await concluir(supa, st.id, 'sem_aresta_' + quando, nodeId); resumo.concluidos++; mudou = false; break }
            nodeId = String(e.to); entrou = agora; mudou = true; continue
          }
          if (node.tipo === 'acao') {
            const cfg = node.config || {}
            const vKey = norm(st.vendedor_nome)
            const usado = acoesPorVendedor.get(vKey) || 0
            if (usado >= MAX_ACOES_VENDEDOR_CICLO) break
            if (cfg.se_ainda_em && !etsChat.has(norm(cfg.se_ainda_em))) {
              resumo.puladas++
            } else {
              // v2: dedup pela ETIQUETA (mover 2A TENTATIVA != mover NUNCA RESPONDEU)
              const desde24 = new Date(agora - 86400_000).toISOString()
              let q = supa.from('funil_fluxo_acoes').select('id')
                .eq('fluxo_id', fluxo.id).eq('chat_id', st.chat_id).eq('tipo', String(cfg.acao))
                .gt('criado_em', desde24).neq('status', 'erro')
              if (cfg.etiqueta) q = q.eq('payload->>etiqueta', String(cfg.etiqueta))
              const { data: dup } = await q.limit(1)
              if (!dup || !dup.length) {
                const payload: any = { node: nodeId, label: node.label || '', etiqueta: cfg.etiqueta || null, mensagem: (cfg.mensagem || '').slice(0, 800) || null, modo: fluxo.modo }
                let status = 'simulada'
                if (fluxo.modo === 'automatico') {
                  if (cfg.acao === 'ia_assumir') {
                    // v3: liga a IA atendente pro chat (mesmo mecanismo do auto_scan).
                    // ignoreDuplicates: se ja existe estado (on OU off pelo vendedor), respeita.
                    await supa.from('ia_atendimentos').upsert({ chat_id: st.chat_id, vendedor_nome: st.vendedor_nome, nome_contato: chat.contact_name || null, ativo: true, origem: 'fluxo_funil', ligado_em: new Date().toISOString() }, { onConflict: 'chat_id', ignoreDuplicates: true })
                    try { await supa.from('automation_runs').insert({ regra_key: 'ia_atendente', vendedor_nome: st.vendedor_nome, chat_id: st.chat_id, acao: 'ia_ligada', modo: 'automatico', executor: 'fluxo_funil', status: 'executado', motivo: 'fluxo do funil: passo IA assume' }) } catch (_) {}
                    resumo.ia_ligadas++
                    status = 'executada'
                  } else if (cfg.acao === 'mover_etiqueta') status = 'pendente'
                  else if (cfg.acao === 'enviar_msg' && cfg.mensagem) {
                    const nome = nomeReal(chat.contact_name || '')
                    await supa.from('wa_scheduled_messages').insert({ vendedor_nome: st.vendedor_nome, chat_id: st.chat_id, contato_nome: chat.contact_name || null, contato_numero: chat.phone || null, body: preencheNome(String(cfg.mensagem), nome), scheduled_at: new Date().toISOString(), status: 'pending' })
                    status = 'executada'
                  } else if (cfg.acao === 'avisar_vendedor' && cfg.mensagem) {
                    await supa.from('wa_scheduled_messages').insert({ vendedor_nome: st.vendedor_nome, to_self: true, chat_id: st.chat_id, contato_nome: chat.contact_name || null, body: '🔁 *Fluxo do funil* — ' + (chat.contact_name || st.chat_id.split('@')[0]) + '\n' + String(cfg.mensagem).slice(0, 500), scheduled_at: new Date().toISOString(), status: 'pending' })
                    status = 'executada'
                  }
                }
                await supa.from('funil_fluxo_acoes').insert({ fluxo_id: fluxo.id, chat_id: st.chat_id, vendedor_nome: st.vendedor_nome, tipo: String(cfg.acao || 'desconhecida'), payload, status, executado_em: status === 'executada' ? new Date().toISOString() : null })
                acoesPorVendedor.set(vKey, usado + 1)
                if (status === 'simulada') resumo.simuladas++
                else if (status === 'pendente') resumo.pendentes++
                else resumo.executadas++
              }
            }
            const e = saidas(nodeId)
            if (!e) { await concluir(supa, st.id, 'fim_apos_acao', nodeId); resumo.concluidos++; mudou = false; break }
            nodeId = String(e.to); entrou = agora; mudou = true; continue
          }
          break
        }
        // v3: persiste avanco de no E/OU a flag respondeu_alguma_vez.
        const flagMudou = respondeuAlgumaVez && st.respondeu_alguma_vez !== true
        if (mudou || flagMudou) {
          const upd: any = { respondeu_alguma_vez: respondeuAlgumaVez }
          if (mudou) { upd.node_atual = nodeId; upd.entrou_no_node_em = new Date(entrou).toISOString() }
          await supa.from('funil_fluxo_estados').update(upd).eq('id', st.id)
          if (mudou) resumo.avancos++
        }
      }
    }
    return j({ ok: true, resumo })
  } catch (e) {
    return j({ ok: false, error: String((e as any)?.message || e).slice(0, 300) }, 500)
  }
})
