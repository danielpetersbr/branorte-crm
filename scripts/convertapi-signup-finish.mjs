// Termina o signup: telefone + senha + submit
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('convertapi.com'))
await page.bringToFront()
await new Promise(r => setTimeout(r, 800))

const SENHA = 'Branorte@2026-CvA!Daniel'
console.log('Senha que sera usada:', SENHA)

// Telefone
const telOK = await page.evaluate(() => {
  const el = document.querySelector('input[name="PhoneDisplay"]')
  if (!el) return false
  el.focus()
  return true
})
if (telOK) {
  await page.type('input[name="PhoneDisplay"]', '48984692860', { delay: 80 })
  console.log('✓ Telefone preenchido')
}

await new Promise(r => setTimeout(r, 500))

// Senha
const senhaOK = await page.evaluate(() => {
  const el = document.querySelector('input[name="Password"]')
  if (!el) return false
  el.focus()
  return true
})
if (senhaOK) {
  await page.type('input[name="Password"]', SENHA, { delay: 60 })
  console.log('✓ Senha preenchida')
}

await new Promise(r => setTimeout(r, 1000))

// Submete
const submitted = await page.evaluate(() => {
  const btn = document.querySelector('input[type="submit"][value="Sign up"]')
  if (!btn) return { ok: false }
  ;(btn).click()
  return { ok: true }
})
console.log('SUBMIT:', JSON.stringify(submitted))

// Aguarda resposta
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const url = page.url()
  const title = await page.title()
  console.log(`  t+${i + 1}s URL=...${url.slice(-50)}  TITLE=${title}`)
  if (!url.includes('/a/signup')) {
    console.log('REDIRECIONOU!')
    break
  }
}

// Verifica se tem mensagem de erro/sucesso
const status = await page.evaluate(() => {
  const errors = [...document.querySelectorAll('.error, .alert-danger, [class*="error"], [class*="invalid"]')]
    .map(e => e.innerText?.trim()).filter(Boolean)
  const successes = [...document.querySelectorAll('.success, .alert-success, [class*="success"]')]
    .map(e => e.innerText?.trim()).filter(Boolean)
  const bodyText = document.body.innerText.slice(0, 500)
  return { errors, successes, bodyText }
})
console.log('STATUS FINAL:')
console.log('  URL:', page.url())
console.log('  Errors:', status.errors)
console.log('  Successes:', status.successes)
console.log('  Body preview:', status.bodyText.replace(/\n+/g, ' | ').slice(0, 400))

browser.disconnect()
