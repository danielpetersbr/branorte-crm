// Detecta deploy novo (o hash do bundle no index.html mudou) e oferece recarregar.
// Resolve o problema clássico de SPA: quem fica com a aba aberta continua na versão
// antiga até dar reload. Checa a cada 60s e quando a aba volta a ter foco.
import { useEffect, useState } from 'react'

const ASSET_RE = /\/assets\/index-[\w-]+\.js/

export function NovaVersaoBanner() {
  const [nova, setNova] = useState(false)

  useEffect(() => {
    // Hash do bundle atualmente carregado (entry do Vite).
    const atual = Array.from(document.querySelectorAll('script'))
      .map(s => (s as HTMLScriptElement).src)
      .find(s => ASSET_RE.test(s)) || ''
    if (!atual) return

    let parado = false
    const check = async () => {
      if (parado || document.hidden) return
      try {
        const html = await fetch('/', { cache: 'no-store' }).then(r => (r.ok ? r.text() : ''))
        const m = html.match(ASSET_RE)
        if (m && !atual.includes(m[0])) setNova(true)
      } catch { /* offline / falha de rede: ignora */ }
    }

    const id = window.setInterval(check, 60_000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => { parado = true; window.clearInterval(id); window.removeEventListener('focus', onFocus) }
  }, [])

  if (!nova) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-2.5 rounded-full bg-accent text-white shadow-lg text-sm animate-in fade-in slide-in-from-bottom-2">
      <span>🚀 Nova versão disponível</span>
      <button
        onClick={() => window.location.reload()}
        className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 font-medium transition-colors"
      >
        Atualizar
      </button>
    </div>
  )
}
