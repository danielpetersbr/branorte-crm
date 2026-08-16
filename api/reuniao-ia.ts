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
const BUCKET = 'reunioes-audio'
const WHISPER_PROMPT = 'Reunião interna da Branorte (metalúrgica, fábrica de máquinas para ração animal). Termos: chupim, transportador helicoidal, moinho de martelo, misturador, silo, orçamento, pedido, vendedor, meta, comissão, follow-up, lead, etiqueta, Wascript, WhatsApp.'

// maxDuration explícito (os outros 11 endpoints declaram; este era o único sem).
// Medido em 16/08/2026: transcrever um bloco de 15 min (3,3 MB) leva ~28 s. Hoje
// o limite efetivo já é folgado, mas deixar implícito é o tipo de coisa que
// quebra sozinha quando a plataforma muda o padrão — já mordeu este repo duas
// vezes (ver o comentário em api/rota.ts e api/resolver-link.ts).
export const config = { api: { bodyParser: { sizeLimit: '2mb' } }, maxDuration: 300 }

interface PautaItem { texto: string; feito: boolean; responsavel?: string }
interface ReqBody {
  action: 'transcrever' | 'resumo'
  path?: string
  url?: string
  transcricoes?: string[]
  pauta?: PautaItem[]
  tarefas?: PautaItem[]
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
    if (!body.path && !body.url) return res.status(400).json({ error: 'no_path' })
    let buf: Buffer
    try {
      if (body.path) {
        // Caminho normal: o bucket é PRIVADO, então quem baixa é esta função com
        // service_role (ignora RLS e não depende de link público).
        const { data, error } = await supa.storage.from(BUCKET).download(body.path)
        if (error || !data) return res.status(502).json({ error: 'fetch_audio', detail: error?.message ?? 'sem dados' })
        buf = Buffer.from(await data.arrayBuffer())
      } else {
        // Compat com chamadas antigas que mandavam a URL pronta (assinada ou não).
        const audioRes = await fetch(body.url!)
        if (!audioRes.ok) return res.status(502).json({ error: 'fetch_audio', status: audioRes.status })
        buf = Buffer.from(await audioRes.arrayBuffer())
      }
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
    form.append('prompt', WHISPER_PROMPT)

    const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    })
    if (!wr.ok) {
      const raw = (await wr.text()).slice(0, 500)
      // A OpenAI devolve "corrupted or unsupported" também quando o áudio passa
      // do limite de duração do modelo (~25 min). Traduz pra algo acionável.
      const detail = /corrupted|unsupported/i.test(raw)
        ? 'Áudio longo demais para transcrever de uma vez (limite ~25 min do modelo). Gravações novas já são salvas em blocos de 15 min e transcrevem normal — esta é uma gravação antiga, longa.'
        : raw
      return res.status(502).json({ error: 'whisper', detail })
    }
    const j = (await wr.json()) as { text?: string }
    let texto = (j.text || '').trim()
    // O modelo às vezes devolve o PRÓPRIO prompt no lugar da fala (aconteceu
    // num bloco da reunião de 27/07 — voltou só o texto do prompt, 260 chars).
    // Nesse caso refaz sem prompt, que transcreve normal.
    if (texto.startsWith(WHISPER_PROMPT.slice(0, 40))) {
      const form2 = new FormData()
      form2.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/webm' }), 'reuniao.webm')
      form2.append('model', 'gpt-4o-transcribe')
      form2.append('language', 'pt')
      form2.append('response_format', 'json')
      const wr2 = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: form2,
      })
      if (wr2.ok) texto = (((await wr2.json()) as { text?: string }).text || '').trim()
    }
    return res.status(200).json({ texto })
  }

  // ---------- RESUMO ----------
  if (body.action === 'resumo') {
    const fmtItens = (arr?: PautaItem[]) => (arr ?? [])
      .map(p => `- [${p.feito ? 'x' : ' '}] ${p.texto}${p.responsavel ? ` (resp: ${p.responsavel})` : ''}`)
      .join('\n')
    const pautaTxt = fmtItens(body.pauta)
    const tarefasTxt = fmtItens(body.tarefas)
    const transcrTxt = (body.transcricoes ?? []).filter(Boolean).join('\n\n— — —\n\n')
    if (!pautaTxt && !tarefasTxt && !transcrTxt) return res.status(400).json({ error: 'nada_pra_resumir' })

    const prompt = `Você é o secretário executivo da Branorte (metalúrgica / fábrica de máquinas para ração). Faça a ATA/resumo desta reunião em português, objetivo e direto. Baseie-se SOMENTE no que está abaixo — não invente.

TÍTULO: ${body.titulo || 'Reunião'}

PAUTA (assuntos que iam ser discutidos; [x] = coberto):
${pautaTxt || '(sem pauta registrada)'}

TAREFAS ANOTADAS NA REUNIÃO ([x] = concluída; resp = responsável):
${tarefasTxt || '(nenhuma tarefa anotada)'}

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
        // gpt-5.4-mini é modelo de raciocínio: os tokens de reasoning saem DESTE
        // orçamento. Com 7 blocos (~25k tokens de entrada), 1200 podiam ser
        // gastos inteiros pensando e devolver content vazio — que o cliente
        // engolia calado. Espaço pra pensar e ainda escrever a ata.
        max_completion_tokens: 4000,
      }),
    })
    if (!gr.ok) return res.status(502).json({ error: 'llm', detail: (await gr.text()).slice(0, 400) })
    const gj = (await gr.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
    const escolha = gj.choices?.[0]
    const resumo = escolha?.message?.content?.trim() || ''
    // Resposta vazia com HTTP 200 fazia o botão girar e não acontecer nada.
    if (!resumo) return res.status(502).json({ error: 'llm_vazio', detail: `A IA respondeu vazio (finish_reason=${escolha?.finish_reason ?? '?'}). Tente de novo.` })
    return res.status(200).json({ resumo })
  }

  return res.status(400).json({ error: 'invalid_action' })
}
