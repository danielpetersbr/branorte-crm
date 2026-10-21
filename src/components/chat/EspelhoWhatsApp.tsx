import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ArrowLeft, Ban, Check, ChevronDown, Contact2, Eye, FileText, Image as ImageIcon, MapPin, MessageSquare, Mic, PhoneCall, Search, SlidersHorizontal, Sticker, Video, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatAvatar, ChatMedia } from '@/components/chat/ChatMedia'
import { MSGS_PAGINA_INCREMENTO, MSGS_PAGINA_INICIAL, useWaKanban, useWaMensagens, type WaMensagem } from '@/hooks/useWaKanban'
import { corpoVisivel, FAMILIA_CHIP, familiaDe, formatarTelefone, nomeContato, tempoRelativo } from '@/lib/wa-funil'
import { achatarConversas, chaveConversa, CONTA_ANA, etiquetasDaLista, filtrarConversas, nomeEtiqueta, rotuloConta, type ContaWhatsApp, type ConversaEspelho, type FiltroEspelho } from '@/lib/whatsapp-espelho'

const inputClass='w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/30'
const buttonClass='inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed'
const LISTA_PAGINA=80

const hoje=()=>new Date().toDateString()
function horaDaLista(iso:string|null):string {
  if(!iso)return ''
  const d=new Date(iso)
  if(Number.isNaN(d.getTime()))return ''
  return d.toDateString()===hoje()?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
}
const fmtHora=(iso:string)=>new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
const fmtDia=(iso:string)=>new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})
const fmtDuracao=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`

/** Seletor de conta no topo da tela: Ana (atendimento) ou o WhatsApp de um vendedor (espelho). */
export function ContaWhatsAppSwitcher({conta,contas,onChange,carregando}:{conta:string;contas:ContaWhatsApp[];onChange:(conta:string)=>void;carregando:boolean}) {
  const [aberto,setAberto]=useState(false)
  const atual=conta===CONTA_ANA?null:contas.find(c=>c.nome===conta)
  const rotulo=conta===CONTA_ANA?'Ana · 1144':`${rotuloConta(conta)}${atual?.final?` · ${atual.final}`:''}`
  const escolher=(nome:string)=>{setAberto(false);onChange(nome)}
  const item=(nome:string,titulo:string,detalhe:string)=><button key={nome} type="button" role="menuitemradio" aria-checked={conta===nome} onClick={()=>escolher(nome)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2',conta===nome&&'bg-accent/10')}>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{titulo}</span><span className="block truncate text-[11px] text-ink-muted">{detalhe}</span></span>
    {conta===nome&&<Check size={15} className="shrink-0 text-accent"/>}
  </button>
  return <Popover.Root open={aberto} onOpenChange={setAberto}>
    <Popover.Trigger asChild><button type="button" aria-label={`Conta de WhatsApp: ${rotulo}. Trocar conta`} title="Trocar a conta de WhatsApp" className="inline-flex h-7 max-w-[160px] shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink data-[state=open]:bg-accent/10 data-[state=open]:text-accent">
      <span className="truncate">{rotulo}</span>{conta!==CONTA_ANA&&<Eye size={12} className="shrink-0" aria-hidden/>}<ChevronDown size={12} className={cn('shrink-0 transition-transform',aberto&&'rotate-180')}/>
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={12} role="menu" aria-label="Contas de WhatsApp" className="z-50 w-[280px] max-w-[calc(100vw-24px)] max-h-[min(70dvh,var(--radix-popover-content-available-height))] overflow-y-auto rounded-xl border border-border bg-surface p-2 text-ink shadow-xl">
      <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Atendimento</p>
      {item(CONTA_ANA,'Ana · 1144','Responder, assumir e finalizar')}
      <p className="mt-2 border-t border-border px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">WhatsApp dos vendedores · só leitura</p>
      {carregando&&<p className="px-3 py-2 text-xs text-ink-muted">Carregando contas…</p>}
      {!carregando&&!contas.length&&<p className="px-3 py-2 text-xs text-ink-muted">Nenhuma conta espelhada.</p>}
      {contas.map(c=>item(c.nome,`${rotuloConta(c.nome)}${c.final?` · ${c.final}`:''}`,'Conversas do WhatsApp dele'))}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

/** Situação do espelho para o topo da tela (no lugar do "Tempo real conectado" da Ana). */
export function useEspelhoStatus(vendedor:string|null) {
  const kanban=useWaKanban(vendedor)
  return {ultimaSync:kanban.data?.ultimaSync??null,erro:kanban.isError}
}

function ChipEtiqueta({nome}:{nome:string}) {
  const rotulo=nomeEtiqueta(nome)
  return <span title={`Etiqueta no WhatsApp do vendedor: ${rotulo}`} className={cn('inline-block max-w-[130px] truncate rounded border px-1.5 text-[10px] font-medium leading-4',FAMILIA_CHIP[familiaDe(nome)].normal)}>{rotulo}</span>
}

const TIPOS:Record<string,{Icon:typeof Mic;label:string}>={
  ptt:{Icon:Mic,label:'Áudio'},audio:{Icon:Mic,label:'Áudio'},image:{Icon:ImageIcon,label:'Foto'},video:{Icon:Video,label:'Vídeo'},
  document:{Icon:FileText,label:'Documento'},sticker:{Icon:Sticker,label:'Figurinha'},location:{Icon:MapPin,label:'Localização'},
  vcard:{Icon:Contact2,label:'Contato compartilhado'},multi_vcard:{Icon:Contact2,label:'Contatos compartilhados'},call_log:{Icon:PhoneCall,label:'Ligação'},
}
const temArquivo=(url:string|null)=>!!url&&/^https:\/\//i.test(url)

function BolhaEspelho({m,vendedor}:{m:WaMensagem;vendedor:string}) {
  const texto=corpoVisivel(m.body)
  const meta=TIPOS[m.tipo]
  const deMim=m.from_me===true,indefinido=m.from_me==null
  const ehAudio=m.tipo==='ptt'||m.tipo==='audio',ehFoto=m.tipo==='image'||m.tipo==='sticker'
  const arquivo=temArquivo(m.media_url)
  const antiga=!!m.data_msg&&Date.now()-Date.parse(m.data_msg)>10*86_400_000
  return <div className={cn('flex',indefinido?'justify-center':deMim?'justify-end':'justify-start')}>
    <div className={cn('max-w-[88%] sm:max-w-[78%] rounded-xl border px-3 py-2 shadow-sm',indefinido?'border-border bg-surface-2/60 text-ink-muted':deMim?'bg-accent/10 border-accent/20 rounded-tr-sm':'bg-surface border-border rounded-tl-sm')}>
      {deMim&&<p className="mb-1 text-xs font-semibold text-accent">{rotuloConta(vendedor)} · WhatsApp</p>}
      {m.tipo==='revoked'?<p className="flex items-center gap-1.5 text-xs italic text-ink-faint"><Ban size={13}/>Mensagem apagada</p>:<>
        {meta&&!(ehFoto&&arquivo)&&!(ehAudio&&arquivo)&&<p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"><meta.Icon size={14}/>{meta.label}{m.duracao_seg?<span className="tabular-nums">· {fmtDuracao(m.duracao_seg)}</span>:null}</p>}
        {(ehAudio||ehFoto)&&arquivo&&<ChatMedia type={m.tipo} url={m.media_url}/>}
        {ehAudio&&arquivo&&!!m.duracao_seg&&<p className="mt-1 text-[10px] tabular-nums text-ink-faint">{fmtDuracao(m.duracao_seg)}</p>}
        {(ehAudio||m.tipo==='image')&&!arquivo&&<p className="mt-0.5 text-[11px] italic text-ink-faint">{m.media_url==='unavailable'||antiga?'Arquivo expirou no aparelho':'Arquivo ainda não copiado pro CRM'}</p>}
        {['video','document','sticker'].includes(m.tipo)&&!arquivo&&<p className="mt-0.5 text-[11px] italic text-ink-faint">Abre só no WhatsApp do vendedor</p>}
        {texto&&<p className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed',(meta||arquivo)&&'mt-1.5')}>{texto}</p>}
        {!texto&&!meta&&<p className="text-xs italic text-ink-faint">({m.tipo})</p>}
        {m.transcricao&&<details className="mt-2 text-xs text-ink-muted"><summary className="cursor-pointer">Transcrição do áudio</summary><p className="mt-1 whitespace-pre-wrap">{m.transcricao}</p></details>}
      </>}
      <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-ink-faint">{indefinido&&<span title="A extensão não identificou quem mandou">autoria?</span>}{m.data_msg&&<time dateTime={m.data_msg}>{fmtHora(m.data_msg)}</time>}{deMim&&<Check size={12}/>}</div>
    </div>
  </div>
}

function ConversaEspelhoPainel({conversa,vendedor,onVoltar}:{conversa:ConversaEspelho;vendedor:string;onVoltar:()=>void}) {
  const [limite,setLimite]=useState(MSGS_PAGINA_INICIAL)
  const historico=useWaMensagens(vendedor,conversa.chat_id,!!conversa.chat_id,limite)
  const mensagens=historico.data?.mensagens??[]
  const area=useRef<HTMLDivElement>(null),grudado=useRef(true),alturaAntes=useRef<number|null>(null)
  const nome=nomeContato(conversa.contact_name,conversa.phone)
  useLayoutEffect(()=>{
    const el=area.current
    if(!el)return
    if(alturaAntes.current!=null){el.scrollTop=el.scrollHeight-alturaAntes.current;alturaAntes.current=null;return}
    if(grudado.current)el.scrollTop=el.scrollHeight
  },[mensagens.length,mensagens[mensagens.length-1]?.msg_id])
  let diaAnterior=''
  return <>
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface p-3 md:px-5">
      <button className="p-2 md:hidden" aria-label="Voltar para conversas" onClick={onVoltar}><ArrowLeft size={20}/></button>
      <ChatAvatar name={nome} url={conversa.foto_url}/>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{nome}</h2>
        <p className="mt-0.5 text-xs text-ink-muted">{formatarTelefone(conversa.phone)} · WhatsApp do {rotuloConta(vendedor)}</p>
        {!!conversa.etiquetas.length&&<div className="mt-1 flex flex-wrap gap-1">{conversa.etiquetas.map(e=><ChipEtiqueta key={e} nome={e}/>)}</div>}
      </div>
    </div>
    <div ref={area} onScroll={e=>{const a=e.currentTarget;grudado.current=a.scrollHeight-a.scrollTop-a.clientHeight<100}} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6" style={{backgroundImage:'radial-gradient(var(--chat-dot, rgba(128,128,128,.08)) 1px, transparent 1px)',backgroundSize:'18px 18px'}}>
      {!conversa.chat_id&&<p className="text-center text-sm text-ink-muted">Esta conversa ainda não tem identificação do WhatsApp, então o histórico não pode ser localizado.</p>}
      {historico.data?.temMais&&<div className="mb-5 text-center"><button type="button" className={cn(buttonClass,'bg-surface text-xs')} disabled={historico.isFetching} onClick={()=>{alturaAntes.current=area.current?.scrollHeight??null;setLimite(l=>l+MSGS_PAGINA_INCREMENTO)}}>Carregar mensagens anteriores</button></div>}
      {historico.isPending&&!!conversa.chat_id&&<p className="text-center text-sm text-ink-muted">Carregando histórico…</p>}
      {historico.isError&&<div role="alert" className="text-center text-sm text-danger">{historico.error.message}<div><button type="button" className={cn(buttonClass,'mt-2 text-xs')} onClick={()=>historico.refetch()}>Tentar novamente</button></div></div>}
      {!historico.isPending&&!historico.isError&&!!conversa.chat_id&&!mensagens.length&&<div className="mx-auto max-w-sm text-center text-sm text-ink-muted"><MessageSquare className="mx-auto mb-3 opacity-40"/><p>Nenhuma mensagem gravada desta conversa.</p><p className="mt-2 text-xs">Última mensagem no WhatsApp: {corpoVisivel(conversa.last_message_preview)||'—'} {conversa.last_message_at&&`(${tempoRelativo(conversa.last_message_at)})`}</p></div>}
      <div className="space-y-3">{mensagens.map(m=>{
        const dia=m.data_msg?new Date(m.data_msg).toDateString():''
        const separador=dia&&dia!==diaAnterior?<p className="py-2 text-center text-[10px] font-medium uppercase tracking-wide text-ink-faint">{fmtDia(m.data_msg!)}</p>:null
        diaAnterior=dia||diaAnterior
        return <div key={m.msg_id}>{separador}<BolhaEspelho m={m} vendedor={vendedor}/></div>
      })}</div>
    </div>
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      <p className="flex items-center gap-2 text-xs text-ink-muted"><Eye size={14} className="shrink-0 text-accent"/>Espelho só para leitura. Quem responde este cliente é o {rotuloConta(vendedor)}, no WhatsApp dele.</p>
    </div>
  </>
}

/** Lista e conversa do WhatsApp de um vendedor, sem envio. */
export function EspelhoWhatsApp({vendedor}:{vendedor:string}) {
  const kanban=useWaKanban(vendedor)
  const [busca,setBusca]=useState(''),[etiqueta,setEtiqueta]=useState(''),[filtro,setFiltro]=useState<FiltroEspelho>('todas')
  const [selecionada,setSelecionada]=useState<string|null>(null),[mostrar,setMostrar]=useState(LISTA_PAGINA)
  const conversas=useMemo(()=>achatarConversas(kanban.data),[kanban.data])
  const etiquetas=useMemo(()=>etiquetasDaLista(conversas),[conversas])
  const filtradas=useMemo(()=>filtrarConversas(conversas,{busca,etiqueta,filtro}),[conversas,busca,etiqueta,filtro])
  const aguardando=useMemo(()=>conversas.filter(c=>c.aguardando).length,[conversas])
  const aberta=selecionada?conversas.find(c=>chaveConversa(c)===selecionada)??null:null
  const filtrosAtivos=Number(!!etiqueta)+Number(filtro!=='todas')
  const nomeVendedor=rotuloConta(vendedor)
  return <div className="flex min-h-0 flex-1">
    <aside className={cn('w-full shrink-0 border-r border-border bg-surface md:w-[290px] xl:w-[320px] flex-col',aberta?'hidden md:flex':'flex')}>
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-2"><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Conversas <span className="ml-1 text-xs font-normal text-ink-muted">{kanban.isPending?'…':filtradas.length}</span></h2>
          <Popover.Root>
            <Popover.Trigger asChild><button type="button" aria-label="Filtros de conversas" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-ink-muted hover:bg-surface-2 data-[state=open]:bg-accent/10 data-[state=open]:text-accent"><SlidersHorizontal size={14}/><span>{filtro==='aguardando'?'Esperando':'Todas'}</span>{!!filtrosAtivos&&<span aria-label={`${filtrosAtivos} filtros ativos`} className="rounded-full bg-accent/10 px-1.5 text-[10px] font-semibold text-accent">{filtrosAtivos}</span>}</button></Popover.Trigger>
            <Popover.Portal><Popover.Content side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label="Filtros de conversas" className="relative z-50 w-[300px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-surface p-4 text-ink shadow-xl">
              <div className="mb-4 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Filtrar conversas</h3><Popover.Close asChild><button type="button" aria-label="Fechar filtros" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2"><X size={16}/></button></Popover.Close></div>
              <div className="space-y-3">
                <div><label htmlFor="espelho-filtro-fila" className="mb-1 block text-xs text-ink-muted">Fila</label><select id="espelho-filtro-fila" className={inputClass} value={filtro} onChange={e=>{setFiltro(e.target.value as FiltroEspelho);setMostrar(LISTA_PAGINA)}}><option value="todas">Todas as conversas</option><option value="aguardando">Cliente esperando resposta ({aguardando})</option></select></div>
                <div><label htmlFor="espelho-filtro-etiqueta" className="mb-1 block text-xs text-ink-muted">Etiqueta do WhatsApp do {nomeVendedor}</label><select id="espelho-filtro-etiqueta" className={inputClass} value={etiqueta} onChange={e=>{setEtiqueta(e.target.value);setMostrar(LISTA_PAGINA)}}><option value="">Todas as etiquetas</option><option value="__sem__">Sem etiqueta</option>{etiquetas.map(e=><option key={e.nome} value={e.nome}>{nomeEtiqueta(e.nome)} ({e.total})</option>)}</select></div>
                {!!filtrosAtivos&&<button type="button" className={cn(buttonClass,'w-full text-xs')} onClick={()=>{setFiltro('todas');setEtiqueta('')}}>Limpar filtros</button>}
              </div>
            </Popover.Content></Popover.Portal>
          </Popover.Root>
        </div>
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-ink-faint"/><input aria-label="Buscar conversa" className={cn(inputClass,'pl-9')} placeholder="Buscar nome ou telefone" value={busca} onChange={e=>{setBusca(e.target.value);setMostrar(LISTA_PAGINA)}}/></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-label={`Conversas do WhatsApp do ${nomeVendedor}`}>
        {kanban.isPending&&<p className="p-6 text-sm text-ink-muted">Carregando conversas do {nomeVendedor}…</p>}
        {kanban.isError&&<div role="alert" className="p-4 text-sm text-danger">{kanban.error.message}<button type="button" className={cn(buttonClass,'mt-2')} onClick={()=>kanban.refetch()}>Tentar novamente</button></div>}
        {!kanban.isPending&&!kanban.isError&&!filtradas.length&&<div className="p-8 text-center text-sm text-ink-muted"><MessageSquare className="mx-auto mb-3 opacity-40"/><p>{conversas.length?'Nenhuma conversa neste filtro.':`Nenhuma conversa espelhada do ${nomeVendedor} ainda.`}</p></div>}
        {filtradas.slice(0,mostrar).map(item=>{
          const chave=chaveConversa(item),nome=nomeContato(item.contact_name,item.phone),previa=corpoVisivel(item.last_message_preview)
          return <button key={chave} type="button" onClick={()=>setSelecionada(chave)} className={cn('flex w-full gap-3 border-b border-border/60 px-4 py-3.5 text-left hover:bg-surface-2',selecionada===chave&&'bg-accent/5 border-l-[3px] border-l-accent')}>
            <ChatAvatar name={nome} url={item.foto_url}/>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{nome}</span><time className="shrink-0 text-[10px] text-ink-faint">{horaDaLista(item.last_message_at)}</time></div>
              {nome.replace(/\D/g,'')!==item.phone.replace(/\D/g,'')&&<p className="mt-1 truncate text-[11px] tabular-nums text-ink-muted">{formatarTelefone(item.phone)}</p>}
              {!!item.last_message_at&&<p className="mt-1 truncate text-xs text-ink-muted">{item.last_message_from_me?'Enviada: ':''}{previa||'Mídia'}</p>}
              {!!item.etiquetas.length&&<div className="mt-2 flex flex-wrap gap-1">{item.etiquetas.slice(0,2).map(e=><ChipEtiqueta key={e} nome={e}/>)}{item.etiquetas.length>2&&<span className="text-[10px] text-ink-faint">+{item.etiquetas.length-2}</span>}</div>}
              {item.aguardando&&<p className="mt-1 text-[10px] text-amber-500">Cliente esperando · {tempoRelativo(item.last_message_at)}</p>}
            </div>
          </button>
        })}
        {filtradas.length>mostrar&&<button type="button" className="w-full p-4 text-sm text-accent" onClick={()=>setMostrar(n=>n+LISTA_PAGINA)}>Carregar mais conversas ({filtradas.length-mostrar})</button>}
      </div>
    </aside>
    <section className={cn('relative min-w-0 flex-1 flex-col',aberta?'flex':'hidden md:flex')} aria-label="Conversa selecionada">
      {aberta?<ConversaEspelhoPainel key={chaveConversa(aberta)} conversa={aberta} vendedor={vendedor} onVoltar={()=>setSelecionada(null)}/>:
        <div className="flex flex-1 items-center justify-center p-8 text-center"><div className="max-w-md">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/20 bg-accent/5 text-accent"><Eye size={34}/></div>
          <h2 className="text-xl font-semibold">WhatsApp do {nomeVendedor}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">Selecione um cliente para ver a conversa. É um espelho só para leitura: nada é enviado do WhatsApp do vendedor por aqui.</p>
          {aguardando>0&&<button type="button" className={cn(buttonClass,'mt-5 text-xs')} onClick={()=>setFiltro('aguardando')}>{aguardando} cliente{aguardando>1?'s':''} esperando resposta</button>}
        </div></div>}
    </section>
  </div>
}
