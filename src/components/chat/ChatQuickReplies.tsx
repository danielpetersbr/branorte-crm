import { useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { chatRpc } from '@/hooks/useAtendimentoChat'
import { defaultQuickReplies, readQuickReplies, saveQuickReplies, type QuickReply } from '@/lib/chat-quick-replies'
import type { TeamQuickReply } from '@/lib/chat-team'
export { readQuickReplies, saveQuickReplies } from '@/lib/chat-quick-replies'

export function ChatQuickReplies({userId,disabled,onSelect,isAdmin=false}:{userId:string;disabled:boolean;onSelect:(body:string)=>void;isAdmin?:boolean}) {
  const {profile}=useAuth(),qc=useQueryClient()
  const queryKey=['crm-chat',profile?.id,profile?.role,profile?.vendor_id,'quick-replies']
  const team=useQuery({queryKey,enabled:profile?.id===userId&&!!profile?.approved_at&&['admin','vendor'].includes(profile.role),queryFn:()=>chatRpc<TeamQuickReply[]>('quick_replies'),refetchInterval:60000,retry:1})
  const mutation=useMutation({mutationFn:({action,...args}:{action:'quick_reply_save'|'quick_reply_delete';reply_id?:string;title?:string;body?:string})=>chatRpc(action,args),onSuccess:()=>qc.invalidateQueries({queryKey})})
  const [replies,setReplies]=useState(()=>{try{return typeof window==='undefined'?defaultQuickReplies:readQuickReplies(localStorage,userId)}catch{return defaultQuickReplies}})
  const [mode,setMode]=useState<'personal'|'team'>('personal')
  const [open,setOpen]=useState(false)
  const insertedReply=useRef(false)
  const [adding,setAdding]=useState(false),[editing,setEditing]=useState<string|null>(null),[title,setTitle]=useState(''),[body,setBody]=useState(''),[error,setError]=useState('')
  function persist(next:QuickReply[]){try{saveQuickReplies(localStorage,userId,next);setReplies(next);setError('');return true}catch{setError('Não foi possível salvar neste navegador.');return false}}
  function closeForm(){setAdding(false);setEditing(null);setTitle('');setBody('');setError('')}
  const rows=mode==='team'?(team.data??[]):replies
  const mayEdit=mode==='personal'||(isAdmin&&profile?.role==='admin')
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button type="button" aria-label="Respostas rápidas" title="Respostas rápidas" className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted hover:bg-surface-2 data-[state=open]:bg-accent/10 data-[state=open]:text-accent"><Zap size={18}/></button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="top" align="end" sideOffset={8} collisionPadding={12} aria-label="Respostas rápidas" onCloseAutoFocus={e=>{if(insertedReply.current){e.preventDefault();insertedReply.current=false}}} className="z-50 w-[340px] max-w-[calc(100vw-24px)] max-h-[min(24rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-xl border border-border bg-surface p-3 text-ink shadow-xl">
      <div className="mb-2 flex gap-1" role="group" aria-label="Tipo de resposta rápida">{([{id:'personal',label:'Pessoais'},{id:'team',label:'Equipe'}] as const).map(tab=><button key={tab.id} type="button" aria-pressed={mode===tab.id} disabled={mutation.isPending} className={`rounded-lg px-3 py-1.5 text-xs ${mode===tab.id?'bg-accent/10 text-accent':'text-ink-muted hover:bg-surface-2'}`} onClick={()=>{closeForm();setMode(tab.id)}}>{tab.label}</button>)}</div>
      <p className="mb-2 text-[11px] text-ink-muted">{mode==='team'?'Mensagens compartilhadas com a equipe.':'Suas respostas neste navegador.'} Escolha para revisar no campo antes de enviar.</p>
      {mode==='team'&&team.isPending&&<p className="p-2 text-xs text-ink-muted">Carregando respostas da equipe…</p>}
      {mode==='team'&&team.isError&&<p role="alert" className="p-2 text-xs text-danger">Não foi possível carregar as respostas. <button type="button" className="text-accent" onClick={()=>team.refetch()}>Tentar novamente</button></p>}
      <div className="space-y-1">{rows.map(reply=><div key={reply.id} className="flex gap-1 rounded-lg hover:bg-surface-2"><button type="button" disabled={disabled} onClick={()=>{insertedReply.current=true;setOpen(false);onSelect(reply.body)}} className="min-w-0 flex-1 p-2 text-left disabled:opacity-40"><span className="block text-xs font-medium">{reply.title}</span><span className="mt-1 block truncate text-[11px] text-ink-muted">{reply.body}</span></button>{mayEdit&&<>
        {mode==='team'&&<button type="button" disabled={mutation.isPending} aria-label={`Editar resposta ${reply.title}`} onClick={()=>{setEditing(reply.id);setTitle(reply.title);setBody(reply.body);setAdding(true);setError('')}} className="self-start rounded-lg p-2 text-ink-faint hover:text-accent"><Pencil size={14}/></button>}
        <button type="button" disabled={mutation.isPending} aria-label={`Excluir resposta ${reply.title}`} onClick={async()=>{if(mode==='personal'){persist(replies.filter(r=>r.id!==reply.id));return}try{await mutation.mutateAsync({action:'quick_reply_delete',reply_id:reply.id});if(editing===reply.id)closeForm()}catch(e){setError((e as Error).message)}}} className="self-start rounded-lg p-2 text-ink-faint hover:text-danger"><Trash2 size={14}/></button>
      </>}</div>)}</div>
      {!rows.length&&(mode==='personal'||team.isSuccess)&&<p className="p-2 text-xs text-ink-muted">Nenhuma resposta salva.</p>}
      {!adding&&mayEdit?<button type="button" disabled={rows.length>=(mode==='team'?100:20)||mutation.isPending} onClick={()=>{closeForm();setAdding(true)}} className="mt-2 inline-flex items-center gap-2 rounded-lg p-2 text-xs text-accent disabled:opacity-40"><Plus size={14}/>Criar resposta {rows.length>=(mode==='team'?100:20)&&`(limite de ${mode==='team'?100:20})`}</button>:adding&&mayEdit?
        <form className="mt-3 space-y-2 border-t border-border pt-3" onSubmit={async e=>{e.preventDefault();if(!title.trim()||!body.trim()||mutation.isPending)return;if(mode==='personal'){if(persist([...replies,{id:crypto.randomUUID(),title:title.trim(),body:body.trim()}]))closeForm();return}try{await mutation.mutateAsync({action:'quick_reply_save',reply_id:editing??undefined,title:title.trim(),body:body.trim()});closeForm()}catch(e){setError((e as Error).message)}}}>
          <label className="block text-xs">Título<input autoFocus aria-label="Título da resposta rápida" maxLength={60} value={title} onChange={e=>setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2" placeholder="Ex.: Prazo de entrega"/></label>
          <label className="block text-xs">Mensagem<textarea aria-label="Texto da resposta rápida" maxLength={4000} rows={3} value={body} onChange={e=>setBody(e.target.value)} className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-2 py-2"/></label>
          <div className="flex gap-2"><button type="submit" disabled={!title.trim()||!body.trim()||mutation.isPending} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{mutation.isPending&&<Loader2 size={13} className="animate-spin"/>}Salvar resposta</button><button type="button" disabled={mutation.isPending} onClick={closeForm} className="rounded-lg px-3 py-2 text-xs">Cancelar</button></div>
        </form>:null}
      {error&&<p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
