// Vercel serverless function — gera PDF vetorial server-side via Puppeteer + Chromium.
//
// Por que: html2canvas no client é raster (bitmap), perde qualidade no zoom,
// e em iOS Safari/PWA estoura memória com scale alto. Puppeteer roda Chrome
// real no servidor e gera PDF nativo (texto vetorial, zoom infinito).
//
// Fluxo:
//   1. Front (FinalizarMontarModal) chama POST /api/gerar-pdf com { previewProps }
//   2. Endpoint valida JWT
//   3. Sobe Chrome (cold start ~5s, warm ~1s)
//   4. Abre /print/orcamento da própria URL atual (mesma origem)
//   5. Injeta previewProps em window.__BRANORTE_PRINT__ via evaluateOnNewDocument
//   6. Aguarda window.__BRANORTE_PRINT_READY__ = true (fonts + imagens carregaram)
//   7. page.pdf({ format: 'A4' }) → blob
//   8. Retorna application/pdf
//
// Deploy:
//   - vercel.json: { "functions": { "api/gerar-pdf.ts": { "memory": 1024, "maxDuration": 60 } } }
//   - Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Permite override pra testes (dev local pode usar chrome stable)
const CHROMIUM_PATH = process.env.CHROMIUM_PATH

export const config = {
  // Disable body parsing — we receive JSON manually pra controlar tamanho
  api: {
    bodyParser: { sizeLimit: '4mb' },
  },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    return res.status(500).json({ error: 'env_missing' })
  }

  // Auth: validar JWT do Supabase
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const body = req.body as { previewProps?: unknown }
  if (!body?.previewProps || typeof body.previewProps !== 'object') {
    return res.status(400).json({ error: 'missing_preview_props' })
  }

  // Origem da request — usamos pra construir URL da rota /print
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  if (!host) return res.status(500).json({ error: 'no_host' })
  const printUrl = `${proto}://${host}/print/orcamento`

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  const t0 = Date.now()
  try {
    const executablePath = CHROMIUM_PATH || (await chromium.executablePath())
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1024, height: 1400, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    })
    const tLaunch = Date.now() - t0
    console.log(`[gerar-pdf] chromium launched in ${tLaunch}ms`)

    const page = await browser.newPage()

    // Injeta os dados ANTES do navigate — quando a rota /print monta,
    // window.__BRANORTE_PRINT__ já estará lá.
    await page.evaluateOnNewDocument((data: unknown) => {
      ;(window as unknown as { __BRANORTE_PRINT__: unknown }).__BRANORTE_PRINT__ = data
    }, body.previewProps)

    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // Aguarda a página sinalizar que terminou de renderizar (fonts + imagens)
    await page.waitForFunction(
      () => (window as unknown as { __BRANORTE_PRINT_READY__?: boolean }).__BRANORTE_PRINT_READY__ === true,
      { timeout: 15000 },
    )
    console.log(`[gerar-pdf] page ready in ${Date.now() - t0}ms`)

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '8mm', right: '6mm', bottom: '16mm', left: '6mm' },
      displayHeaderFooter: true,
      // Header vazio (necessario passar string vazia pra suprimir default do Chrome)
      headerTemplate: '<div></div>',
      // Footer com Pagina X de Y dinamico via Puppeteer
      footerTemplate: `
        <div style="font-family: 'Calibri', sans-serif; font-size: 9pt; color: #9ca3af; width: 100%; padding: 0 6mm 4mm; display: flex; justify-content: space-between; align-items: center;">
          <span>Orçamento · Branorte BBA</span>
          <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
        </div>
      `,
    })
    console.log(`[gerar-pdf] PDF generated (${pdfBuffer.length} bytes) in ${Date.now() - t0}ms`)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(pdfBuffer.length))
    res.setHeader('X-PDF-Generated-Ms', String(Date.now() - t0))
    return res.status(200).send(Buffer.from(pdfBuffer))
  } catch (e) {
    console.error('[gerar-pdf] error', e)
    return res.status(500).json({
      error: 'pdf_generation_failed',
      detail: (e as Error).message,
      stack: (e as Error).stack?.split('\n').slice(0, 5).join('\n'),
    })
  } finally {
    if (browser) {
      try { await browser.close() } catch {}
    }
  }
}
