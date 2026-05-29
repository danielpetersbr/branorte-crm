import { useEffect, useRef, useState } from 'react'
import { supabaseAuditoria } from '@/lib/supabase'

type CriativoInfo = {
  codigo: string
  nome_oficial: string | null
  headline: string | null
  image_url: string | null
  source_url: string | null
  total_leads: number | null
}

const cache = new Map<string, CriativoInfo | null>()
const inflight = new Map<string, Promise<CriativoInfo | null>>()

async function fetchCriativo(codigo: string): Promise<CriativoInfo | null> {
  if (cache.has(codigo)) return cache.get(codigo) ?? null
  const existing = inflight.get(codigo)
  if (existing) return existing
  const p = (async () => {
    const { data } = await supabaseAuditoria
      .from('criativos')
      .select('codigo, nome_oficial, headline, image_url, source_url, total_leads')
      .eq('codigo', codigo)
      .maybeSingle()
    cache.set(codigo, (data as CriativoInfo) ?? null)
    inflight.delete(codigo)
    return (data as CriativoInfo) ?? null
  })()
  inflight.set(codigo, p)
  return p
}

export function CriativoHoverBadge({ codigo, fallback }: { codigo: string; fallback?: CriativoInfo | null }) {
  const [info, setInfo] = useState<CriativoInfo | null>(fallback ?? cache.get(codigo) ?? null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'right' | 'left' } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const hoverTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    if (info) return
    let alive = true
    fetchCriativo(codigo).then(d => { if (alive) setInfo(d) })
    return () => { alive = false }
  }, [open, codigo, info])

  function handleEnter() {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cardW = 280
      const padding = 12
      const wouldOverflowRight = rect.right + cardW + padding > window.innerWidth
      setPos({
        top: rect.top + window.scrollY,
        left: wouldOverflowRight ? rect.left - cardW - 8 : rect.right + 8,
        placement: wouldOverflowRight ? 'left' : 'right',
      })
      setOpen(true)
    }, 120)
  }
  function handleLeave() {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setOpen(false), 80)
  }

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted shrink-0 cursor-help"
      >
        {codigo}
      </span>
      {open && pos && (
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: 280, zIndex: 1000 }}
          className="rounded-lg border border-border bg-surface-1 shadow-xl overflow-hidden text-[12px]"
        >
          {info?.image_url ? (
            <img
              src={info.image_url}
              alt={info.nome_oficial ?? codigo}
              className="w-full h-40 object-cover bg-surface-2"
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="w-full h-20 bg-surface-2 flex items-center justify-center text-ink-faint text-[11px]">
              {info === null ? 'sem imagem' : 'carregando…'}
            </div>
          )}
          <div className="p-2.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted">{codigo}</span>
              {info?.total_leads != null && info.total_leads > 0 && (
                <span className="text-[10px] text-ink-faint">{info.total_leads} leads</span>
              )}
            </div>
            {info?.nome_oficial && (
              <div className="font-medium text-ink text-[12px]">{info.nome_oficial}</div>
            )}
            {info?.headline && (
              <div className="text-[11px] text-ink-faint italic">"{info.headline}"</div>
            )}
            {info?.source_url && (
              <a
                href={info.source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11px] text-accent hover:underline block truncate"
                onClick={(e) => e.stopPropagation()}
              >
                Ver no Facebook ↗
              </a>
            )}
          </div>
        </div>
      )}
    </>
  )
}
