// Vercel serverless — IA das reuniões, 2 ações:
//   action='transcrever': baixa o áudio (URL pública do bucket reunioes-audio)
//     e manda pro Whisper (gpt-4o-transcribe, pt-BR). Retorna { texto }.
//   action='resumo': junta transcrições + pauta e gera um resumo executivo
//     com gpt-5.4-mini. Retorna { resumo }.
// Auth por JWT (mesmo padrão dos outros endpoints). Whisper aceita até 25 MB.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_KEY = process.env.OPENAI_API_KEY!
const MODEL = 'gpt-5.4-mini'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

interface PautaItem { texto: string; feito: boolean; responsavel?: string }
interface ReqBody {
  action: 'transcrever' | 'resumo'
  url?: string
  transcricoes?: string[]
  pauta?: PautaItem[]
  titulo?: string
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

  // ---------- TRANSCREVER ----------
  if (body.action === 'transcrever') {
    if (!body.url) return res.status(400).json({ error: 'no_url' })
    let buf: Buffer
    try {
      const audioRes = await fetch(body.url)
      if (!audioRes.ok) return res.status(502).json({ error: 'fetch_audio', status: audioRes.status })
      buf = Buffer.from(await audioRes.arrayBuffer())
    } catch (e) {
      return res.status(502).json({ error: 'fetch_audio', detail: (e as Error).message })
    }
    if (buf.length === 0) return res.status(400).json({ error: 'empty_audio' })
    if (buf.length > 25 * 1024 * 1024) {
      return res.status(413).json({ error: 'audio_too_big', detail: 'Áudio acima de 25 MB (limite do Whisper). Grave em blocos menores.' })
    }
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/webm' }), 'reuniao.webm')
    form.append('model', 'gpt-4o-transcribe')
    form.append('language', 'pt')
    form.append('response_format', 'json')
    form.append('prompt', 'Reunião interna da Branorte (metalúrgica, fábrica de máquinas para ração animal). Termos: chupim, transportador helicoidal, moinho de martelo, misturador, silo, orçamento, pedido, vendedor, meta, comissão, follow-up, lead, etiqueta, Wascript, WhatsApp.')

    const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    })
    if (!wr.ok) return res.status(502).json({ error: 'whisper', detail: (await wr.text()).slice(0, 400) })
    const j = (await wr.json()) as { text?: string }
    return res.status(200).json({ texto: (j.text || '').trim() })
  }

  // ---------- RESUMO ----------
  if (body.action === 'resumo') {
    const pautaTxt = (body.pauta ?? [])
      .map(p => `- [${p.feito ? 'x' : ' '}] ${p.texto}${p.responsavel ? ` (resp: ${p.responsavel})` : ''}`)
      .join('\n')
    const transcrTxt = (body.transcricoes ?? []).filter(Boolean).join('\n\n— — —\n\n')
    if (!pautaTxt && !transcrTxt) return res.status(400).json({ error: 'nada_pra_resumir' })

    const prompt = `Você é o secretário executivo da Branorte (metalúrgica / fábrica de máquinas para ração). Faça a ATA/resumo desta reunião em português, objetivo e direto. Baseie-se SOMENTE no que está abaixo — não invente.

TÍTULO: ${body.titulo || 'Reunião'}

PAUTA (tarefas; [x] = concluída):
${pautaTxt || '(sem pauta registrada)'}

TRANSCRIÇÃO DO ÁUDIO:
${transcrTxt || '(sem transcrição)'}

Formato de saída (markdown simples, use só as seções que fizerem sentido):
**📌 Decisões**
- ...
**➡️ Próximos passos**
- ação — responsável (se citado) — prazo (se citado)
**⚠️ Pendências / a acompanhar**
- ...
Seja conciso. Se a transcrição estiver vazia, resuma a partir da pauta.`

    const gr = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 1200,
      }),
    })
    if (!gr.ok) return res.status(502).json({ error: 'llm', detail: (await gr.text()).slice(0, 400) })
    const gj = (await gr.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const resumo = gj.choices?.[0]?.message?.content?.trim() || ''
    return res.status(200).json({ resumo })
  }

  return res.status(400).json({ error: 'invalid_action' })
}
