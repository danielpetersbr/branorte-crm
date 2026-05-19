// Converte PDF → DOCX via ConvertAPI. O PDF gerado por Puppeteer ja sai
// pixel-perfect (vetorial, idem ao preview React). ConvertAPI faz OCR
// estrutural sobre o PDF e reconstroi como DOCX editavel mantendo 95%+
// fidelidade visual.
//
// Custo: $30/mes pra 7500 conversoes (ConvertAPI Pro). Free tier: 250/mes.
// Tempo medio: ~3-5s pra um orcamento de 4-5 paginas.
//
// Setup: definir CONVERTAPI_SECRET no Vercel env vars (https://www.convertapi.com/a)
import type { VercelRequest, VercelResponse } from '@vercel/node'
// @ts-ignore - lib sem tipos completos
import ConvertAPI from 'convertapi'

export const config = {
  api: {
    bodyParser: { sizeLimit: '25mb' },  // PDFs grandes (com fotos)
  },
  maxDuration: 60,
}

const SECRET = process.env.CONVERTAPI_SECRET

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SECRET) {
    return res.status(503).json({
      error: 'convertapi_not_configured',
      detail: 'CONVERTAPI_SECRET nao configurado no Vercel. Crie conta em convertapi.com e cole o secret nas env vars.',
    })
  }

  const body = (req.body || {}) as { pdfBase64?: string; filename?: string }
  const pdfBase64 = String(body.pdfBase64 || '')
  if (!pdfBase64 || pdfBase64.length < 100) {
    return res.status(400).json({ error: 'invalid_pdf', detail: 'PDF base64 vazio ou invalido' })
  }
  const filename = String(body.filename || 'orcamento.pdf')

  try {
    const t0 = Date.now()
    const convertapi = new ConvertAPI(SECRET)
    // Convert PDF -> DOCX preservando layout
    // https://www.convertapi.com/pdf-to-docx
    const result = await convertapi.convert('docx',
      {
        File: {
          name: filename,
          data: pdfBase64,
        },
        // Parametros pra max fidelidade:
        UseOCR: false,        // texto ja eh selecionavel no PDF (Puppeteer)
        FileName: filename.replace(/\.pdf$/i, ''),
      },
      'pdf',
    )
    const fileUrl = result.file?.url
    if (!fileUrl) {
      throw new Error('ConvertAPI nao retornou URL do arquivo convertido')
    }
    // Baixa o DOCX do CDN do ConvertAPI
    const docxResp = await fetch(fileUrl)
    if (!docxResp.ok) {
      throw new Error(`Falha ao baixar DOCX convertido: HTTP ${docxResp.status}`)
    }
    const docxBuf = Buffer.from(await docxResp.arrayBuffer())
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
