import { useEffect, useState } from 'react'

/**
 * Detecta viewport mobile (< md, 768px) via matchMedia.
 * Casa com o breakpoint Tailwind `md` usado no Layout (sidebar `hidden md:flex`,
 * bottom nav `md:hidden`). SSR-safe: default false até montar.
 */
export function useIsMobile(maxWidth = 767): boolean {
  const query = `(max-width: ${maxWidth}px)`
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    // addEventListener é o moderno; addListener fallback p/ Safari antigo
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [query])

  return isMobile
}
