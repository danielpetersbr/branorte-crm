import { useEffect, useId, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { chatRpc } from '@/hooks/useAtendimentoChat'
import { ChatCloseContext, chatCloseReason, type ChatCloseReason } from '@/lib/chat-close'

export interface ChatCloseDialogProps {
  conversationId:string;
  conversationName:string;
  userIdentity:string;
  open:boolean;
  onOpenChange:(open:boolean)=>void;
  onCloseAutoFocus?:()=>void;
  onConfirm:(reasonId:string,blockAutomation:boolean)=>Promise<boolean>;
}

export function ChatCloseDialog({conversationId,conversationName,userIdentity,open,onOpenChange,onCloseAutoFocus,onConfirm}:ChatCloseDialogProps) {
  const options=useQuery({queryKey:['crm-chat-close-options',userIdentity,conversationId],enabled:open,
    queryFn:()=>chatRpc<{reasons:ChatCloseReason[]}>('close_options',{id:conversationId}),retry:1})
  const [selection,setSelection]=useState<{token:number;id:string}|null>(null),[automation,setAutomation]=useState<{token:number;blocked:boolean}|null>(null),[pending,setPending]=useState(false),[failureState,setFailureState]=useState<{token:number;message:string}|null>(null)
  const context=useRef(new ChatCloseContext()),pendingToken=useRef<number|null>(null),mounted=useRef(true)
  const previous=useRef({conversationId,userIdentity}),changeOpen=useRef(onOpenChange)
  changeOpen.current=onOpenChange
  const token=context.current.update(conversationId,userIdentity,open)
  const reasonId=selection?.token===token?selection.id:'',blockAutomation=automation?.token===token?automation.blocked:false,error=failureState?.token===token?failureState.message:''
  const reason=chatCloseReason(options.data?.reasons,reasonId)
  const busy=pending&&pendingToken.current===token
  const selectId=useId(),checkboxId=useId()
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{
    const changed=previous.current.conversationId!==conversationId||previous.current.userIdentity!==userIdentity
    previous.current={conversationId,userIdentity};pendingToken.current=null
    setSelection(null);setAutomation(null);setFailureState(null);setPending(false)
    if(changed&&open)changeOpen.current(false)
  },[conversationId,userIdentity,open])
  function close(next:boolean){if(!next&&pendingToken.current===token)return;onOpenChange(next)}
  async function confirm() {
    if(!open||!reason||options.isError||options.isPending||pendingToken.current===token)return
    const requestToken=token,chosen=reason.id,block=blockAutomation
    pendingToken.current=requestToken;setPending(true);setFailureState(null)
    try {
      const ok=await onConfirm(chosen,block)
      if(!mounted.current||!context.current.isCurrent(requestToken))return
      if(ok)changeOpen.current(false)
      else setFailureState({token:requestToken,message:'Não foi possível finalizar. Confira o atendimento e tente novamente.'})
    } catch(failure) {
      if(mounted.current&&context.current.isCurrent(requestToken))setFailureState({token:requestToken,message:failure instanceof Error?failure.message:'Não foi possível finalizar o atendimento.'})
    } finally {
      if(mounted.current&&context.current.isCurrent(requestToken)&&pendingToken.current===requestToken){pendingToken.current=null;setPending(false)}
    }
  }
  return <Dialog.Root open={open} onOpenChange={close}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/60"/>
      <Dialog.Content onCloseAutoFocus={event=>{event.preventDefault();onCloseAutoFocus?.()}} onEscapeKeyDown={event=>{if(busy)event.preventDefault()}} onPointerDownOutside={event=>{if(busy)event.preventDefault()}} className="fixed left-1/2 top-1/2 z-[1001] w-[400px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-4 text-ink shadow-xl focus:outline-none">
        <Dialog.Title className="pr-8 text-base font-semibold">Finalizar atendimento</Dialog.Title>
        <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-muted">Escolha o motivo para {conversationName}. {blockAutomation?'A Ana permanecerá pausada até você liberar a automação.':'A Ana ficará pausada até uma nova mensagem relevante do cliente.'}</Dialog.Description>
        <Dialog.Close asChild><button type="button" aria-label="Fechar finalização" disabled={busy} className="absolute right-2 top-2 rounded-lg p-2 text-ink-muted hover:bg-surface-2 disabled:opacity-40"><X size={16}/></button></Dialog.Close>
        <form className="mt-4 space-y-4" onSubmit={event=>{event.preventDefault();void confirm()}}>
          {options.isPending?<p role="status" className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={14} className="animate-spin"/>Carregando motivos…</p>
            :options.isError?<div role="alert" className="space-y-2 text-xs text-danger"><p>Não foi possível carregar os motivos.</p><button type="button" onClick={()=>{void options.refetch()}} className="rounded-lg border border-border px-3 py-2 text-accent hover:bg-surface-2">Tentar novamente</button></div>
            :!options.data?.reasons.length?<p role="status" className="text-xs text-ink-muted">Nenhuma etiqueta de encerramento da Ana está disponível. Atualize os motivos para tentar novamente.<button type="button" onClick={()=>{void options.refetch()}} className="mt-2 block rounded-lg border border-border px-3 py-2 text-accent hover:bg-surface-2">Atualizar motivos</button></p>
            :<div><label htmlFor={selectId} className="mb-1 block text-xs font-medium text-ink-muted">Motivo do encerramento</label><select id={selectId} required disabled={busy} value={reasonId} onChange={event=>{setSelection({token,id:event.target.value});setFailureState(null)}} className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-40"><option value="">Escolha um motivo</option>{options.data.reasons.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
          <div className="rounded-lg border border-border p-3"><label htmlFor={checkboxId} className="flex items-start gap-2 text-xs"><input id={checkboxId} type="checkbox" disabled={busy} checked={blockAutomation} onChange={event=>setAutomation({token,blocked:event.target.checked})} className="mt-0.5 accent-accent"/><span>Não reativar a Ana neste contato</span></label><p className="mt-2 text-[11px] leading-relaxed text-ink-muted">Use para spam. Você pode liberar a Ana depois; a equipe continua vendo as mensagens.</p></div>
          {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>close(false)} className="rounded-lg border border-border px-3 py-2 text-xs text-ink-muted hover:bg-surface-2 disabled:opacity-40">Cancelar</button><button type="submit" disabled={busy||!reason||options.isPending||options.isError} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs text-white hover:bg-accent/90 disabled:opacity-40">{busy&&<Loader2 size={14} className="animate-spin"/>}{busy?'Finalizando…':'Finalizar atendimento'}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
