// /projeto-3d — Configurador de fábrica em 3D embutido. O app é um projeto SvelteKit
// standalone (branorte-configurador-3d.vercel.app): o vendedor desenha o galpão,
// arrasta os equipamentos em escala, gera o 3D e vê a simulação ("Trabalhando") de
// cada máquina por dentro. Aqui ele roda DENTRO do CRM via iframe (o configurador
// não tem X-Frame-Options, então o embed é liberado). O botão "Abrir" leva pra aba
// própria quando o vendedor quer o espaço todo; "Tela cheia" usa a Fullscreen API.
import { useRef, useState } from 'react'
import { Boxes, ExternalLink, Maximize2, RefreshCw } from 'lucide-react'

const CONFIGURADOR_URL = 'https://branorte-configurador-3d.vercel.app'

export function Projeto3D() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)

  const telaCheia = () => {
    frameRef.current?.requestFullscreen?.().catch(() => {})
  }
  const recarregar = () => {
    const el = frameRef.current
    if (!el) return
    setLoading(true)
    el.src = el.src // reatribui pra forçar reload do app embutido
  }

  return (
    // Desconta a barra de navegação mobile (4rem) + safe-area; no desktop ocupa a viewport toda.
    <div className="h-[calc(100dvh_-_4rem_-_env(safe-area-inset-bottom))] md:h-screen flex flex-col bg-bg">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <Boxes className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-ink truncate">Projeto 3D</h1>
            <p className="text-xs text-ink-faint truncate">
              Desenhe o galpão, monte os equipamentos em escala e veja a fábrica em 3D
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={recarregar}
            title="Recarregar"
            className="h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg flex items-center justify-center"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={telaCheia}
            className="h-9 px-3 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg hidden sm:flex items-center gap-1.5 text-sm font-medium"
          >
            <Maximize2 className="h-4 w-4" /> Tela cheia
          </button>
          <a
            href={CONFIGURADOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-3 rounded-lg bg-accent text-white hover:opacity-90 flex items-center gap-1.5 text-sm font-semibold"
          >
            <ExternalLink className="h-4 w-4" /> Abrir
          </a>
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-ink-faint">
              <Boxes className="h-8 w-8 animate-pulse" />
              <span className="text-sm">Carregando o configurador 3D…</span>
            </div>
          </div>
        )}
        <iframe
          ref={frameRef}
          src={CONFIGURADOR_URL}
          title="Configurador 3D Branorte"
          onLoad={() => setLoading(false)}
          className="absolute inset-0 h-full w-full border-0"
          allow="fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
        />
      </div>
    </div>
  )
}

export default Projeto3D
