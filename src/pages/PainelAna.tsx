import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, RefreshCw, Users, CheckCircle2, AlertTriangle, Clock, ArrowLeft } from 'lucide-react'
import { usePainelAna } from '@/hooks/usePainelAna'
import { useAuth } from '@/hooks/useAuth'
import type { FiltroAna } from '@/types/painel-ana'

const dataBR = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro'
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const somarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const etapas: Record<string, string> = { atendendo: 'Ana atendendo', aguardando_orientacao: 'Espera de orientação', repasse_pendente: 'Repasse pendente', pausado: 'Pausa humana', bloqueado: 'Bloqueado', inconclusivo: 'Conclusão não comprovada', finalizado: 'Etapa da Ana concluída' }
const filtros: { id: FiltroAna; titulo: string }[] = [{ id: 'todos', titulo: 'Clientes' }, { id: 'abertos', titulo: 'Não finalizados agora' }, { id: 'atendidos', titulo: 'Atendidos no período' }, { id: 'qualificados', titulo: 'Qualificados no período' }, { id: 'erros', titulo: 'Erros técnicos' }, { id: 'alertas', titulo: 'Alertas para revisar' }]

export function PainelAna() {
  const { profile } = useAuth()
  const [dias, setDias] = useState('7')
  const [de, setDe] = useState(() => somarDias(hojeBR(), -6))
  const [ate, setAte] = useState(hojeBR)
  const [filtro, setFiltro] = useState<FiltroAna>('todos')
  const [cursores, setCursores] = useState<(string | null)[]>([null])
  const [detalhe, setDetalhe] = useState<string | null>(null)
  const periodo = useMemo(() => ({ inicio: new Date(`${de}T00:00:00-03:00`).toISOString(), fim: new Date(`${somarDias(ate, 1)}T00:00:00-03:00`).toISOString() }), [de, ate])
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
    { id: 'atendidos' as const, cobertura: 'atendidos', titulo: 'Clientes atendidos', valor: dados?.totais.atendidos, icon: Users, texto: 'Resposta da Ana com envio confirmado' },
    { id: 'qualificados' as const, cobertura: 'qualificados', titulo: 'Clientes qualificados', valor: dados?.totais.qualificados, icon: CheckCircle2, texto: 'Critérios de qualificação validados' },
    { id: 'erros' as const, cobertura: 'erros_tecnicos', titulo: 'Erros técnicos', valor: dados?.totais.erros_tecnicos, icon: AlertTriangle, texto: 'Incidentes, incluindo os recuperados' },
    { id: 'abertos' as const, cobertura: null, titulo: 'Não finalizados agora', valor: dados?.totais.nao_finalizados_agora, icon: Clock, texto: 'Situação atual, independente do período' },
  ]
  return <div className="min-h-screen bg-bg px-4 sm:px-6 py-6 text-ink">
    <Link to="/ia-atendente" className="text-sm text-ink-muted inline-flex gap-1 items-center mb-4"><ArrowLeft size={14} /> IA Atendente</Link>
    <div className="flex flex-wrap gap-3 justify-between items-start mb-5">
      <div><h1 className="text-xl font-semibold flex items-center gap-2"><Bot className="text-accent" /> Painel da Ana</h1>
        <p className="text-sm text-ink-muted mt-1">Atendimento, qualificação e pendências com evidência de cada etapa.</p>
        <p className="text-xs text-ink-muted mt-1">Última leitura: {dados ? dataBR(dados.gerado_em) : 'aguardando'} · Horário de São Paulo</p></div>
      <button onClick={() => leitura.refetch()} disabled={leitura.isFetching || invalido} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-50"><RefreshCw size={15} className={leitura.isFetching ? 'animate-spin' : ''} /> Atualizar</button>
    </div>
    <div className="flex flex-wrap gap-2 mb-5 items-center">
      {[['1', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['custom', 'Escolher período']].map(([v, label]) => <button key={v} onClick={() => preset(v)} className={`rounded-md border px-3 py-2 text-xs ${dias === v ? 'border-accent text-accent bg-surface' : 'border-border bg-surface text-ink-muted'}`}>{label}</button>)}
      {dias === 'custom' && <><input aria-label="Data inicial" type="date" value={de} onChange={e => { if(e.target.value) { setDe(e.target.value); setCursores([null]) } }} className="bg-surface border border-border rounded p-2 text-xs" /><span>até</span><input aria-label="Data final" type="date" value={ate} onChange={e => { if(e.target.value) { setAte(e.target.value); setCursores([null]) } }} className="bg-surface border border-border rounded p-2 text-xs" /></>}
    </div>
    {invalido && <p role="alert" className="mb-4 text-red-500">Escolha um intervalo válido de até 366 dias.</p>}
    {leitura.isError && <p role="alert" className="mb-4 border border-red-400 rounded-lg p-3 text-sm">Não foi possível atualizar. {dados ? 'A leitura abaixo está desatualizada.' : 'Os números ainda não estão disponíveis.'} <button onClick={() => leitura.refetch()} className="underline">Tentar novamente</button></p>}
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
      {cards.map(c => { const cobertura=c.cobertura ? dados?.cobertura[c.cobertura] : undefined; const semMedicao=cobertura?.disponivel===false; return <button key={c.id} onClick={() => mudarFiltro(c.id)} className={`text-left bg-surface rounded-xl border p-4 ${filtro === c.id ? 'border-accent' : 'border-border'}`}><div className="flex justify-between text-ink-muted"><span className="text-xs font-medium">{c.titulo}</span><c.icon size={17} /></div><p className="text-3xl font-semibold my-3">{semMedicao ? '—' : c.valor?.toLocaleString('pt-BR') ?? '—'}</p><p className="text-xs text-ink-muted">{semMedicao ? 'Sem medição neste período' : cobertura?.parcial ? 'Registros comprovados · cobertura parcial' : c.texto}</p></button> })}
    </div>
    {dados && Object.values(dados.cobertura).some(c => c.incompleta) && <div className="mt-4 p-3 border border-amber-500/40 bg-amber-500/5 rounded-lg text-xs"><strong>Cobertura parcial no período.</strong> As métricas novas começam na ativação da captura. Números anteriores podem estar incompletos, inclusive quando aparecem como zero.<details className="mt-2"><summary className="cursor-pointer">Ver cobertura por indicador</summary>{Object.entries(dados.cobertura).map(([id,c]) => <p key={id} className="mt-2"><strong>{id.replaceAll('_',' ')}</strong>: desde {dataBR(c.inicio)}. {c.observacao}</p>)}</details></div>}
    <p className="text-xs text-ink-muted mt-3">Um cliente pode aparecer em vários indicadores. Concluir a etapa da Ana não significa concluir a venda.</p>
    <div className="mt-6 flex flex-wrap gap-2">{filtros.map(f => <button key={f.id} onClick={() => mudarFiltro(f.id)} className={`rounded-md border px-3 py-2 text-xs ${filtro === f.id ? 'border-accent text-accent' : 'border-border text-ink-muted'}`}>{f.titulo}{f.id === 'alertas' && dados ? ` (${dados.totais.alertas_revisor})` : ''}</button>)}</div>
    {leitura.isLoading && <p className="p-8 text-center text-sm text-ink-muted">Carregando indicadores…</p>}
    {dados && <div className="mt-4 space-y-2">
      {(filtro === 'erros' || filtro === 'alertas') ? dados.incidentes.map(i => <article key={i.id} className="p-4 bg-surface border border-border rounded-lg"><button className="w-full text-left flex flex-wrap justify-between gap-2" onClick={() => setDetalhe(detalhe === i.id ? null : i.id)}><span className="font-medium text-sm">{i.dados.categoria || i.tipo} · {i.dados.severidade || (i.recuperado ? 'Recuperado' : 'Registrado')}</span><span className="text-xs text-ink-muted">{dataBR(i.ocorrido_em)}</span></button><p className="mt-2 text-sm text-ink-muted">{i.dados.resumo || 'Consultar registro operacional'}</p>{detalhe === i.id && <p className="mt-3 text-xs break-all">Origem: {i.origem} · Referência: {i.origem_ref} · Chat: {i.chat_id || 'não informado'}</p>}</article>) : dados.clientes.map(c => <article key={c.cliente_ref} className="p-4 bg-surface border border-border rounded-lg"><div className="flex flex-wrap gap-2 justify-between"><span className="font-medium text-sm break-all">{c.conversa_id ? <Link className="underline hover:text-accent" to={`/whatsapp?conversa=${c.conversa_id}`}>{c.nome || c.chat_id}</Link> : c.nome || c.chat_id}</span><span className="text-xs rounded-full bg-surface-2 px-2 py-1">{etapas[c.etapa] || c.etapa}</span></div><div className="text-xs text-ink-muted mt-2 flex flex-wrap gap-x-5 gap-y-1"><span>{c.necessidade || 'Necessidade em identificação'}</span><span>Responsável: {c.vendedor || 'a definir'}</span><span>{dataBR(c.ultima_atividade)}</span></div>{c.pendencia && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{c.pendencia}</p>}{c.identidade_pendente && <p className="mt-1 text-xs text-ink-muted">Vínculo com o contato do CRM pendente.</p>}</article>)}
      {((filtro === 'erros' || filtro === 'alertas') ? dados.incidentes : dados.clientes).length === 0 && <p className="p-8 text-center text-sm text-ink-muted">Nenhum registro disponível para este filtro.{Object.values(dados.cobertura).some(c => c.incompleta) ? ' Consulte a cobertura acima.' : ''}</p>}
    </div>}
    <div className="flex justify-between items-center mt-4"><button disabled={cursores.length === 1} onClick={() => setCursores(c => c.slice(0,-1))} className="border border-border rounded px-3 py-2 text-xs disabled:opacity-30">Anterior</button><span className="text-xs text-ink-muted">Página {cursores.length}</span><button disabled={!dados?.proximo_cursor || leitura.isFetching} onClick={() => { if(dados?.proximo_cursor) setCursores(c => [...c,dados.proximo_cursor]) }} className="border border-border rounded px-3 py-2 text-xs disabled:opacity-30">Próxima</button></div>
  </div>
}
