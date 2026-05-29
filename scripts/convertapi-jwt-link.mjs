// Inspeciona o link JWT — provavelmente eh um anchor pra outra pagina
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('convertapi.com'))
await page.bringToFront()
await page.goto('https://www.convertapi.com/a/authentication', { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 2500))

const links = await page.evaluate(() => {
  return [...document.querySelectorAll('a')].filter(a => a.innerText?.trim() === 'JWT' && a.offsetParent !== null)
    .map(a => ({ href: a.href, onclick: a.onclick ? 'yes' : null, dataAttrs: Object.fromEntries([...a.attributes].filter(at => at.name.startsWith('data-')).map(at => [at.name, at.value])) }))
})
console.log('Links JWT:')
links.forEach((l, i) => console.log(`  [${i}]`, JSON.stringify(l, null, 2)))

// Navega pra cada um e pega o conteudo
for (let i = 0; i < links.length; i++) {
  const l = links[i]
  console.log(`\n=== Acessando link ${i}: ${l.href} ===`)
  await page.goto(l.href, { waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 2000))
  const result = await page.evaluate(() => {
    const text = document.body.innerText
    const jwts = text.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g)
    const inputs = [...document.querySelectorAll('input, textarea')]
      .filter(i => i.value && i.value.length > 30)
      .map(i => ({ name: i.name || i.id, value: i.value, type: i.type }))
    return {
      url: location.href,
      title: document.title,
      jwts: jwts || [],
      inputs,
      preview: text.slice(0, 800).replace(/\n+/g, ' | '),
    }
  })
  console.log('  URL apos goto:', result.url)
  console.log('  TITLE:', result.title)
  console.log('  JWTs:', result.jwts.length)
  result.jwts.forEach(j => console.log(`    → ${j.slice(0, 80)}...${j.slice(-10)}`))
  console.log('  INPUTS com valor:')
  result.inputs.forEach(inp => console.log(`    name=${inp.name}, value=${inp.value.slice(0, 80)}${inp.value.length > 80 ? '...' : ''}`))
  console.log('  PREVIEW:', result.preview.slice(0, 300))
  console.log('\n=== TOKEN COMPLETO ===')
  result.inputs.forEach(inp => {
    if (inp.value.startsWith('eyJ') || inp.value.length > 100) console.log(inp.value)
  })
  result.jwts.forEach(j => console.log(j))
}

browser.disconnect()
