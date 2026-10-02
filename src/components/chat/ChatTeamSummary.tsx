import { useQuery } from '@tanstack/react-query'
import { AlarmClock, CheckCircle2, Clock, Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { chatRpc } from '@/hooks/useAtendimentoChat'
import { responseTimeLabel, type ChatTeamSummaryData } from '@/lib/chat-team'

export function ChatTeamSummary({vendor,isAdmin,onSelectQueue,onSelectUnassigned}:{vendor:string;isAdmin:boolean;onSelectQueue:(queue:'all'|'waiting'|'overdue')=>void;onSelectUnassigned:()=>void}) {
  const {profile}=useAuth()
  const summary=useQuery({
    queryKey:['crm-chat',profile?.id,profile?.role,profile?.vendor_id,'summary',vendor],
    enabled:!!profile?.approved_at&&['admin','vendor'].includes(profile.role),
    queryFn:()=>chatRpc<ChatTeamSummaryData>('summary',{vendor}),refetchInterval:60000,retry:1,
  })
  const data=summary.data
  if(summary.isError)return <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-xs text-ink-muted">Não foi possível carregar o resumo.<button className="text-accent" onClick={()=>summary.refetch()}>Tentar novamente</button></div>
  const card='flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-surface-2 disabled:opacity-50'
  return <div aria-label="Resumo dos atendimentos" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-1">
    <button className={card} disabled={!data} onClick={()=>onSelectQueue('waiting')}><Clock size={15} className="text-accent"/><span>Aguardando resposta <strong className="ml-1 text-ink">{data?.waiting??'—'}</strong></span></button>
    <button className={card} disabled={!data} onClick={()=>onSelectQueue('overdue')}><AlarmClock size={15} className="text-amber-500"/><span>Retornos vencidos <strong className="ml-1 text-ink">{data?.overdue??'—'}</strong></span></button>
    {isAdmin&&<button className={card} disabled={!data} onClick={onSelectUnassigned}><Users size={15} className="text-ink-muted"/><span>Sem responsável <strong className="ml-1 text-ink">{data?.unassigned??'—'}</strong></span></button>}
    <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-ink-muted"><CheckCircle2 size={15}/><span>Finalizados hoje <strong className="ml-1 text-ink">{data?.resolved_today??'—'}</strong></span></div>
    <div className="ml-auto shrink-0 px-3 py-2 text-[11px] text-ink-muted" title={data?.metrics_since?`Respostas enviadas pelo CRM e confirmadas hoje. Registro iniciado em ${new Date(data.metrics_since).toLocaleDateString('pt-BR')}.`:undefined}>
      {data&&data.average_response_seconds!==null?<span>Resposta média hoje: <strong className="text-ink">{responseTimeLabel(data.average_response_seconds)}</strong> · {data.response_samples} {data.response_samples===1?'amostra':'amostras'}</span>:<span>{data?'Sem amostras de resposta hoje':'Carregando resumo…'}</span>}
    </div>
  </div>
}
