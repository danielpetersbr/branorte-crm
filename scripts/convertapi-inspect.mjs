// Re-inspeciona o form apos cookies aceitos
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('convertapi.com'))
await page.bringToFront()
await new Promise(r => setTimeout(r, 1500))

console.log('URL:', page.url())
console.log('TITLE:', await page.title())

const fields = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, button, select, textarea')]
  return inputs.map(el => ({
    tag: el.tagName,
    type: el.type || null,
    name: el.name || el.id || el.getAttribute('aria-label') || null,
    placeholder: el.placeholder || null,
    value: el.value?.slice(0, 50) || null,
    text: el.innerText?.trim().slice(0, 60) || null,
    visible: el.offsetParent !== null,
  })).filter(f => f.visible)
})
console.log('CAMPOS:', JSON.stringify(fields, null, 2))

browser.disconnect()
