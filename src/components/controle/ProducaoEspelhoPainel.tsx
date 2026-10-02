import {useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {codificarFiltroEspelho,filtrarEspelho,paginarEspelho,chaveSelecaoEspelho,selecionarEspelhoPagina,type ConsultaEspelho,type CardEspelho,type FiltrosEspelho} from '../../lib/producao-espelho-consulta';

export type ProducaoEspelhoViewProps={data:ConsultaEspelho|undefined;autorizado:boolean;identityKey:string;loading:boolean;fetching:boolean;error:boolean;atualizar:()=>void};
const box='rounded-xl border border-border bg-surface p-4 min-w-0';
const control='rounded-lg border border-border bg-surface px-3 py-2 text-ink min-w-0 max-w-full';
function valor(value:unknown):string {return value===null?'Sem valor (SQL NULL)':typeof value==='string'?(value===''?'""':value):String(value);}
function Metadados({row,omit=[]}:{row:Record<string,unknown>;omit?:string[]}) {
  return <dl className="grid gap-3 sm:grid-cols-2 min-w-0">{Object.entries(row).filter(([key])=>!omit.includes(key)).map(([key,value])=><div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground break-all">{key}</dt><dd className="text-sm text-ink whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{valor(value)}</dd></div>)}</dl>;
}
function Paginacao({page,pages,total,onPage,label}:{page:number;pages:number;total:number;onPage:(page:number)=>void;label:string}) {
  return <nav aria-label={`Páginas de ${label}`} className="flex flex-wrap items-center gap-3 text-sm"><button className={control} disabled={page<=1} onClick={()=>onPage(page-1)}>Anterior</button><span>Página {page} de {pages} · {total} registros</span><button className={control} disabled={page>=pages} onClick={()=>onPage(page+1)}>Próxima</button></nav>;
}
function Colecao({title,rows,render}:{title:string;rows:readonly Record<string,unknown>[];render?:(row:Record<string,unknown>)=>React.ReactNode}) {
  const [page,setPage]=useState(1),p=paginarEspelho(rows,page);
  return <section className={`${box} space-y-4`}><h3 className="font-semibold">{title} · {rows.length}</h3>{!rows.length?<p className="text-sm text-muted-foreground">Sem registros.</p>:p.linhas.map((row,i)=><details key={String(row.id??row.card_id??i)} className="rounded-lg border border-border p-3 min-w-0"><summary className="cursor-pointer break-words [overflow-wrap:anywhere]">Registro {(p.pagina-1)*25+i+1} · {valor(row.titulo??row.setor??row.new_status??row.id)}</summary><div className="pt-4 space-y-4">{render?render(row):<Metadados row={row}/>}</div></details>)}<Paginacao page={p.pagina} pages={p.paginas} total={p.total} onPage={setPage} label={title}/></section>;
}
function Ficha({card,close}:{card:CardEspelho;close:()=>void}) {
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};document.addEventListener('keydown',escape);return ()=>document.removeEventListener('keydown',escape);},[close]);
  const raw=card.dadosOriginais;
  return <section aria-label="Ficha do card" className={`${box} space-y-5`}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold break-words [overflow-wrap:anywhere]">Ficha · {card.cliente}</h2><button className={control} onClick={close}>Fechar ficha</button></div><p className="text-sm text-muted-foreground">Vínculo {raw.vinculo==='confirmado'?'confirmado com o pedido atual do Controle':'não verificado'}. Pedido confirmado: {card.pedidoId===null?'Sem vínculo confirmado':valor(card.pedidoId)}. Referências da origem aparecem abaixo como texto.</p><Metadados row={raw} omit={['vinculo','historico','logistica','setores']}/><Colecao title="Histórico" rows={raw.historico}/><section className={`${box} space-y-4`}><h3 className="font-semibold">Logística · {raw.logistica===null?0:1}</h3>{raw.logistica===null?<p className="text-sm text-muted-foreground">Sem registro.</p>:<Metadados row={raw.logistica}/>}</section><Colecao title="Setores" rows={raw.setores} render={row=><><Metadados row={row} omit={['checklists']}/><Colecao title="Checklists do setor" rows={row.checklists as Record<string,unknown>[]}/></>}/></section>;
}
const initialFilters:FiltrosEspelho={busca:'',status:'',exclusao:'todos',vendedor:''};
const etapas=[
  {status:'PPCP',label:'PPCP',cor:'bg-slate-400'},
  {status:'EM_PROJETO',label:'Em projeto',cor:'bg-violet-500'},
  {status:'PROJETO_CONCLUIDO',label:'Projeto concluído',cor:'bg-blue-500'},
  {status:'SOLDA',label:'Solda',cor:'bg-orange-500'},
  {status:'MONTAGEM',label:'Montagem',cor:'bg-amber-500'},
  {status:'EXPEDICAO',label:'Expedição',cor:'bg-cyan-500'},
  {status:'ENTREGUE',label:'Entregue',cor:'bg-emerald-500'},
];
function Cartao({card,onOpen}:{card:CardEspelho;onOpen:(button:HTMLButtonElement)=>void}) {
  const raw=card.dadosOriginais;
  return <button data-card-id={card.id} className="w-full rounded-xl border border-border bg-surface p-3 text-left min-w-0 space-y-2 hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={event=>onOpen(event.currentTarget)}>
    <span className="block text-xs font-medium text-muted-foreground break-words">Orçamento: {valor(card.numeroOrcamento)}</span>
    <span className="block font-semibold text-sm break-words [overflow-wrap:anywhere]">{card.cliente}</span>
    {typeof raw.titulo_equipamento==='string'&&raw.titulo_equipamento&&<span className="block text-xs break-words [overflow-wrap:anywhere]">{raw.titulo_equipamento}</span>}
    <span className="block text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">Vendedor: {valor(card.vendedor)}</span>
    {typeof raw.prazo_data==='string'&&raw.prazo_data&&<span className="block text-xs">Prazo: {raw.prazo_data}</span>}
    <span className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-bg px-2 py-1 break-all">{card.etapa||'Status vazio'}</span>{raw.excluido===true&&<span className="rounded bg-red-500/10 px-2 py-1 text-red-500">Excluído</span>}{typeof raw.parado_status==='string'&&raw.parado_status&&<span className="rounded bg-amber-500/10 px-2 py-1">{raw.parado_status}</span>}</span>
  </button>;
}
function Kanban({cards,onOpen}:{cards:readonly CardEspelho[];onOpen:(card:CardEspelho,button:HTMLButtonElement)=>void}) {
  const groups=new Map<string,CardEspelho[]>();
  for(const card of cards){const group=groups.get(card.etapa);if(group)group.push(card);else groups.set(card.etapa,[card]);}
  const known=new Set([...etapas.map(e=>e.status),'CANCELADO']);
  const columns=[...etapas,...[...groups.keys()].filter(status=>!known.has(status)).map(status=>({status,label:status||'Status vazio',cor:'bg-slate-400'})),{status:'CANCELADO',label:'Cancelado',cor:'bg-red-500'}];
  return <div aria-label="Kanban de produção" role="region" tabIndex={0} className="flex gap-4 overflow-x-auto pb-3 min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{columns.map(column=>{
    const rows=groups.get(column.status)??[];
    return <section key={column.status} data-etapa={column.status} aria-label={`${column.label}: ${rows.length} cards`} className="w-72 sm:w-[300px] shrink-0 rounded-xl border border-border bg-bg min-w-0">
      <header className="flex items-center gap-2 border-b border-border px-3 py-3"><span className={`h-2.5 w-2.5 rounded-full shrink-0 ${column.cor}`} aria-hidden="true"/><h3 className="text-sm font-semibold min-w-0 break-words [overflow-wrap:anywhere]">{column.label}</h3><span className="ml-auto rounded-md bg-surface px-2 py-0.5 text-xs shrink-0">{rows.length}</span></header>
      <div className="max-h-[65vh] min-h-40 overflow-y-auto p-2 space-y-2">{rows.map(card=><Cartao key={card.id} card={card} onOpen={button=>onOpen(card,button)}/>)}{!rows.length&&<p className="py-5 text-center text-xs text-muted-foreground">Sem cards nesta etapa.</p>}</div>
    </section>;
  })}</div>;
}
function Catalogo({data,identityKey}:Pick<ProducaoEspelhoViewProps,'identityKey'>&{data:ConsultaEspelho}) {
  const [filters,setFilters]=useState(initialFilters),[page,setPage]=useState(1),[view,setView]=useState<'kanban'|'lista'>('kanban'),[selected,setSelected]=useState<{id:string;context:string}|null>(null);
  const revision=useRef(0),liveContext=useRef('');
  const cards=data.dados.cards,filtered=filtrarEspelho(cards,filters),p=paginarEspelho(filtered,page);
  const selectable=view==='kanban'?filtered:p.linhas;
  const opener=useRef<HTMLButtonElement|null>(null),liveCards=useRef(selectable);liveCards.current=selectable;
  const context=chaveSelecaoEspelho(`${identityKey}:${data.consultadoEm}:${view}`,revision.current,filters,view==='kanban'?1:p.pagina,selectable);liveContext.current=context;
  const card=selecionarEspelhoPagina(selectable,selected,context);
  const reset=()=>{revision.current++;liveContext.current='';setSelected(null);};
  const filter=(patch:Partial<FiltrosEspelho>)=>{reset();setFilters(f=>({...f,...patch}));setPage(1);};
  const move=(next:number)=>{reset();setPage(next);};
  const close=()=>{reset();};
  const open=(card:CardEspelho,button:HTMLButtonElement)=>{if(liveContext.current===context){opener.current=button;setSelected({id:card.id,context});}};
  const statuses=[...new Set(cards.map(c=>c.etapa))],vendors=[...new Set(cards.map(c=>c.vendedor))];
  const labels:Record<string,string>={total:'Total de cards',ativos:'Em produção',entregues:'Entregues na fábrica',cancelados:'Cancelados',excluidos:'Excluídos',pedidosUnicos:'Pedidos vinculados'};
  return <div className="space-y-4 min-w-0">
    <section className={`${box} grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3`} aria-label="Indicadores da produção">{Object.entries(data.dados.kpis).map(([key,value])=><div key={key}><p className="text-xs text-muted-foreground">{labels[key]??key}</p><p className="text-xl font-semibold">{value}</p></div>)}</section>
    <section className={`${box} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{view==='kanban'?'Kanban de produção':'Lista de produção'}</h2><div className="flex gap-2" aria-label="Visualização da produção">{(['kanban','lista'] as const).map(mode=><button key={mode} aria-pressed={view===mode} className={`${control} ${view===mode?'bg-accent/10 border-accent font-medium':''}`} onClick={()=>{reset();setView(mode);setPage(1);}}>{mode==='kanban'?'Kanban':'Lista'}</button>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm min-w-0">Buscar<input className={`${control} block w-full mt-1`} value={filters.busca} onChange={e=>filter({busca:e.target.value})} placeholder="Cliente, vendedor, orçamento, status ou ID"/></label>
        <label className="text-sm min-w-0">Status<select className={`${control} block w-full mt-1`} value={filters.status} onChange={e=>filter({status:e.target.value})}><option value="">Todos os status</option>{statuses.map(v=><option key={v} value={codificarFiltroEspelho(v)}>{valor(v)}</option>)}</select></label>
        <label className="text-sm min-w-0">Exclusão<select className={`${control} block w-full mt-1`} value={filters.exclusao} onChange={e=>filter({exclusao:e.target.value as FiltrosEspelho['exclusao']})}><option value="todos">Todos os cards</option><option value="incluidos">Sem excluídos</option><option value="excluidos">Somente excluídos</option></select></label>
        <label className="text-sm min-w-0">Vendedor<select className={`${control} block w-full mt-1`} value={filters.vendedor} onChange={e=>filter({vendedor:e.target.value})}><option value="">Todos os vendedores</option>{vendors.map(v=><option key={codificarFiltroEspelho(v)} value={codificarFiltroEspelho(v)}>{valor(v)}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>Total autorizado: {cards.length} · Filtrados: {filtered.length}{view==='lista'?` · Nesta página: ${p.linhas.length}`:''}</p><button className={control} onClick={()=>{reset();setFilters(initialFilters);setPage(1);}}>Limpar filtros</button></div>
      {view==='kanban'?<Kanban cards={filtered} onOpen={open}/>:<><div className="grid gap-3">{p.linhas.map(c=><Cartao key={c.id} card={c} onOpen={button=>open(c,button)}/>)}</div><Paginacao page={p.pagina} pages={p.paginas} total={p.total} onPage={move} label="cards"/></>}
      {!filtered.length&&<p className="text-muted-foreground">Nenhum card corresponde aos filtros.</p>}
    </section>
    <details className={`${box} text-sm`}><summary className="cursor-pointer">Contagens por status e setor</summary><p className="pt-3 text-xs text-muted-foreground">ENTREGUE é o status da fábrica; não comprova entrega ao cliente. Por setor conta registros de setores.</p><div className="grid gap-4 sm:grid-cols-2 pt-3"><Metadados row={data.dados.porEtapa}/><Metadados row={data.dados.porSetor}/></div></details>
    <Dialog.Root open={!!card} onOpenChange={isOpen=>{if(!isOpen)close();}}>{card&&<Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60"/><Dialog.Content onCloseAutoFocus={event=>{event.preventDefault();const button=opener.current;if(button?.isConnected&&liveCards.current.some(c=>c.id===button.dataset.cardId))button.focus();}} className="fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-4xl max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-surface border border-border shadow-xl focus:outline-none"><Dialog.Title className="sr-only">Ficha de produção</Dialog.Title><Dialog.Description className="sr-only">Consulta dos dados do card na fábrica.</Dialog.Description><Ficha key={card.id} card={card} close={close}/></Dialog.Content></Dialog.Portal>}</Dialog.Root>
  </div>;
}
/** Synthetic preview entry: no hook, Auth, client or API imports. */
export function ProducaoEspelhoView({data,autorizado,identityKey,loading,fetching,error,atualizar}:ProducaoEspelhoViewProps) {
  const visible=autorizado&&!error&&!loading?data:undefined;
  return <main className="p-4 sm:p-6 space-y-4 text-ink min-w-0"><header className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h1 className="text-2xl font-semibold">Produção da fábrica</h1><p className="text-sm text-muted-foreground">Espelho somente leitura · Controle de Produção</p></div>{autorizado&&<button className={control} disabled={fetching||loading} onClick={atualizar}>{fetching?'Consultando…':'Atualizar leitura'}</button>}</header>{!autorizado?<p role="status" className={box}>Sem permissão para a produção da fábrica.</p>:error?<p role="alert" className={box}>Produção indisponível. Tente atualizar a leitura.</p>:!visible?<p role="status" className={box}>Consultando produção…</p>:<><Catalogo key={identityKey} data={visible} identityKey={identityKey}/><details className={`${box} text-sm`}><summary className="cursor-pointer">Detalhes da leitura da fábrica</summary><div className="pt-3 space-y-2"><p>Fonte: Controle de Produção</p><p>Momento da leitura: {visible.consultadoEm}</p><p>Atualização global da fonte não confirmada.</p><p>{visible.aviso}</p><p>Alterações continuam no sistema de produção.</p><p className="text-muted-foreground">Cards: {visible.totals.cards} · Histórico: {visible.totals.historico} · Logística: {visible.totals.logistica} · Setores: {visible.totals.setores} · Checklists: {visible.totals.checklists}. Metadados de arquivos são texto; conteúdo de arquivos não está disponível nesta leitura.</p></div></details></>}</main>;
}
export {valor as formatarValorEspelho};
