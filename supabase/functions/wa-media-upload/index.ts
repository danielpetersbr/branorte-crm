import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

// Decodifica dataURL → { mime, bytes }
function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(dataUrl)
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  const isBase64 = (m[2] || '').includes('base64')
  const data = m[3] || ''
  if (isBase64) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { mime, bytes }
  }
  // URL-encoded fallback
  const dec = decodeURIComponent(data)
  const bytes = new TextEncoder().encode(dec)
  return { mime, bytes }
}

function extDoMime(mime: string, fallbackName?: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
    'application/pdf': 'pdf', 'application/zip': 'zip',
  }
  if (map[mime]) return map[mime]
  if (fallbackName?.includes('.')) return fallbackName.split('.').pop()!
  return 'bin'
}

function slugify(s: string): string {
  return (s || 'arquivo')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 60)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // Auth
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return json({ error: 'unauthorized' }, 401)
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const BUCKET = 'qr-media'

  // POST: upload
  if (req.method === 'POST') {
    let body: any
    try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

    const vendedor = String(body.vendedor_nome || 'SHARED').toUpperCase().trim()
    const dataUrl = String(body.dataUrl || '')
    const filename = String(body.filename || 'arquivo')
    const mediaType = String(body.mediaType || 'document')

    const parsed = parseDataUrl(dataUrl)
    if (!parsed) return json({ error: 'invalid_data_url' }, 400)
    const { mime, bytes } = parsed

    // Tamanho máximo 16MB
    if (bytes.length > 16 * 1024 * 1024) {
      return json({ error: 'file_too_large', max_mb: 16 }, 413)
    }

    // Path: VENDEDOR/timestamp_random.ext
    const ext = extDoMime(mime, filename)
    const stamp = Date.now()
    const rand = crypto.randomUUID().slice(0, 8)
    const safeName = slugify(filename.replace(/\.[^.]+$/, ''))
    const path = `${slugify(vendedor)}/${stamp}_${rand}_${safeName}.${ext}`

    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    })
    if (upErr) return json({ error: 'upload_failed', detail: upErr.message }, 500)

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)

    return json({
      ok: true,
      url: pub.publicUrl,
      path,
      mime,
      media_type: mediaType,
      media_filename: filename,
      size_kb: Math.round(bytes.length / 1024),
    })
  }

  // DELETE: remove arquivo
  if (req.method === 'DELETE') {
    const url = new URL(req.url)
    const path = url.searchParams.get('path')
    if (!path) return json({ error: 'path_required' }, 400)
    const { error } = await sb.storage.from(BUCKET).remove([path])
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'method_not_allowed' }, 405)
})
