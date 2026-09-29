// Converte HTML do preview do orcamento em DOCX editavel via html-to-docx.
// Por que: o gerador manual via lib `docx` nunca fica IGUAL ao preview React.
// Aqui o HTML real (com computed styles inlined pelo client) vira DOCX, mantendo
// texto editavel + estrutura visual proxima a 90% da prevista.
//
// Fluxo:
//   Client renderiza OrcamentoPreview em div oculto -> serializa com computed
//   styles inlined -> POST aqui -> html-to-docx -> Buffer -> retorna como blob
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
// @ts-ignore - lib sem tipos
import HTMLtoDOCX from 'html-to-docx'
import { exigirAprovado, htmlTemImagemExterna } from './_lib/exigir-aprovado.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const config = {
  api: {
    bodyParser: { sizeLimit: '4mb' },
  },
  // Necessario pra html-to-docx (usa jszip + buffers grandes)
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Auth (29/09/2026): este endpoint era ABERTO para a internet — sem login,
  // qualquer um prendia funções de 60 s com 4 MB de HTML. Agora exige conta
  // aprovada, como os outros; o cliente (preview-to-docx-html.ts) manda o JWT.
  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing' })
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })
  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const acesso = await exigirAprovado(supa, auth)
  if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error })

  const body = (req.body || {}) as { html?: string; orientation?: 'portrait' | 'landscape' }
  const html = String(body.html || '')
  if (!html || html.length < 50) {
    return res.status(400).json({ error: 'invalid_html', detail: 'HTML vazio ou muito curto' })
  }
  // A lib baixa <img src="http..."> NO SERVIDOR e devolve o conteúdo dentro do
  // DOCX (proxy de fetch). O cliente legítimo manda toda imagem como data:.
  // A checagem lê o HTML pelo MESMO parser da lib (regex tinha brecha — ver
  // htmlTemImagemExterna em _lib/exigir-aprovado.ts, 29/09/2026).
  if (await htmlTemImagemExterna(html)) {
    return res.status(400).json({ error: 'invalid_html', detail: 'Imagem fora de data: no HTML (ou HTML ilegível) — envie toda imagem como data:' })
  }

  try {
    const t0 = Date.now()
    // Configuracoes: A4 portrait, margens iguais ao preview (35mm)
    const opts = {
      orientation: (body.orientation || 'portrait') as 'portrait' | 'landscape',
      pageNumber: false,
      // Margens em TWIPs (1 mm ~ 56.7 TWIPs). A4 padrao Branorte usa ~25mm
      margins: { top: 1417, right: 1417, bottom: 1417, left: 1417, header: 720, footer: 720, gutter: 0 },
      title: 'Orcamento Branorte',
      // Fonte padrao do preview e do orcamento
      font: 'Calibri',
      fontSize: 22,  // 11pt (em half-points)
      // Tabelas: bordas finas por padrao quando o HTML define
      table: { row: { cantSplit: true } },
    }
    const buf: Buffer = await HTMLtoDOCX(html, null, opts)
    const ms = Date.now() - t0
    console.log(`[html-to-docx] OK ${buf.length} bytes em ${ms}ms`)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', 'attachment; filename="orcamento.docx"')
    res.setHeader('Content-Length', String(buf.length))
    return res.status(200).send(buf)
  } catch (e) {
    const err = e as Error
    console.error('[html-to-docx] error', err.message, err.stack)
    return res.status(500).json({ error: 'conversion_failed', detail: err.message })
  }
}
