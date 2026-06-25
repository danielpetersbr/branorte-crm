// Detecta deploy novo (o hash do bundle no index.html mudou) e oferece atualizar.
// Resolve o problema clássico de SPA/PWA: quem fica com a aba/app aberto continua na
// versão antiga até dar reload. Checa logo após abrir, a cada 45s, ao focar a aba e
// quando o app/aba volta a ficar visível (visibilitychange — o evento certo no PWA mobile).
// O botão Atualizar LIMPA os caches do service worker e força um reload limpo.
import { useEffect, useState } from 'react'

const ASSET_RE = /\/assets\/index-[\w-]+\.js/

export function NovaVersaoBanner() {
  const [nova, setNova] = useState(false)

  useEffect(() => {
    // Hash do bundle atualmente carregado (entry do Vite). Em DEV não existe → não checa.
    const atual = Array.from(document.querySelectorAll('script'))
      .map(s => (s as HTMLScriptElement).src)
      .find(s => ASSET_RE.test(s)) || ''
    if (!atual) return

    let parado = false
    const check = async () => {
      if (parado || nova || document.hidden) return
      try {
        // no-store + cache-buster: garante a comparação contra o servidor (não o cache).
        const html = await fetch('/?_v=' + Date.now(), { cache: 'no-store' }).then(r => (r.ok ? r.text() : ''))
        const m = html.match(ASSET_RE)
        if (m && !atual.includes(m[0])) setNova(true)
      } catch { /* offline / falha de rede: ignora */ }
    }

    const id = window.setInterval(check, 45_000)
    const onVisivel = () => { if (!document.hidden) check() }
    window.addEventListener('focus', onVisivel)
    document.addEventListener('visibilitychange', onVisivel)
    // Primeira checagem ~4s depois de abrir (pega deploy que saiu durante o load).
    const t = window.setTimeout(check, 4_000)
    return () => {
      parado = true
      window.clearInterval(id)
      window.clearTimeout(t)
      window.removeEventListener('focus', onVisivel)
      document.removeEventListener('visibilitychange', onVisivel)
    }
  }, [nova])

  if (!nova) return null

  const atualizar = async () => {
    try {
      // Limpa todos os caches do SW (imagens/fontes/shell) pra não servir versão antiga.
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
      // Força o SW a assumir a versão nova já.
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        reg?.waiting?.postMessage('SKIP_WAITING')
        await reg?.update().catch(() => {})
      }
    } catch { /* ignora — segue pro reload de qualquer jeito */ }
    window.location.reload()
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3 rounded-full bg-accent text-white shadow-2xl ring-2 ring-white/30 text-sm font-medium animate-in fade-in slide-in-from-bottom-2">
      <span className="whitespace-nowrap">🚀 Nova versão disponível</span>
      <button
        onClick={atualizar}
        className="px-3.5 py-1.5 rounded-full bg-white text-accent hover:bg-white/90 font-bold transition-colors whitespace-nowrap"
      >
        Atualizar agora
      </button>
    </div>
  )
}
