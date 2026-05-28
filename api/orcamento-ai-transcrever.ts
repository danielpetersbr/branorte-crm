// Vercel serverless function — transcrição de áudio com 2 passos:
//   1) Audio → texto via gpt-4o-mini-transcribe (preço baixo, latência boa)
//   2) Texto → texto corrigido via gpt-5.4-mini (corretor com glossário Branorte)
//
// Passo 2 resolve o problema crônico de termos técnicos errados (chumbim →
// chupim, BMH → BNMH, etc.). Whisper isolado erra muito jargão do domínio
// mesmo com prompt parameter (limite 244 tokens, pouco confiável). LLM
// pos-processor com glossário restritivo e `temperature: 0` corrige sem
// alucinar — ganho documentado de 15-30% em domain-specific WER segundo
// pesquisa Interspeech 2024.
//
// Whisper aceita até 25 MB. Áudios típicos de 30s ficam em ~300 KB.
// PT-BR é detectado automaticamente, mas forçamos via param `language=pt`
// pra evitar falsos-positivos com sotaque carregado.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { buildCorrecaoPrompt } from './_lib/branorte-vocab'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_KEY = process.env.OPENAI_API_KEY!
const CORRETOR_MODEL = 'gpt-5.4-mini'

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
  form.append('model', 'gpt-4o-mini-transcribe')
  form.append('language', 'pt')
  form.append('response_format', 'json')
  // Prompt de contexto: vocabulário técnico Branorte melhora MUITO a precisão.
  form.append('prompt', 'Orçamento Branorte metalúrgica. Equipamentos: chupim, transportador helicoidal, TH, rosca transportadora, moinho de martelo, BNMM, misturador vertical, misturador horizontal, caçamba de pesagem, silo, ensacadeira, balança eletrônica, elevador de canecas, pré-limpeza, moega, caixa de ração. Medidas: 160 x 3,0 m, 210 x 12,0 m, TH 200, 500 kg/h, 1000 litros, 42 toneladas. Potência: 1,5 CV, 3 CV, 5 CV, 7,5 CV, 10 CV, 15 CV, 20 CV, monofásico, trifásico. Compacta, mini fábrica, fábrica de ração. Orçamento para cliente, cidade, CNPJ, gerar PDF, mandar no WhatsApp.')

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
  const rawText = (result.text || '').trim()
  const whisperMs = Date.now() - startedAt

  // Passo 2: pos-correcao com gpt-5.4-mini + glossario Branorte.
  // Se a transcricao veio vazia, pula direto (nada pra corrigir).
  let correctedText = rawText
  let correcaoMs = 0
  let correcaoOk = false
  if (rawText) {
    const correcaoStart = Date.now()
    try {
      const corrRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: CORRETOR_MODEL,
          messages: [
            { role: 'system', content: buildCorrecaoPrompt() },
            { role: 'user', content: rawText },
          ],
          temperature: 0,
          // Limite generoso pra textos longos. 99% das transcricoes Branorte
          // cabem em <500 tokens.
          max_tokens: 1024,
        }),
      })
      if (corrRes.ok) {
        const corrJson = (await corrRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const corrText = corrJson.choices?.[0]?.message?.content?.trim()
        if (corrText) {
          correctedText = corrText
          correcaoOk = true
        }
      }
      // Se falhar, mantem rawText (graceful fallback — pior cenario =
      // comportamento antigo, sem regressao).
    } catch {
      // Idem: silencioso, mantem rawText
    }
    correcaoMs = Date.now() - correcaoStart
  }

  return res.status(200).json({
    text: correctedText,
    text_raw: rawText, // pra debug/auditoria se quiser comparar antes×depois
    correcao_aplicada: correcaoOk && correctedText !== rawText,
    bytes: buf.length,
    elapsed_ms: whisperMs + correcaoMs,
    whisper_ms: whisperMs,
    correcao_ms: correcaoMs,
    mime,
  })
}
