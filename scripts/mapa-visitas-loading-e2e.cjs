// Regressão: uma camada desligada/lenta não pode cobrir visitas já disponíveis.
// Sessão fictícia e todas as chamadas de dados interceptadas; não grava em produção.
// Use PLAYWRIGHT_MODULE/CHROME_PATH caso o runtime e o navegador não sejam os padrões.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined })
  let release
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
    const user = { id: '22222222-2222-2222-2222-222222222222', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', created_at: '2026-10-07T00:00:00Z' }
    const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'fixture'].join('.')
    await context.addInitScript(({ user, token }) => {
      localStorage.setItem('sb-flwbeevtvjiouxdjmziv-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user }))
    }, { user, token })
    const visits = [{ id: 'fixture-visit', telefone: '5549999999999', nome: 'Cliente para visita', cidade: 'Chapecó', estado: 'SC', interesse: null, visitar: true, vendedor_nome: 'DANIEL', etiquetas: [], valor_negociando: null, lat: -27.1, lng: -52.61, created_at: '2026-10-07T00:00:00Z' }]
    let orcRequests = 0
    let onOrcRequest
    let orcData = []
    let delayed = new Promise(resolve => { release = resolve })
    await context.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await context.route('https://flwbeevtvjiouxdjmziv.supabase.co/**', async route => {
      const url = new URL(route.request().url())
      let json = []
      if (url.pathname.includes('/auth/v1/')) json = user
      else if (url.pathname.endsWith('/user_profiles')) json = { id: user.id, email: user.email, display_name: 'Daniel', role: 'vendor', vendor_id: '11111111-1111-1111-1111-111111111111', approved_at: '2026-10-07T00:00:00Z' }
      else if (url.pathname.endsWith('/vendors')) json = { name: 'DANIEL' }
      else if (url.pathname.endsWith('/cliente_dados_visita')) json = visits
      else if (url.pathname.endsWith('/rpc/mapa_orcamentos_v2')) { orcRequests++; onOrcRequest?.(); await delayed; json = orcData }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(json) })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.stack || error.message))
    await page.goto((process.env.VISITAS_PREVIEW_URL || 'http://127.0.0.1:4178') + '/mapa-visitas?origem=whatsapp&vendedor=DANIEL', { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.getByRole('checkbox', { name: 'Visitar Cliente para visita', exact: true }).waitFor()
    const loading = page.getByText('Carregando...', { exact: true })
    await assert.doesNotReject(() => loading.waitFor({ state: 'hidden', timeout: 3000 }), 'visitas carregadas não ficam cobertas esperando os orçamentos desligados')
    assert.equal(orcRequests, 0, 'entrada de visitas não busca a camada de orçamentos desligada')
    await page.getByRole('button', { name: 'Cliente para visita', exact: true }).click()
    await page.waitForTimeout(350) // animação nativa de zoom do Leaflet
    const mapBox = await page.locator('.leaflet-container').boundingBox()
    await page.locator('.leaflet-container').click({ position: { x: mapBox.width / 2, y: mapBox.height / 2 } })
    await page.locator('.leaflet-popup-content').filter({ hasText: 'Cliente para visita' }).waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    // Ativar a camada deve buscar seus dados; desligá-la durante a espera libera o mapa.
    const layer = page.getByRole('button', { name: '💰 Orçamentos', exact: true })
    await layer.click()
    await page.waitForFunction(() => document.querySelector('button[title="Camada: pinos a partir dos orçamentos"]')?.getAttribute('aria-pressed') === 'true')
    await loading.waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(orcRequests, 1)
    await layer.click()
    await loading.waitFor({ state: 'hidden', timeout: 3000 })
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    release()
    await page.waitForLoadState('networkidle')
    await layer.click()
    await loading.waitFor({ state: 'hidden', timeout: 3000 })
    assert.equal(await layer.getAttribute('aria-pressed'), 'true')
    assert.deepEqual(errors, [])
    await page.close()
    // Rascunho restaurado ainda deve reconciliar um endereço confirmado no banco.
    orcRequests = 0
    delayed = new Promise(resolve => { release = resolve })
    const client = { cliKey: 'fixture-client', nome: 'Cliente do roteiro', telefone: '5549999999999', vendedor: 'DANIEL', equipamento: null, valor: null, vendido: false, numeros: null }
    const stop = { id: 'fixture-stop', tipo: 'cidade', clientes: [client], rotulo: null, cidade: 'Chapecó', uf: 'SC', endereco: null, lat: -27.1, lng: -52.61, precisao: 'cidade', visitaMinutos: 90, janelaInicio: null, janelaFim: null, ordemTravada: false, notas: 'Manter esta anotação', confirmacao: 'nao_solicitado' }
    const draft = { cfg: { nome: 'Roteiro de teste', dias: 3, diasManual: true }, paradas: [stop], id: 'fixture-trip', status: 'rascunho' }
    orcData = [{ cli_key: client.cliKey, cliente: client.nome, telefone: client.telefone, fone: null, numeros: null, cidade: 'Chapecó', uf: 'SC', total: null, n_orcamentos: 1, data_recente: '2026-10-07', vendedor: 'DANIEL', vendido: false, n_vendas: 0, lat: -26.98, lng: -52.58, precisao: 'confirmada' }]
    await context.addInitScript(draft => localStorage.setItem('branorte:viagem-rascunho:v1', JSON.stringify(draft)), draft)
    const tripPage = await context.newPage()
    tripPage.on('pageerror', error => errors.push(error.stack || error.message))
    await tripPage.goto((process.env.VISITAS_PREVIEW_URL || 'http://127.0.0.1:4178') + '/mapa-visitas?origem=whatsapp&vendedor=DANIEL', { waitUntil: 'domcontentloaded' })
    await tripPage.getByRole('button', { name: '🧭 Viagem (1)', exact: true }).waitFor()
    assert.equal(orcRequests, 0)
    const requestHandled = new Promise(resolve => { onOrcRequest = resolve })
    await Promise.all([
      tripPage.waitForRequest(request => new URL(request.url()).pathname.endsWith('/rpc/mapa_orcamentos_v2'), { timeout: 5000 }),
      requestHandled,
      tripPage.getByRole('button', { name: '🧭 Viagem (1)', exact: true }).click(),
    ])
    assert.equal(orcRequests, 1, 'planejamento precisa consultar as localizações atuais')
    assert.equal(await tripPage.getByText('Carregando...', { exact: true }).count(), 0, 'consulta da viagem não bloqueia visitas')
    release()
    await tripPage.waitForFunction(() => JSON.parse(localStorage.getItem('branorte:viagem-rascunho:v1'))?.paradas?.[0]?.precisao === 'confirmada')
    const updated = await tripPage.evaluate(() => JSON.parse(localStorage.getItem('branorte:viagem-rascunho:v1')))
    assert.equal(updated.paradas[0].lat, -26.98)
    assert.equal(updated.paradas[0].lng, -52.58)
    assert.equal(updated.paradas[0].tipo, 'cliente')
    assert.equal(updated.paradas[0].notas, stop.notas)
    assert.deepEqual(updated.paradas[0].clientes, [client])
    assert.equal(updated.cfg.nome, draft.cfg.nome)
    assert.equal(updated.cfg.dias, 3)
    assert.equal(updated.id, draft.id)
    assert.deepEqual(errors, [])
    console.log('PASSOU: visitas sem orçamentos; mapa e pinos clicáveis; camada lenta ligada/desligada; orçamentos carregam ao ativar.')
    console.log('PASSOU: viagem restaurada consulta e atualiza endereço sem bloquear visitas; clientes, notas, configuração e identidade preservados.')
  } finally {
    release?.()
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
