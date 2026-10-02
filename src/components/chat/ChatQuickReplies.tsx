import { useState } from 'react'
import { ChevronDown, MessageSquare, Plus, Trash2 } from 'lucide-react'

interface QuickReply {id:string;title:string;body:string}
interface ReplyStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const key=(user:string)=>`crm-chat-quick-replies:${user}`
const defaults:QuickReply[]=[
  {id:'greeting',title:'Cumprimentar',body:'Olá! Tudo bem? Como posso ajudar você hoje?'},
  {id:'proposal',title:'Enviar proposta',body:'Vou preparar sua proposta. Pode me confirmar o que você precisa?'},
  {id:'follow-up',title:'Retomar contato',body:'Olá! Conseguiu conferir nossa proposta? Fico à disposição para tirar suas dúvidas.'},
]
export function readQuickReplies(storage:Pick<ReplyStorage,'getItem'>,user:string):QuickReply[] {
  try {
    const raw=storage.getItem(key(user));if(!raw)return defaults.map(r=>({...r}))
    const rows=JSON.parse(raw);if(!Array.isArray(rows))return defaults.map(r=>({...r}))
    return rows.filter((r):r is QuickReply=>r&&typeof r.id==='string'&&typeof r.title==='string'&&typeof r.body==='string'&&r.title.trim()&&r.title.length<=60&&r.body.trim()&&r.body.length<=4000).slice(0,20)
  } catch{return defaults.map(r=>({...r}))}
}
export function saveQuickReplies(storage:ReplyStorage,user:string,rows:QuickReply[]){storage.setItem(key(user),JSON.stringify(rows))}

export function ChatQuickReplies({userId,disabled,onSelect}:{userId:string;disabled:boolean;onSelect:(body:string)=>void}) {
  const [replies,setReplies]=useState(()=>{try{return typeof window==='undefined'?defaults:readQuickReplies(localStorage,userId)}catch{return defaults}})
  const [adding,setAdding]=useState(false),[title,setTitle]=useState(''),[body,setBody]=useState(''),[error,setError]=useState('')
  function persist(next:QuickReply[]){try{saveQuickReplies(localStorage,userId,next);setReplies(next);setError('');return true}catch{setError('Não foi possível salvar neste navegador.');return false}}
  return <details className="relative min-w-0">
    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-2"><MessageSquare size={14}/>Respostas rápidas<ChevronDown size={13}/></summary>
    <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(340px,calc(100vw-3rem))] max-h-96 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-xl">
      <p className="mb-2 text-[11px] text-ink-muted">Suas respostas neste navegador. Escolha para revisar no campo antes de enviar.</p>
      <div className="space-y-1">{replies.map(reply=><div key={reply.id} className="flex gap-1 rounded-lg hover:bg-surface-2"><button type="button" disabled={disabled} onClick={e=>{onSelect(reply.body);e.currentTarget.closest('details')?.removeAttribute('open')}} className="min-w-0 flex-1 p-2 text-left disabled:opacity-40"><span className="block text-xs font-medium">{reply.title}</span><span className="mt-1 block truncate text-[11px] text-ink-muted">{reply.body}</span></button><button type="button" aria-label={`Excluir resposta ${reply.title}`} onClick={()=>persist(replies.filter(r=>r.id!==reply.id))} className="self-start rounded-lg p-2 text-ink-faint hover:text-danger"><Trash2 size={14}/></button></div>)}</div>
      {!replies.length&&<p className="p-2 text-xs text-ink-muted">Nenhuma resposta salva.</p>}
      {!adding?<button type="button" disabled={replies.length>=20} onClick={()=>setAdding(true)} className="mt-2 inline-flex items-center gap-2 rounded-lg p-2 text-xs text-accent disabled:opacity-40"><Plus size={14}/>Criar resposta {replies.length>=20&&'(limite de 20)'}</button>:
        <form className="mt-3 space-y-2 border-t border-border pt-3" onSubmit={e=>{e.preventDefault();if(!title.trim()||!body.trim())return;if(persist([...replies,{id:crypto.randomUUID(),title:title.trim(),body:body.trim()}])){setAdding(false);setTitle('');setBody('')}}}>
          <label className="block text-xs">Título<input autoFocus aria-label="Título da resposta rápida" maxLength={60} value={title} onChange={e=>setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2" placeholder="Ex.: Prazo de entrega"/></label>
          <label className="block text-xs">Mensagem<textarea aria-label="Texto da resposta rápida" maxLength={4000} rows={3} value={body} onChange={e=>setBody(e.target.value)} className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-2 py-2"/></label>
          <div className="flex gap-2"><button type="submit" disabled={!title.trim()||!body.trim()} className="rounded-lg bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">Salvar resposta</button><button type="button" onClick={()=>setAdding(false)} className="rounded-lg px-3 py-2 text-xs">Cancelar</button></div>
        </form>}
      {error&&<p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  </details>
}
