// wa-sync-avatars: salva fotos de perfil (baixa da URL WPP -> Storage wa-avatars)
// e devolve o proximo lote de pendentes. Endpoint unico, nao toca em wa-sync-labels.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { avatarPatch, normalizeAvatarCursor, nextAvatarCursor } from './avatar-patch.ts'

const SHARED_SECRET = Deno.env.get('SHARED_SECRET') || Deno.env.get('WA_SYNC_SHARED_SECRET') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'wa-avatars'
const LOTE = 15

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-extension-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function foneCanon(p?: string | null): string | null {
  const d = String(p ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  let n = (d.length >= 12 && d.startsWith('55')) ? d.slice(2) : d
  if (n.length === 11 && n[2] === '9') n = n.slice(0, 2) + n.slice(3)
  if (n.length > 10) n = n.slice(-10)
  return n.length === 10 ? n : null
}

async function baixar(url: string): Promise<Uint8Array | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!ct.startsWith('image/')) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (buf.length < 100 || buf.length > 2000000) return null
    return buf
  } catch { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('authorization') ?? ''
  if (!SHARED_SECRET || auth !== `Bearer ${SHARED_SECRET}`) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors })
  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: cors }) }

  const { vendedor_nome, fotos } = body
  if (!vendedor_nome) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers: cors })
  const vendedor = String(vendedor_nome).toUpperCase()
  const nowIso = new Date().toISOString()

  let saved = 0, checked = 0
  for (const f of (Array.isArray(fotos) ? fotos : []).slice(0, 60)) {
    const phone = String(f?.phone || '')
    if (phone.length < 10) continue
    const canon = foneCanon(phone)
    const picUrl = typeof f?.pic_url === 'string' ? f.pic_url : ''
    let fotoUrl: string | null = null

    if (picUrl.startsWith('http') && canon) {
      const bytes = await baixar(picUrl)
      if (bytes) {
        const path = `${canon}.jpg`
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
        if (!upErr) fotoUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
        else console.error('storage upload error', upErr)
      }
    }

    const patch = avatarPatch(f, fotoUrl, nowIso)
    if (!patch) continue
    if (fotoUrl) saved++
    const { error: updErr } = await sb.from('wa_chat_labels').update(patch).eq('vendedor_nome', vendedor).eq('phone', phone)
    if (updErr) console.error('update foto error', updErr)
    else checked++
  }

  let precisam_foto: { phone: string; chat_id: string }[] = []
  let avatar_cursor: string | null = null
  const after = vendedor === 'ANA' ? normalizeAvatarCursor(body.avatar_cursor) : null
  try {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString()
    let pending = sb.from('wa_chat_labels')
      .select('phone, chat_id')
      .eq('vendedor_nome', vendedor)
      .neq('chat_id', '')
      .or(`foto_checked_at.is.null,foto_checked_at.lt.${cutoff}`)
    if (vendedor === 'ANA') {
      pending = pending.order('phone', { ascending: true })
      if (after) pending = pending.gt('phone', after)
    } else {
      pending = pending.order('foto_checked_at', { ascending: true, nullsFirst: true })
    }
    const { data: pend } = await pending.limit(LOTE)
    precisam_foto = (pend ?? []).filter((r: any) => r.chat_id && String(r.chat_id).length > 5).map((r: any) => ({ phone: String(r.phone), chat_id: String(r.chat_id) }))
    if (vendedor === 'ANA') avatar_cursor = nextAvatarCursor(precisam_foto)
  } catch (e) { console.error('precisam_foto query error', e) }

  return new Response(JSON.stringify({ ok: true, saved, checked, precisam_foto, avatar_cursor }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})
