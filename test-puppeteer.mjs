// Testa o gerador de PDF Puppeteer localmente (sem auth supabase)
// Roda: cd c:/temp/branorte-crm-source && node test-puppeteer.mjs

import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'fs'

// Acha Chrome instalado no Windows
const chromePaths = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
]
import { existsSync } from 'fs'
const executablePath = chromePaths.find(p => existsSync(p))
if (!executablePath) {
  console.error('Chrome não encontrado')
  process.exit(1)
}
console.log('Chrome:', executablePath)

// Dados mock que cobrem o caso real
const previewProps = {
  numero: '2026 - 9999',
  dataEmissao: '26/05/2026',
  cliente: {
    nome: 'DANIEL DE OLIVEIRA PETERS',
    ac: 'DANIEL DE OLIVEIRA PETERS',
    fone: '+5548998313374',
    cidade: 'Braço do Norte',
    bairro: 'nossa senhora de fatima',
    endereco: 'Rua Paulo Andre Guesser 1080, Casa',
    cep: '88750-000',
    cnpj: '—',
    ie: '—',
    email: '—',
  },
  voltagem: 'trifasico',
  carrinho: [{
    uid: '1',
    nome: 'TRITURADOR DE GRÃOS 50 CV',
    nome_custom: null,
    qtd: 1,
    valor: 51503,
    specs: [
      'Construído em aço galvanizado',
      'Capacidade 5.000 kg/h',
      'Acoplamento elástico',
      'Equipamento fabricado com 36 martelos',
      'Acionamento: potência 50,0 CV',
    ],
    motor_cv: 50,
    motor_polos: 2,
    motor_qtd: 1,
    motor_valor_unit: 24122,
    foto_url: null,
    brinde: false,
  }],
  motoresAgrupados: [{ cv: 50, polos: 2, qtd: 1, valor_unit: 24122, valor_total: 24122, item_nome: 'TRITURADOR' }],
  acessorios: null,
  totalItems: 51503,
  totalMotores: 24122,
  totalEquip: 51503,
  totalGeral: 75625,
  fotoPrincipal: null,
  tensaoMotores: null,
  desconto: null,
  termsInline: { dataVenda: '26/05/2026', prazoEntrega: '90 dias (úteis)', formaPagamento: 'À vista (PIX) com 5% de desconto' },
  parcelas: [],
  componentesExtras: [],
}

console.log('[test] Lançando Chrome local...')
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  defaultViewport: { width: 1024, height: 1400, deviceScaleFactor: 2 },
})

try {
  const page = await browser.newPage()
  console.log('[test] Injetando previewProps...')
  await page.evaluateOnNewDocument((data) => {
    window.__BRANORTE_PRINT__ = data
  }, previewProps)

  const url = 'https://branorte-crm.vercel.app/print/orcamento'
  console.log(`[test] Navegando: ${url}`)
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })

  console.log('[test] Aguardando __BRANORTE_PRINT_READY__...')
  try {
    await page.waitForFunction(() => window.__BRANORTE_PRINT_READY__ === true, { timeout: 15000 })
    console.log('[test] READY!')
  } catch (e) {
    console.warn('[test] Timeout esperando READY. Vamos tirar screenshot do estado atual:')
    await page.screenshot({ path: 'd:/tmp/puppeteer-error-state.png', fullPage: true })
    console.log('[test] Screenshot salvo: d:/tmp/puppeteer-error-state.png')
    // Capturar console errors
    const html = await page.content()
    writeFileSync('d:/tmp/puppeteer-error.html', html.slice(0, 5000))
    throw e
  }

  console.log('[test] Gerando PDF...')
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '8mm', right: '6mm', bottom: '12mm', left: '6mm' },
  })

  writeFileSync('d:/tmp/test-puppeteer.pdf', Buffer.from(pdfBuffer))
  console.log(`[test] PDF salvo: d:/tmp/test-puppeteer.pdf (${pdfBuffer.length} bytes)`)
} finally {
  await browser.close()
}
