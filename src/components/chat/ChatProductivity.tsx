import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, X } from 'lucide-react'
import { displayMessageBody } from '@/lib/atendimento-chat'
import { followUpIso, followUpState, localDateTime, waitingTime } from '@/lib/chat-productivity'
import type { ChatSales } from '@/hooks/useAtendimentoChat'

export function ChatReplyPreview({preview,author,onCancel,disabled=false}:{preview?:string|null;author?:string|null;onCancel?:()=>void;disabled?:boolean}) {
  return <blockquote aria-label="Mensagem citada" className="mb-2 flex min-w-0 items-start gap-2 rounded-lg border-l-2 border-accent bg-accent/5 px-3 py-2 text-xs">
    <div className="min-w-0 flex-1"><p className="font-medium text-accent">{author?.trim()||'Mensagem citada'}</p><p className="mt-1 line-clamp-2 break-words text-ink-muted">{displayMessageBody(preview??null)||'Mídia'}</p></div>
    {onCancel&&<button type="button" aria-label="Cancelar citação" disabled={disabled} onClick={onCancel} className="rounded p-1 disabled:opacity-40"><X size={14}/></button>}
  </blockquote>
}
const field='w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/30'
const button='rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-40'
export function ChatFollowUp({dueAt,now,disabled,onSave,onDone}:{dueAt:string|null|undefined;now:number;disabled:boolean;onSave:(due:string|null)=>Promise<boolean>;onDone:()=>Promise<boolean>}) {
  const initial=()=>localDateTime(dueAt||new Date(Date.now()+3600000).toISOString())
  const [value,setValue]=useState(initial),[error,setError]=useState('')
  useEffect(()=>{setValue(initial());setError('')},[dueAt])
  const state=followUpState(dueAt,now)
  return <section aria-label="Retorno interno" className="space-y-2">
    <h3 className="flex items-center gap-2 text-xs font-medium text-ink-muted"><CalendarClock size={14}/>Retorno interno</h3>
    {dueAt&&<p role={state==='overdue'?'status':undefined} className={state==='overdue'?'text-xs font-medium text-amber-500':'text-xs text-ink'}>{state==='overdue'?`Atrasado há ${waitingTime(dueAt,now)}`:'Agendado'} · {new Date(dueAt).toLocaleString('pt-BR')}</p>}
    <form className="space-y-2" onSubmit={async e=>{e.preventDefault();const due=followUpIso(value);if(!due){setError('Escolha uma data e hora válidas no futuro.');return}setError('');await onSave(due)}}>
      <label className="block text-xs text-ink-muted">Data e hora local<input aria-label="Data e hora do retorno" type="datetime-local" className={`${field} mt-1`} value={value} disabled={disabled} onChange={e=>setValue(e.target.value)}/></label>
      <button type="submit" className={`${button} w-full`} disabled={disabled||!value}>{dueAt?'Atualizar retorno':'Agendar retorno'}</button>
    </form>
    {dueAt&&<div className="flex gap-2"><button type="button" className={`${button} flex-1`} disabled={disabled} onClick={()=>void onDone()}>Concluir</button><button type="button" className={`${button} flex-1`} disabled={disabled} onClick={()=>void onSave(null)}>Cancelar retorno</button></div>}
    {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
    <p className="text-[10px] text-ink-faint">Lembrete interno no seu horário local. Não envia mensagens.</p>
  </section>
}
const currency=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const route=(href:string|null):href is string=>!!href&&(href.startsWith('/controle/pedidos/')||/^\/orcamentos\/(lista|salvos|montar)(\?|$)/.test(href))
export function ChatSalesPanel({data,loading,error,onRetry}:{data?:ChatSales;loading:boolean;error?:string;onRetry:()=>void}) {
  return <section aria-label="Pedidos e orçamentos" className="space-y-2">
    <h3 className="text-xs font-medium text-ink-muted">Pedidos e orçamentos</h3>
    {loading&&<p className="text-xs text-ink-muted">Carregando vínculos do cliente…</p>}
    {error&&<div role="alert" className="text-xs text-danger">{error}<button type="button" className={`${button} mt-2`} onClick={onRetry}>Tentar novamente</button></div>}
    {!loading&&!error&&data&&!data.orders.length&&!data.quotes.length&&<p className="text-xs text-ink-muted">Nenhum pedido ou orçamento vinculado a este contato.</p>}
    {data?.orders.map(order=><div key={order.id} className="rounded-lg border border-border p-2 text-xs">{route(order.href)?<Link to={order.href} className="font-medium text-accent underline">Pedido {order.number}</Link>:<span>Pedido {order.number}</span>}<p className="mt-1 text-ink-muted">{order.status||'Situação não informada'}{order.total!==null&&` · ${currency(order.total)}`}</p></div>)}
    {data?.quotes.map(quote=><div key={quote.id} className="rounded-lg border border-border p-2 text-xs">{route(quote.href)?<Link to={quote.href} className="font-medium text-accent underline">Orçamento {quote.number}/{quote.year}</Link>:<span>Orçamento {quote.number}/{quote.year}</span>}<p className="mt-1 text-ink-muted">{quote.status||'Situação não informada'}</p></div>)}
  </section>
}
