// Dados e sessão fictícios; todas as chamadas ao banco são interceptadas.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const user = { id: '22222222-2222-2222-2222-222222222222', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', created_at: '2026-10-08T00:00:00Z' }
    const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'fixture'].join('.')
    await context.addInitScript(({ user, token }) => {
      localStorage.setItem('sb-flwbeevtvjiouxdjmziv-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user }))
    }, { user, token })
    const base = { telefone: '(48) 99999-0000', fone: '(48) 99999-0000', cidade: 'Chapecó', uf: 'SC', total: 150000, n_orcamentos: 1, data_recente: '2026-10-08', vendedor: 'EDER', vendido: true, n_vendas: 1, lat: -27.1, lng: -52.61, precisao: 'cidade' }
    const clientes = [
      { ...base, cli_key: 'maria', cliente: 'Maria <img src=x onerror=alert(1)>' },
      { ...base, cli_key: 'joao', cliente: 'João', telefone: null, fone: null, vendedor: null },
    ]
    await context.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await context.route('https://flwbeevtvjiouxdjmziv.supabase.co/**', route => {
      const url = new URL(route.request().url())
      const path = url.pathname
      let json = []
      if (path.includes('/auth/v1/')) json = user
      else if (path.endsWith('/user_profiles')) json = { id: user.id, email: user.email, display_name: 'Daniel', role: 'admin', vendor_id: null, approved_at: '2026-10-08T00:00:00Z' }
      else if (path.endsWith('/rpc/mapa_orcamentos_v2')) json = clientes.slice(Number(url.searchParams.get('offset') || 0))
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', 'content-range': `0-${Math.max(0,json.length-1)}/${path.endsWith('/rpc/mapa_orcamentos_v2') ? clientes.length : Array.isArray(json) ? json.length : 1}` }, body: JSON.stringify(json) })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto((process.env.MAPA_PREVIEW_URL || 'http://127.0.0.1:4182') + '/mapa-visual?modo=vendidos', { waitUntil: 'domcontentloaded' })
    const map = page.getByRole('region', { name: 'Mapa de clientes', exact: true })
    await map.locator('canvas').waitFor({ timeout: 15000 })
    await page.waitForTimeout(300) // primeiro desenho do Leaflet
    const box = await map.boundingBox()
    await map.click({ position: { x: box.width / 2, y: box.height / 2 + 20 } })
    const card = page.getByRole('dialog', { name: 'Dados do cliente', exact: true })
    await card.waitFor({ timeout: 3000 })
    await card.getByRole('button', { name: 'Ver cliente Maria <img src=x onerror=alert(1)>', exact: true }).click()
    assert.match(await card.innerText(), /EDER/)
    assert.match(await card.innerText(), /\(48\) 99999-0000/)
    assert.equal(await card.locator('img').count(), 0, 'nome é texto, nunca HTML executável')
    assert.equal(await card.getByRole('link', { name: 'Abrir WhatsApp', exact: true }).getAttribute('href'), 'https://wa.me/5548999990000')
    await card.getByRole('button', { name: 'Ver cliente João', exact: true }).click()
    assert.equal(await card.getByRole('link', { name: 'Abrir WhatsApp', exact: true }).count(), 0)
    assert.match(await card.innerText(), /Não informado/)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(200)
    const mobile = await card.boundingBox()
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390)
    assert.ok(mobile.y >= 0 && mobile.y + mobile.height <= 844)
    await card.getByRole('button', { name: 'Fechar dados do cliente', exact: true }).click()
    await card.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Voltar às categorias', exact: true }).click()
    await page.getByRole('button', { name: 'Vendidos: 2', exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log('PASSOU: clique real no círculo, clientes sobrepostos, telefone/WhatsApp, vendedor, dados ausentes, texto seguro, cartão mobile e retorno.')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
