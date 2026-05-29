// Tenta varias paginas pra achar o API secret
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('convertapi.com'))
await page.bringToFront()

// Lista de URLs comuns onde fica o secret
const urlsCandidatas = [
  'https://www.convertapi.com/a/authentication',
  'https://www.convertapi.com/a/account',
  'https://www.convertapi.com/a/integration',
  'https://www.convertapi.com/a/keys',
  'https://www.convertapi.com/a/api',
]

for (const url of urlsCandidatas) {
  console.log(`\n=== ${url} ===`)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await new Promise(r => setTimeout(r, 2500))
    const result = await page.evaluate(() => {
      const text = document.body.innerText
      const secretMatch = text.match(/secret_[A-Za-z0-9]{20,}/g)
      const longTokens = text.match(/\b[A-Za-z0-9]{30,80}\b/g)
      const inputs = [...document.querySelectorAll('input')]
        .filter(i => i.value && i.value.length > 20)
        .map(i => ({ name: i.name || i.id, value: i.value, type: i.type, readonly: i.readOnly }))
      const codeBlocks = [...document.querySelectorAll('code, pre, .api-key, [class*="key"], [class*="secret"], [class*="token"]')]
        .map(e => e.innerText?.trim()).filter(t => t && t.length > 10).slice(0, 5)
      return {
        title: document.title,
        url: location.href,
        secrets: secretMatch ? [...new Set(secretMatch)] : [],
        longTokens: longTokens ? [...new Set(longTokens)].slice(0, 5) : [],
        inputs,
        codeBlocks,
      }
    })
    console.log('TITLE:', result.title)
    console.log('  secrets:', result.secrets)
    console.log('  longTokens:', result.longTokens.slice(0, 3))
    console.log('  inputs:', result.inputs.slice(0, 3))
    console.log('  codeBlocks:', result.codeBlocks.slice(0, 3))
    if (result.secrets.length > 0 || result.inputs.some(i => i.value?.startsWith('secret_'))) {
      console.log('\n🎯 SECRET ENCONTRADO! Parando aqui.')
      break
    }
  } catch (e) {
    console.log('  ERRO:', e.message.slice(0, 100))
  }
}

browser.disconnect()
