import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, Home, AlertTriangle } from 'lucide-react'

/**
 * ErrorBoundary global — captura QUALQUER erro de render OU rejeição de
 * import() de chunk lazy. Sem isso, qualquer falha desmontava a árvore React
 * inteira e o usuário via TELA PRETA (o app é dark, então árvore vazia = preto).
 *
 * Dois caminhos:
 *  - Erro de carregamento de chunk (deploy novo, rede instável no celular):
 *    o React.lazy CACHEIA a rejeição, então a tela fica presa preta até um
 *    reload completo. Aqui detectamos e damos reload automático UMA vez
 *    (guardado em sessionStorage pra não entrar em loop de reload).
 *  - Qualquer outro erro: mostra um card legível com a mensagem + botões de
 *    Recarregar / Início, em vez de tela preta silenciosa.
 */

const RELOAD_FLAG = 'eb-chunk-reload-ts'

// Mensagens típicas de falha de carregamento de módulo dinâmico (Vite/Chrome/Safari/FF)
function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase()
  return (
    msg.includes('loading chunk') ||
    msg.includes('dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('failed to fetch dynamically') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('failed to import')
  )
}

interface Props {
  children: ReactNode
  /** Muda quando a rota muda — reseta o boundary pra tentar a nova página. */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack)

    // Falha de chunk → tenta auto-recuperar com 1 reload (anti-loop por tempo).
    if (isChunkLoadError(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0)
      const now = Date.now()
      if (now - last > 15_000) {
        sessionStorage.setItem(RELOAD_FLAG, String(now))
        window.location.reload()
      }
    }
  }

  componentDidUpdate(prev: Props) {
    // Navegou pra outra rota → limpa o erro pra renderizar a nova página.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const chunk = isChunkLoadError(error)

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-warning-bg flex items-center justify-center mb-4">
            <AlertTriangle className="h-6 w-6 text-warning" />
          </div>
          <h1 className="text-lg font-bold text-ink">
            {chunk ? 'Atualizando o app…' : 'Algo deu errado'}
          </h1>
          <p className="text-sm text-ink-muted mt-1.5">
            {chunk
              ? 'Saiu uma versão nova. Estamos recarregando — se não recarregar sozinho, toque abaixo.'
              : 'Esta tela encontrou um erro. Você pode recarregar ou voltar ao início.'}
          </p>

          {!chunk && (
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-surface-2 p-2.5 text-left text-[11px] leading-snug text-ink-faint whitespace-pre-wrap break-words">
              {error.name}: {error.message}
            </pre>
          )}

          <div className="mt-5 flex gap-2 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent text-white px-4 py-2.5 text-sm font-bold active:scale-95 transition-transform"
            >
              <RefreshCw className="h-4 w-4" />
              Recarregar
            </button>
            <a
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 text-ink px-4 py-2.5 text-sm font-semibold active:scale-95 transition-transform"
            >
              <Home className="h-4 w-4" />
              Início
            </a>
          </div>
        </div>
      </div>
    )
  }
}
