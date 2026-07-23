import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Check, Bell, CalendarClock,
  ListTodo, Trash2, X, Loader2, Save, User, Pencil, ChevronDown,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useVendedorNome } from '@/hooks/useVendedorNome'
import {
  AGENDA_SELECT, parseLocalDateTime, ymd, likeExato,
  type AgendaItem, type AgendaTipo,
} from '@/lib/agenda'

// ============================================================================
// Agenda (calendário + tarefas + lembretes) por vendedor. Tudo lê/grava em
// agenda_itens filtrando por vendedor_nome (MAIÚSCULO, case-insensitive no filtro).
// O aviso NA TELA quando o lembrete vence é global (LembretesNotifier no Layout);
// o aviso no WhatsApp é feito por um cron server-side (não mexemos aqui).
// ============================================================================

// ─── Toast mínimo local (padrão do repo — não há provider global) ───────────
interface ToastMsg { id: number; texto: string; tone: 'success' | 'danger' | 'info' }

function useToast(): [ToastMsg[], (texto: string, tone?: ToastMsg['tone']) => void] {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const push = (texto: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }
  return [toasts, push]
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[1100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border backdrop-blur bg-surface/95',
          t.tone === 'success' && 'border-success/30 text-success',
          t.tone === 'danger' && 'border-danger/30 text-danger',
          t.tone === 'info' && 'border-border text-ink',
        )}>
          {t.texto}
        </div>
      ))}
    </div>
  )
}

// ─── Toggle simples com design tokens do CRM ────────────────────────────────
function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      disabled={disabled}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors shrink-0 disabled:opacity-40',
        on ? 'bg-accent' : 'bg-border',
      )}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
        on && 'translate-x-4',
      )} />
    </button>
  )
}

// ─── Metadados visuais por tipo ─────────────────────────────────────────────
const TIPO_META: Record<AgendaTipo, {
  label: string
  Icon: typeof Bell
  dot: string
  chipOn: string
  text: string
  soft: string
  ring: string
}> = {
  tarefa:      { label: 'Tarefa',      Icon: ListTodo,      dot: 'bg-accent',  chipOn: 'bg-accent text-white border-accent',   text: 'text-accent',  soft: 'bg-accent/10',  ring: 'border-accent/30' },
  lembrete:    { label: 'Lembrete',    Icon: Bell,          dot: 'bg-warning', chipOn: 'bg-warning text-white border-warning', text: 'text-warning', soft: 'bg-warning/10', ring: 'border-warning/30' },
  compromisso: { label: 'Compromisso', Icon: CalendarClock, dot: 'bg-info',    chipOn: 'bg-info text-white border-info',       text: 'text-info',    soft: 'bg-info/10',    ring: 'border-info/30' },
}

const TIPOS: AgendaTipo[] = ['tarefa', 'lembrete', 'compromisso']
const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

const inputCls =
  'w-full min-h-[44px] sm:min-h-0 sm:h-9 rounded-md border border-border bg-surface px-3 text-[14px] sm:text-[13px] ' +
  'text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all ' +
  '[color-scheme:light] dark:[color-scheme:dark]'

// ─── Helpers de data ────────────────────────────────────────────────────────
function inicioSemana(d: Date): Date {
  const dia = d.getDay()            // 0=dom … 6=sáb
  const offset = (dia + 6) % 7      // segunda como início
  const r = new Date(d)
  r.setDate(d.getDate() - offset)
  r.setHours(0, 0, 0, 0)
  return r
}

function horaCurta(h: string | null): string {
  return h && h.length >= 5 ? h.slice(0, 5) : ''
}

function mesLabel(d: Date): string {
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function dataLonga(dataStr: string | null): string {
  if (!dataStr) return 'Sem data'
  const d = parseLocalDateTime(dataStr, null)
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

// Ordena por hora (sem hora vai pro fim), depois por título.
function ordenaItens(a: AgendaItem, b: AgendaItem): number {
  const ha = a.hora ?? '99:99'
  const hb = b.hora ?? '99:99'
  if (ha !== hb) return ha < hb ? -1 : 1
  return a.titulo.localeCompare(b.titulo, 'pt-BR')
}

// ─── Form ───────────────────────────────────────────────────────────────────
interface FormState {
  id: number | null
  tipo: AgendaTipo
  titulo: string
  descricao: string
  data: string        // 'YYYY-MM-DD' | ''
  hora: string        // 'HH:MM' | ''
  contato_nome: string
  notificar_wa: boolean
}

function formVazio(dataInicial = ''): FormState {
  return { id: null, tipo: 'tarefa', titulo: '', descricao: '', data: dataInicial, hora: '', contato_nome: '', notificar_wa: true }
}

function formDeItem(it: AgendaItem): FormState {
  return {
    id: it.id,
    tipo: it.tipo,
    titulo: it.titulo,
    descricao: it.descricao ?? '',
    data: it.data ?? '',
    hora: horaCurta(it.hora),
    contato_nome: it.contato_nome ?? '',
    notificar_wa: it.notificar_wa,
  }
}

// ─── Query ──────────────────────────────────────────────────────────────────
function useAgendaItens(nome: string) {
  return useQuery({
    queryKey: ['agenda-itens', nome],
    enabled: !!nome,
    queryFn: async (): Promise<AgendaItem[]> => {
      const { data, error } = await supabase
        .from('agenda_itens')
        .select(AGENDA_SELECT)
        .ilike('vendedor_nome', likeExato(nome))
        .order('data', { ascending: true, nullsFirst: false })
        .order('hora', { ascending: true, nullsFirst: true })
      if (error) throw error
      return (data ?? []) as AgendaItem[]
    },
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Linha de item (usada no drawer do dia e na lista de tarefas)
// ============================================================================
function LinhaItem({ item, onToggle, onEditar }: {
  item: AgendaItem
  onToggle: (item: AgendaItem) => void
  onEditar: (item: AgendaItem) => void
}) {
  const meta = TIPO_META[item.tipo]
  return (
    <div className="flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-surface-2/50 transition-colors group">
      <button
        onClick={() => onToggle(item)}
        title={item.concluido ? 'Marcar como pendente' : 'Marcar como concluído'}
        className={cn(
          'mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors',
          item.concluido ? 'bg-accent border-accent text-white' : 'border-border hover:border-accent',
        )}
      >
        {item.concluido && <Check className="h-3 w-3" />}
      </button>
      <button onClick={() => onEditar(item)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full shrink-0', meta.dot)} />
          <span className={cn(
            'text-[13px] font-medium text-ink truncate',
            item.concluido && 'line-through text-ink-faint',
          )}>
            {item.titulo}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 pl-3.5 text-[11px] text-ink-faint">
          <span className={cn('uppercase tracking-wide font-semibold', meta.text)}>{meta.label}</span>
          {item.hora && <span className="tabular-nums">{horaCurta(item.hora)}</span>}
          {item.contato_nome && (
            <span className="inline-flex items-center gap-0.5 truncate"><User className="h-3 w-3" />{item.contato_nome}</span>
          )}
        </div>
      </button>
      <Pencil className="h-3.5 w-3.5 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0" />
    </div>
  )
}

// ============================================================================
// Calendário do mês
// ============================================================================
function CalendarioMes({ mesRef, itensPorDia, onPrev, onNext, onHoje, onAbrirDia }: {
  mesRef: Date
  itensPorDia: Map<string, AgendaItem[]>
  onPrev: () => void
  onNext: () => void
  onHoje: () => void
  onAbrirDia: (ymdStr: string) => void
}) {
  const hojeStr = ymd(new Date())
  const mesAtual = mesRef.getMonth()

  const dias = useMemo(() => {
    const primeiro = new Date(mesRef.getFullYear(), mesRef.getMonth(), 1)
    const inicio = inicioSemana(primeiro)
    const arr: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio)
      d.setDate(inicio.getDate() + i)
      arr.push(d)
    }
    return arr
  }, [mesRef])

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      {/* Header do calendário */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <h2 className="text-[14px] font-semibold text-ink">{mesLabel(mesRef)}</h2>
        <div className="flex items-center gap-1">
          <button onClick={onHoje} className="px-2.5 py-1 rounded-md border border-border text-[12px] font-medium text-ink hover:bg-surface-2 transition-colors">
            Hoje
          </button>
          <button onClick={onPrev} title="Mês anterior" className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-2 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={onNext} title="Próximo mês" className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-2 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 border-b border-border bg-surface-2/40">
        {DIAS_SEMANA.map(d => (
          <div key={d} className="text-center py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">{d}</div>
        ))}
      </div>

      {/* Grade */}
      <div className="grid grid-cols-7">
        {dias.map((d, i) => {
          const key = ymd(d)
          const doMes = d.getMonth() === mesAtual
          const ehHoje = key === hojeStr
          const itens = itensPorDia.get(key) ?? []
          const visiveis = itens.slice(0, 3)
          const resto = itens.length - visiveis.length
          return (
            <button
              key={key}
              onClick={() => onAbrirDia(key)}
              className={cn(
                'min-h-[74px] sm:min-h-[92px] border-b border-r border-border/60 p-1 text-left align-top flex flex-col gap-0.5 transition-colors',
                'hover:bg-surface-2/50',
                i % 7 === 6 && 'border-r-0',
                !doMes && 'bg-surface-2/20',
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  'inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[11px] font-semibold tabular-nums',
                  ehHoje ? 'bg-accent text-white' : doMes ? 'text-ink' : 'text-ink-faint',
                )}>
                  {d.getDate()}
                </span>
                {itens.length > 0 && !doMes && (
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/50" />
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {visiveis.map(it => {
                  const meta = TIPO_META[it.tipo]
                  return (
                    <span key={it.id} className={cn(
                      'flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight truncate',
                      meta.soft, it.concluido && 'opacity-50',
                    )}>
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', meta.dot)} />
                      <span className={cn('truncate text-ink', it.concluido && 'line-through')}>
                        {it.hora ? horaCurta(it.hora) + ' ' : ''}{it.titulo}
                      </span>
                    </span>
                  )
                })}
                {resto > 0 && <span className="text-[10px] text-ink-faint pl-1">+{resto} mais</span>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// Painel de tarefas
// ============================================================================
function PainelTarefas({ tarefas, onToggle, onEditar, onNovo }: {
  tarefas: AgendaItem[]
  onToggle: (item: AgendaItem) => void
  onEditar: (item: AgendaItem) => void
  onNovo: () => void
}) {
  const [verConcluidas, setVerConcluidas] = useState(false)

  // Pendentes: por data (sem data no fim), depois hora/título.
  const pendentes = useMemo(() => tarefas.filter(t => !t.concluido).sort((a, b) => {
    const da = a.data ?? '9999-99-99'
    const db = b.data ?? '9999-99-99'
    if (da !== db) return da < db ? -1 : 1
    return ordenaItens(a, b)
  }), [tarefas])

  const concluidas = useMemo(
    () => tarefas.filter(t => t.concluido).sort((a, b) => (a.data ?? '') < (b.data ?? '') ? 1 : -1),
    [tarefas],
  )

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <h2 className="text-[14px] font-semibold text-ink flex items-center gap-1.5">
          <ListTodo className="h-4 w-4 text-accent" /> Tarefas
          <span className="text-[11px] font-normal text-ink-faint">({pendentes.length})</span>
        </h2>
        <button
          onClick={onNovo}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" /> Nova
        </button>
      </div>

      <div className="p-1.5 flex-1 min-h-0">
        {pendentes.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-ink-faint">
            Nenhuma tarefa pendente. Clique em <strong className="text-ink">Nova</strong> pra criar.
          </div>
        ) : (
          <div className="flex flex-col">
            {pendentes.map(t => (
              <div key={t.id}>
                <LinhaItem item={t} onToggle={onToggle} onEditar={onEditar} />
                {t.data && <div className="pl-[1.9rem] -mt-1 mb-0.5 text-[10px] text-ink-faint">{dataLonga(t.data)}</div>}
              </div>
            ))}
          </div>
        )}

        {concluidas.length > 0 && (
          <div className="mt-1 border-t border-border/60 pt-1">
            <button
              onClick={() => setVerConcluidas(v => !v)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink transition-colors"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', verConcluidas ? 'rotate-0' : '-rotate-90')} />
              Concluídas ({concluidas.length})
            </button>
            {verConcluidas && (
              <div className="flex flex-col">
                {concluidas.map(t => <LinhaItem key={t.id} item={t} onToggle={onToggle} onEditar={onEditar} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Drawer do dia
// ============================================================================
function DrawerDia({ diaKey, itens, onFechar, onEditar, onNovo, onToggle }: {
  diaKey: string
  itens: AgendaItem[]
  onFechar: () => void
  onEditar: (item: AgendaItem) => void
  onNovo: (dataInicial: string) => void
  onToggle: (item: AgendaItem) => void
}) {
  const d = parseLocalDateTime(diaKey, null)
  const titulo = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end" onClick={onFechar}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div
        className="relative w-full sm:max-w-sm h-full bg-surface border-l border-border shadow-2xl flex flex-col animate-[drawerIn_.18s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Dia</div>
            <h3 className="text-[15px] font-semibold text-ink capitalize">{titulo}</h3>
          </div>
          <button onClick={onFechar} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 transition-colors">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {itens.length === 0 ? (
            <div className="px-3 py-10 text-center text-[12px] text-ink-faint">Nada marcado neste dia.</div>
          ) : (
            [...itens].sort(ordenaItens).map(it => <LinhaItem key={it.id} item={it} onToggle={onToggle} onEditar={onEditar} />)
          )}
        </div>

        <div className="p-3 border-t border-border">
          <button
            onClick={() => onNovo(diaKey)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" /> Novo item neste dia
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Modal de formulário (novo / editar)
// ============================================================================
function FormModal({ form, setForm, onSalvar, onExcluir, onFechar, salvando, excluindo }: {
  form: FormState
  setForm: (f: FormState) => void
  onSalvar: () => void
  onExcluir: () => void
  onFechar: () => void
  salvando: boolean
  excluindo: boolean
}) {
  const editando = form.id != null
  const tituloOk = form.titulo.trim().length > 0
  return (
    <div className="fixed inset-0 z-[1250] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full sm:max-w-lg bg-surface border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto animate-[modalIn_.18s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
          <h3 className="text-[15px] font-semibold text-ink">{editando ? 'Editar item' : 'Novo item'}</h3>
          <button onClick={onFechar} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 transition-colors">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          {/* Tipo */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Tipo</label>
            <div className="grid grid-cols-3 gap-1.5">
              {TIPOS.map(t => {
                const meta = TIPO_META[t]
                const Icon = meta.Icon
                const ativo = form.tipo === t
                return (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, tipo: t })}
                    className={cn(
                      'flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border text-[12px] font-semibold transition-colors',
                      ativo ? meta.chipOn : 'bg-surface border-border text-ink-muted hover:bg-surface-2',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Título */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Título *</label>
            <Input
              value={form.titulo}
              onChange={e => setForm({ ...form, titulo: e.target.value })}
              placeholder="Ex: Ligar pro cliente sobre o orçamento"
              autoFocus
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Descrição (opcional)</label>
            <textarea
              value={form.descricao}
              onChange={e => setForm({ ...form, descricao: e.target.value })}
              placeholder="Detalhes que você não quer esquecer…"
              className={cn(
                'w-full min-h-[72px] rounded-md border border-border bg-surface px-3 py-2 text-[13px]',
                'text-ink placeholder:text-ink-faint resize-y',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
              )}
            />
          </div>

          {/* Data + Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Data</label>
              <input type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Hora</label>
              <input type="time" value={form.hora} onChange={e => setForm({ ...form, hora: e.target.value })} className={inputCls} />
            </div>
          </div>
          <p className="-mt-1.5 text-[11px] text-ink-faint">Sem hora, o lembrete considera 09:00 do dia.</p>

          {/* Contato */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Contato (opcional)</label>
            <Input
              value={form.contato_nome}
              onChange={e => setForm({ ...form, contato_nome: e.target.value })}
              placeholder="Ex: João da Fazenda Boa Vista"
              leftIcon={<User className="h-3.5 w-3.5" />}
            />
          </div>

          {/* Notificar WA */}
          <div className="flex items-start gap-3 rounded-md border border-border bg-surface-2/40 p-3">
            <Toggle on={form.notificar_wa} onChange={v => setForm({ ...form, notificar_wa: v })} />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">Avisar no meu WhatsApp na hora</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                Quando a data/hora chegar, você recebe uma mensagem no seu próprio WhatsApp.
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="sticky bottom-0 flex items-center gap-2 px-4 py-3 border-t border-border bg-surface">
          {editando && (
            <button
              onClick={onExcluir}
              disabled={excluindo}
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-danger/40 text-danger text-[12px] font-medium hover:bg-danger/10 transition-colors disabled:opacity-60"
            >
              {excluindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Excluir
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onFechar} className="px-3 py-2 rounded-md border border-border text-[13px] font-medium text-ink-muted hover:bg-surface-2 transition-colors">
              Cancelar
            </button>
            <button
              onClick={onSalvar}
              disabled={salvando || !tituloOk}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-colors',
                tituloOk ? 'bg-accent text-white hover:opacity-90' : 'bg-surface-2 text-ink-faint cursor-default',
                'disabled:opacity-60',
              )}
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editando ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Página
// ============================================================================
export function Agenda() {
  const qc = useQueryClient()
  const [toasts, push] = useToast()
  const { nome, isLoading: nomeLoading } = useVendedorNome()

  const [mesRef, setMesRef] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [drawerDia, setDrawerDia] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const { data: itens, isLoading } = useAgendaItens(nome)

  const invalidar = () => qc.invalidateQueries({ queryKey: ['agenda-itens'] })

  const itensPorDia = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const it of itens ?? []) {
      if (!it.data) continue
      const arr = map.get(it.data) ?? []
      arr.push(it)
      map.set(it.data, arr)
    }
    return map
  }, [itens])

  const tarefas = useMemo(() => (itens ?? []).filter(i => i.tipo === 'tarefa'), [itens])
  const itensDoDrawer = useMemo(
    () => (drawerDia ? (itens ?? []).filter(i => i.data === drawerDia) : []),
    [itens, drawerDia],
  )

  // ── Mutations ──
  const salvar = useMutation({
    mutationFn: async (f: FormState) => {
      const titulo = f.titulo.trim()
      if (!titulo) throw new Error('Dê um título pro item')
      const payload = {
        tipo: f.tipo,
        titulo,
        descricao: f.descricao.trim() || null,
        data: f.data || null,
        hora: f.hora ? `${f.hora}:00` : null,
        contato_nome: f.contato_nome.trim() || null,
        notificar_wa: f.notificar_wa,
      }
      if (f.id == null) {
        const { error } = await supabase.from('agenda_itens').insert({ ...payload, vendedor_nome: nome })
        if (error) throw error
      } else {
        // Editou: só RE-ARMA os avisos (tela + WhatsApp) se o horário agendado ainda
        // está no FUTURO. Editar um item já vencido (ex: corrigir um typo no título) NÃO
        // pode re-disparar o alerta — senão qualquer ediçãozinha vira spam. (auditoria)
        const quando = f.data ? parseLocalDateTime(f.data, f.hora || null).getTime() : null
        const reArma = quando != null && quando > Date.now()
        const upd: Record<string, unknown> = { ...payload, atualizado_em: new Date().toISOString() }
        if (reArma) { upd.notificado_app = false; upd.notificado_wa = false }
        const { error } = await supabase.from('agenda_itens').update(upd).eq('id', f.id)
        if (error) throw error
      }
    },
    onSuccess: (_d, f) => {
      invalidar()
      setForm(null)
      push(f.id == null ? 'Item criado' : 'Item salvo', 'success')
    },
    onError: (err: Error) => push('Erro ao salvar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const toggleConcluido = useMutation({
    mutationFn: async (item: AgendaItem) => {
      const { error } = await supabase
        .from('agenda_itens')
        .update({ concluido: !item.concluido, atualizado_em: new Date().toISOString() })
        .eq('id', item.id)
      if (error) throw error
    },
    onSuccess: () => invalidar(),
    onError: (err: Error) => push('Erro: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const excluir = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('agenda_itens').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidar()
      setForm(null)
      push('Item excluído', 'success')
    },
    onError: (err: Error) => push('Erro ao excluir: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  // ── Handlers ──
  const abrirNovo = (dataInicial = '') => setForm(formVazio(dataInicial))
  const abrirEditar = (item: AgendaItem) => setForm(formDeItem(item))
  const abrirNovoDoDrawer = (dataInicial: string) => { setDrawerDia(null); abrirNovo(dataInicial) }

  // ── Estados de carregamento / vazio ──
  if (nomeLoading || (nome && isLoading)) {
    return <div className="min-h-screen bg-bg"><div className="max-w-6xl mx-auto px-4 sm:px-6 py-6"><PageLoading /></div></div>
  }

  if (!nome) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <CalendarDays className="h-8 w-8 text-ink-faint mx-auto mb-2" />
            <h1 className="text-[16px] font-semibold text-ink mb-1">Agenda</h1>
            <p className="text-[13px] text-ink-muted">
              Não consegui identificar seu usuário de vendedor. Fale com o admin pra vincular seu acesso a um vendedor.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="w-5 h-5 text-accent" />
              <h1 className="text-[18px] font-semibold text-ink">Agenda</h1>
            </div>
            <p className="text-[12px] text-ink-muted">
              Suas tarefas, lembretes e compromissos. O lembrete aparece na tela na hora — e no seu WhatsApp, se você marcar.
            </p>
          </div>
          <button
            onClick={() => abrirNovo('')}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" /> Novo
          </button>
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          {TIPOS.map(t => {
            const meta = TIPO_META[t]
            return (
              <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot)} /> {meta.label}
              </span>
            )
          })}
        </div>

        {/* Calendário + Tarefas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <CalendarioMes
              mesRef={mesRef}
              itensPorDia={itensPorDia}
              onPrev={() => setMesRef(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              onNext={() => setMesRef(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              onHoje={() => { const n = new Date(); setMesRef(new Date(n.getFullYear(), n.getMonth(), 1)) }}
              onAbrirDia={setDrawerDia}
            />
          </div>
          <div className="lg:col-span-1">
            <PainelTarefas
              tarefas={tarefas}
              onToggle={item => toggleConcluido.mutate(item)}
              onEditar={abrirEditar}
              onNovo={() => abrirNovo('')}
            />
          </div>
        </div>
      </div>

      {/* Drawer do dia */}
      {drawerDia && (
        <DrawerDia
          diaKey={drawerDia}
          itens={itensDoDrawer}
          onFechar={() => setDrawerDia(null)}
          onEditar={item => { setDrawerDia(null); abrirEditar(item) }}
          onNovo={abrirNovoDoDrawer}
          onToggle={item => toggleConcluido.mutate(item)}
        />
      )}

      {/* Modal do form */}
      {form && (
        <FormModal
          form={form}
          setForm={setForm}
          onSalvar={() => salvar.mutate(form)}
          onExcluir={() => { if (form.id != null && window.confirm('Excluir este item?')) excluir.mutate(form.id) }}
          onFechar={() => setForm(null)}
          salvando={salvar.isPending}
          excluindo={excluir.isPending}
        />
      )}

      <ToastStack toasts={toasts} />

      <style>{`
        @keyframes drawerIn { from { transform: translateX(16px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }
        @keyframes modalIn { from { transform: translateY(12px); opacity: .7 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
    </div>
  )
}
