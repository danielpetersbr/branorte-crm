import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot, RefreshCw, Users, CheckCircle2, AlertTriangle, Clock, ArrowLeft,
  CalendarDays, ChevronRight, ChevronDown, ArrowUpRight, MessageSquareText,
  UserRound, Info, ClipboardCheck, Link2,
} from 'lucide-react'
import { usePainelAna } from '@/hooks/usePainelAna'
import { useAuth } from '@/hooks/useAuth'
import type { FiltroAna } from '@/types/painel-ana'

const dataBR = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro'
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const somarDias = (dia: string, n: number) => {
  const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diaBR = (v: string) => new Date(v + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' })
const foco = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
const etapas: Record<string, string> = { atendendo: 'Ana atendendo', aguardando_orientacao: 'Espera de orientação', repasse_pendente: 'Repasse pendente', pausado: 'Pausa humana', bloqueado: 'Bloqueado', inconclusivo: 'Conclusão não comprovada', finalizado: 'Etapa da Ana concluída' }
const coresEtapa: Record<string, string> = {
  atendendo: 'bg-info/10 text-info border-info/20',
  aguardando_orientacao: 'bg-warning/10 text-warning border-warning/20',
  repasse_pendente: 'bg-warning/10 text-warning border-warning/20',
  pausado: 'bg-surface-2 text-ink-muted border-border',
  bloqueado: 'bg-danger/10 text-danger border-danger/20',
  inconclusivo: 'bg-warning/10 text-warning border-warning/20',
  finalizado: 'bg-success/10 text-success border-success/20',
}
const indicadores: Record<string, string> = { atendidos: 'Clientes atendidos', qualificados: 'Clientes qualificados', erros_tecnicos: 'Erros técnicos', alertas_revisor: 'Alertas do revisor' }
const filtros: { id: FiltroAna; titulo: string }[] = [
  { id: 'todos', titulo: 'Todos' }, { id: 'abertos', titulo: 'Não finalizados' },
  { id: 'atendidos', titulo: 'Atendidos' }, { id: 'qualificados', titulo: 'Qualificados' },
  { id: 'erros', titulo: 'Erros técnicos' }, { id: 'alertas', titulo: 'Para revisar' },
]

export function PainelAna() {
  const { profile } = useAuth()
  const [dias, setDias] = useState('7')
  const [de, setDe] = useState(() => somarDias(hojeBR(), -6))
  const [ate, setAte] = useState(hojeBR)
  const [filtro, setFiltro] = useState<FiltroAna>('todos')
  const [cursores, setCursores] = useState<(string | null)[]>([null])
  const [detalhe, setDetalhe] = useState<string | null>(null)
  const periodo = useMemo(() => ({ inicio: new Date(de + 'T00:00:00-03:00').toISOString(), fim: new Date(somarDias(ate, 1) + 'T00:00:00-03:00').toISOString() }), [de, ate])
  const invalido = de > ate || new Date(periodo.fim).getTime() - new Date(periodo.inicio).getTime() > 366 * 86400000
  const leitura = usePainelAna(periodo.inicio, periodo.fim, filtro, cursores.at(-1) ?? null)
  const dados = leitura.data
  const mudarFiltro = (f: FiltroAna) => { setFiltro(f); setCursores([null]); setDetalhe(null) }
  const preset = (v: string) => {
    setDias(v); setCursores([null])
    if (v !== 'custom') { setAte(hojeBR()); setDe(somarDias(hojeBR(), 1 - Number(v))) }
  }
  if (profile?.role !== 'admin') return <p className="p-6 text-ink-muted">Acesso administrativo necessário.</p>
  const cards = [
    { id: 'atendidos' as const, cobertura: 'atendidos', titulo: 'Clientes atendidos', valor: dados?.totais.atendidos, icon: Users, cor: 'text-accent', fundo: 'bg-accent/10', linha: 'bg-accent', texto: 'Resposta com envio confirmado' },
    { id: 'qualificados' as const, cobertura: 'qualificados', titulo: 'Clientes qualificados', valor: dados?.totais.qualificados, icon: CheckCircle2, cor: 'text-info', fundo: 'bg-info/10', linha: 'bg-info', texto: 'Critérios de qualificação validados' },
    { id: 'erros' as const, cobertura: 'erros_tecnicos', titulo: 'Erros técnicos', valor: dados?.totais.erros_tecnicos, icon: AlertTriangle, cor: 'text-danger', fundo: 'bg-danger/10', linha: 'bg-danger', texto: 'Incidentes, incluindo recuperados' },
    { id: 'abertos' as const, cobertura: null, titulo: 'Não finalizados agora', valor: dados?.totais.nao_finalizados_agora, icon: Clock, cor: 'text-warning', fundo: 'bg-warning/10', linha: 'bg-warning', texto: 'Situação atual · fora do filtro de data' },
  ]
  const incidentes = filtro === 'erros' || filtro === 'alertas'
  const vazio = dados && (incidentes ? dados.incidentes : dados.clientes).length === 0
  const parcial = dados && Object.values(dados.cobertura).some(c => c.incompleta)
  const coberturaAlertas = dados?.cobertura.alertas_revisor
  const semMedicaoAlertas = coberturaAlertas?.disponivel === false

  return <div className="min-h-screen bg-bg px-4 py-6 text-ink sm:px-8 sm:py-8 lg:px-10">
    <div className="mx-auto max-w-[1440px]">
      <Link to="/ia-atendente" className={'mb-6 inline-flex items-center gap-2 rounded-md text-micro text-ink-muted transition-colors hover:text-ink ' + foco}>
        <ArrowLeft size={14} aria-hidden="true" /> IA Atendente
      </Link>
      <header className="mb-7 flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
            <Bot size={28} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <div>
            <p className="mb-1 text-micro font-semibold uppercase tracking-[0.14em] text-accent">Visão de atendimento</p>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">Painel da Ana</h1>
            <p className="mt-1.5 text-body text-ink-muted">Do primeiro contato ao repasse para o vendedor.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-micro text-ink-muted sm:text-right">
            <p className="flex items-center gap-1.5 sm:justify-end"><Clock size={13} aria-hidden="true" /> Última leitura</p>
            <p className="mt-1 font-medium tabular-nums text-ink">{dados ? dataBR(dados.gerado_em) : 'Aguardando dados'} <span className="font-normal text-ink-muted">· São Paulo</span></p>
          </div>
          <button onClick={() => leitura.refetch()} disabled={leitura.isFetching || invalido} className={'inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-label font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50 ' + foco}>
            <RefreshCw size={16} aria-hidden="true" className={leitura.isFetching ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </header>

      <section aria-label="Período da análise" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <CalendarDays size={18} className="text-ink-muted" aria-hidden="true" />
          <div><p className="text-micro text-ink-muted">Período da análise</p><p className="text-label font-medium">{diaBR(de)} — {diaBR(ate)}</p></div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
          {[['1', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['custom', 'Personalizado']].map(([v, label]) => <button key={v} onClick={() => preset(v)} aria-pressed={dias === v} className={'min-h-10 rounded-md px-3 text-micro font-medium transition-colors ' + (dias === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink') + ' ' + foco}>{label}</button>)}
        </div>
        {dias === 'custom' && <div className="flex w-full flex-wrap items-center gap-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-micro text-ink-muted">De <input type="date" value={de} onChange={e => { if (e.target.value) { setDe(e.target.value); setCursores([null]) } }} className={'min-h-11 rounded-lg border border-border bg-bg px-3 text-label text-ink ' + foco} /></label>
          <label className="flex items-center gap-2 text-micro text-ink-muted">Até <input type="date" value={ate} onChange={e => { if (e.target.value) { setAte(e.target.value); setCursores([null]) } }} className={'min-h-11 rounded-lg border border-border bg-bg px-3 text-label text-ink ' + foco} /></label>
        </div>}
      </section>
      {invalido && <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-label text-danger">Escolha um intervalo válido de até 366 dias.</p>}
      {leitura.isError && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-label">
        <AlertTriangle size={18} className="shrink-0 text-danger" aria-hidden="true" />
        <p className="flex-1">Não foi possível atualizar. {dados ? 'A leitura abaixo está desatualizada.' : 'Os números ainda não estão disponíveis.'}</p>
        <button onClick={() => leitura.refetch()} disabled={invalido || leitura.isFetching} className={'min-h-11 rounded-lg px-3 font-medium text-danger disabled:opacity-50 ' + foco}>Tentar novamente</button>
      </div>}

      <section aria-label="Indicadores da Ana" className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {cards.map(c => {
          const cobertura = c.cobertura ? dados?.cobertura[c.cobertura] : undefined
          const semMedicao = cobertura?.disponivel === false
          return <button key={c.id} onClick={() => mudarFiltro(c.id)} aria-pressed={filtro === c.id} className={'group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-surface to-surface-2/50 p-5 text-left shadow-sm transition-colors hover:border-border-strong ' + (filtro === c.id ? 'border-accent ring-1 ring-accent/20' : 'border-border') + ' ' + foco}>
            <div className={'absolute inset-y-0 left-0 w-1 ' + c.linha} />
            <div className="mb-5 flex items-center justify-between gap-2">
              <span className="text-label font-medium text-ink-muted">{c.titulo}</span>
              <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' + c.fundo + ' ' + c.cor}><c.icon size={18} aria-hidden="true" /></span>
            </div>
            <p className="text-[40px] font-semibold leading-none tracking-tight tabular-nums sm:text-[44px]">{semMedicao ? '—' : c.valor?.toLocaleString('pt-BR') ?? '—'}</p>
            <p className="mt-3 min-h-8 text-micro leading-relaxed text-ink-muted">{semMedicao ? 'Sem medição neste período' : cobertura?.parcial ? 'Registros comprovados · histórico parcial' : c.texto}</p>
            <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-micro">
              <span className={c.cor}>{filtro === c.id ? 'Filtro selecionado' : 'Ver registros'}</span><ChevronRight size={15} className="text-ink-muted" aria-hidden="true" />
            </div>
          </button>
        })}
      </section>

      <div className="mt-6 grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_292px]">
        <section aria-labelledby="registros-ana" className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-ink-muted"><MessageSquareText size={18} aria-hidden="true" /></span>
              <div><h2 id="registros-ana" className="text-title">{incidentes ? filtro === 'alertas' ? 'Alertas para revisar' : 'Registro de incidentes' : 'Conversas e clientes'}</h2><p className="mt-0.5 text-micro text-ink-muted">{filtro === 'abertos' ? 'Atendimentos ainda sem conclusão comprovada, na situação atual.' : incidentes ? 'Ocorrências registradas no período escolhido.' : 'Acompanhe a necessidade, o responsável e a etapa de cada cliente.'}</p></div>
            </div>
            <div aria-label="Filtrar registros" className="mt-4 flex flex-wrap gap-1.5">{filtros.map(f => <button key={f.id} onClick={() => mudarFiltro(f.id)} aria-pressed={filtro === f.id} className={'inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-micro font-medium transition-colors ' + (filtro === f.id ? 'border-accent/25 bg-accent/10 text-accent' : 'border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink') + ' ' + foco}>
              {f.titulo}{f.id === 'alertas' && dados && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-micro tabular-nums text-ink-muted" title={semMedicaoAlertas ? 'Sem medição neste período' : coberturaAlertas?.parcial ? 'Histórico parcial' : undefined}>{semMedicaoAlertas ? '—' : dados.totais.alertas_revisor.toLocaleString('pt-BR')}</span>}
            </button>)}</div>
          </div>
          {!incidentes && <div className="hidden grid-cols-[minmax(0,1fr)_104px_172px_132px] gap-3 border-b border-border bg-surface-2/50 px-5 py-3 text-micro text-ink-muted xl:grid" aria-hidden="true">
            <span>Cliente / necessidade</span><span>Responsável</span><span>Etapa</span><span className="text-right">Última atividade</span>
          </div>}
          {leitura.isLoading && <div role="status" aria-label="Carregando registros" className="divide-y divide-border">
            {[1, 2, 3, 4].map(i => <div key={i} className="flex items-center gap-4 px-5 py-5 motion-safe:animate-pulse"><span className="h-10 w-10 rounded-xl bg-surface-2" /><div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-surface-2" /><div className="h-3 w-2/3 rounded bg-surface-2" /></div><span className="hidden h-6 w-24 rounded-full bg-surface-2 sm:block" /></div>)}
            <span className="sr-only">Carregando indicadores e registros…</span>
          </div>}
          {dados && <div className="divide-y divide-border">
            {incidentes ? dados.incidentes.map(i => <article key={i.id} className="px-5 py-4">
              <button onClick={() => setDetalhe(detalhe === i.id ? null : i.id)} aria-expanded={detalhe === i.id} aria-controls={'incidente-' + i.id} className={'flex min-h-11 w-full items-start gap-3 rounded-lg text-left ' + foco}>
                <span className={'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' + (filtro === 'alertas' ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger')}><AlertTriangle size={16} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-label font-medium">{i.dados.categoria || (i.tipo === 'alerta_revisor' ? 'Alerta do revisor' : 'Incidente técnico')}<span className="rounded-md bg-surface-2 px-2 py-0.5 text-micro font-normal text-ink-muted">{i.dados.severidade || (i.recuperado ? 'Recuperado' : 'Registrado')}</span></span><span className="mt-1 block text-body text-ink-muted">{i.dados.resumo || 'Consultar registro operacional'}</span><span className="mt-2 block text-micro tabular-nums text-ink-muted">{dataBR(i.ocorrido_em)}</span></span>
                <ChevronDown size={16} aria-hidden="true" className={'mt-2 shrink-0 text-ink-muted transition-transform ' + (detalhe === i.id ? 'rotate-180' : '')} />
              </button>
              {detalhe === i.id && <div id={'incidente-' + i.id} className="ml-11 mt-3 space-y-1 rounded-lg border border-border bg-bg p-3 text-micro text-ink-muted"><p className="break-all"><span className="text-ink">Origem:</span> {i.origem}</p><p className="break-all"><span className="text-ink">Referência:</span> {i.origem_ref}</p><p className="break-all"><span className="text-ink">Chat:</span> {i.chat_id || 'não informado'}</p></div>}
            </article>) : dados.clientes.map(c => <article key={c.cliente_ref} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto] gap-y-2 px-5 py-4 transition-colors hover:bg-surface-2/40 xl:grid-cols-[minmax(0,1fr)_104px_172px_132px] xl:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span className={'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ' + (c.etapa === 'finalizado' ? 'bg-success/10 text-success' : 'bg-surface-2 text-ink-muted')}><UserRound size={19} strokeWidth={1.7} aria-hidden="true" /></span>
                <div className="min-w-0">
                  <p className="break-words text-label font-semibold">{c.conversa_id ? <Link className={'group inline-flex min-h-6 max-w-full items-center gap-1.5 rounded text-ink hover:text-accent ' + foco} to={'/whatsapp?conversa=' + c.conversa_id} aria-label={'Abrir conversa de ' + (c.nome || c.chat_id)}><span className="break-all">{c.nome || c.chat_id}</span><ArrowUpRight size={13} className="shrink-0 text-ink-muted group-hover:text-accent" aria-hidden="true" /></Link> : c.nome || c.chat_id}</p>
                  <p className="mt-1 line-clamp-2 text-micro leading-relaxed text-ink-muted" title={c.necessidade || undefined}>{c.necessidade || 'Necessidade em identificação'}</p>
                  {c.identidade_pendente && <p className="mt-1 inline-flex items-center gap-1 text-micro text-ink-muted" title="Vínculo com o contato do CRM pendente."><Link2 size={11} aria-hidden="true" /> Contato a vincular</p>}
                </div>
              </div>
              <div className="sm:col-start-1 sm:row-start-2 flex items-center gap-1.5 pl-[52px] text-micro font-medium text-ink-muted xl:col-auto xl:row-auto xl:pl-0">
                {c.vendedor === 'ANA' ? <Bot size={13} aria-hidden="true" /> : <UserRound size={13} aria-hidden="true" />}<span className="break-words">{c.vendedor || 'A definir'}</span>
              </div>
              <div className="pl-[52px] sm:pl-0 sm:col-start-2 sm:row-start-1 sm:max-w-[150px] sm:text-right xl:col-auto xl:row-auto xl:max-w-none xl:text-left"><span className={'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-micro leading-snug ' + (coresEtapa[c.etapa] || 'border-border bg-surface-2 text-ink-muted')}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />{etapas[c.etapa] || c.etapa}</span></div>
              <p className="pl-[52px] sm:pl-0 sm:col-start-2 sm:row-start-2 sm:text-right text-micro leading-relaxed tabular-nums text-ink-muted xl:col-auto xl:row-auto">{dataBR(c.ultima_atividade)}</p>
              {c.pendencia && <p className="col-span-full flex items-start gap-1.5 rounded-lg bg-warning/5 px-3 py-2 text-micro leading-relaxed text-warning xl:ml-[52px]"><Clock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{c.pendencia}</p>}
            </article>)}
            {vazio && <div className="flex flex-col items-center px-6 py-12 text-center">
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted"><MessageSquareText size={26} strokeWidth={1.5} aria-hidden="true" /></span>
              <p className="text-title">Nenhum registro neste filtro</p><p className="mt-2 max-w-sm text-body text-ink-muted">{parcial ? 'O histórico deste período é parcial. Veja a cobertura dos dados para entender o que já está sendo medido.' : 'Escolha outro período ou filtro para consultar os registros.'}</p>
            </div>}
          </div>}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
            <span className="text-micro text-ink-muted">Página <span className="font-medium tabular-nums text-ink">{cursores.length}</span></span>
            <div className="flex w-full gap-2 sm:w-auto">
              <button disabled={cursores.length === 1} onClick={() => setCursores(c => c.slice(0, -1))} className={'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 sm:flex-none text-micro font-medium transition-colors hover:bg-surface-2 disabled:opacity-40 ' + foco}><ArrowLeft size={13} aria-hidden="true" /> Anterior</button>
              <button disabled={!dados?.proximo_cursor || leitura.isFetching} onClick={() => { if (dados?.proximo_cursor) setCursores(c => [...c, dados.proximo_cursor]) }} className={'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 sm:flex-none text-micro font-medium transition-colors hover:bg-surface-2 disabled:opacity-40 ' + foco}>Próxima <ChevronRight size={13} aria-hidden="true" /></button>
            </div>
          </footer>
        </section>

        <aside aria-label="Revisão e cobertura dos dados" className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-label font-semibold"><ClipboardCheck size={18} className="text-warning" aria-hidden="true" /><h2>Revisão de qualidade</h2></div>
            <p className="text-[32px] font-semibold leading-none tracking-tight tabular-nums">{semMedicaoAlertas ? '—' : dados?.totais.alertas_revisor.toLocaleString('pt-BR') ?? '—'} <span className="text-micro font-normal tracking-normal text-ink-muted">alertas no período</span></p>
            {(semMedicaoAlertas || coberturaAlertas?.parcial) && <p className="mt-2 text-micro text-warning">{semMedicaoAlertas ? 'Sem medição neste período' : 'Registros comprovados · histórico parcial'}</p>}
            <p className="mt-3 text-body leading-relaxed text-ink-muted">Apontamentos do revisor para conferir o atendimento. São separados dos erros técnicos.</p>
            <button onClick={() => mudarFiltro('alertas')} className={'mt-5 flex min-h-11 w-full items-center justify-between rounded-lg border border-warning/25 bg-warning/5 px-3 text-label font-medium text-warning transition-colors hover:bg-warning/10 ' + foco}>Revisar alertas <ChevronRight size={15} aria-hidden="true" /></button>
          </section>
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-label font-semibold"><Info size={18} className="text-ink-muted" aria-hidden="true" /><h2>Sobre os dados</h2></div>
            {parcial && <div className="mb-4 rounded-xl border border-warning/20 bg-warning/5 p-3">
              <p className="flex items-center gap-1.5 text-micro font-semibold text-warning"><AlertTriangle size={13} aria-hidden="true" /> Histórico parcial</p>
              <p className="mt-2 text-micro leading-relaxed text-ink-muted">A captura começou na ativação. Registros anteriores podem estar incompletos, inclusive quando o número é zero.</p>
            </div>}
            <ul className="space-y-3 text-micro leading-relaxed text-ink-muted">
              <li className="flex gap-2"><Users size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Atendidos, qualificados e não finalizados contam clientes únicos. Erros e alertas contam ocorrências.</span></li>
              <li className="flex gap-2"><Clock size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong className="font-medium text-ink">Não finalizados agora</strong> mostra a situação atual, independente do período.</span></li>
              <li className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Concluir a etapa da Ana não significa concluir a venda.</span></li>
            </ul>
            {dados && <details className="group mt-4 border-t border-border pt-4">
              <summary className={'flex min-h-8 cursor-pointer list-none items-center justify-between rounded text-micro font-medium text-ink [&::-webkit-details-marker]:hidden ' + foco}>Cobertura por indicador <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
              <div className="mt-3 space-y-3">{Object.entries(dados.cobertura).map(([id, c]) => <div key={id} className="rounded-lg bg-bg p-3 text-micro leading-relaxed"><p className="font-medium text-ink">{indicadores[id] || id.replaceAll('_', ' ')}</p><p className="mt-1 text-ink-muted">Desde {dataBR(c.inicio)}</p><p className="mt-1 text-ink-muted">{c.observacao}</p></div>)}</div>
            </details>}
          </section>
        </aside>
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-micro text-ink-muted"><RefreshCw size={12} aria-hidden="true" /> Atualização automática a cada 30 segundos enquanto a página estiver visível.</p>
    </div>
  </div>
}
