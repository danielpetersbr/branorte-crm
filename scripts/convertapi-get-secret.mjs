// Acessa o dashboard do ConvertAPI e pega o API secret
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()

// Acha aba do convertapi
let page = pages.find(p => p.url().includes('convertapi.com'))
if (!page) {
  console.error('Nenhuma aba ConvertAPI aberta')
  process.exit(1)
}
await page.bringToFront()
await new Promise(r => setTimeout(r, 1500))

console.log('URL atual:', page.url())
console.log('TITLE atual:', await page.title())

// Se ainda esta no await-verification, espera
if (page.url().includes('await-verification')) {
  console.log('Ainda em verification, aguardando 3s...')
  await new Promise(r => setTimeout(r, 3000))
  console.log('URL apos espera:', page.url())
}

// Navega pro dashboard / API auth
console.log('Indo pro dashboard / authentication...')
await page.goto('https://www.convertapi.com/a', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))

console.log('URL dashboard:', page.url())
console.log('TITLE dashboard:', await page.title())

// Procura o API secret na pagina
const secret = await page.evaluate(() => {
  // Estrategias varias pra achar o secret:
  // 1) Input/code com classe que contenha 'secret' ou 'token'
  // 2) Texto na pagina que matche regex de secret_XXX
  const allText = document.body.innerText
  const secretMatch = allText.match(/secret_[A-Za-z0-9]{20,}/g)
  const tokenMatch = allText.match(/[A-Za-z0-9]{40,}/g)
  // Inputs com value
  const inputs = [...document.querySelectorAll('input')]
    .filter(i => i.value && i.value.length > 20)
    .map(i => ({ name: i.name || i.id, value: i.value, type: i.type }))
  return {
    secrets: secretMatch ? [...new Set(secretMatch)] : [],
    longTokens: tokenMatch ? [...new Set(tokenMatch)].slice(0, 10) : [],
    inputs,
    bodyPreview: allText.slice(0, 500).replace(/\n+/g, ' | '),
  }
})
console.log('=== SECRETS ENCONTRADOS ===')
console.log(JSON.stringify(secret, null, 2))

browser.disconnect()
