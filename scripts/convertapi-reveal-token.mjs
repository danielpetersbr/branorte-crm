// Revela os tokens clicando nos botoes "JWT"
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('convertapi.com')) || (await browser.newPage())
if (!page.url().includes('authentication')) {
  await page.goto('https://www.convertapi.com/a/authentication', { waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 2500))
}
await page.bringToFront()
await new Promise(r => setTimeout(r, 800))

// Lista todos os botoes na pagina pra entender
const buttons = await page.evaluate(() => {
  return [...document.querySelectorAll('button, a')].slice(0, 40).map(b => ({
    tag: b.tagName,
    text: b.innerText?.trim().slice(0, 40),
    onclick: b.onclick ? 'yes' : null,
    href: b.href || null,
    classes: b.className?.slice(0, 60) || null,
    visible: b.offsetParent !== null,
  })).filter(b => b.visible && (b.text || b.href))
})
console.log('BOTOES VISIVEIS:')
buttons.forEach((b, i) => {
  if (b.text && b.text.match(/JWT|Show|Reveal|Copy|View/i)) {
    console.log(`  [${i}] ⭐ ${b.tag}: "${b.text}"`)
  }
})

// Tenta clicar nos botoes "JWT" (deveria revelar o token completo num modal/dialog)
const clicks = await page.evaluate(() => {
  const jwtButtons = [...document.querySelectorAll('button, a')].filter(b => {
    const t = b.innerText?.trim()
    return t === 'JWT' && b.offsetParent !== null
  })
  return jwtButtons.length
})
console.log(`Encontrados ${clicks} botoes "JWT"`)

// Clica no SEGUNDO (Production Token)
if (clicks >= 2) {
  await page.evaluate(() => {
    const jwtButtons = [...document.querySelectorAll('button, a')].filter(b => {
      const t = b.innerText?.trim()
      return t === 'JWT' && b.offsetParent !== null
    })
    if (jwtButtons[1]) jwtButtons[1].click()
  })
  await new Promise(r => setTimeout(r, 1500))
  console.log('✓ Clicou no botao JWT do Production Token')

  // Inspeciona modal/dialog que abriu
  const modal = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]')]
    return dialogs.filter(d => d.offsetParent !== null).map(d => ({
      text: d.innerText?.slice(0, 1000),
      hasInput: !!d.querySelector('input, textarea'),
      inputValues: [...d.querySelectorAll('input, textarea')].map(i => ({ value: i.value, type: i.type })),
    }))
  })
  console.log('MODAL aberto:')
  console.log(JSON.stringify(modal, null, 2))

  // Procura JWT no body inteiro tambem (pode aparecer fora de modal)
  const tokens = await page.evaluate(() => {
    const text = document.body.innerText
    const jwts = text.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g)
    return jwts ? [...new Set(jwts)] : []
  })
  console.log('JWTs encontrados no body:', tokens.length)
  tokens.forEach((t, i) => console.log(`  [${i}] ${t.slice(0, 60)}...${t.slice(-20)}`))
  console.log('\n=== TOKENS COMPLETOS ===')
  tokens.forEach((t, i) => console.log(`[${i}] ${t}`))
}

browser.disconnect()
