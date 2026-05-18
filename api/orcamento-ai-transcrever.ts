// Vercel serverless function — transcrição de áudio via Whisper-1.
// O front grava com MediaRecorder API → envia blob como multipart → server
// repassa pro Whisper e retorna { text }.
//
// Whisper aceita até 25 MB. Áudios típicos de 30s ficam em ~300 KB.
// PT-BR é detectado automaticamente, mas forçamos via param `language=pt`
// pra evitar falsos-positivos com sotaque carregado.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_KEY = process.env.OPENAI_API_KEY!

export const config = {
  api: {
    bodyParser: { sizeLimit: '25mb' },
  },
}

interface ReqBody {
  // Áudio em base64 (data URL ou raw). Vem do MediaRecorder do front.
  audio_base64: string
  // MIME type ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg').
  mime?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!OPENAI_KEY) return res.status(500).json({ error: 'env_missing', detail: 'OPENAI_API_KEY' })
  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing', detail: 'SUPABASE' })

  // JWT obrigatório
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })
  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt' })

  const body = req.body as ReqBody
  if (!body?.audio_base64) return res.status(400).json({ error: 'no_audio' })

  // Decodifica base64 (aceita data URL ou raw)
  let buf: Buffer
  let mime = body.mime || 'audio/webm'
  try {
    const b64 = body.audio_base64.replace(/^data:[^;]+;base64,/, '')
    buf = Buffer.from(b64, 'base64')
    // Se veio com data URL, extrai mime real
    const dataMatch = body.audio_base64.match(/^data:([^;]+);base64,/)
    if (dataMatch) mime = dataMatch[1]
  } catch (e) {
    return res.status(400).json({ error: 'decode_failed', detail: (e as Error).message })
  }

  if (buf.length === 0) return res.status(400).json({ error: 'empty_audio' })
  if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'audio_too_big' })

  // Mapeia mime → extensão (Whisper exige nome de arquivo com extensão válida)
  const extMap: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/oga': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  }
  const ext = extMap[mime.toLowerCase()] || 'webm'

  // Monta multipart FormData (nativo Node 18+). Buffer.subarray() retorna
  // um view sobre ArrayBuffer que TS aceita como BlobPart (vs Buffer cru).
  const form = new FormData()
  const blob = new Blob([new Uint8Array(buf)], { type: mime })
  form.append('file', blob, `audio.${ext}`)
  form.append('model', 'whisper-1')
  form.append('language', 'pt')
  form.append('response_format', 'json')
  // Temperature 0 = mais determinístico
  form.append('temperature', '0')

  const startedAt = Date.now()
  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: form,
  })

  if (!whisperRes.ok) {
    const errText = await whisperRes.text()
    return res.status(502).json({
      error: 'whisper_error',
      status: whisperRes.status,
      detail: errText.slice(0, 500),
    })
  }

  const result = (await whisperRes.json()) as { text?: string }
  const elapsedMs = Date.now() - startedAt

  return res.status(200).json({
    text: (result.text || '').trim(),
    bytes: buf.length,
    elapsed_ms: elapsedMs,
    mime,
  })
}
