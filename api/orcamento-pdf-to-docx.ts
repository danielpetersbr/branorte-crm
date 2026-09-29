// Converte PDF → DOCX via ConvertAPI usando lib npm `convertapi`.
// O PDF gerado por Puppeteer ja sai pixel-perfect. ConvertAPI faz OCR
// estrutural e reconstroi como DOCX editavel mantendo ~95% fidelidade visual.
//
// Setup: CONVERTAPI_SECRET no Vercel env (formato 'secret_xxx', pegado em
// https://v2.convertapi.com/user com Authorization Bearer do token v2).
import type { VercelRequest, VercelResponse } from '@vercel/node'
// @ts-ignore - lib sem tipos completos
import ConvertAPI from 'convertapi'
import { createClient } from '@supabase/supabase-js'
import { exigirAprovado } from './_lib/exigir-aprovado.js'

export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
  maxDuration: 60,
}

const SECRET = process.env.CONVERTAPI_SECRET
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Auth (29/09/2026): era aberto para a internet (25 MB por chamada). Hoje não
  // tem chamador vivo (src/lib/pdf-to-docx.ts não é importado em lugar nenhum);
  // quem voltar a usar precisa mandar 'Authorization: Bearer <JWT da sessão>'.
  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing' })
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })
  const acesso = await exigirAprovado(createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } }), auth)
  if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error })

  if (!SECRET) {
    return res.status(503).json({
      error: 'convertapi_not_configured',
      detail: 'CONVERTAPI_SECRET nao configurado no Vercel',
    })
  }

  const body = (req.body || {}) as { pdfBase64?: string; filename?: string }
  const pdfBase64 = String(body.pdfBase64 || '')
  if (!pdfBase64 || pdfBase64.length < 100) {
    return res.status(400).json({ error: 'invalid_pdf', detail: 'PDF base64 vazio' })
  }
  const filename = String(body.filename || 'orcamento.pdf')

  try {
    const t0 = Date.now()
    const convertapi = new ConvertAPI(SECRET)
    // Doc: https://www.convertapi.com/pdf-to-docx
    const result = await convertapi.convert('docx',
      {
        File: { name: filename, data: pdfBase64 },
        FileName: filename.replace(/\.pdf$/i, ''),
      },
      'pdf',
    )

    // Resultado: lista de files. Pega o primeiro.
    const files = result.files || (result as any).Files
    const file = files?.[0]
    if (!file) throw new Error('ConvertAPI nao retornou files')

    let docxBuf: Buffer
    if (typeof file.fileBase64 === 'function') {
      const b64 = await file.fileBase64()
      docxBuf = Buffer.from(b64, 'base64')
    } else if (file.url || file.Url) {
      const fileUrl: string = file.url || file.Url
      const dr = await fetch(fileUrl)
      if (!dr.ok) throw new Error(`Falha baixar DOCX: HTTP ${dr.status}`)
      docxBuf = Buffer.from(await dr.arrayBuffer())
    } else {
      throw new Error('File sem fileBase64() nem url')
    }

    const ms = Date.now() - t0
    console.log(`[pdf-to-docx] OK ${docxBuf.length} bytes em ${ms}ms`)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\.pdf$/i, '.docx')}"`)
    res.setHeader('Content-Length', String(docxBuf.length))
    return res.status(200).send(docxBuf)
  } catch (e) {
    const err = e as Error
    console.error('[pdf-to-docx] error', err.message)
    return res.status(500).json({ error: 'conversion_failed', detail: err.message })
  }
}
