// supabase/functions/wa-sync-messages/index.ts
// Histórico recente (últimas ~10 msgs) dos chats em FOLLOW UP / LEAD QUENTE,
// pro drawer "Conversa" do funil do CRM. Duas operações num endpoint só
// (mesmo desenho round-trip do wa-sync-avatars):
//   1) POST {vendedor_nome, mensagens:[...]}  → upsert em wa_chat_messages
//      e devolve {need_media:[{msg_id}]} = mídias sem binário (ANA inclui vídeos, documentos e stickers);
//   2) POST {vendedor_nome, media:[{msg_id,dataUrl}]} → decodifica o base64 e
//      sobe no bucket certo (áudio→wa-audios, imagem→wa-midias), grava media_url.
//
// Deploy: supabase functions deploy wa-sync-messages --no-verify-jwt
// Auth: Bearer SHARED_SECRET (mesmo esquema do wa-sync-labels)
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureTypes, validateMedia, readLimitedJson, PayloadTooLargeError } from './media-policy.ts'

const SHARED_SECRET = Deno.env.get('SHARED_SECRET') || Deno.env.get('WA_SYNC_SHARED_SECRET') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_MSGS_POR_POST = 200
const MAX_MEDIA_POR_POST = 6
const NEED_MEDIA_LOTE = 4

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// msg_id do WhatsApp tem ':'/'@' — vira nome de arquivo seguro
function pathSeguro(msgId: string): string {
  return msgId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('authorization') ?? ''
  if (!SHARED_SECRET || auth !== `Bearer ${SHARED_SECRET}`) return json({ error: 'unauthorized' }, 401)
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: any
  try { body = await readLimitedJson(req) } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: 'payload_too_large' }, 413)
    return json({ error: 'invalid_json' }, 400)
  }

  const vendedor = String(body?.vendedor_nome || '').toUpperCase().trim()
  if (!vendedor) return json({ error: 'missing_vendedor' }, 400)
  const TIPOS_MIDIA = captureTypes(vendedor)

  // ===== 0) BACKFILL: devolve os próximos chats a reler =====
  // De 01 a 10/08/2026 o "Out of Memory" travava a aba e o sync lia só as 10 ÚLTIMAS msgs
  // por ciclo; chat que passou de 10 entre dois ciclos perdeu o miolo — e junto foram os
  // registros de LIGAÇÃO (call_log), que são mensagem de sistema como qualquer outra.
  // Medido por MIL mensagens (normaliza atividade): 6 dos 9 vendedores caíram 42-81% com
  // volume de conversa estável. Aqui a extensão pergunta o que reler com janela maior.
  if (body?.acao === 'backfill_next') {
    const lote = Math.min(Number(body?.lote) || 2, 4)   // teto baixo: não competir com o sync do dia
    const { data: fila } = await sb.from('wa_backfill_fila')
      .select('id, chat_id, msgs_antes')
      .eq('vendedor_nome', vendedor).eq('status', 'pendente')
      .lt('tentativas', 3)                              // 3 falhas = desiste, não fica em loop
      .order('msgs_antes', { ascending: false })        // chat movimentado primeiro: é onde mais se perdeu
      .limit(lote)
    const ids = (fila ?? []).map((f: any) => f.id)
    // marca a tentativa JÁ, não depois: se a aba morrer no meio (que é exatamente o que o
    // Out of Memory fazia), o chat não trava a fila pra sempre.
    if (ids.length) { try { await sb.rpc('wa_backfill_tentar', { p_ids: ids }) } catch (e) { console.error('backfill_tentar', e) } }
    const { count: restam } = await sb.from('wa_backfill_fila')
      .select('id', { count: 'exact', head: true })
      .eq('vendedor_nome', vendedor).eq('status', 'pendente').lt('tentativas', 3)
    return json({ ok: true, chats: (fila ?? []).map((f: any) => f.chat_id), restam: restam ?? 0 })
  }

  // ===== 2) mídia (áudio → wa-audios, imagem → wa-midias): dataUrl → Storage → media_url =====
  if (Array.isArray(body.media) && body.media.length > 0) {
    let saved = 0
    for (const m of body.media.slice(0, MAX_MEDIA_POR_POST)) {
      const msgId = String(m?.msg_id || '')
      if (!msgId) continue
      // extensão desistiu (3 falhas = mídia expirou no aparelho) → sai da fila need_media
      if (m?.indisponivel === true) {
        await sb.from('wa_chat_messages').update({ media_url: 'unavailable' })
          .eq('msg_id', msgId).eq('vendedor_nome', vendedor).is('media_url', null)
        continue
      }
      const dataUrl = String(m?.dataUrl || '')
      try {
        // só grava mídia de msg que EXISTE e é mídia autorizada deste vendedor (anti-lixo)
        const { data: row } = await sb.from('wa_chat_messages')
          .select('id, tipo, filename, chat_id').eq('msg_id', msgId).eq('vendedor_nome', vendedor).maybeSingle()
        if (!row || !TIPOS_MIDIA.includes(String(row.tipo))) continue
        const validation = validateMedia(vendedor, String(row.tipo), dataUrl, row.filename)
        if (!validation.ok) {
          await sb.from('wa_chat_messages').update({ media_url: 'unavailable' }).eq('id', row.id)
          continue
        }
        const { mime, bucket, extension, encoded } = validation
        const bin = atob(encoded)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

        const privateFile = bucket === 'crm-chat-media'
        let folder = vendedor
        if (privateFile) {
          // Resolve from the stored ANA message, never from a caller-supplied chat/path.
          const { data: conversation, error: lookupError } = await sb.from('crm_chat_conversations')
            .select('id').eq('wa_chat_id', row.chat_id).maybeSingle()
          if (lookupError || !conversation || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(conversation.id)) continue
          folder = conversation.id
        }
        const path = privateFile ? `${folder}/${crypto.randomUUID()}.${extension}` : `${vendedor}/${pathSeguro(msgId)}.${extension}`
        const { error: upErr } = await sb.storage.from(bucket)
          .upload(path, bytes, { contentType: mime, upsert: !privateFile })
        if (upErr) { console.error('storage upload error', upErr); continue }
        const mediaUrl = `${SUPABASE_URL}/storage/v1/object/${privateFile ? 'authenticated' : 'public'}/${bucket}/${path}`
        const { error: updErr } = await sb.from('wa_chat_messages')
          .update({ media_url: mediaUrl }).eq('id', row.id)
        if (!updErr) saved++
      } catch (e) { console.error('media error', msgId, e) }
    }
    return json({ ok: true, media_saved: saved })
  }

  // ===== 1) upsert das mensagens + devolve áudios pendentes de mídia =====
  const TIPOS_OK = /^[a-z0-9_]{1,32}$/
  const rows = (Array.isArray(body.mensagens) ? body.mensagens : [])
    .slice(0, MAX_MSGS_POR_POST)
    .map((m: any) => ({
      vendedor_nome: vendedor,
      chat_id: String(m?.chat_id || '').slice(0, 120),
      phone: m?.phone ? String(m.phone).replace(/\D/g, '').slice(0, 15) : null,
      msg_id: String(m?.msg_id || '').slice(0, 200),
      from_me: typeof m?.from_me === 'boolean' ? m.from_me : null,
      tipo: TIPOS_OK.test(String(m?.tipo || '')) ? String(m.tipo) : 'chat',
      // 2026-07-29 — teto subiu de 800 para 4000: mensagem longa de cliente vinha
      // cortada e o Observador perderia o miolo. A extensão ainda trunca em 800 no
      // lado dela (background.js); este lado já aceita o valor maior quando ela subir.
      body: typeof m?.body === 'string' ? m.body.slice(0, 4000) : '',
      filename: typeof m?.filename === 'string' ? m.filename.trim().slice(0, 200) || null : null,
      duracao_seg: Number.isFinite(m?.duracao_seg) ? Math.min(Math.round(m.duracao_seg), 36000) : null,
      // media_url fica FORA do payload de upsert — mídia já salva nunca é sobrescrita
      data_msg: typeof m?.data_msg === 'string' ? m.data_msg : null,
      synced_at: new Date().toISOString(),
    }))
    .filter((r: any) => r.chat_id && r.msg_id)

  let upserted = 0
  if (rows.length) {
    // dedupe intra-lote por msg_id (upsert do PostgREST rejeita duplicata no mesmo comando)
    const porId = new Map<string, any>()
    for (const r of rows) porId.set(r.msg_id, r)
    const { error } = await sb.from('wa_chat_messages')
      .upsert([...porId.values()], { onConflict: 'msg_id' })
    if (error) return json({ error: error.message }, 500)
    upserted = porId.size
  }

  // Fecha os chats que acabaram de ser relidos pelo backfill e MEDE o ganho
  // (msgs_depois - msgs_antes). Esse delta é a resposta honesta pra "quantas ligações
  // estão fazendo de verdade": não é estimativa, é contagem do que voltou.
  if (Array.isArray(body?.backfill_chats) && body.backfill_chats.length) {
    try { await sb.rpc('wa_backfill_concluir', { p_vendedor: vendedor, p_chats: body.backfill_chats }) }
    catch (e) { console.error('backfill_concluir', e) }
  }

  // mídias recentes (14d) deste vendedor ainda sem binário — lote pro próximo passo.
  // Inclui áudio E imagem; a extensão baixa cada uma e devolve; o tipo decide o bucket.
  let need_media: { msg_id: string; chat_id?: string; from_me?: boolean | null; tipo?: string; filename?: string | null }[] = []
  try {
    const cutoff = new Date(Date.now() - 14 * 864e5).toISOString()
    const { data: pend } = await sb.from('wa_chat_messages')
      .select('msg_id, chat_id, from_me, tipo, filename')
      .eq('vendedor_nome', vendedor)
      .in('tipo', TIPOS_MIDIA)
      .is('media_url', null)
      .gte('data_msg', cutoff)
      .order('data_msg', { ascending: false })
      .limit(NEED_MEDIA_LOTE)
    // chat_id+from_me vão junto: a extensão reconstrói o msg-key _serialized que o downloadMedia precisa
    need_media = (pend ?? []).map((r: any) => ({ msg_id: String(r.msg_id), chat_id: r.chat_id, from_me: r.from_me, tipo: r.tipo, filename: r.filename }))
  } catch (e) { console.error('need_media query error', e) }

  // manutenção eventual (2% dos POSTs): mídia >10d sem binário nunca vai chegar
  // (WhatsApp já expirou o arquivo) → marca 'unavailable' pra UI parar de dizer
  // "sincronizando" pra sempre.
  //
  // 2026-07-29 — PURGE DE 90 DIAS REMOVIDO (decisão do Daniel).
  // O DELETE por synced_at apagava a conversa mais antiga primeiro — justamente
  // a que já fechou venda, que é o que o Agente Observador precisa aprender.
  // A conversa passa a acumular. Storage medido na auditoria: 176 MB de áudio.
  // Se algum dia precisar de retenção, fazer arquivamento (extrair par + transcrição
  // antes de expirar), nunca DELETE cego dentro do hot-path da frota.
  if (Math.random() < 0.02) {
    try {
      await sb.from('wa_chat_messages')
        .update({ media_url: 'unavailable' })
        .eq('vendedor_nome', vendedor)
        .in('tipo', TIPOS_MIDIA)
        .is('media_url', null)
        .lt('data_msg', new Date(Date.now() - 10 * 864e5).toISOString())
    } catch { /* best-effort */ }
  }

  // TELEMETRIA (diag da extensão): WPP ready, getMessages existe, msgs por via (gm/store), lote.
  // Loga SÓ o caso de falha (a extensão mandou lote mas nada chegou) — logar todo POST
  // enche o log, e a frota bate aqui a cada 30s. Este trim já estava em produção (v8+)
  // e NÃO estava neste arquivo; preservado ao redeployar em 2026-07-29.
  if (typeof body.lote === 'number' && body.lote > 0 && rows.length === 0) {
    console.log('[wa-sync-msgs-diag]', vendedor, 'lote=' + body.lote, 'recv=0 upserted=0 diag=' + JSON.stringify(body.diag || null))
  }
  return json({ ok: true, upserted, need_media })
})
