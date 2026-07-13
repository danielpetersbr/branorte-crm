// Converte orçamento PDF → DOCX SEM PREÇO para a produção (chamado pelo
// pedido-de-venda ao importar orçamento em PDF no /novo-pedido).
//
// Fluxo: ConvertAPI pdf→docx (mesmo setup do orcamento-pdf-to-docx) →
// scrubDocxPrices remove todo R$ > 0 → GATE: se sobrar qualquer preço,
// retorna 422 e o chamador cai no fluxo sem documento. Produção nunca vê preço.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { scrubDocxPrices } from './_lib/scrubDocxPrices.js'

export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
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
    return res.status(503).json({ error: 'convertapi_not_configured' })
  }

  const body = (req.body || {}) as { pdfBase64?: string; filename?: string; debug?: boolean }
  const pdfBase64 = String(body.pdfBase64 || '')
  if (!pdfBase64 || pdfBase64.length < 100) {
    return res.status(400).json({ error: 'invalid_pdf', detail: 'PDF base64 vazio' })
  }
  const filename = String(body.filename || 'orcamento.pdf')

  try {
    const t0 = Date.now()
    // REST direto (a lib npm convertapi nao aceita base64 em memoria)
    const convResp = await fetch(`https://v2.convertapi.com/convert/pdf/to/docx?Secret=${SECRET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Parameters: [
          { Name: 'File', FileValue: { Name: filename, Data: pdfBase64 } },
          { Name: 'FileName', Value: filename.replace(/\.pdf$/i, '') },
        ],
      }),
    })
    if (!convResp.ok) {
      const detail = (await convResp.text()).slice(0, 300)
      throw new Error(`ConvertAPI HTTP ${convResp.status}: ${detail}`)
    }
    const conv = await convResp.json() as { Files?: Array<{ FileName?: string; FileData?: string; Url?: string }> }
    const file = conv.Files?.[0]
    if (!file) throw new Error('ConvertAPI nao retornou files')

    let docxBuf: Buffer
    if (file.FileData) {
      docxBuf = Buffer.from(file.FileData, 'base64')
    } else if (file.Url) {
      const dr = await fetch(file.Url)
      if (!dr.ok) throw new Error(`Falha baixar DOCX: HTTP ${dr.status}`)
      docxBuf = Buffer.from(await dr.arrayBuffer())
    } else {
      throw new Error('File sem FileData nem Url')
    }

    const { out, removed, leaks } = await scrubDocxPrices(docxBuf)
    const ms = Date.now() - t0

    if (leaks.length > 0) {
      // Contrato duro: preço residual = NÃO entrega documento
      console.error(`[pdf-to-docx-producao] PRECO_RESIDUAL apos scrub (${leaks.length} trechos, ${removed} removidos):`, leaks.slice(0, 5))
      return res.status(422).json({ error: 'preco_residual', removed, leaks: leaks.slice(0, 5) })
    }

    console.log(`[pdf-to-docx-producao] OK ${out.length} bytes, ${removed} precos removidos, ${ms}ms`)

    if (body.debug) {
      return res.status(200).json({ ok: true, removed, ms, bytes: out.length, docxBase64: out.toString('base64') })
    }

    const outName = filename.replace(/\.pdf$/i, '') + ' - SEM PRECO.docx'
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outName)}"`)
    res.setHeader('X-Precos-Removidos', String(removed))
    return res.status(200).send(out)
  } catch (e) {
    const err = e as Error
    console.error('[pdf-to-docx-producao] error', err.message)
    return res.status(500).json({ error: 'conversion_failed', detail: err.message })
  }
}
