// Service worker mínimo do Branorte CRM PWA.
// Estratégia: network-first, cache só pra fallback offline básico.
// IMPORTANTE: NÃO cachear o /assets/index-*.js porque atrapalha auto-update
// do bundle quando Vercel faz deploy novo (vendedor ficaria preso em versão velha).

const CACHE = 'branorte-crm-shell-v1'
const SHELL = ['/', '/icon.svg', '/branorte-logo.png', '/manifest.json']

self.addEventListener('install', (e) => {
  // Pega controle imediato em vez de esperar todas abas fecharem
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Limpa caches antigos
      const names = await caches.keys()
      await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // SUPABASE/API: sempre rede, nunca cache
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('onrender.com')) return

  // ASSETS .js / .css com hash do Vite: rede direto (auto-update transparente)
  if (url.pathname.startsWith('/assets/')) return

  // Navegações HTML: tenta rede, fallback pra cache do shell se offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(async () => {
        const cache = await caches.open(CACHE)
        return (await cache.match('/')) || new Response('Offline', { status: 503 })
      })
    )
    return
  }

  // Imagens/fontes/static: cache-first com fallback rede
  if (['image', 'font', 'style'].includes(e.request.destination)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {})
        return res
      }))
    )
  }
})

// Permite página forçar update manual via postMessage
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
