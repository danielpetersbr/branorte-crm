// Aguarda Cloudflare passar e inspeciona o form
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({
  browserURL: 'http://localhost:9222',
  defaultViewport: null,
})

// Pega a aba do convertapi que ja deve estar aberta
const pages = await browser.pages()
let page = pages.find(p => p.url().includes('convertapi.com'))
if (!page) {
  console.log('Aba do ConvertAPI nao encontrada, abrindo nova')
  page = await browser.newPage()
  await page.goto('https://www.convertapi.com/a/signup', { waitUntil: 'domcontentloaded' })
}
console.log('URL:', page.url())
console.log('TITULO:', await page.title())

// Espera ate 30s pra Cloudflare passar (titulo muda)
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const t = await page.title()
  if (!t.includes('momento') && !t.includes('moment') && !t.includes('Just a')) {
    console.log(`Passou Cloudflare em ${i + 1}s. Titulo agora: ${t}`)
    break
  }
}

await new Promise(r => setTimeout(r, 2000))
console.log('TITULO FINAL:', await page.title())
console.log('URL FINAL:', page.url())

const fields = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, button')]
  return inputs.map(el => ({
    tag: el.tagName,
    type: el.type || null,
    name: el.name || el.id || el.getAttribute('aria-label') || null,
    placeholder: el.placeholder || null,
    text: el.innerText?.trim().slice(0, 60) || null,
    visible: el.offsetParent !== null,
  })).filter(f => f.visible)
})
console.log('CAMPOS VISIVEIS:', JSON.stringify(fields, null, 2))

browser.disconnect()
