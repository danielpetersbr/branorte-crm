import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

/**
 * Banner discreto pra instalar o CRM como PWA no celular/desktop.
 * Aparece automaticamente quando o browser dispara `beforeinstallprompt`.
 * Some 1) ao instalar, 2) ao usuário fechar, 3) se já está rodando standalone.
 *
 * iOS Safari não dispara beforeinstallprompt — fallback é instrução manual
 * (mostra dica em vez de botão).
 */
type BIPEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'branorte_install_dismissed_at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 dias

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && !/Windows/.test(ua)
}

function recentlyDismissed(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || '0')
    return ts > 0 && Date.now() - ts < DISMISS_TTL_MS
  } catch { return false }
}

export function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  const [showIosDica, setShowIosDica] = useState(false)
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed())

  useEffect(() => {
    if (hidden) return
    const handler = (e: Event) => {
      e.preventDefault()
      setEvt(e as BIPEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS: não tem beforeinstallprompt → mostra dica manual após 5s na home
    if (isIOS() && !isStandalone()) {
      const t = setTimeout(() => setShowIosDica(true), 5000)
      return () => {
        clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', handler)
      }
    }

    const installed = () => setHidden(true)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installed)
    }
  }, [hidden])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    setEvt(null)
    setShowIosDica(false)
    setHidden(true)
  }

  async function handleInstall() {
    if (!evt) return
    await evt.prompt()
    const choice = await evt.userChoice
    if (choice.outcome === 'accepted') setHidden(true)
    setEvt(null)
  }

  if (hidden) return null
  if (!evt && !showIosDica) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-[100] bg-surface border border-accent/40 rounded-lg shadow-2xl p-3 flex items-start gap-3 animate-in slide-in-from-bottom">
      <div className="shrink-0 h-10 w-10 rounded-md bg-accent/15 flex items-center justify-center">
        <Download className="h-5 w-5 text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-ink">Instalar Branorte CRM</div>
        {evt ? (
          <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
            Tenha o CRM como app no celular — abre direto do menu, funciona offline básico.
          </p>
        ) : (
          <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
            iOS: toque no <span className="font-bold">botão compartilhar</span> ⬆️ e escolha
            <span className="font-bold"> "Adicionar à Tela de Início"</span>.
          </p>
        )}
        {evt && (
          <button
            onClick={handleInstall}
            className="mt-2 text-[12px] px-3 py-1.5 rounded-md bg-accent text-white font-bold hover:bg-accent/90 transition-colors"
          >Instalar</button>
        )}
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 text-ink-faint hover:text-ink p-1 -m-1"
        aria-label="Fechar"
      ><X className="h-4 w-4" /></button>
    </div>
  )
}
