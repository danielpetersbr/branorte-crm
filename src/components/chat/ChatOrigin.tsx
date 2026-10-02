import * as Popover from '@radix-ui/react-popover'
import { ExternalLink, Loader2, Megaphone, X } from 'lucide-react'
import { chatOriginDate, chatOriginUrl, type ChatOrigin } from '../../lib/chat-origin'

type OriginProps={data?:ChatOrigin|null;loading?:boolean;error?:boolean;onRetry:()=>void}
const codeLabels={message:'Código na primeira mensagem recebida',lead:'Código registrado no CRM',ad:'Código associado ao anúncio'}

export function ChatOriginCard({data,loading=false,error=false,onRetry}:OriginProps) {
  const creativeUrl=chatOriginUrl(data?.creative?.url),adUrl=chatOriginUrl(data?.ad?.url),seenAt=chatOriginDate(data?.ad?.seen_at)
  const platform=data?.ad?.platform?.trim().toLowerCase()
  const adOrigin=platform==='facebook'?'Anúncio do Facebook':platform==='instagram'?'Anúncio do Instagram':'Anúncio com clique registrado'
  const registered=data?.origin?.trim(),origin=registered?.toLowerCase()==='atendimento_auto'?null:registered
  return <section aria-label="Origem do cliente" className="space-y-3 text-xs">
    <h3 className="pr-6 text-sm font-semibold text-ink">Origem do cliente</h3>
    {error?<div role="alert" className="space-y-2 text-danger"><p>Não foi possível carregar a origem.</p><button type="button" onClick={onRetry} className="rounded-lg border border-border px-3 py-2 text-accent hover:bg-surface-2">Tentar novamente</button></div>
      :loading&&!data?<p role="status" className="flex items-center gap-2 text-ink-muted"><Loader2 size={14} className="animate-spin"/>Carregando origem…</p>
      :<>
        {data?.ad&&<p className="text-ink-muted">{adOrigin}</p>}
        {origin?<p className="break-words text-ink-muted"><span className="font-medium">Origem registrada:</span> {origin}</p>:!data?.ad&&<p className="text-ink-muted">Origem não identificada.</p>}
        {data?.code?.trim()&&<div className="space-y-1 rounded-lg border border-border bg-surface-2 p-2.5">
          <p className="text-[11px] text-ink-muted">{data.code_source?codeLabels[data.code_source]:'Código registrado'}</p>
          <p className="break-words font-mono font-semibold text-accent">{data.code}</p>
          {data.creative?.name&&<p className="break-words font-medium text-ink">{data.creative.name}</p>}
          {data.creative?.headline&&<p className="break-words text-ink-muted">{data.creative.headline}</p>}
          <p className="text-[10px] text-ink-faint">O código identifica o criativo; não confirma uma campanha específica.</p>
        </div>}
        {!data?.code?.trim()&&data?.creative&&<div className="space-y-1">{data.creative.name&&<p className="break-words font-medium text-ink">{data.creative.name}</p>}{data.creative.headline&&<p className="break-words text-ink-muted">{data.creative.headline}</p>}</div>}
        {creativeUrl&&<a href={creativeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Ver criativo<ExternalLink size={12}/></a>}
        {data?.ad&&<div className="space-y-1.5 border-t border-border pt-3">
          <h4 className="font-medium text-ink">Último clique registrado</h4>
          <p className="break-words text-ink-muted">{data.ad.name?.trim()||data.ad.title?.trim()||'Anúncio sem nome registrado'}</p>
          {data.ad.id&&<p className="break-all text-[10px] text-ink-faint">ID do anúncio: {data.ad.id}</p>}
          {data.ad.platform&&<p className="break-words text-ink-muted">Plataforma: {data.ad.platform}</p>}
          {data.ad.campaign&&<p className="break-words text-ink-muted">Campanha: {data.ad.campaign}</p>}
          {data.ad.adset&&<p className="break-words text-ink-muted">Conjunto: {data.ad.adset}</p>}
          {seenAt&&<time dateTime={seenAt} className="block text-[10px] text-ink-faint">{new Date(seenAt).toLocaleString('pt-BR')}</time>}
          {adUrl&&<a href={adUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Ver anúncio<ExternalLink size={12}/></a>}
          <p className="text-[10px] text-ink-faint">Esse clique pode ser posterior à primeira entrada do cliente.</p>
        </div>}
        {!data?.code&&!data?.creative&&!data?.ad&&<p className="text-[10px] text-ink-faint">Nenhum código ou anúncio identificado foi registrado para esta conversa.</p>}
      </>}
  </section>
}

export function ChatOriginButton(props:OriginProps) {
  const code=props.data?.code?.trim(),creative=props.data?.creative?.name?.trim()
  return <Popover.Root>
    <Popover.Trigger asChild><button type="button" aria-label="Origem do cliente" title={creative?`Origem do cliente · ${creative}`:'Origem do cliente'} className="inline-flex h-8 max-w-[160px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-xs text-ink-muted hover:bg-surface-2 data-[state=open]:bg-accent/10 data-[state=open]:text-accent"><Megaphone size={15} className="shrink-0"/><span className="hidden min-w-0 truncate sm:inline">{code?`Origem · ${code}`:'Origem'}</span></button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Origem do cliente" className="relative z-50 w-[340px] max-w-[calc(100vw-24px)] max-h-[min(32rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-xl border border-border bg-surface p-3 text-ink shadow-xl">
      <Popover.Close asChild><button type="button" aria-label="Fechar origem do cliente" className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-muted hover:bg-surface-2"><X size={14}/></button></Popover.Close>
      <ChatOriginCard {...props}/>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
