// Converte DOCX → PDF via ConvertAPI usando lib npm `convertapi`.
// Estratégia nova: gera DOCX nativo (gerarOrcamentoCustomDocx), depois
// converte pra PDF mantendo a paginação NATIVA do Word/LibreOffice.
// Substitui o gerador client-side html2canvas que era frágil e tinha
// vários bugs de quebra de página, fotos faltando, etc.
//
// Setup: CONVERTAPI_SECRET no Vercel env (formato 'secret_xxx').
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Readable } from 'stream'
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

  // Auth (29/09/2026): era aberto para a internet (25 MB por chamada, cota paga
  // da ConvertAPI se o token for renovado). O cliente (docx-to-pdf-server.ts) já
  // mandava o JWT; agora exige conta aprovada.
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

  const body = (req.body || {}) as { docxBase64?: string; filename?: string }
  const docxBase64 = String(body.docxBase64 || '')
  if (!docxBase64 || docxBase64.length < 100) {
    return res.status(400).json({ error: 'invalid_docx', detail: 'DOCX base64 vazio' })
  }
  const filename = String(body.filename || 'orcamento.docx')

  try {
    const t0 = Date.now()
    const convertapi = new ConvertAPI(SECRET)

    // Padrão correto da lib v1.15: converter base64 → Buffer → Readable stream
    // → convertapi.upload(stream, filename) → result. Antes tentamos
    // { name, data: base64 } direto que dá erro 'path must be string'.
    const buffer = Buffer.from(docxBase64, 'base64')
    const stream = new Readable()
    stream.push(buffer)
    stream.push(null)

    const uploadResult = await convertapi.upload(stream, filename)
    // Doc: https://www.convertapi.com/docx-to-pdf
    const result = await convertapi.convert('pdf', { File: uploadResult }, 'docx')

    const file = result.files[0]
    if (!file) throw new Error('ConvertAPI nao retornou files')
    if (!file.url) throw new Error('ConvertAPI não retornou a URL do PDF')
    const dr = await fetch(file.url)
    if (!dr.ok) throw new Error(`Falha baixar PDF: HTTP ${dr.status}`)
    const pdfBuf = Buffer.from(await dr.arrayBuffer())

    const ms = Date.now() - t0
    console.log(`[docx-to-pdf] OK ${pdfBuf.length} bytes em ${ms}ms`)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\.docx$/i, '.pdf')}"`)
    res.setHeader('Content-Length', String(pdfBuf.length))
    return res.status(200).send(pdfBuf)
  } catch (e) {
    const err = e as Error
    console.error('[docx-to-pdf] error', err.message)
    return res.status(500).json({ error: 'conversion_failed', detail: err.message })
  }
}
