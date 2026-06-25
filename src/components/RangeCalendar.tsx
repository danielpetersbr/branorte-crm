// Calendário inline de intervalo (De → Até). Sem dependência nova: usa date-fns
// (já no projeto) + tokens do app. 1º clique = início, 2º clique = fim. Clicar antes
// do início reinicia. Dias depois de `max` ficam desabilitados.
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, format, isSameDay, isSameMonth, isAfter, isToday, isWithinInterval,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'

function parseISO(s: string): Date | null {
  if (!s) return null
  const d = new Date(`${s}T00:00:00`)
  return isNaN(d.getTime()) ? null : d
}
const toISO = (d: Date) => format(d, 'yyyy-MM-dd')
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

interface Props {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
  max?: string // YYYY-MM-DD — dias depois ficam desabilitados
  onChange: (from: string, to: string) => void
}

export function RangeCalendar({ from, to, max, onChange }: Props) {
  const fromD = parseISO(from)
  const toD = parseISO(to)
  const maxD = max ? parseISO(max) : null
  const [view, setView] = useState<Date>(() => fromD ?? new Date())

  const gridStart = startOfWeek(startOfMonth(view), { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(view), { weekStartsOn: 0 })
  const dias = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function clicar(d: Date) {
    if (maxD && isAfter(d, maxD)) return
    // Sem início, ou intervalo completo → começa um novo.
    if (!fromD || (fromD && toD)) { onChange(toISO(d), ''); return }
    // Tem início, falta fim. Clicou ANTES do início → reinicia nesse dia.
    if (isAfter(fromD, d)) onChange(toISO(d), '')
    else onChange(from, toISO(d))
  }

  const ehFrom = (d: Date) => !!fromD && isSameDay(d, fromD)
  const ehTo = (d: Date) => !!toD && isSameDay(d, toD)
  const ehMeio = (d: Date) =>
    !!fromD && !!toD && isWithinInterval(d, { start: fromD, end: toD }) && !ehFrom(d) && !ehTo(d)

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setView(v => subMonths(v, 1))}
          className="p-1 rounded hover:bg-surface-3 text-ink-muted" aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[12px] font-bold text-ink capitalize">
          {format(view, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button type="button" onClick={() => setView(v => addMonths(v, 1))}
          className="p-1 rounded hover:bg-surface-3 text-ink-muted" aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-ink-faint">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {dias.map((d) => {
          const foraMes = !isSameMonth(d, view)
          const desab = !!(maxD && isAfter(d, maxD))
          const borda = ehFrom(d) || ehTo(d)
          const meio = ehMeio(d)
          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={desab}
              onClick={() => clicar(d)}
              className={
                'h-7 text-[11px] rounded transition-colors ' +
                (desab ? 'text-ink-faint/40 cursor-not-allowed '
                  : borda ? 'bg-accent text-white font-bold '
                  : meio ? 'bg-accent-bg text-accent '
                  : foraMes ? 'text-ink-faint/50 hover:bg-surface-3 '
                  : 'text-ink hover:bg-surface-3 ') +
                (isToday(d) && !borda && !meio ? 'ring-1 ring-accent/40 ' : '')
              }
            >
              {format(d, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
