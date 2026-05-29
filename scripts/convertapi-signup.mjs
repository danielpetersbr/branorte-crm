// Conecta no Chrome via CDP e faz signup ConvertAPI
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({
  browserURL: 'http://localhost:9222',
  defaultViewport: null,
})

console.log('✓ Conectado ao Chrome')

const page = await browser.newPage()
await page.goto('https://www.convertapi.com/a/signup', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))

const title = await page.title()
console.log('TITULO:', title)
console.log('URL:', page.url())

// Dump form fields visiveis
const fields = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, button, a')]
  return inputs.slice(0, 40).map(el => ({
    tag: el.tagName,
    type: el.type || null,
    name: el.name || el.id || null,
    placeholder: el.placeholder || null,
    text: el.innerText?.trim().slice(0, 60) || null,
    visible: el.offsetParent !== null,
  }))
})
console.log('CAMPOS:', JSON.stringify(fields.filter(f => f.visible), null, 2))

browser.disconnect()
