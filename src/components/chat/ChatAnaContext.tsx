import { anaTagNames, chatResolution, type ChatAnaMetadata } from '@/lib/chat-ana'

type Conversation=ChatAnaMetadata&{status:'open'|'resolved'}
export function ChatAnaTags({tags,limit=2,compact=true}:{tags?:string[];limit?:number;compact?:boolean}) {
  const names=anaTagNames(tags),shown=compact?names.slice(0,limit):names,remaining=compact?names.slice(limit):[]
  if(!names.length)return null
  return <div aria-label="Etiquetas da Ana" className={`flex min-w-0 items-center gap-1 text-[10px] ${compact?'overflow-hidden':'flex-wrap'}`}>
    <span className="shrink-0 font-medium text-indigo-700 dark:text-indigo-300">Ana:</span>
    {shown.map(tag=><span key={tag} title={tag} className={`min-w-0 rounded border border-indigo-500/20 bg-indigo-500/5 px-1.5 py-0.5 text-indigo-700 dark:text-indigo-300 ${compact?'max-w-[130px] truncate':'max-w-full break-words whitespace-normal'}`}>{tag}</span>)}
    {!!remaining.length&&<span title={remaining.join(', ')} aria-label={`Mais ${remaining.length} etiquetas da Ana: ${remaining.join(', ')}`} className="shrink-0 text-ink-muted">+{remaining.length}</span>}
  </div>
}
export function ChatResolutionBadge({conversation}:{conversation?:Conversation}) {
  const resolution=chatResolution(conversation)
  const label=resolution&&[resolution.label,resolution.reason].filter(Boolean).join(' · ')
  return resolution?<span title={label||undefined} className="inline-block max-w-full truncate rounded border border-accent/20 bg-accent/5 px-1.5 py-0.5 text-[10px] text-accent">{label}</span>:null
}
export function ChatAnaContext({conversation}:{conversation?:Conversation}) {
  const resolution=chatResolution(conversation)
  return <section aria-label="Etiquetas da Ana e encerramento" className="space-y-2">
    <h3 className="text-xs font-medium text-ink-muted">Etiquetas da Ana</h3>
    {anaTagNames(conversation?.ana_tags).length?<ChatAnaTags tags={conversation?.ana_tags} compact={false}/>:<p className="text-xs text-ink-muted">Nenhuma etiqueta da Ana sincronizada.</p>}
    <p className="text-[10px] text-ink-faint">Atualizadas pela Ana. As etiquetas do CRM são gerenciadas separadamente abaixo.</p>
    {resolution&&<div className="space-y-1 rounded-lg border border-accent/20 bg-accent/5 p-3 text-xs">
      <p className="font-medium text-accent">{resolution.label}</p>
      {resolution.reason&&<p className="break-words text-ink-muted">{resolution.reason}</p>}
      {resolution.closedAt&&<p className="text-[10px] text-ink-muted">{resolution.closedLabel} <time dateTime={resolution.closedAt}>{new Date(resolution.closedAt).toLocaleString('pt-BR')}</time></p>}
      {resolution.observedAt&&<p className="text-[10px] text-ink-muted">Etiqueta atualizada em <time dateTime={resolution.observedAt}>{new Date(resolution.observedAt).toLocaleString('pt-BR')}</time></p>}
    </div>}
  </section>
}
