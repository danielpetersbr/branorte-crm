// Preenche o form de signup ConvertAPI e submete
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('convertapi.com/a/signup'))
if (!page) {
  console.error('Aba ConvertAPI signup nao encontrada')
  process.exit(1)
}
await page.bringToFront()

// Senha forte gerada — vou logar pra você guardar
const SENHA = 'Branorte@2026-CvA!' + Math.random().toString(36).slice(2, 6)
const EMAIL = 'daniel.peters.br@gmail.com'
const NOME = 'Daniel Peters'
const TELEFONE = '48984692860'

console.log('=== CREDENCIAIS QUE SERAO USADAS ===')
console.log('Email:', EMAIL)
console.log('Senha:', SENHA)
console.log('====================================')

// 1) Aceita cookies se aparecer
try {
  await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', { timeout: 3000 })
  console.log('✓ Cookies aceitos')
  await new Promise(r => setTimeout(r, 800))
} catch { console.log('  (sem dialog de cookies)') }

// 2) Preenche Name
await page.type('input[name="Name"]', NOME, { delay: 50 })
console.log('✓ Nome preenchido')

// 3) Preenche Email
await page.type('input[name="Email"]', EMAIL, { delay: 50 })
console.log('✓ Email preenchido')

// 4) Telefone (Brasil ja eh default)
await page.type('input[name="PhoneDisplay"]', TELEFONE, { delay: 50 })
console.log('✓ Telefone preenchido')

// 5) Senha
await page.type('input[name="Password"]', SENHA, { delay: 50 })
console.log('✓ Senha preenchida')

// 6) Aguarda 1s e SUBMETE
await new Promise(r => setTimeout(r, 1200))

// Procura botao de submit (input[type=submit] sem nome especifico, mas dentro do form)
const submitted = await page.evaluate(() => {
  const form = document.querySelector('form')
  if (!form) return { ok: false, reason: 'sem form' }
  const submitBtn = form.querySelector('input[type="submit"], button[type="submit"]')
  if (!submitBtn) return { ok: false, reason: 'sem botao submit' }
  ;(submitBtn).click()
  return { ok: true, btn: submitBtn.outerHTML.slice(0, 200) }
})
console.log('SUBMIT:', JSON.stringify(submitted))

// Aguarda resposta — 10s
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const url = page.url()
  const title = await page.title()
  console.log(`  t+${i + 1}s URL=${url.slice(-60)}  TITLE=${title}`)
  if (url !== 'https://www.convertapi.com/a/signup') break
}

console.log('=== ESTADO FINAL ===')
console.log('URL:', page.url())
console.log('TITLE:', await page.title())

browser.disconnect()
