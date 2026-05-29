// v14: NAO deleta wa_chat_labels quando vem heartbeat (chats_etiquetas vazio).
// Bug anterior: heartbeat com array vazio apagava todo o historico do vendedor.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LATEST_VERSION = '0.69.1'
const LATEST_DOWNLOAD = 'https://branorte-crm.vercel.app/extension/branorte-wa-sync-latest.zip'

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-extension-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${SHARED_SECRET}`) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors })
  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: cors }) }

  const { vendedor_nome, etiquetas, chats_etiquetas, total_chats, sem_etiqueta, dia, chats_ativos_hoje, msgs_estimadas_hoje, movimentos, ext_version, client_version, _diag, wa_self_wid } = body
  if (!vendedor_nome || !Array.isArray(etiquetas)) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers: cors })

  const vendedor = String(vendedor_nome).toUpperCase()
  const isHeartbeat = !!(_diag?.heartbeat_only)

  if (wa_self_wid && typeof wa_self_wid === 'string' && wa_self_wid.length >= 10 && wa_self_wid.length <= 15) {
    try {
      const { data: vendor } = await sb.from('vendors').select('telefone').eq('name', vendedor).single()
      if (vendor && vendor.telefone !== wa_self_wid) {
        await sb.from('vendors').update({ telefone: wa_self_wid }).eq('name', vendedor)
      }
    } catch (e) { console.error('vendor telefone update error', e) }
  }

  // wascript_etiquetas: so atualiza se NAO for heartbeat (heartbeat vem com etiquetas: [])
  if (!isHeartbeat && etiquetas.length > 0) {
    await sb.from('wascript_etiquetas').delete().eq('vendedor_nome', vendedor)
    const rows = etiquetas.map((e: any) => {
      const idNum = parseInt(String(e.id), 10)
      return {
        vendedor_nome: vendedor,
        etiqueta_id_wascript: Number.isFinite(idNum) ? idNum : 0,
        etiqueta_nome: e.name,
        etiqueta_nome_normalizado: String(e.name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(),
        total_contatos: e.count ?? 0,
        synced_at: new Date().toISOString(),
      }
    }).filter((r: any) => r.etiqueta_id_wascript > 0)
    if (rows.length > 0) { const { error } = await sb.from('wascript_etiquetas').insert(rows); if (error) console.error('etiquetas insert error', error) }
  }

  if (dia && (typeof chats_ativos_hoje === 'number' || typeof msgs_estimadas_hoje === 'number')) {
    const { error: dailyErr } = await sb.from('wa_daily_activity').upsert(
      { vendedor_nome: vendedor, dia, chats_ativos: chats_ativos_hoje ?? 0, msgs_estimadas: msgs_estimadas_hoje ?? 0, atualizado_em: new Date().toISOString() },
      { onConflict: 'vendedor_nome,dia' },
    )
    if (dailyErr) console.error('daily upsert error', dailyErr)
  }

  let chatLabelsCount = 0, chatLabelsFiltered = 0, chatLabelsRaw = 0
  // CRITICO: SO mexe em wa_chat_labels se NAO for heartbeat E o array tiver itens.
  // Heartbeat com array vazio NAO deve apagar nada.
  if (Array.isArray(chats_etiquetas) && chats_etiquetas.length > 0 && !isHeartbeat) {
    chatLabelsRaw = chats_etiquetas.length
    const syncTs = new Date().toISOString()
    const lista = chats_etiquetas.slice(0, 5000).filter((c: any) => c && typeof c.phone === 'string' && c.phone.length >= 10 && Array.isArray(c.label_ids))
    chatLabelsFiltered = lista.length
    if (lista.length > 0) {
      const labelRows = lista.map((c: any) => ({
        vendedor_nome: vendedor, phone: String(c.phone), chat_id: String(c.chat_id || ''),
        label_ids: c.label_ids.map(String),
        contact_name: c.name ? String(c.name).slice(0, 100) : null,
        last_message_at: c.last_message_at || null,
        last_message_from_me: typeof c.last_message_from_me === 'boolean' ? c.last_message_from_me : null,
        last_message_preview: c.last_message_preview ? String(c.last_message_preview).slice(0, 100) : null,
        updated_at: syncTs,
      }))
      const CHUNK = 500
      for (let i = 0; i < labelRows.length; i += CHUNK) {
        const slice = labelRows.slice(i, i + CHUNK)
        const { error: upErr } = await sb.from('wa_chat_labels').upsert(slice, { onConflict: 'vendedor_nome,phone' })
        if (upErr) { console.error('chat_labels upsert error', upErr); break }
        chatLabelsCount += slice.length
      }
      // Delete stale: so executa quando teve dados validos (lista.length > 0)
      const { error: delErr } = await sb.from('wa_chat_labels').delete().eq('vendedor_nome', vendedor).lt('updated_at', syncTs)
      if (delErr) console.error('chat_labels delete stale error', delErr)
    }
  }

  let movimentosCount = 0
  if (Array.isArray(movimentos) && movimentos.length > 0) {
    const movRows = movimentos.slice(0, 500).map((m: any) => ({
      vendedor_nome: vendedor, phone: String(m.phone || ''),
      chat_id: m.chat_id ? String(m.chat_id) : null,
      etiqueta_de: m.etiqueta_de ? String(m.etiqueta_de) : null,
      etiqueta_para: m.etiqueta_para ? String(m.etiqueta_para) : null,
      detectado_em: m.detectado_em || new Date().toISOString(),
    })).filter((m: any) => m.phone.length >= 10)
    if (movRows.length > 0) {
      const { error: movErr } = await sb.from('wa_etiqueta_movimentos').upsert(movRows, { onConflict: 'vendedor_nome,phone,etiqueta_de,etiqueta_para,detectado_em', ignoreDuplicates: true })
      if (movErr) console.error('movimentos insert error', movErr)
      else movimentosCount = movRows.length
    }
  }

  const versionTag = ext_version || client_version || req.headers.get('x-extension-version') || null
  try {
    await sb.from('wa_sync_debug').insert({
      vendedor_nome: vendedor,
      etiquetas_count: isHeartbeat ? 0 : etiquetas.length,
      chats_etiquetas_count: chatLabelsRaw,
      chats_etiquetas_filtered: chatLabelsFiltered,
      movimentos_count: movimentosCount,
      total_chats: typeof total_chats === 'number' ? total_chats : null,
      sem_etiqueta: typeof sem_etiqueta === 'number' ? sem_etiqueta : null,
      client_version: versionTag ? String(versionTag).slice(0, 20) : null,
      wa_self_wid: wa_self_wid || null,
      diag: _diag || null,
      recebido_em: new Date().toISOString(),
    })
  } catch (e) { console.error('sync_debug insert error', e) }

  return new Response(
    JSON.stringify({ ok: true, heartbeat: isHeartbeat, chat_labels: chatLabelsCount, chat_labels_raw: chatLabelsRaw, chat_labels_filtered: chatLabelsFiltered, movimentos: movimentosCount, latest_version: LATEST_VERSION, latest_download: LATEST_DOWNLOAD }),
    { headers: { ...cors, 'Content-Type': 'application/json' } },
  )
})
