// /guia-animais e /guia-materias — Guia do Vendedor (raças/criações + matérias-primas da
// ração) embutido via iframe. O guia (branorte-viabilidade.vercel.app/guia.html) é standalone;
// aqui é só o container no CRM. O `hash` escolhe a aba (animais | materias).
import { useMemo, useRef, useState } from 'react'
import { BookOpen, Maximize2, RefreshCw, ExternalLink } from 'lucide-react'

const GUIA_URL = 'https://branorte-viabilidade.vercel.app/guia.html'

export function Guia({ hash, title, subtitle }: { hash: string; title: string; subtitle: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const src = useMemo(() => `${GUIA_URL}#${hash}`, [hash])

  const telaCheia = () => frameRef.current?.requestFullscreen?.().catch(() => {})
  const recarregar = () => {
    const el = frameRef.current
    if (!el) return
    setLoading(true)
    el.src = el.src
  }

  return (
    <div className="h-[calc(100dvh_-_4rem_-_env(safe-area-inset-bottom))] md:h-screen flex flex-col bg-bg">
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-border bg-surface relative z-20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <BookOpen className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <h1 className="text-sm font-bold text-ink truncate leading-tight">{title}</h1>
            <p className="text-[11px] text-ink-faint truncate">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir em nova aba" className="h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg flex items-center justify-center">
            <ExternalLink className="h-4 w-4" />
          </a>
          <button onClick={recarregar} title="Recarregar" className="h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg flex items-center justify-center">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={telaCheia} title="Tela cheia" className="h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg hidden sm:flex items-center justify-center">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg pointer-events-none z-10">
            <div className="flex flex-col items-center gap-2 text-ink-faint">
              <BookOpen className="h-8 w-8 animate-pulse" />
              <span className="text-sm">Carregando o guia…</span>
            </div>
          </div>
        )}
        <iframe
          ref={frameRef}
          src={src}
          title={title}
          onLoad={() => setLoading(false)}
          className="absolute inset-0 h-full w-full border-0"
          allow="fullscreen"
        />
      </div>
    </div>
  )
}

export default Guia
