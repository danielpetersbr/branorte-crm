import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowLeft, Check, CheckCircle2, FileText, Image as ImageIcon, Info, Loader2, Lock, MessageSquare, Mic, Music, Paperclip, Plus, Reply, Search, Send, Square, Tag, Upload, Users, Video, X } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useVendors } from '@/hooks/useVendors'
import { chatRpc, useAtendimentoChat, useChatMedia, useChatHistoryMedia } from '@/hooks/useAtendimentoChat'
import { attachmentExtension, attachmentType, CHAT_ATTACHMENT_ACCEPT, CHAT_MEDIA_BUCKET, CHAT_PRIVATE_MEDIA_PREFIX, chatMessageSenderName, deliveryLabel, displayMessageBody, privateChatMediaPath, resolveAttachmentMime, validateAttachment, type ChatMessage, type ChatOutbox } from '@/lib/atendimento-chat'
import { clearPendingSend, readPendingSend, savePendingSend, type PendingChatSend } from '@/lib/chat-pending-send'
import { clearChatDraft, readChatDraft, saveChatDraft } from '@/lib/chat-drafts'
import { createChatRecorder } from '@/lib/chat-recorder'
import { recoverRejectedChatQuote, type RecoveredChatAttachment } from '@/lib/chat-rpc-error'
import { ChatAttachmentPreview, ChatAvatar, ChatMedia as Media } from '@/components/chat/ChatMedia'
import { ChatQuickReplies } from '@/components/chat/ChatQuickReplies'
import { ChatTeamSummary } from '@/components/chat/ChatTeamSummary'
import { ChatFollowUp, ChatReplyPreview, ChatSalesPanel } from '@/components/chat/ChatProductivity'
import { followUpState, messageCitation, waitingTime, selectChatQueue, selectChatStatus, type ChatCitation, type ChatQueue } from '@/lib/chat-productivity'

const inputClass='w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/30'
const buttonClass='inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed'
const fmtTime=(s:string)=>new Date(s).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
const fmtDay=(s:string)=>new Date(s).toLocaleDateString('pt-BR',{day:'2-digit',month:'long'})
function MessageBubble({message,url,onReply,replyDisabled}:{message:ChatMessage;url:string|null;onReply:(message:ChatMessage)=>void;replyDisabled:boolean}) {
  const hasMedia=['image','sticker','audio','ptt','video','document'].includes(message.tipo)
  const body=displayMessageBody(message.body)
  const senderName=chatMessageSenderName(message)
  return <div className={cn('flex',message.from_me?'justify-end':'justify-start')}>
    <div className={cn('max-w-[88%] sm:max-w-[78%] rounded-xl border px-3 py-2 shadow-sm',message.from_me?'bg-accent/10 border-accent/20 rounded-tr-sm':'bg-surface border-border rounded-tl-sm')}>
      {senderName&&<p className="mb-1 break-words text-xs font-semibold text-accent">{senderName}</p>}
      {message.reply_msg_id&&<ChatReplyPreview preview={message.reply_preview} author={message.reply_sender_name}/>}
      {hasMedia&&<Media type={message.tipo} url={url} filename={message.filename}/>}
      {body&&<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</p>}
      {!body&&!hasMedia&&<p className="text-xs text-ink-muted">{message.body?'Mídia':`[${message.tipo}]`}</p>}
      {message.transcricao&&<details className="mt-2 text-xs text-ink-muted"><summary className="cursor-pointer">Transcrição do áudio</summary><p className="mt-1 whitespace-pre-wrap">{message.transcricao}</p></details>}
      <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-ink-faint"><button type="button" aria-label="Responder citando esta mensagem" disabled={replyDisabled} onClick={()=>onReply(message)} className="mr-auto rounded p-1 text-ink-muted hover:text-accent disabled:opacity-40"><Reply size={13}/></button><time dateTime={message.data_msg}>{fmtTime(message.data_msg)}</time>{message.from_me&&<Check size={12}/>}</div>
    </div>
  </div>
}
function OutboxEntry({item}:{item:ChatOutbox}) {
  const media=useChatMedia(item.media_path)
  const body=displayMessageBody(item.body)
  return <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
    <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{item.sender_name||'Vendedor'} · {fmtTime(item.created_at)}</span><span className={item.status==='failed'?'text-danger':item.status==='sent'?'text-accent':'text-ink-muted'}>{deliveryLabel(item.status)}</span></div>
    {item.reply_msg_id&&<div className="mt-2"><ChatReplyPreview preview={item.reply_preview} author={item.reply_sender_name}/></div>}
    {body&&<p className="mt-1 whitespace-pre-wrap break-words">{body}</p>}
    {item.media_path&&<div className="mt-2"><Media type={item.tipo} url={media.data||null} filename={item.filename}/></div>}
    {item.error&&<p className="mt-1 text-danger">{item.error}</p>}
  </div>
}

export function AtendimentoWhatsApp() {
  const [selected,setSelected]=useState<string|null>(null)
  const [search,setSearch]=useState(''),[debounced,setDebounced]=useState('')
  const [status,setStatus]=useState('open'),[vendor,setVendor]=useState(''),[tag,setTag]=useState('')
  const [queue,setQueue]=useState<ChatQueue>('all'),[now,setNow]=useState(Date.now)
  const [historySearch,setHistorySearch]=useState(''),[historyDebounced,setHistoryDebounced]=useState('')
  const [reply,setReply]=useState<ChatCitation|null>(null)
  const [showInfo,setShowInfo]=useState(false),[showNew,setShowNew]=useState(false),[contactSearch,setContactSearch]=useState('')
  const [draft,setDraft]=useState(''),[attachment,setAttachment]=useState<File|null>(null)
  const [recoveredAttachment,setRecoveredAttachment]=useState<RecoveredChatAttachment|null>(null)
  const [attachmentMenu,setAttachmentMenu]=useState(false),[dragging,setDragging]=useState(false),[draftSaveError,setDraftSaveError]=useState(false)
  const [note,setNote]=useState(''),[newTag,setNewTag]=useState(''),[sending,setSending]=useState(false)
  const [uncertain,setUncertain]=useState(false),[recording,setRecording]=useState(false),[preparingRecording,setPreparingRecording]=useState(false),[recordSeconds,setRecordSeconds]=useState(0)
  const pendingRequest=useRef<(PendingChatSend&{file:File|null;url?:string})|null>(null)
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),cancelRecording=useRef(false)
  const sendingGeneration=useRef<number|null>(null),recordingGeneration=useRef<number|null>(null),canCompose=useRef(false),dragDepth=useRef(0)
  const chatGeneration=useRef(0),fileInput=useRef<HTMLInputElement>(null),bottom=useRef<HTMLDivElement>(null),scrollArea=useRef<HTMLDivElement>(null)
  const stickToBottom=useRef(true),prependHeight=useRef<number|null>(null)
  const messageInput=useRef<HTMLTextAreaElement>(null)
  const focusAfterClaim=useRef<number|null>(null)
  const chat=useAtendimentoChat({search:debounced,status,vendor,tag,queue},selected,historyDebounced)
  const historyMedia=useChatHistoryMedia([...chat.messages,...chat.searchMessages])
  const recoveredMedia=useChatMedia(recoveredAttachment?.path??null)
  const {data:vendors=[]}=useVendors()
  const isAdmin=chat.profile?.role==='admin'
  const c=chat.conversation
  const blocked=chat.detail.isError||chat.history.isError
  const draftDisabled=!c||sending||uncertain||blocked||preparingRecording
  canCompose.current=chat.ownsLease&&!sending&&!uncertain&&!blocked
  const contacts=useQuery({queryKey:['crm-chat-contacts',chat.profile?.id,chat.profile?.vendor_id,contactSearch],enabled:showNew,
    queryFn:()=>chatRpc<Array<{id:string;name:string;phone:string;vendor_id:string|null}>>('contacts',{search:contactSearch})})
  useEffect(()=>{const t=setTimeout(()=>setDebounced(search),250);return()=>clearTimeout(t)},[search])
  useEffect(()=>{const t=setTimeout(()=>setHistoryDebounced(historySearch),300);return()=>clearTimeout(t)},[historySearch])
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t)},[])
  useEffect(()=>{if(chat.ownsLease&&focusAfterClaim.current===chatGeneration.current){focusAfterClaim.current=null;messageInput.current?.focus()}},[chat.ownsLease,selected])
  useEffect(()=>{
    chatGeneration.current++;cancelRecording.current=true
    recorder.current?.state==='recording'&&recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop())
    recorder.current=null;stream.current=null;recordingGeneration.current=null;sendingGeneration.current=null;dragDepth.current=0
    const saved=selected&&chat.profile?.id?readPendingSend(localStorage,chat.profile.id,selected):null
    pendingRequest.current=saved?{...saved,file:null}:null
    const restored=selected&&chat.profile?.id?readChatDraft(localStorage,chat.profile.id,selected):''
    setReply(saved?.reply_msg_id?{reply_msg_id:saved.reply_msg_id,reply_preview:saved.reply_preview??null,reply_sender_name:saved.reply_sender_name??null}:null)
    setHistorySearch('');setHistoryDebounced('');focusAfterClaim.current=null;setRecoveredAttachment(null)
    setRecording(false);setPreparingRecording(false);setSending(false);setDraft(saved?saved.body:restored);setDraftSaveError(false);setAttachment(null);setAttachmentMenu(false);setDragging(false);setNote('');setUncertain(!!saved);stickToBottom.current=true;prependHeight.current=null
  },[selected,chat.profile?.id])
  useEffect(()=>{if(chat.ownsLease)return;cancelRecording.current=true;recorder.current?.state==='recording'&&recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());setAttachmentMenu(false);setDragging(false);dragDepth.current=0},[chat.ownsLease])
  useEffect(()=>{
    const area=scrollArea.current
    if(prependHeight.current!==null&&area){area.scrollTop=area.scrollHeight-prependHeight.current;prependHeight.current=null}
    else if(stickToBottom.current)bottom.current?.scrollIntoView({block:'end',behavior:'auto'})
  },[chat.messages,chat.detail.data?.outbox.length])
  useEffect(()=>{
    if(!recording)return
    const t=setInterval(()=>setRecordSeconds(n=>n+1),1000)
    return()=>clearInterval(t)
  },[recording])
  useEffect(()=>{if(recordSeconds>=120&&recording)recorder.current?.stop()},[recordSeconds,recording])
  useEffect(()=>()=>{chatGeneration.current++;canCompose.current=false;cancelRecording.current=true;recorder.current?.state==='recording'&&recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop())},[])

  async function act(name:string,args:Record<string,unknown>={}) {
    try {await chat.action.mutateAsync({name,...args});return true} catch(e){toast.error((e as Error).message);return false}
  }
  async function assume(){const generation=chatGeneration.current;focusAfterClaim.current=generation;if(!await act('claim')&&generation===chatGeneration.current)focusAfterClaim.current=null}
  function selectQueue(next:ChatQueue){const filters=selectChatQueue(next,status);setQueue(filters.queue);setStatus(filters.status)}
  function selectStatus(next:string){const filters=selectChatStatus(next,queue);setQueue(filters.queue);setStatus(filters.status)}
  function quote(message:ChatMessage){if(draftDisabled||recording)return;setReply(messageCitation(message,c?.name||'Cliente'));messageInput.current?.focus()}
  function editDraft(body:string){
    if(!selected||!chat.profile?.id||draftDisabled)return
    setDraft(body)
    try{saveChatDraft(localStorage,chat.profile.id,selected,body);setDraftSaveError(readChatDraft(localStorage,chat.profile.id,selected)!==body)}catch{setDraftSaveError(true)}
  }
  function chooseFile(file:File|undefined){
    if(!file||!canCompose.current)return
    const error=validateAttachment(file);if(error){toast.error(error);return}
    setAttachment(file);setRecoveredAttachment(null);setAttachmentMenu(false)
  }
  function takeFiles(files:File[]){
    if(!canCompose.current||recording||preparingRecording)return
    if(files.length>1){toast.error('Anexe um arquivo por vez.');return}
    chooseFile(files[0])
  }
  function pasteFiles(e:ClipboardEvent<HTMLDivElement>){
    const files=Array.from(e.clipboardData.files);if(!files.length)return
    e.preventDefault();takeFiles(files)
  }
  function dropFiles(e:DragEvent<HTMLDivElement>){
    if(!e.dataTransfer.types.includes('Files'))return
    e.preventDefault();dragDepth.current=0;setDragging(false);takeFiles(Array.from(e.dataTransfer.files))
  }
  function openAttachmentPicker(accept:string){if(!canCompose.current)return;setAttachmentMenu(false);if(fileInput.current){fileInput.current.accept=accept;fileInput.current.click()}}
  async function startRecording() {
    if(!canCompose.current||recorder.current||recordingGeneration.current!==null)return
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){toast.error('Este navegador não permite gravação de áudio. Envie um arquivo de áudio.');return}
    const generation=chatGeneration.current
    recordingGeneration.current=generation;setPreparingRecording(true)
    try {
      const s=await navigator.mediaDevices.getUserMedia({audio:true})
      if(generation!==chatGeneration.current||!canCompose.current){s.getTracks().forEach(t=>t.stop());return}
      stream.current=s;cancelRecording.current=false
      const r=await createChatRecorder(s)
      if(generation!==chatGeneration.current||!canCompose.current){s.getTracks().forEach(t=>t.stop());return}
      const mime=r.mimeType,chunks:Blob[]=[];recorder.current=r
      if(!mime.includes('ogg'))toast.info('Este áudio será enviado como arquivo de áudio. Você pode ouvi-lo antes de enviar.')
      r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      r.onerror=()=>{s.getTracks().forEach(t=>t.stop());if(generation!==chatGeneration.current||recorder.current!==r)return;cancelRecording.current=true;setRecording(false);recorder.current=null;stream.current=null;toast.error('Não foi possível gravar o áudio.')}
      r.onstop=()=>{s.getTracks().forEach(t=>t.stop());if(generation!==chatGeneration.current||recorder.current!==r)return
        setRecording(false);recorder.current=null;stream.current=null;if(cancelRecording.current||!canCompose.current)return
        const blob=new Blob(chunks,{type:mime});chooseFile(new File([blob],`audio-${Date.now()}.${mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm'}`,{type:mime}))}
      r.start(1000);setRecording(true);setRecordSeconds(0)
    } catch(e){if(generation===chatGeneration.current){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;recorder.current=null;toast.error((e as Error).name==='NotAllowedError'?'Permita o microfone no navegador para gravar áudio.':(e as Error).message)}}
    finally{if(generation===chatGeneration.current){recordingGeneration.current=null;setPreparingRecording(false)}}
  }
  async function send() {
    const generation=chatGeneration.current,user=chat.profile?.id
    if(sendingGeneration.current===generation||sending||!selected||!user||!chat.ownsLease||blocked||recording||preparingRecording)return
    let request=pendingRequest.current
    if(request&&request.chat!==selected)return
    if(!request){if(!draft.trim()&&!attachment&&!recoveredAttachment)return;request={...recoveredAttachment,id:crypto.randomUUID(),chat:selected,body:draft.trim(),file:attachment,mime:attachment?resolveAttachmentMime(attachment)||undefined:recoveredAttachment?.mime,filename:attachment?.name||recoveredAttachment?.filename,...(reply||{})};pendingRequest.current=request}
    sendingGeneration.current=generation
    setSending(true)
    try {
      if(request.file&&!request.path){
        const f=request.file,ext=attachmentExtension(request.mime||'')
        if(!ext)throw new Error('Formato de arquivo não permitido.')
        const path=`${request.chat}/${request.id}.${ext}`
        const {error}=await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path,f,{contentType:request.mime,upsert:false})
        if(error&&error.message!=='The resource already exists')throw new Error(error.message)
        request.path=path
      }
      if(request.path){const {data,error}=await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(request.path,604800);if(error)throw new Error(error.message);request.url=data.signedUrl}
      if(generation!==chatGeneration.current)return
      // Se o navegador não conseguir preservar a chave, não iniciamos um envio incerto.
      savePendingSend(localStorage,user,{id:request.id,chat:request.chat,body:request.body,path:request.path,mime:request.mime,filename:request.filename,reply_msg_id:request.reply_msg_id,reply_preview:request.reply_preview,reply_sender_name:request.reply_sender_name})
      await chatRpc('send',{id:request.chat,session:chat.session,request:request.id,body:request.body,media_path:request.path,media_url:request.url,mime:request.mime,filename:request.filename,reply_msg_id:request.reply_msg_id})
      clearPendingSend(localStorage,user,request.chat);clearChatDraft(localStorage,user,request.chat)
      if(generation===chatGeneration.current){pendingRequest.current=null;setUncertain(false);setDraft('');setReply(null);setAttachment(null);setRecoveredAttachment(null);stickToBottom.current=true;await chat.invalidate()}
    } catch(e){if(generation===chatGeneration.current){
      const recovered=recoverRejectedChatQuote(e,request)
      if(recovered){
        clearPendingSend(localStorage,user,request.chat);pendingRequest.current=null;setUncertain(false);setDraft(recovered.body);setAttachment(request.file);setRecoveredAttachment(recovered.media)
        toast.error('A mensagem citada não está mais disponível. Cancele a citação ou selecione outra antes de enviar novamente.')
      }else{setUncertain(true);toast.error(`${(e as Error).message} Use “Confirmar envio” para consultar ou repetir a mesma solicitação sem duplicar.`)}
    }}
    finally{if(generation===chatGeneration.current){sendingGeneration.current=null;setSending(false)}}
  }
  const connection=chat.list.data?.pages[0]?.connection
  const fresh=connection&&connection.number_final==='1144'&&Date.now()-Date.parse(connection.last_sync)<180000
  const tags=chat.list.data?.pages[0]?.tags||[]
  const selectedList=chat.conversations.find(x=>x.id===selected)
  const responsible=c?c.vendor_name:selectedList?.vendor_name
  const name=c?.name||selectedList?.name||'Conversa'
  const composerDisabled=!chat.ownsLease||sending||uncertain||blocked||preparingRecording
  const activeLease=!!c?.lock_until&&Date.parse(c.lock_until)>now
  const otherLease=activeLease&&(c?.lock_user_id!==chat.profile?.id||c?.lock_session_id!==chat.session)
  return <div className="flex h-[calc(100dvh-4.25rem)] md:h-dvh min-h-[500px] flex-col bg-background text-ink">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:px-6">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-accent/10 p-2 text-accent"><MessageSquare size={22}/></div><div><h1 className="text-lg font-semibold">Atendimento WhatsApp</h1><p className="text-xs text-ink-muted">Ana · número final 1144 · {isAdmin?'Visão da equipe':'Minha carteira'}</p></div></div>
      <span data-realtime-event={chat.lastEventAt??''} title={connection?`Última sincronização da VPS: ${new Date(connection.last_sync).toLocaleString('pt-BR')}`:'Sem informação da VPS'} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',fresh&&chat.realtimeConnected?'border-accent/20 bg-accent/5 text-accent':'border-amber-500/30 text-amber-500')}><span className={cn('h-1.5 w-1.5 rounded-full',fresh&&chat.realtimeConnected?'bg-accent':'bg-amber-500')}/><span>{!fresh?'Verificar VPS':chat.realtimeConnected?'Tempo real conectado':'Reconectando chat'}</span></span>
    </header>
    <ChatTeamSummary vendor={vendor} isAdmin={isAdmin} onSelectQueue={selectQueue} onSelectUnassigned={()=>{setVendor('unassigned');selectQueue('all');setStatus('open')}}/>
    <div className="flex min-h-0 flex-1">
      <aside className={cn('w-full shrink-0 border-r border-border bg-surface md:w-[290px] xl:w-[320px] flex-col',selected?'hidden md:flex':'flex')}>
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Conversas <span className="ml-1 text-xs font-normal text-ink-muted">{chat.conversations.length}{chat.list.hasNextPage?'+':''}</span></h2><button className="p-2 text-accent hover:bg-accent/10 rounded-lg" aria-label="Nova conversa" onClick={()=>setShowNew(true)}><Plus size={18}/></button></div>
          <div className="relative"><Search size={16} className="absolute left-3 top-3 text-ink-faint"/><input aria-label="Buscar conversa" className={cn(inputClass,'pl-9')} placeholder="Buscar nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <select aria-label="Filtrar fila de atendimento" className={inputClass} value={queue} onChange={e=>selectQueue(e.target.value as ChatQueue)}><option value="all">Todas as conversas</option><option value="waiting">Aguardando resposta · mais antigas primeiro</option><option value="overdue">Retornos atrasados · prazo mais antigo</option></select>
          <div className="flex gap-2"><select aria-label="Filtrar situação" className={cn(inputClass,'min-w-0')} value={status} onChange={e=>selectStatus(e.target.value)}><option value="open">Abertas</option><option value="resolved">Finalizadas</option><option value="">Todas</option></select><select aria-label="Filtrar etiqueta" className={cn(inputClass,'min-w-0')} value={tag} onChange={e=>setTag(e.target.value)}><option value="">Etiquetas</option>{tags.map(t=><option key={t}>{t}</option>)}</select></div>
          {isAdmin&&<select aria-label="Filtrar vendedor" className={inputClass} value={vendor} onChange={e=>setVendor(e.target.value)}><option value="">Todos os vendedores</option><option value="unassigned">Sem responsável</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Lista de conversas">
          {chat.list.isPending&&<p className="p-6 text-sm text-ink-muted">Carregando conversas…</p>}
          {chat.list.isError&&<div role="alert" className="p-4 text-sm text-danger">{chat.list.error.message}<button className={cn(buttonClass,'mt-2')} onClick={()=>chat.list.refetch()}>Tentar novamente</button></div>}
          {!chat.list.isPending&&!chat.list.isError&&!chat.conversations.length&&<div className="p-8 text-center text-sm text-ink-muted"><MessageSquare className="mx-auto mb-3 opacity-40"/><p>Nenhuma conversa neste filtro.</p>{!isAdmin&&<p className="mt-2 text-xs">Você vê somente os clientes atribuídos à sua carteira.</p>}</div>}
          {chat.conversations.map(item=><button key={item.id} onClick={()=>{setSelected(item.id);setShowInfo(false)}} className={cn('flex w-full gap-3 border-b border-border/60 px-4 py-3.5 text-left hover:bg-surface-2',selected===item.id&&'bg-accent/5 border-l-[3px] border-l-accent')}>
            <ChatAvatar name={item.name} url={item.avatar_url}/>
            <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{item.name}</span><time className="shrink-0 text-[10px] text-ink-faint">{fmtTime(item.last_message_at)}</time></div><p className="mt-1 truncate text-xs text-ink-muted">{item.last_from_me?'Enviada: ':''}{displayMessageBody(item.last_preview)||(item.last_preview?'Mídia':item.phone)}</p><div className="mt-2 flex items-center gap-2"><span className="truncate text-[10px] text-ink-faint">{item.vendor_name||'Sem responsável'}</span>{item.tags.slice(0,1).map(t=><span key={t} className="max-w-[100px] truncate rounded bg-accent/10 px-1.5 text-[10px] text-accent">{t}</span>)}{!!item.unread&&<span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Mensagem não lida"/>}</div>{item.waiting_since&&<p className="mt-1 text-[10px] text-amber-500">Aguardando resposta · {waitingTime(item.waiting_since,now)}</p>}{followUpState(item.follow_up_at,now)==='overdue'&&<p className="mt-1 text-[10px] text-danger">Retorno atrasado · {new Date(item.follow_up_at!).toLocaleString('pt-BR')}</p>}</div>
          </button>)}
          {chat.list.hasNextPage&&<button className="w-full p-4 text-sm text-accent" disabled={chat.list.isFetchingNextPage} onClick={()=>chat.list.fetchNextPage()}>Carregar mais conversas</button>}
        </div>
      </aside>
      <section className={cn('relative min-w-0 flex-1 flex-col',selected?'flex':'hidden md:flex')} aria-label="Conversa selecionada"
        onPaste={pasteFiles} onDrop={dropFiles}
        onDragEnter={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();if(!composerDisabled&&!recording&&selected){dragDepth.current++;setDragging(true)}}}
        onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=composerDisabled||recording?'none':'copy'}}}
        onDragLeave={e=>{if(e.dataTransfer.types.includes('Files')){dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false)}}}>
        {dragging&&<div role="status" className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface/95 text-accent"><Upload size={36}/><p className="font-semibold">Solte o arquivo para anexar</p><p className="text-xs">Um arquivo por vez · até 20 MB · revise antes de enviar</p></div>}
        {!selected?<div className="flex flex-1 items-center justify-center p-8 text-center"><div className="max-w-md"><div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/20 bg-accent/5 text-accent"><MessageSquare size={34}/></div><h2 className="text-xl font-semibold">Seu atendimento, em um só lugar</h2><p className="mt-3 text-sm leading-relaxed text-ink-muted">Selecione um cliente para conversar pelo WhatsApp da Ana. Mensagens, fotos, áudios e histórico ficam juntos no CRM.</p><p className="mt-5 inline-flex items-center gap-2 text-xs text-ink-faint"><Lock size={13}/>Carteiras protegidas por vendedor</p></div></div>:<>
          <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface p-3 md:px-5">
            <button className="p-2 md:hidden" aria-label="Voltar para conversas" onClick={()=>setSelected(null)}><ArrowLeft size={20}/></button><ChatAvatar name={name} url={c?c.avatar_url:selectedList?.avatar_url}/><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{name}</h2><p className="mt-0.5 text-xs text-ink-muted">{c?.phone||selectedList?.phone} · {c?.status==='resolved'?'Finalizado':c?.human_hold?'Atendimento humano':'Atendimento da Ana'}</p><p className="mt-1 text-[11px] text-ink-muted">Responsável: {responsible||'Sem responsável'}{activeLease&&` · Atendendo: ${c?.lock_user_name||'Sessão ativa'}${chat.ownsLease?' (você)':''}`}</p></div>
            {c&&<button className={cn(buttonClass,'text-xs')} disabled={chat.action.isPending||blocked} onClick={()=>act(c.status==='resolved'?'reopen':'resolve')}><CheckCircle2 size={15}/><span className="hidden sm:inline">{c.status==='resolved'?'Reabrir':'Finalizar'}</span></button>}<button className="rounded-lg p-2 hover:bg-surface-2 xl:hidden" aria-label="Dados do cliente" onClick={()=>setShowInfo(!showInfo)}><Info size={20}/></button>
          </div>
          {chat.leaseError&&<div role="alert" className="border-b border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger">{chat.leaseError}</div>}
          {c?.follow_up_at&&<div role="status" className={cn('shrink-0 border-b border-border px-4 py-2 text-xs',followUpState(c.follow_up_at,now)==='overdue'?'bg-danger/5 text-danger':'bg-amber-500/5 text-amber-500')}>Retorno {followUpState(c.follow_up_at,now)==='overdue'?'atrasado':'agendado'} · {new Date(c.follow_up_at).toLocaleString('pt-BR')}<button type="button" className="ml-3 underline" onClick={()=>setShowInfo(true)}>Ver lembrete interno</button></div>}
          <div className="shrink-0 border-b border-border bg-surface px-4 py-2">
            <div className="flex items-center gap-2"><Search size={15} className="shrink-0 text-ink-muted"/><input className={cn(inputClass,'min-w-0 py-1.5 text-xs')} aria-label="Pesquisar todo o histórico desta conversa" maxLength={200} placeholder="Pesquisar em todo o histórico…" value={historySearch} onChange={e=>setHistorySearch(e.target.value)}/>{historySearch&&<button type="button" className="rounded p-2 hover:bg-surface-2" aria-label="Fechar pesquisa do histórico" onClick={()=>{setHistorySearch('');setHistoryDebounced('')}}><X size={15}/></button>}</div>
            {!!historySearch.trim()&&<div aria-label="Resultados da pesquisa do histórico" className="mt-2 max-h-[35dvh] overflow-y-auto rounded-lg border border-border p-3">
              {historySearch.trim()!==historyDebounced.trim()||chat.historyResults.isPending?<p className="text-xs text-ink-muted">Pesquisando histórico…</p>:chat.historyResults.isError?<div role="alert" className="text-xs text-danger">{chat.historyResults.error.message}<button type="button" className={cn(buttonClass,'ml-2 text-xs')} onClick={()=>chat.historyResults.refetch()}>Tentar novamente</button></div>:<><p className="mb-3 text-[11px] text-ink-muted">{chat.searchMessages.length}{chat.historyResults.hasNextPage?'+':''} resultado(s) · pesquisa separada do histórico</p>{!chat.searchMessages.length&&<p className="text-xs text-ink-muted">Nenhuma mensagem encontrada.</p>}<div className="space-y-3">{chat.searchMessages.map(m=><div key={m.msg_id}><p className="mb-1 text-center text-[10px] text-ink-faint">{fmtDay(m.data_msg)}</p><MessageBubble message={m} url={m.media_url?.startsWith(CHAT_PRIVATE_MEDIA_PREFIX)?historyMedia.data?.[privateChatMediaPath(m.media_url)??'']??null:m.media_url} onReply={quote} replyDisabled={draftDisabled||recording}/></div>)}</div>{chat.historyResults.hasNextPage&&<button type="button" className={cn(buttonClass,'mt-3 w-full text-xs')} disabled={chat.historyResults.isFetchingNextPage} onClick={()=>chat.historyResults.fetchNextPage()}>Carregar mais resultados</button>}</>}
            </div>}
          </div>
          {blocked?<div role="alert" className="p-6 text-sm text-danger">{chat.detail.error?.message||chat.history.error?.message}<p className="mt-2 text-ink-muted">Se o atendimento foi transferido, selecione outra conversa.</p><button className={cn(buttonClass,'mt-3')} onClick={()=>{chat.detail.refetch();chat.history.refetch()}}>Tentar novamente</button></div>:<div ref={scrollArea} onScroll={e=>{const a=e.currentTarget;stickToBottom.current=a.scrollHeight-a.scrollTop-a.clientHeight<100}} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6" style={{backgroundImage:'radial-gradient(var(--chat-dot, rgba(128,128,128,.08)) 1px, transparent 1px)',backgroundSize:'18px 18px'}}>
            {chat.history.hasNextPage&&<div className="mb-5 text-center"><button className={cn(buttonClass,'bg-surface text-xs')} disabled={chat.history.isFetchingNextPage} onClick={()=>{prependHeight.current=scrollArea.current?.scrollHeight||null;chat.history.fetchNextPage()}}>Carregar mensagens anteriores</button></div>}
            {chat.history.isPending&&<div className="text-center text-sm text-ink-muted">Carregando histórico…</div>}
            {!chat.history.isPending&&!chat.messages.length&&<p className="py-8 text-center text-sm text-ink-muted">Nenhuma mensagem no histórico ainda.</p>}
            <div className="space-y-3">{chat.messages.map((m,i)=><div key={m.msg_id}>{(i===0||fmtDay(m.data_msg)!==fmtDay(chat.messages[i-1].data_msg))&&<div className="mb-4 text-center"><span className="rounded-full border border-border bg-surface px-3 py-1 text-[10px] text-ink-muted">{fmtDay(m.data_msg)}</span></div>}<MessageBubble message={m} url={m.media_url?.startsWith(CHAT_PRIVATE_MEDIA_PREFIX)?historyMedia.data?.[privateChatMediaPath(m.media_url)??'']??null:m.media_url} onReply={quote} replyDisabled={draftDisabled||recording}/></div>)}</div>
            {!!chat.detail.data?.outbox.length&&<details open={chat.detail.data.outbox.some(o=>o.status!=='sent')} className="mt-5 rounded-xl border border-border bg-surface/70 p-3"><summary className="cursor-pointer text-xs font-medium text-ink-muted">Envios recentes · {chat.detail.data.outbox.length}<span className="ml-2 font-normal">A confirmação aparece aqui; o histórico é sincronizado pelo WhatsApp.</span></summary><div className="mt-3 space-y-2">{chat.detail.data.outbox.map(item=><OutboxEntry item={item} key={item.id}/>)}</div></details>}
            <div ref={bottom}/>
          </div>}
          <div className="shrink-0 border-t border-border bg-surface p-3 md:p-4">
            {!chat.ownsLease&&c&&!blocked&&<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/20 bg-accent/5 p-3"><p className="min-w-0 flex-1 text-xs text-ink-muted">{c.status==='resolved'?'Reabra este atendimento para voltar a responder.':otherLease?`${c.lock_user_name||'Outra sessão'} está atendendo. Você pode preparar seu rascunho.`:'Prepare sua resposta e assuma o atendimento para enviar. A IA da Ana ficará pausada neste cliente.'}</p><button type="button" className={cn(buttonClass,'shrink-0 border-transparent bg-accent text-xs text-white hover:bg-accent/90')} disabled={chat.action.isPending||otherLease||sending} onClick={()=>c.status==='resolved'?act('reopen'):assume()}><Users size={15}/>{c.status==='resolved'?'Reabrir atendimento':'Assumir atendimento'}</button></div>}
            {reply&&<div className="mb-2"><ChatReplyPreview preview={reply.reply_preview} author={reply.reply_sender_name} disabled={sending||uncertain} onCancel={()=>setReply(null)}/></div>}
            {attachment&&<ChatAttachmentPreview file={attachment} disabled={sending||uncertain} onRemove={()=>{setAttachment(null);setRecoveredAttachment(null)}}/>}
            {!attachment&&recoveredAttachment&&<div className="mb-2 rounded-lg border border-border p-3"><div className="mb-2 flex items-center justify-between gap-2 text-xs"><span>{recoveredAttachment.filename||'Anexo preservado'}</span><button type="button" aria-label="Remover anexo preservado" disabled={sending||uncertain} onClick={()=>setRecoveredAttachment(null)}><X size={15}/></button></div><Media type={attachmentType(recoveredAttachment.mime||'')||'document'} url={recoveredMedia.data||null} filename={recoveredAttachment.filename}/></div>}
            {uncertain&&<p role="alert" className="mb-2 text-xs text-amber-500">A solicitação pode ter chegado. Confirme o mesmo envio antes de escrever outra mensagem.{pendingRequest.current?.path&&` Anexo preservado: ${pendingRequest.current.filename||'arquivo'}.`}</p>}
            {recording?<div className="flex items-center gap-3 rounded-lg border border-danger/30 p-3"><Mic size={18} className="animate-pulse text-danger"/><span className="flex-1 text-sm">Gravando {Math.floor(recordSeconds/60)}:{String(recordSeconds%60).padStart(2,'0')} · máximo 2 min</span><button className={buttonClass} onClick={()=>{cancelRecording.current=true;recorder.current?.stop()}}>Cancelar</button><button className={buttonClass} onClick={()=>recorder.current?.stop()}><Square size={14}/>Concluir</button></div>:<div className="flex items-end gap-2">
              <input ref={fileInput} type="file" className="hidden" accept={CHAT_ATTACHMENT_ACCEPT} onChange={e=>{takeFiles(Array.from(e.target.files||[]));e.target.value=''}}/>
              <div className="relative" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setAttachmentMenu(false)}} onKeyDown={e=>{if(e.key==='Escape')setAttachmentMenu(false)}}>
                <button type="button" className={buttonClass} title="Fotos, vídeos, áudios e documentos até 20 MB" aria-label="Anexar arquivo" aria-expanded={attachmentMenu} aria-controls="chat-attachment-options" disabled={composerDisabled} onClick={()=>setAttachmentMenu(!attachmentMenu)}><Paperclip size={18}/></button>
                {attachmentMenu&&<div id="chat-attachment-options" className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-xl border border-border bg-surface p-2 shadow-xl" aria-label="Tipos de anexo">
                  {[{label:'Foto',icon:ImageIcon,accept:'image/jpeg,image/png,image/webp'},{label:'Vídeo',icon:Video,accept:'video/mp4,video/webm'},{label:'Áudio',icon:Music,accept:'audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav'},{label:'Documento',icon:FileText,accept:'.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'}].map(option=><button type="button" key={option.label} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-2" onClick={()=>openAttachmentPicker(option.accept)}><option.icon size={18} className="text-accent"/>{option.label}</button>)}
                  <p className="px-3 py-2 text-[10px] text-ink-muted">Até 20 MB. Também pode colar ou arrastar um arquivo.</p>
                </div>}
              </div>
              <textarea ref={messageInput} aria-label="Mensagem ao cliente" className={cn(inputClass,'resize-none min-h-[44px] max-h-32')} rows={2} maxLength={4000} placeholder={chat.ownsLease?'Escreva ou cole uma foto…':'Prepare o texto. Assuma para enviar.'} disabled={draftDisabled} value={draft} onChange={e=>editDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!chat.ownsLease){toast.info('Assuma o atendimento para enviar sua resposta.');return}void send()}}}/>
              <button className={buttonClass} aria-label={preparingRecording?'Preparando microfone':'Gravar áudio'} disabled={composerDisabled} onClick={startRecording}>{preparingRecording?<Loader2 size={18} className="animate-spin"/>:<Mic size={18}/>}</button>
              <button className={cn(buttonClass,'bg-accent text-white border-transparent hover:bg-accent/90')} aria-label={uncertain?'Confirmar envio':'Enviar mensagem'} disabled={!chat.ownsLease||sending||preparingRecording||(!draft.trim()&&!attachment&&!recoveredAttachment&&!uncertain)||blocked} onClick={send}>{sending?<Loader2 size={18} className="animate-spin"/>:<Send size={18}/>}<span className="hidden lg:inline">{uncertain?'Confirmar envio':'Enviar'}</span></button>
            </div>}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {chat.profile?.id&&<ChatQuickReplies key={chat.profile.id} userId={chat.profile.id} isAdmin={isAdmin} disabled={draftDisabled||recording} onSelect={body=>{const next=draft?`${draft}\n${body}`:body;if(next.length>4000){toast.error('A mensagem pode ter até 4.000 caracteres.');return}editDraft(next);messageInput.current?.focus()}}/>}
              <span className="text-[10px] text-ink-faint">{draftSaveError?'Rascunho não salvo neste navegador':!uncertain&&draft?'Rascunho salvo neste navegador':chat.ownsLease?'Cole ou arraste um arquivo · até 20 MB':'Assuma para responder'}</span>
            </div>
            <p className="mt-1 text-[10px] text-ink-faint">{chat.ownsLease?'Você está atendendo · número final 1144 · Enter envia, Shift+Enter quebra linha':'O rascunho fica neste navegador · anexos e microfone disponíveis após assumir'}</p>
          </div>
        </>}
      </section>
      {selected&&!blocked&&<aside className={cn('w-[280px] shrink-0 flex-col border-l border-border bg-surface xl:flex',showInfo?'absolute right-0 z-30 flex h-[calc(100dvh-9rem)] shadow-xl xl:static xl:h-auto':'hidden')} aria-label="Dados do cliente">
        <div className="flex items-center justify-between border-b border-border p-4"><h2 className="text-sm font-semibold">Cliente e atendimento</h2><button className="xl:hidden" aria-label="Fechar dados" onClick={()=>setShowInfo(false)}><X size={18}/></button></div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          <div><ChatAvatar name={name} url={c?c.avatar_url:selectedList?.avatar_url} className="mb-3 h-16 w-16 text-lg"/><h3 className="text-sm font-semibold">{name}</h3><p className="mt-1 text-xs text-ink-muted">{c?.phone}</p>{chat.detail.data?.contact&&<div className="mt-3 space-y-1 text-xs text-ink-muted"><p>{chat.detail.data.contact.empresa}</p><p>{[chat.detail.data.contact.city,chat.detail.data.contact.state].filter(Boolean).join(' / ')}</p><p>{chat.detail.data.contact.email}</p></div>}</div>
          <div><label className="mb-2 block text-xs font-medium text-ink-muted" htmlFor="chat-owner">Responsável da carteira</label>{isAdmin?<select id="chat-owner" className={inputClass} disabled={chat.action.isPending||!c} value={c?.vendor_id||''} onChange={e=>act('assign',{vendor:e.target.value}).then(ok=>{if(ok)toast.success('Responsável atualizado.')})}><option value="">Sem responsável</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>:<p className="text-sm">{responsible||'Sem responsável'}</p>}<p className="mt-2 text-xs text-ink-muted">Atendente: {activeLease?c?.lock_user_name||'Sessão ativa':'Nenhuma sessão ativa'}{chat.ownsLease?' (você)':''}</p></div>
          <ChatFollowUp key={selected} dueAt={c?.follow_up_at} now={now} disabled={chat.action.isPending||!c} onSave={due=>act('followup',{id:c?.id,due_at:due})} onDone={()=>act('followup_done',{id:c?.id})}/>
          <ChatSalesPanel data={chat.sales.data} loading={chat.sales.isPending} error={chat.sales.error?.message} onRetry={()=>{void chat.sales.refetch()}}/>
          <div><h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-muted"><Tag size={14}/>Etiquetas do atendimento</h3><div className="flex flex-wrap gap-2">{tags.map(t=><button key={t} disabled={chat.action.isPending||!c} onClick={()=>act('tags',{tags:c?.tags.includes(t)?c.tags.filter(x=>x!==t):[...(c?.tags||[]),t]})} className={cn('rounded-full border px-2.5 py-1.5 text-[11px]',c?.tags.includes(t)?'border-accent/30 bg-accent/10 text-accent':'border-border text-ink-muted')}>{t}</button>)}</div><form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();if(newTag.trim())act('create_tag',{name:newTag.trim()}).then(ok=>{if(ok)setNewTag('')})}}><input aria-label="Nome da nova etiqueta" className={cn(inputClass,'min-w-0 text-xs')} maxLength={40} placeholder="Criar etiqueta" value={newTag} onChange={e=>setNewTag(e.target.value)}/><button className={buttonClass} aria-label="Criar etiqueta" disabled={!newTag.trim()||chat.action.isPending}><Plus size={15}/></button></form></div>
          <div><h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-muted"><Lock size={13}/>Notas internas</h3><textarea aria-label="Nota interna" className={cn(inputClass,'text-xs resize-none')} maxLength={4000} rows={3} placeholder="Visível à equipe responsável. Não vai para o cliente." value={note} onChange={e=>setNote(e.target.value)}/><button className={cn(buttonClass,'mt-2 w-full text-xs')} disabled={!note.trim()||chat.action.isPending} onClick={()=>act('note',{body:note.trim()}).then(ok=>{if(ok){setNote('');toast.success('Nota interna salva.')}})}>Salvar nota</button><div className="mt-3 space-y-3">{chat.detail.data?.notes.map(n=><div key={n.id} className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3"><p className="whitespace-pre-wrap break-words text-xs">{n.body}</p><p className="mt-2 text-[10px] text-ink-faint">{n.author_name} · {fmtDay(n.created_at)} {fmtTime(n.created_at)}</p></div>)}</div></div>
        </div>
      </aside>}
    </div>
    {showNew&&<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Nova conversa"><div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Nova conversa</h2><button aria-label="Fechar nova conversa" onClick={()=>setShowNew(false)}><X size={20}/></button></div><p className="mb-3 text-xs text-ink-muted">Selecione um contato {isAdmin?'do CRM':'da sua carteira'}. O envio começa somente após assumir o atendimento.</p><input autoFocus className={inputClass} aria-label="Buscar contato para nova conversa" value={contactSearch} onChange={e=>setContactSearch(e.target.value)} placeholder="Nome ou telefone"/><div className="mt-3 max-h-72 overflow-y-auto">{contacts.isPending&&<p className="p-4 text-sm">Buscando contatos…</p>}{contacts.isError&&<p role="alert" className="p-4 text-sm text-danger">{contacts.error.message}</p>}{contacts.data?.map(ct=><button className="w-full border-b border-border p-3 text-left hover:bg-surface-2" key={ct.id} disabled={chat.action.isPending} onClick={async()=>{try{const r=await chatRpc<{id:string}>('start',{contact:ct.id});setSelected(r.id);setQueue('all');setStatus('');setShowNew(false);await chat.invalidate()}catch(e){toast.error((e as Error).message)}}}><p className="text-sm font-medium">{ct.name}</p><p className="text-xs text-ink-muted">{ct.phone}</p></button>)}{contacts.data?.length===0&&<p className="p-4 text-sm text-ink-muted">Nenhum contato encontrado.</p>}</div></div></div>}
  </div>
}
