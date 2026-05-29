import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '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'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(dataUrl)
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  const isB64 = (m[2] || '').includes('base64')
  const data = m[3] || ''
  if (isB64) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { mime, bytes }
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(data)) }
}

function extDoMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('flac')) return 'flac'
  return 'ogg'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS, 'content-type': 'application/json' },
    })
  }
  if (!OPENAI_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY nao configurada' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const dataUrl = body.dataUrl
  if (!dataUrl) {
    return new Response(JSON.stringify({ error: 'dataUrl_obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return new Response(JSON.stringify({ error: 'invalid_data_url' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  if (parsed.bytes.length > 25 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'audio_muito_grande', max_mb: 25 }), { status: 413, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const ext = extDoMime(parsed.mime)
  const filename = body.filename || `audio.${ext}`
  const blob = new Blob([parsed.bytes], { type: parsed.mime })

  const fd = new FormData()
  fd.append('file', blob, filename)
  fd.append('model', 'whisper-1')
  fd.append('language', body.language || 'pt')
  fd.append('response_format', 'json')
  if (body.prompt) fd.append('prompt', String(body.prompt).slice(0, 500))

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY },
      body: fd,
    })
    if (!r.ok) {
      const t = await r.text()
      return new Response(JSON.stringify({ error: 'whisper_failed', status: r.status, detail: t.slice(0, 300) }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const j = await r.json()
    return new Response(JSON.stringify({
      ok: true,
      text: j.text || '',
      filename,
      mime: parsed.mime,
      size_kb: Math.round(parsed.bytes.length / 1024),
    }), { headers: { ...CORS, 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'fetch_failed', detail: String(e).slice(0, 300) }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }
})
