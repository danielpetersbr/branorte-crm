import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'branorte:orcamentos-chamados'

function readSet(): Set<number> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as number[]
    return new Set(arr.filter(n => Number.isFinite(n)))
  } catch {
    return new Set()
  }
}

function writeSet(s: Set<number>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...s])) } catch { /* quota cheia, etc. */ }
}

/**
 * Marca orçamentos que o vendedor já entrou em contato (clicou copiar fone).
 * Estado vive 100% no navegador via localStorage — sem ida ao servidor.
 * Multi-aba sincroniza via storage event.
 */
export function useOrcamentosChamados() {
  const [chamados, setChamados] = useState<Set<number>>(() => readSet())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setChamados(readSet())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const marcar = useCallback((id: number) => {
    setChamados(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev); next.add(id); writeSet(next); return next
    })
  }, [])

  const desmarcar = useCallback((id: number) => {
    setChamados(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); writeSet(next); return next
    })
  }, [])

  return { chamados, marcar, desmarcar }
}
