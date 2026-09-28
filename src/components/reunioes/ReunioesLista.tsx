import { useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock3, ListTodo, MessageSquare, PlayCircle, Plus, Presentation, RotateCcw, Search } from 'lucide-react'
import type { Reuniao, ReuniaoStatus } from '@/hooks/useReunioes'
import './ReunioesLista.css'

type FeedbackCount = { total: number; novos: number }
type Filter = 'todos' | ReuniaoStatus

type Props = {
  reunioes: Reuniao[]
  contagem: Record<string, FeedbackCount>
  isLoading: boolean
  error?: unknown
  onRetry: () => void
  onCreate: () => void
  creating: boolean
  onOpen: (id: string) => void
}

const filters: { id: Filter; label: string }[] = [
  { id: 'todos', label: 'Todas' },
  { id: 'planejada', label: 'Planejadas' },
  { id: 'em_andamento', label: 'Em andamento' },
  { id: 'concluida', label: 'Concluídas' },
]

const status: Record<ReuniaoStatus, { label: string; icon: typeof Clock3 }> = {
  planejada: { label: 'Planejada', icon: Clock3 },
  em_andamento: { label: 'Em andamento', icon: PlayCircle },
  concluida: { label: 'Concluída', icon: CheckCircle2 },
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
}

function dateValue(value: string): number {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function dateParts(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { day: '—', month: '', year: '', time: 'Data não informada', group: 'Sem data' }
  const month = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  const group = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return {
    day: date.toLocaleDateString('pt-BR', { day: '2-digit' }),
    month,
    year: String(date.getFullYear()),
    time: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    group: group.charAt(0).toLocaleUpperCase('pt-BR') + group.slice(1),
  }
}

function StatusChip({ value }: { value: ReuniaoStatus }) {
  const item = status[value] ?? status.planejada
  const Icon = item.icon
  return <span className={`br-meet-status is-${value}`}><Icon aria-hidden="true" size={14} />{item.label}</span>
}

function MeetingMeta({ meeting, feedback }: { meeting: Reuniao; feedback?: FeedbackCount }) {
  const tasks = meeting.tarefas ?? []
  const done = tasks.filter(item => item.feito).length
  const slides = meeting.apresentacao_manifesto?.slides?.length ?? 0
  return <div className="br-meet-meta" aria-label="Conteúdo da reunião">
    <span><ClipboardList aria-hidden="true" size={14} /> Pauta {meeting.pauta?.length ?? 0}</span>
    <span><ListTodo aria-hidden="true" size={14} /> Tarefas {done}/{tasks.length}</span>
    {slides > 0 && <span><Presentation aria-hidden="true" size={14} /> {slides} {slides === 1 ? 'slide' : 'slides'}</span>}
    {feedback && feedback.total > 0 && <span className={feedback.novos > 0 ? 'has-new' : ''}><MessageSquare aria-hidden="true" size={14} /> {feedback.novos > 0 ? `${feedback.novos} ${feedback.novos === 1 ? 'novo' : 'novos'}` : `${feedback.total} feedback${feedback.total === 1 ? '' : 's'}`}</span>}
  </div>
}

function DateStamp({ meeting, prominent = false }: { meeting: Reuniao; prominent?: boolean }) {
  const date = dateParts(meeting.data_reuniao)
  return <time className={`br-meet-date${prominent ? ' is-prominent' : ''}`} dateTime={meeting.data_reuniao}>
    <strong>{date.day}</strong><span>{date.month}</span><small>{date.year} · {date.time}</small>
  </time>
}

export function ReunioesLista({ reunioes, contagem, isLoading, error, onRetry, onCreate, creating, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [search, setSearch] = useState('')
  const sorted = useMemo(() => [...reunioes].sort((a, b) => dateValue(b.data_reuniao) - dateValue(a.data_reuniao)), [reunioes])
  const featured = useMemo(() => {
    const inProgress = sorted.find(item => item.status === 'em_andamento')
    if (inProgress) return inProgress
    const now = Date.now()
    return [...sorted]
      .filter(item => item.status === 'planejada' && dateValue(item.data_reuniao) >= now)
      .sort((a, b) => dateValue(a.data_reuniao) - dateValue(b.data_reuniao))[0]
  }, [sorted])
  const query = normalized(search)
  const filtered = sorted.filter(item =>
    (filter === 'todos' || item.status === filter) &&
    (!query || normalized(`${item.titulo} ${item.resumo ?? ''}`).includes(query)),
  )
  const showFeatured = filter === 'todos' && !query && !!featured
  const agenda = showFeatured && featured ? filtered.filter(item => item.id !== featured.id) : filtered
  const groups = new Map<string, Reuniao[]>()
  for (const meeting of agenda) {
    const label = dateParts(meeting.data_reuniao).group
    const group = groups.get(label) ?? []
    group.push(meeting)
    groups.set(label, group)
  }
  const counts: Record<Filter, number> = {
    todos: reunioes.length,
    planejada: reunioes.filter(item => item.status === 'planejada').length,
    em_andamento: reunioes.filter(item => item.status === 'em_andamento').length,
    concluida: reunioes.filter(item => item.status === 'concluida').length,
  }

  return <main className="br-meetings">
    <header className="br-meetings-header">
      <div><p className="br-meetings-kicker">Agenda comercial</p><h1>Reuniões</h1><p className="br-meetings-description">Pautas, decisões e acompanhamento do time em um só lugar.</p></div>
      <button className="br-meetings-create" type="button" onClick={onCreate} disabled={creating}><Plus aria-hidden="true" size={18} />{creating ? 'Criando…' : 'Nova reunião'}</button>
    </header>

    {Boolean(error) && <div className="br-meetings-error" role="alert"><span>Não foi possível atualizar as reuniões.</span><button type="button" onClick={onRetry}><RotateCcw aria-hidden="true" size={15} /> Tentar novamente</button></div>}

    {isLoading ? <div className="br-meetings-loading" aria-busy="true" aria-label="Carregando reuniões"><div className="br-meetings-skeleton is-large" /><div className="br-meetings-skeleton" /><div className="br-meetings-skeleton" /></div> : Boolean(error) && reunioes.length === 0 ? null : reunioes.length === 0 ? (
      <div className="br-meetings-empty"><CalendarDays aria-hidden="true" size={30} /><h2>Nenhuma reunião ainda</h2><p>Crie uma reunião para montar a primeira pauta.</p><button type="button" onClick={onCreate} disabled={creating}><Plus aria-hidden="true" size={16} /> Criar reunião</button></div>
    ) : <>
      {showFeatured && featured && <section className="br-meet-featured" aria-labelledby="br-featured-title">
        <div className="br-meet-featured-copy">
          <p className="br-meet-featured-kicker">{featured.status === 'em_andamento' ? 'Reunião em andamento' : 'Próxima na agenda'}</p>
          <h2 id="br-featured-title">{featured.titulo}</h2>
          {featured.resumo && <p className="br-meet-featured-summary">{featured.resumo}</p>}
          <div className="br-meet-featured-detail"><StatusChip value={featured.status} /><MeetingMeta meeting={featured} feedback={contagem[featured.id]} /></div>
          <button type="button" className="br-meet-featured-open" onClick={() => onOpen(featured.id)}>Abrir reunião <ArrowRight aria-hidden="true" size={17} /></button>
        </div>
        <DateStamp meeting={featured} prominent />
      </section>}

      <section className="br-meet-agenda" aria-labelledby="br-agenda-title">
        <div className="br-meet-agenda-heading"><div><p className="br-meetings-kicker">Histórico e planejamento</p><h2 id="br-agenda-title">Agenda de reuniões</h2></div><span>{agenda.length} {agenda.length === 1 ? 'reunião' : 'reuniões'}</span></div>
        <div className="br-meet-tools">
          <div className="br-meet-filters" role="group" aria-label="Filtrar por status">{filters.map(item => <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<small>{counts[item.id]}</small></button>)}</div>
          <label className="br-meet-search"><Search aria-hidden="true" size={17} /><span className="sr-only">Buscar reuniões</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por título ou resumo" /></label>
        </div>
        {agenda.length === 0 ? <div className="br-meet-results-empty"><p>{showFeatured ? 'A próxima reunião está em destaque acima.' : 'Nenhuma reunião encontrada para este filtro.'}</p>{(!showFeatured || query) && <button type="button" onClick={() => { setFilter('todos'); setSearch('') }}>Limpar filtros</button>}</div> : [...groups].map(([label, meetings]) => <div className="br-meet-month" key={label}>
          <h3>{label}</h3><div className="br-meet-rows">{meetings.map(meeting => <button type="button" className="br-meet-row" key={meeting.id} onClick={() => onOpen(meeting.id)} aria-label={`Abrir reunião ${meeting.titulo}`}>
            <DateStamp meeting={meeting} /><div className="br-meet-row-body"><div className="br-meet-row-heading"><strong>{meeting.titulo}</strong><StatusChip value={meeting.status} /></div>{meeting.resumo && <p>{meeting.resumo}</p>}<MeetingMeta meeting={meeting} feedback={contagem[meeting.id]} /></div><ArrowRight className="br-meet-row-arrow" aria-hidden="true" size={18} />
          </button>)}</div>
        </div>)}
      </section>
    </>}
  </main>
}
