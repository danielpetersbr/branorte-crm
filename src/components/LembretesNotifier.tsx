import { useEffect, useRef } from 'react'
import { Bell, Check, Clock, X, User } from 'lucide-react'
import { useLembretesDueNotifier } from '@/hooks/useLembretesDueNotifier'
import { parseLocalDateTime } from '@/lib/agenda'
import { cn } from '@/lib/utils'

// ============================================================================
// Card fixo de lembrete (canto inferior direito), acima de tudo. Aparece em
// qualquer página do CRM quando um lembrete/compromisso do vendedor vence.
// Discreto: um pulso curto na borda + beep suave (best-effort) ao surgir.
// ============================================================================

// Beep curto e suave via WebAudio. Best-effort — se o navegador bloquear
// (autoplay), falha em silêncio. Não é essencial pro aviso funcionar.
function beepDiscreto() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 660
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.34)
    osc.onended = () => ctx.close().catch(() => {})
  } catch {
    /* som é opcional */
  }
}

function quandoTexto(data: string | null, hora: string | null): string {
  if (!data) return ''
  const d = parseLocalDateTime(data, hora)
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const hh = hora && hora.length >= 4 ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
  return hh ? `${dia} às ${hh}` : dia
}

export function LembretesNotifier() {
  const { cards, concluir, adiar1h, dispensar } = useLembretesDueNotifier()
  const contadorRef = useRef(0)

  // Toca o beep quando surge um card novo (a contagem aumentou).
  useEffect(() => {
    if (cards.length > contadorRef.current) beepDiscreto()
    contadorRef.current = cards.length
  }, [cards.length])

  if (cards.length === 0) return null

  return (
    <div className="fixed right-3 sm:right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 z-[var(--z-toast)] flex flex-col gap-2 w-[calc(100vw-1.5rem)] max-w-[340px] pointer-events-none">
      {cards.map(item => {
        const compromisso = item.tipo === 'compromisso'
        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto rounded-xl border bg-surface shadow-xl overflow-hidden',
              'animate-[lembretePulse_1.6s_ease-out] ',
              compromisso ? 'border-info/40' : 'border-warning/40',
            )}
          >
            {/* faixa superior colorida */}
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-white text-[11px] font-bold uppercase tracking-wider',
              compromisso ? 'bg-info' : 'bg-warning',
            )}>
              {compromisso ? <Clock className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              <span className="flex-1">{compromisso ? 'Compromisso' : 'Lembrete'}</span>
              <button
                onClick={() => dispensar(item.id)}
                title="Dispensar"
                className="shrink-0 -mr-1 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-white/20 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="px-3 py-2.5">
              <div className="text-[13.5px] font-semibold text-ink leading-snug break-words">
                {item.titulo}
              </div>
              {item.contato_nome && (
                <div className="mt-1 flex items-center gap-1 text-[12px] text-ink-muted">
                  <User className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  <span className="break-words">{item.contato_nome}</span>
                </div>
              )}
              {item.descricao && (
                <p className="mt-1 text-[12px] text-ink-muted leading-snug break-words line-clamp-3">
                  {item.descricao}
                </p>
              )}
              {item.data && (
                <div className="mt-1 text-[11px] text-ink-faint tabular-nums">
                  {quandoTexto(item.data, item.hora)}
                </div>
              )}

              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  onClick={() => concluir(item)}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md bg-accent text-white text-[12px] font-semibold hover:opacity-90 transition-opacity"
                >
                  <Check className="h-3.5 w-3.5" /> Concluir
                </button>
                <button
                  onClick={() => adiar1h(item)}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-ink-muted text-[12px] font-medium hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  <Clock className="h-3.5 w-3.5" /> Adiar 1h
                </button>
                <button
                  onClick={() => dispensar(item.id)}
                  className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-md border border-border text-ink-muted text-[12px] font-medium hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* pulso discreto na borda ao surgir (theme-aware via currentColor da borda) */}
      <style>{`
        @keyframes lembretePulse {
          0%   { transform: translateY(6px); opacity: 0; }
          12%  { transform: translateY(0);   opacity: 1; }
          0%,100% { box-shadow: 0 10px 25px -5px rgba(0,0,0,.25); }
          20%  { box-shadow: 0 0 0 4px hsl(var(--warning) / .18), 0 10px 25px -5px rgba(0,0,0,.25); }
          60%  { box-shadow: 0 0 0 0 hsl(var(--warning) / 0), 0 10px 25px -5px rgba(0,0,0,.25); }
        }
      `}</style>
    </div>
  )
}
