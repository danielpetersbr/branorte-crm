// Acessa Gmail no Chrome e pega o codigo OTP do ConvertAPI
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()

// Procura aba do Gmail
let gmail = pages.find(p => p.url().includes('mail.google.com'))
if (!gmail) {
  console.log('Gmail nao aberto. Abrindo...')
  gmail = await browser.newPage()
  await gmail.goto('https://mail.google.com/mail/u/0/#search/convertapi', { waitUntil: 'domcontentloaded' })
} else {
  console.log('Gmail ja aberto:', gmail.url().slice(0, 80))
  await gmail.bringToFront()
  await gmail.goto('https://mail.google.com/mail/u/0/#search/convertapi', { waitUntil: 'domcontentloaded' })
}

// Aguarda inbox carregar
await new Promise(r => setTimeout(r, 4000))

console.log('URL gmail:', gmail.url())
console.log('TITLE:', await gmail.title())

// Procura emails com "convertapi" no remetente/assunto
const emails = await gmail.evaluate(() => {
  // Lista de rows da inbox
  const rows = [...document.querySelectorAll('[role="main"] tr.zA, [role="main"] tr')]
  return rows.slice(0, 10).map(r => ({
    text: r.innerText?.replace(/\t+/g, ' | ').slice(0, 250),
    visible: r.offsetParent !== null,
  })).filter(e => e.visible && e.text)
})
console.log('EMAILS encontrados:')
emails.forEach((e, i) => console.log(`  [${i}]`, e.text))

browser.disconnect()
