import { useEffect, useState } from 'react'

// Fonte única do tema. O index.html já aplica a classe `dark` antes do React
// montar (flash-free), lendo localStorage 'theme-v2' (default dark). Aqui o
// estado inicial vem da classe que já está no <html>, então bate sempre.
// Múltiplas instâncias do hook (sidebar + header) ficam em sync via evento.
function classIsDark(): boolean {
  if (typeof document === 'undefined') return true
  return document.documentElement.classList.contains('dark')
}

const THEME_EVENT = 'branorte-theme-changed'

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(classIsDark)

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('theme-v2', 'dark')
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0d0d11')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme-v2', 'light')
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#fafafb')
    }
    try { localStorage.removeItem('theme') } catch { /* legado */ }
    // Notifica outras instâncias (ex.: ícone na sidebar) pra ficarem em sync.
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: dark }))
  }, [dark])

  useEffect(() => {
    const onChange = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (typeof d === 'boolean') setDark(d)
    }
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])

  return [dark, () => setDark(d => !d)]
}
