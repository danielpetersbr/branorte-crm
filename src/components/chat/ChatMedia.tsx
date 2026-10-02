import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, FileText, Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { attachmentType, resolveAttachmentMime } from '@/lib/atendimento-chat'

function safeUrl(url?:string|null){return url&&/^https:\/\//i.test(url)?url:null}

export function ChatAvatar({name,url,className}:{name:string;url?:string|null;className?:string}) {
  const [failedUrl,setFailedUrl]=useState<string|null>(null)
  useEffect(()=>setFailedUrl(null),[url])
  const src=safeUrl(url)
  const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase()||'?'
  return <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-xs font-semibold text-accent',className)}>
    {src&&src!==failedUrl?<img key={src} src={src} alt={`Foto de ${name}`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailedUrl(src)} className="h-full w-full object-cover"/>:initials}
  </span>
}

export function ChatMedia({type,url,filename}:{type:string;url:string|null;filename?:string|null}) {
  const [failedUrl,setFailedUrl]=useState<string|null>(null)
  useEffect(()=>setFailedUrl(null),[url])
  const src=safeUrl(url)
  if(!src||src===failedUrl)return <p className="text-xs text-ink-muted">{!url?'Aguardando sincronização da mídia.':'Mídia indisponível no histórico.'}</p>
  const fail=()=>setFailedUrl(src)
  if(['ptt','audio'].includes(type))return <audio key={src} aria-label={filename||'Mensagem de voz'} controls preload="none" src={src} onError={fail} className="w-[270px] max-w-full"/>
  if(type==='video')return <video key={src} aria-label={filename||'Vídeo da conversa'} controls playsInline preload="metadata" src={src} onError={fail} className="max-h-72 w-full rounded-lg"/>
  if(['image','sticker'].includes(type))return <Dialog.Root>
    <Dialog.Trigger asChild><button type="button" aria-label="Ampliar foto da conversa" className="group relative block max-w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><img key={src} src={src} alt={filename||'Foto enviada na conversa'} loading="lazy" onError={fail} className="max-h-72 max-w-full rounded-lg object-contain"/><span className="absolute bottom-2 right-2 rounded-md bg-black/50 p-1 text-white"><Maximize2 size={14}/></span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/80"/><Dialog.Content className="fixed inset-4 z-[1001] flex flex-col items-center justify-center focus:outline-none">
      <Dialog.Title className="sr-only">Foto da conversa</Dialog.Title><Dialog.Description className="sr-only">Prévia ampliada. Pressione Escape para fechar.</Dialog.Description>
      <Dialog.Close className="absolute right-0 top-0 rounded-full bg-surface p-3 text-ink" aria-label="Fechar foto"><X size={20}/></Dialog.Close>
      <img src={src} alt={filename||'Foto da conversa ampliada'} className="max-h-[80dvh] max-w-full object-contain"/>
      <a href={src} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-surface px-4 py-2 text-sm text-ink"><ExternalLink size={15}/>Abrir original</a>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
  return <a href={src} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-3 rounded-lg border border-border bg-surface/70 p-3 text-sm text-ink hover:bg-surface-2"><FileText size={24} className="shrink-0 text-accent"/><span className="min-w-0 flex-1"><span className="block break-all font-medium">{filename||'Documento da conversa'}</span><span className="mt-1 block text-xs text-ink-muted">Abrir arquivo</span></span><ExternalLink size={15} className="shrink-0"/></a>
}

export function ChatAttachmentPreview({file,disabled,onRemove}:{file:File;disabled:boolean;onRemove:()=>void}) {
  const [resource,setResource]=useState<{file:File;url:string}|null>(null)
  useEffect(()=>{const url=URL.createObjectURL(file);setResource({file,url});return()=>URL.revokeObjectURL(url)},[file])
  const url=resource?.file===file?resource.url:null
  const type=attachmentType(resolveAttachmentMime(file)||'')
  const size=file.size>=1024*1024?`${(file.size/1024/1024).toFixed(1)} MB`:`${Math.ceil(file.size/1024)} KB`
  return <div className="mb-3 overflow-hidden rounded-xl border border-border bg-surface-2">
    <div className="flex items-center gap-3 p-3"><FileText size={18} className="shrink-0 text-accent"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.name}>{file.name}</p><p className="mt-0.5 text-[10px] text-ink-muted">{size} · Confira antes de enviar</p></div><button type="button" disabled={disabled} aria-label="Remover anexo" onClick={onRemove} className="rounded-lg p-2 hover:bg-surface disabled:opacity-40"><X size={18}/></button></div>
    {url&&<div className="border-t border-border px-3 pb-3 pt-2">
      {type==='image'?<img src={url} alt="Prévia da foto a enviar" className="max-h-52 max-w-full rounded-lg object-contain"/>:
       type==='video'?<video src={url} controls playsInline preload="metadata" aria-label="Prévia do vídeo a enviar" className="max-h-52 max-w-full rounded-lg"/>:
       type==='audio'?<audio src={url} controls preload="metadata" aria-label="Ouvir áudio antes de enviar" className="max-w-full"/>:
       <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-accent underline"><ExternalLink size={14}/>Conferir documento</a>}
    </div>}
  </div>
}
