// Vercel serverless function — gera o PDF do ROTEIRO DE VIAGEM (§20 do spec)
// server-side via Puppeteer + Chromium. Clone do mecanismo de api/gerar-pdf.ts,
// mudando a rota renderizada e os tempos de espera.
//
// Fluxo:
//   1. Front chama POST /api/gerar-pdf-roteiro com { roteiro: { cfg, prog, ... } }
//   2. Endpoint valida JWT (ou a própria service_role, igual gerar-pdf)
//   3. Sobe Chrome (cold start ~5s, warm ~1s)
//   4. Abre /print/roteiro da própria URL atual (mesma origem)
//   5. Injeta o payload em window.__BRANORTE_ROTEIRO__ via evaluateOnNewDocument
//   6. Aguarda window.__BRANORTE_ROTEIRO_READY__ = true
//   7. page.pdf({ format: 'A4' }) → PDF
//
// Por que os timeouts são maiores que os do gerar-pdf.ts:
//   a página do roteiro carrega TILES DE MAPA (rede externa, ~10-20 imagens).
//   Texto renderiza em ~1s; tile de mapa não. A própria página tem orçamento
//   interno de 15s pras tiles e sinaliza READY mesmo se elas falharem — então
//   30s aqui é folga, não espera cega.
//
// Também por isso o goto usa 'domcontentloaded' em vez de 'networkidle0':
//   quem decide que a página terminou é a flag READY, não a rede. Com
//   networkidle0 a gente pagaria a espera das tiles DUAS vezes.
//
// Deploy:
//   - vercel.json: { "functions": { "api/gerar-pdf-roteiro.ts": { "memory": 1536, "maxDuration": 90 } } }
//   - Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (as mesmas do gerar-pdf)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Permite override pra testes (dev local pode usar chrome stable)
const CHROMIUM_PATH = process.env.CHROMIUM_PATH

/** Espera pela flag READY da página. A página se auto-limita em ~16s. */
const READY_TIMEOUT_MS = 30000

// O tipo do client vem da FÁBRICA, não de `ReturnType<typeof createClient>`:
// sem os argumentos, os genéricos de schema caem pro default `never` e o tipo
// deixa de bater com o client realmente criado.
const criarAdmin = () => createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
type SupaAdmin = ReturnType<typeof criarAdmin>

export const config = {
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

  const supa = criarAdmin()

  // Mesma regra do gerar-pdf.ts: aceita a service_role pra chamadas server-side
  // (edge/cron gerando roteiro sem ninguém logado). Comparação exata, nunca prefixo.
  if (auth !== SVC_KEY) {
    const { data: u, error: uErr } = await supa.auth.getUser(auth)
    if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })
  }

  const body = req.body as {
    roteiro?: unknown
    roteiroPath?: string
    responseMode?: string
    nomeArquivo?: string
  }

  // Escape hatch de payload grande — mesmo mecanismo do gerar-pdf.ts.
  // Viagem de 40 paradas com muitos clientes por cidade passa fácil de 1MB de JSON;
  // o Vercel devolve 413 ANTES da função rodar. O cliente sobe o JSON no bucket
  // pdf-tmp (prefixo props/, policy de INSERT authenticated) e manda só o path.
  let roteiro = body?.roteiro
  let roteiroPath: string | null = null
  if (!roteiro && typeof body?.roteiroPath === 'string' && /^props\/[\w\-/]+\.json$/.test(body.roteiroPath)) {
    roteiroPath = body.roteiroPath
    const { data: file, error: dlErr } = await supa.storage.from('pdf-tmp').download(roteiroPath)
    if (dlErr || !file) {
      return res.status(400).json({ error: 'roteiro_download_failed', detail: dlErr?.message })
    }
    try {
      roteiro = JSON.parse(await file.text())
    } catch {
      return res.status(400).json({ error: 'roteiro_parse_failed' })
    }
    console.log(`[gerar-pdf-roteiro] roteiro via storage ${roteiroPath}`)
  }

  if (!roteiro || typeof roteiro !== 'object') {
    return res.status(400).json({ error: 'missing_roteiro' })
  }
  const r = roteiro as { cfg?: unknown; prog?: { dias?: unknown } }
  if (!r.cfg || typeof r.cfg !== 'object' || !r.prog || !Array.isArray(r.prog.dias)) {
    return res.status(400).json({ error: 'roteiro_invalido', detail: 'esperado { cfg, prog: { dias: [] } }' })
  }

  // responseMode:
  //   'url'    → sobe no Storage e devolve signed URL (recomendado; sem limite de payload)
  //   'base64' → devolve JSON { base64 } (útil pra quem vai anexar em e-mail/WhatsApp server-side)
  //   ausente  → binário application/pdf direto
  const modo = body.responseMode === 'url' ? 'url' : body.responseMode === 'base64' ? 'base64' : 'binario'

  // Origem da request — usamos pra construir URL da rota /print
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  if (!host) return res.status(500).json({ error: 'no_host' })
  const printUrl = `${proto}://${host}/print/roteiro`

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
    console.log(`[gerar-pdf-roteiro] chromium launched in ${Date.now() - t0}ms`)

    const page = await browser.newPage()

    // Injeta ANTES do navigate — quando /print/roteiro monta, o payload já está lá.
    await page.evaluateOnNewDocument((data: unknown) => {
      ;(window as unknown as { __BRANORTE_ROTEIRO__: unknown }).__BRANORTE_ROTEIRO__ = data
    }, roteiro)

    // domcontentloaded + flag READY (ver comentário do topo). Módulos ES do Vite são
    // deferidos, então DOMContentLoaded já vem depois do app bootar.
    await page.goto(printUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })

    await page.waitForFunction(
      () => (window as unknown as { __BRANORTE_ROTEIRO_READY__?: boolean }).__BRANORTE_ROTEIRO_READY__ === true,
      { timeout: READY_TIMEOUT_MS },
    )
    console.log(`[gerar-pdf-roteiro] page ready in ${Date.now() - t0}ms`)

    const titulo = tituloDoRoteiro(roteiro)
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '8mm', right: '8mm', bottom: '14mm', left: '8mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family:'Calibri',sans-serif;font-size:8pt;color:#9ca3af;width:100%;padding:0 8mm 4mm;display:flex;justify-content:space-between;">
          <span>${escapeHtml(titulo)}</span>
          <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
        </div>
      `,
    })
    console.log(`[gerar-pdf-roteiro] PDF gerado (${pdfBuffer.length} bytes) em ${Date.now() - t0}ms`)

    // Payload temporário já cumpriu o papel — remove (best-effort)
    if (roteiroPath) {
      supa.storage.from('pdf-tmp').remove([roteiroPath]).catch(() => {})
    }

    if (modo === 'base64') {
      return res.status(200).json({
        base64: Buffer.from(pdfBuffer).toString('base64'),
        size: pdfBuffer.length,
        ms: Date.now() - t0,
      })
    }

    if (modo === 'url') {
      const dia = new Date().toISOString().slice(0, 10)
      const path = `gerar-pdf/${dia}/${crypto.randomUUID()}.pdf`
      const { error: upErr } = await supa.storage.from('pdf-tmp').upload(path, Buffer.from(pdfBuffer), {
        contentType: 'application/pdf',
        upsert: false,
      })
      if (upErr) throw new Error(`upload pdf-tmp falhou: ${upErr.message}`)
      const { data: signed, error: signErr } = await supa.storage.from('pdf-tmp').createSignedUrl(path, 900)
      if (signErr || !signed?.signedUrl) throw new Error(`signed url falhou: ${signErr?.message}`)
      console.log(`[gerar-pdf-roteiro] uploaded ${path} + signed url em ${Date.now() - t0}ms`)

      cleanupOldPdfs(supa).catch(() => {})

      return res.status(200).json({ url: signed.signedUrl, size: pdfBuffer.length, ms: Date.now() - t0 })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(pdfBuffer.length))
    res.setHeader('X-PDF-Generated-Ms', String(Date.now() - t0))
    return res.status(200).send(Buffer.from(pdfBuffer))
  } catch (e) {
    console.error('[gerar-pdf-roteiro] error', e)
    return res.status(500).json({
      error: 'pdf_generation_failed',
      detail: (e as Error).message,
      stack: (e as Error).stack?.split('\n').slice(0, 5).join('\n'),
    })
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* noop */ }
    }
  }
}

function tituloDoRoteiro(roteiro: unknown): string {
  const nome = (roteiro as { cfg?: { nome?: unknown } })?.cfg?.nome
  return typeof nome === 'string' && nome.trim() ? nome.trim() : 'Roteiro de viagem'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// Apaga PDFs temporários com 2+ dias (pastas gerar-pdf/YYYY-MM-DD antigas).
// Best-effort: falha silenciosa, roda em background após responder.
async function cleanupOldPdfs(supa: SupaAdmin) {
  for (const diasAtras of [2, 3]) {
    const d = new Date(Date.now() - diasAtras * 86400000).toISOString().slice(0, 10)
    for (const raiz of ['gerar-pdf', 'props']) {
      const prefix = `${raiz}/${d}`
      const { data: files } = await supa.storage.from('pdf-tmp').list(prefix, { limit: 100 })
      if (files?.length) {
        await supa.storage.from('pdf-tmp').remove(files.map(f => `${prefix}/${f.name}`))
        console.log(`[gerar-pdf-roteiro] cleanup: ${files.length} arquivos de ${prefix} removidos`)
      }
    }
  }
}
