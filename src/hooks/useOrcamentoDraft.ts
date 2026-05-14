import { useCallback, useEffect, useRef, useState } from 'react'

// Versao do schema do rascunho. Bump quando o shape mudar pra invalidar drafts antigos.
const DRAFT_VERSION = 1
const DRAFT_KEY = 'branorte_orcamento_montar_draft_v1'
// TTL: rascunhos com mais de 7 dias sao descartados na hora de recuperar.
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Debounce do autosave (ms). Pequeno o bastante pra nao perder digitacao,
// grande o bastante pra nao escrever no localStorage a cada keystroke.
const SAVE_DEBOUNCE_MS = 600

export interface OrcamentoDraft<T> {
  version: number
  saved_at: string  // ISO timestamp
  data: T
}

interface UseDraftReturn<T> {
  /** Rascunho recuperado do localStorage no mount, ou null se nao havia/expirou. */
  recovered: OrcamentoDraft<T> | null
  /** Descarta o rascunho recuperado (some o banner). */
  dismissRecovered: () => void
  /** Apaga o rascunho do localStorage. Use ao finalizar/gerar orcamento. */
  clearDraft: () => void
  /** Salva o snapshot atual imediatamente (sem debounce). */
  saveNow: (data: T) => void
  /** Status do ultimo save. UI pode mostrar "salvando..."/"salvo". */
  status: 'idle' | 'saving' | 'saved' | 'error'
  /** Timestamp do ultimo save bem-sucedido. */
  lastSavedAt: Date | null
}

/**
 * Hook de autosave generico pro localStorage. Faz debounce + recuperacao no mount.
 *
 * Uso:
 *   const draft = useOrcamentoDraft(snapshotAtual)
 *   if (draft.recovered) {
 *     // mostrar banner: "Tem um rascunho de DD/MM HH:mm. Recuperar?"
 *   }
 *   // ao finalizar: draft.clearDraft()
 */
export function useOrcamentoDraft<T>(snapshot: T, enabled = true): UseDraftReturn<T> {
  const [recovered, setRecovered] = useState<OrcamentoDraft<T> | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const firstRunRef = useRef(true)

  // Recupera rascunho no mount
  useEffect(() => {
    if (!enabled) return
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as OrcamentoDraft<T>
      if (parsed.version !== DRAFT_VERSION) {
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      const savedTime = new Date(parsed.saved_at).getTime()
      if (Number.isNaN(savedTime) || Date.now() - savedTime > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      setRecovered(parsed)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[useOrcamentoDraft] falha ao ler rascunho:', err)
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const writeDraft = useCallback((data: T) => {
    try {
      setStatus('saving')
      const payload: OrcamentoDraft<T> = {
        version: DRAFT_VERSION,
        saved_at: new Date().toISOString(),
        data,
      }
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
      setStatus('saved')
      setLastSavedAt(new Date())
    } catch (err) {
      setStatus('error')
      // eslint-disable-next-line no-console
      console.error('[useOrcamentoDraft] falha ao salvar:', err)
    }
  }, [])

  // Autosave debounced quando o snapshot muda.
  // Skip do primeiro render (snapshot inicial nao precisa salvar antes do usuario interagir).
  useEffect(() => {
    if (!enabled) return
    if (firstRunRef.current) {
      firstRunRef.current = false
      return
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = window.setTimeout(() => {
      writeDraft(snapshot)
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [snapshot, enabled, writeDraft])

  // Flush no beforeunload — se o usuario fechar a aba antes do debounce disparar.
  useEffect(() => {
    if (!enabled) return
    const handler = () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
        writeDraft(snapshot)
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [snapshot, enabled, writeDraft])

  const dismissRecovered = useCallback(() => {
    setRecovered(null)
  }, [])

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY)
      setLastSavedAt(null)
      setStatus('idle')
      setRecovered(null)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[useOrcamentoDraft] falha ao apagar rascunho:', err)
    }
  }, [])

  const saveNow = useCallback((data: T) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    writeDraft(data)
  }, [writeDraft])

  return { recovered, dismissRecovered, clearDraft, saveNow, status, lastSavedAt }
}
