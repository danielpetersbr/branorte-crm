import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export const TAB_IDS = ['geral', 'funil', 'marketing', 'equipe', 'geografia'] as const
export type TabId = (typeof TAB_IDS)[number]

export const TABS: { id: TabId; label: string; pergunta: string }[] = [
  { id: 'geral',     label: 'Visão geral', pergunta: 'Bato a meta e o que faço hoje?' },
  { id: 'funil',     label: 'Funil',       pergunta: 'Onde o lead morre?' },
  { id: 'marketing', label: 'Marketing',   pergunta: 'Pra onde vai ou corta a verba?' },
  { id: 'equipe',    label: 'Equipe',      pergunta: 'Quem entrega e quem cobrar?' },
  { id: 'geografia', label: 'Geografia',   pergunta: 'De onde vêm?' },
]

const LS_KEY = 'dashboard-tab'

function ehTab(v: string | null): v is TabId {
  return !!v && (TAB_IDS as readonly string[]).includes(v)
}

/**
 * Aba ativa. Fonte da verdade = querystring `?tab=funil`.
 *
 * Por que na URL e não em estado local:
 *  - o link é compartilhável (colar no WhatsApp abre a mesma aba);
 *  - F5 mantém a aba;
 *  - o botão voltar do navegador anda entre abas, que é o que o usuário espera
 *    depois de clicar num atalho tipo "→ ver no Funil".
 *
 * localStorage entra só como preferência inicial quando a URL vem sem ?tab —
 * assim quem sempre olha "Equipe" cai lá, mas um link explícito sempre vence.
 */
export function useDashboardTab(): [TabId, (t: TabId, opts?: { replace?: boolean }) => void] {
  const [params, setParams] = useSearchParams()
  const naUrl = params.get('tab')

  const tab: TabId = ehTab(naUrl)
    ? naUrl
    : (() => {
        if (typeof window === 'undefined') return 'geral'
        const salvo = localStorage.getItem(LS_KEY)
        return ehTab(salvo) ? salvo : 'geral'
      })()

  // Espelha a aba resolvida na URL sem criar entrada no histórico — senão o
  // primeiro "voltar" da sessão não sairia da página, só limparia o ?tab.
  useEffect(() => {
    if (!ehTab(naUrl)) {
      const p = new URLSearchParams(params)
      p.set('tab', tab)
      setParams(p, { replace: true })
    }
  }, [naUrl, tab, params, setParams])

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, tab) } catch { /* quota */ }
  }, [tab])

  const set = useCallback((t: TabId, opts?: { replace?: boolean }) => {
    const p = new URLSearchParams(window.location.search)
    p.set('tab', t)
    setParams(p, { replace: opts?.replace ?? false })
  }, [setParams])

  return [tab, set]
}

/**
 * Troca de aba e rola até um bloco. Usado pelos atalhos das Ações prioritárias.
 * O scroll espera o próximo frame porque a aba alvo só monta depois do setState.
 */
export function irPara(
  set: (t: TabId) => void,
  tab: TabId,
  anchorId?: string,
) {
  set(tab)
  if (!anchorId) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(anchorId)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // foco pra quem navega por teclado acompanhar o salto
      el.setAttribute('tabindex', '-1')
      ;(el as HTMLElement).focus({ preventScroll: true })
    })
  })
}
