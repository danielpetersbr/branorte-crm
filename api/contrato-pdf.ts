// Vercel serverless — PDF do CONTRATO a partir do HTML gerado no cliente.
//
// Por que existe: o caminho antigo de PDF passava pelo ConvertAPI, cujo trial
// expirou e cujos tokens voltaram 401 em 22/09/2026 — o botao "Gerar em PDF"
// morria com "Unauthorized. Code: 4011". Aqui o PDF sai do proprio Chrome que
// o projeto ja usa em /api/gerar-pdf (@sparticuz/chromium), sem servico externo
// e sem cota.
//
// Diferenca pro /api/gerar-pdf: aquele navega ate a rota /print/orcamento e
// depende do React montar a pagina. O contrato e' texto puro, entao o cliente
// manda o HTML pronto e aqui so' se imprime — sem rota, sem espera de render.
//
// Deploy: vercel.json precisa de { "api/contrato-pdf.ts": { "memory": 1024,
// "maxDuration": 60 } }, igual ao gerar-pdf.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const CHROMIUM_PATH = process.env.CHROMIUM_PATH

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing' })

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const { html } = (req.body ?? {}) as { html?: string }
  if (!html || typeof html !== 'string' || html.length < 50) {
    return res.status(400).json({ error: 'html_missing' })
  }

  const t0 = Date.now()
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  try {
    const executablePath = CHROMIUM_PATH || (await chromium.executablePath())
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1024, height: 1400, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    })

    const page = await browser.newPage()
    // O HTML e' autocontido (CSS inline, sem imagem externa): 'load' basta e
    // evita ficar preso em networkidle esperando requisicao que nunca vem.
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,     // respeita o @page do contrato-html.ts
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family: Calibri, sans-serif; font-size: 8pt; color: #6b7280; width: 100%; padding: 0 20mm 6mm;">
          <div style="border-top: 1px solid #d0d0d0; padding-top: 3mm; display: flex; justify-content: space-between;">
            <span>Rodovia SC 370, km 139, nº 1.390 – Rio Pequeno – Grão-Pará/SC · (48) 3658-4502</span>
            <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
          </div>
        </div>
      `,
    })

    console.log(`[contrato-pdf] ${pdf.length} bytes em ${Date.now() - t0}ms`)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(pdf.length))
    return res.status(200).send(Buffer.from(pdf))
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[contrato-pdf] falhou:', detail)
    return res.status(500).json({ error: 'pdf_failed', detail })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
