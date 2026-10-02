import {useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowUpDown,CalendarDays,Check,Copy,Filter,LayoutGrid,List,PauseCircle,Printer,RefreshCw,Search,UserRound} from 'lucide-react';
import {codificarFiltroEspelho,paginarEspelho,chaveSelecaoEspelho,selecionarEspelhoPagina,type ConsultaEspelho,type CardEspelho,type FiltrosEspelho} from '../../lib/producao-espelho-consulta';
import {agruparQuadro,cardParado,consultarQuadro,etapasQuadro,filtrosIniciaisQuadro,prazoCard,textoCard,type FiltrosQuadro} from '../../lib/producao-espelho-quadro';

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
  return <section aria-label="Ficha do card" className={`${box} space-y-5`}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold break-words [overflow-wrap:anywhere]">Ficha · {card.cliente}</h2><button className={control} onClick={close}>Fechar ficha</button></div><p className="text-sm text-muted-foreground">Vínculo {raw.vinculo==='confirmado'?'confirmado com o pedido atual do Controle':'não verificado'}. Pedido confirmado: {card.pedidoId===null?'Sem vínculo confirmado':valor(card.pedidoId)}. Referências da origem aparecem abaixo como texto.</p><Metadados row={raw} omit={['vinculo','historico','logistica','setores','projeto']}/>{raw.projeto&&<section className={`${box} space-y-4`}><h3 className="font-semibold">Projeto</h3><Metadados row={raw.projeto}/></section>}<Colecao title="Histórico" rows={raw.historico}/><section className={`${box} space-y-4`}><h3 className="font-semibold">Logística · {raw.logistica===null?0:1}</h3>{raw.logistica===null?<p className="text-sm text-muted-foreground">Sem registro.</p>:<Metadados row={raw.logistica}/>}</section><Colecao title="Setores" rows={raw.setores} render={row=><><Metadados row={row} omit={['checklists']}/><Colecao title="Checklists do setor" rows={row.checklists as Record<string,unknown>[]}/></>}/></section>;
}
function Cartao({card,hoje,onOpen}:{card:CardEspelho;hoje:Date;onOpen:(button:HTMLButtonElement)=>void}) {
  const [copia,setCopia]=useState<'pronto'|'copiando'|'copiado'|'erro'>('pronto');
  const raw=card.dadosOriginais,parado=cardParado(card),prazo=prazoCard(card,hoje),entregue=card.etapa==='ENTREGUE';
  const nota=parado?textoCard(raw.parado_motivo):'';
  const equipamento=textoCard(raw.titulo_equipamento);
  const tensao=textoCard(raw.motor_tensao_vendedor)||textoCard(raw.motor_tensao);
  const motor=[tensao?(/^motor\b/i.test(tensao)?tensao:`Motor ${tensao}`):'',textoCard(raw.motor_marca)].filter(Boolean).join(' · ');
  const entrada=new Date(textoCard(raw.created_at)),dataEntrada=Number.isFinite(entrada.getTime())?entrada.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace(' de ',' ').replace('.',''):'';
  const codigo=textoCard(raw.codigo_rastreio);
  const revisado=!!textoCard(raw.orcamento_revisado_em)&&!textoCard(raw.orcamento_revisado_visto_em),op=/^OP\b/i.test(card.numeroOrcamento??'');
  const projeto=['PROJETOS_PADROES','EM_PROJETO'].includes(card.etapa)&&raw.projeto&&typeof raw.projeto==='object'&&!Array.isArray(raw.projeto)?raw.projeto as Record<string,unknown>:null;
  const responsavel=textoCard(projeto?.responsavel_nome),estadoProjeto=textoCard(projeto?.status_projeto);
  const corProjeto=estadoProjeto==='concluido'?'concluido':estadoProjeto==='em_andamento'?'andamento':estadoProjeto==='bloqueado'?'bloqueado':'neutro';
  const descricaoProjeto=estadoProjeto==='concluido'?'Projeto concluído':estadoProjeto==='em_andamento'?'Projetista trabalhando':estadoProjeto==='bloqueado'?'Projeto bloqueado':'Responsável pelo projeto';
  const copiar=async()=>{
    if(typeof raw.codigo_rastreio!=='string'||!raw.codigo_rastreio.trim())return;
    setCopia('copiando');
    try {await navigator.clipboard.writeText(raw.codigo_rastreio);setCopia('copiado');}
    catch {setCopia('erro');}
  };
  return <div data-card-shell={card.id} className={`pq-card${parado?' pq-card-parado':responsavel?` pq-card-projeto-${corProjeto}`:''}`}>
    <button data-card-id={card.id} className="pq-card-open" onClick={event=>onOpen(event.currentTarget)} aria-label={`Abrir ficha: ${card.cliente}`}>
    <span className="pq-card-top"><span className="pq-orcamento">{card.numeroOrcamento||'Sem orçamento'}</span>{parado&&<span className="pq-parado">PARADO</span>}{op&&<span className="pq-flag">OP</span>}{revisado&&<span className="pq-flag pq-flag-revisado">REVISADO</span>}{raw.excluido===true&&<span className="pq-parado">Excluído</span>}<span className="pq-entrada" title={dataEntrada?`Entrou na produção em ${entrada.toLocaleDateString('pt-BR')}`:undefined}>{dataEntrada}</span></span>
    <span className="pq-cliente">{card.cliente}</span>
    <span className="pq-vendedor">{card.vendedor||'Sem vendedor'}</span>
    {equipamento&&<span className="pq-equipamento" title={equipamento}>{equipamento}</span>}
    {nota&&<span className="pq-nota-parado" title={nota}><span className="pq-nota">{nota}</span></span>}
    {motor&&<span className="pq-motor" title={motor}>{motor}</span>}
    <span className={`pq-prazo${prazo&&prazo.dias<0&&!entregue?' pq-prazo-atrasado':''}${!prazo?' pq-prazo-vazio':''}`} title={prazo?`Entrega: ${prazo.data.toLocaleDateString('pt-BR')}${entregue?'':` · ${prazo.descricao}`}`:undefined}>
      <CalendarDays size={13} aria-hidden="true"/>{prazo?<><strong><span className="sr-only">Entrega: </span>{prazo.label}</strong>{!entregue&&<span>{prazo.descricao}</span>}</>:<span>Sem data de entrega</span>}
    </span>
    </button>
    {(codigo||responsavel)&&<span className="pq-card-bottom">{codigo&&<button className="pq-rastreio" aria-label={`Copiar rastreio ${codigo}`} title={copia==='copiado'?'Rastreio copiado':copia==='erro'?'Não foi possível copiar. Tente novamente.':'Copiar rastreio'} onClick={copiar} disabled={copia==='copiando'}>{copia==='copiado'?<Check size={12} aria-hidden="true"/>:<Copy size={12} aria-hidden="true"/>}{codigo}</button>}{responsavel&&<span className={`pq-responsavel pq-responsavel-${corProjeto}`} title={`${descricaoProjeto} · ${responsavel}`}><UserRound size={11} aria-hidden="true"/>{responsavel}</span>}{(copia==='copiado'||copia==='erro')&&<span role="status" className={`pq-copia-feedback pq-copia-${copia}`}>{copia==='copiado'?'Copiado':'Não foi possível copiar'}</span>}</span>}
  </div>;
}
function Kanban({cards,hoje,onOpen}:{cards:readonly CardEspelho[];hoje:Date;onOpen:(card:CardEspelho,button:HTMLButtonElement)=>void}) {
  return <div aria-label="Kanban de produção" role="region" tabIndex={0} className="pq-kanban">{agruparQuadro(cards).map((column,i)=><section key={column.status} data-etapa={column.status} aria-label={`${column.label}: ${column.cards.length} cards`} className="pq-coluna">
    <header className="pq-coluna-header"><span className="pq-fase">{i<8?`${String(i+1).padStart(2,'0')} · `:''}{column.fase}</span><span className="pq-coluna-title"><h2>{column.label}{['SOLDA','MONTAGEM'].includes(column.status)&&<small> · Jaison</small>}</h2><span className="pq-contagem">{column.cards.length}</span></span></header>
    <div className="pq-coluna-cards">{column.cards.map(card=><Cartao key={card.id} card={card} hoje={hoje} onOpen={button=>onOpen(card,button)}/>)}{!column.cards.length&&<p className="pq-sem-cards">Sem pedidos</p>}</div>
  </section>)}</div>;
}
function MarcaQuadro(){return <span className="pq-marca"><img className="pq-logo-claro" src="/branorte-logo.png" alt="Branorte"/><img className="pq-logo-escuro" src="/branorte-logo-dark.png" alt="Branorte"/></span>;}
function Catalogo({data,identityKey,atualizar,fetching}:Pick<ProducaoEspelhoViewProps,'identityKey'|'atualizar'|'fetching'>&{data:ConsultaEspelho}) {
  const [filters,setFilters]=useState(filtrosIniciaisQuadro),[page,setPage]=useState(1),[view,setView]=useState<'kanban'|'lista'>('kanban'),[selected,setSelected]=useState<{id:string;context:string}|null>(null);
  const revision=useRef(0),liveContext=useRef('');
  const cards=data.dados.cards,filtered=consultarQuadro(cards,filters),p=paginarEspelho(filtered,page),hoje=new Date(data.consultadoEm);
  const selectable=view==='kanban'?filtered:p.linhas;
  const opener=useRef<HTMLButtonElement|null>(null),liveCards=useRef(selectable);liveCards.current=selectable;
  const context=chaveSelecaoEspelho(`${identityKey}:${data.consultadoEm}:${view}`,revision.current,filters,view==='kanban'?1:p.pagina,selectable);liveContext.current=context;
  const card=selecionarEspelhoPagina(selectable,selected,context);
  const reset=()=>{revision.current++;liveContext.current='';setSelected(null);};
  const filter=(patch:Partial<FiltrosQuadro>)=>{reset();setFilters(f=>({...f,...patch}));setPage(1);};
  const move=(next:number)=>{reset();setPage(next);};
  const close=()=>{reset();};
  const open=(card:CardEspelho,button:HTMLButtonElement)=>{if(liveContext.current===context){opener.current=button;setSelected({id:card.id,context});}};
  const statuses=agruparQuadro(cards),vendors=[...new Set(cards.map(c=>c.vendedor))].sort((a,b)=>(a??'').localeCompare(b??'','pt-BR'));
  const labels:Record<string,string>={total:'Total de cards',ativos:'Em produção',entregues:'Entregues na fábrica',cancelados:'Cancelados',excluidos:'Excluídos',pedidosUnicos:'Pedidos vinculados'};
  const hasFilters=filters.busca||filters.status||filters.vendedor||filters.parados||filters.exclusao!=='incluidos'||filters.ordem!=='antigos';
  const totalSemBusca=cards.filter(c=>filters.exclusao==='todos'||c.dadosOriginais.excluido===(filters.exclusao==='excluidos')).length;
  return <div className="pq-catalogo">
    <header className="pq-toolbar">
      <div className="pq-identidade"><MarcaQuadro/><h1>Quadro de produção</h1><span className="pq-total">{filtered.length} {filtered.length===1?'pedido':'pedidos'}</span></div>
      <div className="pq-filtros">
        <label className="pq-controle pq-busca"><Search size={15} aria-hidden="true"/><span className="sr-only">Buscar pedido, cliente ou ID</span><input value={filters.busca} onChange={e=>filter({busca:e.target.value})} placeholder="Buscar pedido, cliente…"/></label>
        <label className="pq-controle"><UserRound size={14} aria-hidden="true"/><span className="sr-only">Vendedor</span><select aria-label="Vendedor" value={filters.vendedor} onChange={e=>filter({vendedor:e.target.value})}><option value="">Vendedor</option>{vendors.map(v=><option key={codificarFiltroEspelho(v)} value={codificarFiltroEspelho(v)}>{v||'Sem vendedor'}</option>)}</select></label>
        <label className="pq-controle"><LayoutGrid size={14} aria-hidden="true"/><span className="sr-only">Etapa</span><select aria-label="Etapa" value={filters.status} onChange={e=>filter({status:e.target.value})}><option value="">Todas etapas</option>{statuses.map(v=><option key={v.status} value={codificarFiltroEspelho(v.status)}>{v.label}{v.status==='PROJETO_CONCLUIDO'?' · pós-projeto':''}</option>)}</select></label>
        <label className="pq-controle"><PauseCircle size={14} aria-hidden="true"/><span className="sr-only">Parados</span><select aria-label="Parados" value={filters.parados} onChange={e=>filter({parados:e.target.value as FiltrosQuadro['parados']})}><option value="">Parados</option><option value="somente">Somente parados</option><option value="sem">Sem parados</option></select></label>
        <label className="pq-controle"><ArrowUpDown size={14} aria-hidden="true"/><span className="sr-only">Ordenação</span><select aria-label="Ordenação" value={filters.ordem} onChange={e=>filter({ordem:e.target.value as FiltrosQuadro['ordem']})}><option value="antigos">Mais antigo primeiro</option><option value="recentes">Mais recente primeiro</option><option value="entrega">Data de entrega</option></select></label>
      </div>
      <div className="pq-acoes">
        <div className="pq-visualizacao" aria-label="Visualização da produção">{(['kanban','lista'] as const).map(mode=><button key={mode} aria-pressed={view===mode} onClick={()=>{reset();setView(mode);setPage(1);}}>{mode==='kanban'?<LayoutGrid size={14} aria-hidden="true"/>:<List size={14} aria-hidden="true"/>}{mode==='kanban'?'Kanban':'Lista'}</button>)}</div>
        <button className="pq-icon-button" aria-label="Atualizar leitura" title="Atualizar leitura" disabled={fetching} onClick={atualizar}><RefreshCw size={16} className={fetching?'animate-spin':''} aria-hidden="true"/></button>
        <button className="pq-icon-button" aria-label="Imprimir quadro" title="Imprimir quadro" onClick={()=>window.print()}><Printer size={16} aria-hidden="true"/></button>
      </div>
    </header>
    {hasFilters&&<div className="pq-filtros-ativos"><span>{filtered.length} de {totalSemBusca} pedidos · {filters.exclusao==='todos'?'incluindo excluídos':filters.exclusao==='excluidos'?'somente excluídos':'sem excluídos'}</span><button onClick={()=>{reset();setFilters(filtrosIniciaisQuadro);setPage(1);}}>Limpar filtros</button></div>}
    {view==='kanban'?<Kanban cards={filtered} hoje={hoje} onOpen={open}/>:<section className="pq-lista" aria-label="Lista de produção"><div className="pq-lista-cards">{p.linhas.map(c=><div key={c.id}><p className="pq-lista-etapa">{etapasQuadro.find(e=>e.status===c.etapa)?.label||c.etapa||'Sem etapa'}</p><Cartao card={c} hoje={hoje} onOpen={button=>open(c,button)}/></div>)}</div><Paginacao page={p.pagina} pages={p.paginas} total={p.total} onPage={move} label="cards"/></section>}
    {!filtered.length&&<p className="pq-nenhum">Nenhum pedido corresponde aos filtros.</p>}
    <footer className="pq-leitura"><span title="As alterações continuam no sistema de Controle de Produção">Somente leitura</span><details><summary><Filter size={13} aria-hidden="true"/> Opções e indicadores</summary><div className="pq-opcoes"><label>Exclusão<select aria-label="Exclusão" value={filters.exclusao} onChange={e=>filter({exclusao:e.target.value as FiltrosEspelho['exclusao']})}><option value="incluidos">Sem excluídos</option><option value="todos">Todos os cards</option><option value="excluidos">Somente excluídos</option></select></label><section aria-label="Indicadores da produção" className="pq-indicadores">{Object.entries(data.dados.kpis).map(([key,value])=><div key={key}><span>{labels[key]??key}</span><strong>{value}</strong></div>)}</section><p>ENTREGUE é o status da fábrica; não comprova entrega ao cliente.</p><details><summary>Contagens por status e setor</summary><div className="grid gap-4 sm:grid-cols-2 pt-3"><Metadados row={data.dados.porEtapa}/><Metadados row={data.dados.porSetor}/></div></details><details><summary>Detalhes da leitura da fábrica</summary><p>Fonte: Controle de Produção</p><p>Momento da leitura: {data.consultadoEm}</p><p>Atualização global da fonte não confirmada.</p><p>{data.aviso}</p><p>Alterações continuam no sistema de produção.</p><p>Cards: {data.totals.cards} · Histórico: {data.totals.historico} · Logística: {data.totals.logistica} · Setores: {data.totals.setores} · Checklists: {data.totals.checklists}.</p><p>Metadados de arquivos são texto; conteúdo de arquivos não está disponível nesta leitura.</p></details></div></details></footer>
    <Dialog.Root open={!!card} onOpenChange={isOpen=>{if(!isOpen)close();}}>{card&&<Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60"/><Dialog.Content onCloseAutoFocus={event=>{event.preventDefault();const button=opener.current;if(button?.isConnected&&liveCards.current.some(c=>c.id===button.dataset.cardId))button.focus();}} className="fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-4xl max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-surface border border-border shadow-xl focus:outline-none"><Dialog.Title className="sr-only">Ficha de produção</Dialog.Title><Dialog.Description className="sr-only">Consulta dos dados do card na fábrica.</Dialog.Description><Ficha key={card.id} card={card} close={close}/></Dialog.Content></Dialog.Portal>}</Dialog.Root>
  </div>;
}
/** Synthetic preview entry: no hook, Auth, client or API imports. */
export function ProducaoEspelhoView({data,autorizado,identityKey,loading,fetching,error,atualizar}:ProducaoEspelhoViewProps) {
  const visible=autorizado&&!error&&!loading?data:undefined;
  return <main className="producao-quadro text-ink min-w-0">{visible?<Catalogo key={identityKey} data={visible} identityKey={identityKey} atualizar={atualizar} fetching={fetching}/>:<><header className="pq-toolbar"><div className="pq-identidade"><MarcaQuadro/><h1>Quadro de produção</h1></div>{autorizado&&<button className="pq-icon-button" aria-label="Atualizar leitura" disabled={fetching||loading} onClick={atualizar}><RefreshCw size={16} aria-hidden="true"/></button>}</header><div className="p-4">{!autorizado?<p role="status" className={box}>Sem permissão para a produção da fábrica.</p>:error?<p role="alert" className={box}>Produção indisponível. Tente atualizar a leitura.</p>:<p role="status" className={box}>Consultando produção…</p>}</div></>}</main>;
}
export {valor as formatarValorEspelho};
