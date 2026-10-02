import {useState,type ReactNode} from 'react';
import {Check,ChevronDown,ClipboardList,Copy,FileText,Layers,MessageSquare,NotebookPen,Truck,UserRound,Wrench,X} from 'lucide-react';
import type {CardEspelho,ProjetoEspelho} from '../../lib/producao-espelho-consulta';
import {cardParado,dataCalendario,etapasQuadro,textoCard} from '../../lib/producao-espelho-quadro';
export type RecursoProducaoFicha='documento'|'video'|'fotos'|'placa'|'ordem-producao'|'anexos';
export type DetalhesProducaoFicha={projeto?:ProjetoEspelho|null;logistica?:Record<string,unknown>|null;comentarios?:readonly {id:string;conteudo:string;autor_nome:string|null;created_at:string|null;updated_at?:string|null}[]};
export type ProducaoEspelhoFichaProps={card:CardEspelho;close:()=>void;detalhes?:DetalhesProducaoFicha;carregando?:boolean;erro?:boolean;renderRecurso?:(tipo:RecursoProducaoFicha)=>ReactNode;renderComentarioAnexos?:(comentarioId:string)=>ReactNode};

const setoresFicha=[{setor:'solda',label:'Solda'},{setor:'montagem',label:'Montagem'},{setor:'expedicao',label:'Expedição'}] as const;
const andamento=(row:Record<string,unknown>|undefined)=>typeof row?.andamento==='number'?row.andamento:0;
/** Same display rule as the source: all sector rows enter the mean; status controls colour only. */
export function resumirAndamentoFicha(setores:readonly Record<string,unknown>[]) {
  const total=setores.length?Math.round(setores.reduce((sum,row)=>sum+andamento(row),0)/setores.length):0;
  return {total,segmentos:setoresFicha.map(stage=>{const row=setores.find(s=>s.setor===stage.setor),percent=andamento(row);return {...stage,andamento:percent,concluido:row?.status==='concluido'||percent>=100};})};
}
type VolumeFicha={descricao:string;comprimento:string;largura:string;altura:string;pesoKg:string};
const medidaTexto=(value:unknown)=>value===null||value===undefined?'':typeof value==='number'||typeof value==='string'?String(value).trim():'';
/** Decode the logistics display format only; the physical DTO remains untouched. */
export function volumesFicha(logistica:Record<string,unknown>|null|undefined) {
  const medidas=textoCard(logistica?.medidas),volumes:VolumeFicha[]=[];
  let formatoIndisponivel=false;
  const legacy=(value:string,peso:unknown):VolumeFicha=>{
    const numbers=value.match(/\d+(?:[.,]\d+)?/g)??[];
    return {descricao:numbers.length?'':value,comprimento:numbers[0]??'',largura:numbers[1]??'',altura:numbers[2]??'',pesoKg:medidaTexto(peso)};
  };
  if(medidas.startsWith('[')){
    try {
      const parsed:unknown=JSON.parse(medidas);
      if(!Array.isArray(parsed)||parsed.some(v=>!v||typeof v!=='object'||Array.isArray(v)))formatoIndisponivel=true;
      else for(const value of parsed){
        const row=value as Record<string,unknown>,old=legacy(textoCard(row.medidas),row.peso_kg);
        volumes.push({descricao:medidaTexto(row.descricao),comprimento:medidaTexto(row.comprimento)||old.comprimento,largura:medidaTexto(row.largura)||old.largura,altura:medidaTexto(row.altura)||old.altura,pesoKg:medidaTexto(row.peso_kg)});
      }
    } catch {formatoIndisponivel=true;}
  } else if(medidas){
    if(/[{}\[\]]/.test(medidas))formatoIndisponivel=true;
    else volumes.push(legacy(medidas,logistica?.peso_kg));
  } else if(logistica?.peso_kg!==null&&logistica?.peso_kg!==undefined||typeof logistica?.qtd_volumes==='number'&&logistica.qtd_volumes>0)volumes.push(legacy('',logistica?.peso_kg));
  const peso=(row:VolumeFicha)=>{const number=Number(row.pesoKg.replace(',','.'));return Number.isFinite(number)&&number>0?number:0;};
  return {volumes,formatoIndisponivel,totalVolumes:volumes.filter(row=>row.descricao||row.comprimento||row.largura||row.altura||peso(row)>0).length,totalPeso:volumes.reduce((sum,row)=>sum+peso(row),0)};
}
const ufsBrasil=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
export function destinoFicha(value:unknown) {
  const cidade=textoCard(value),match=/^(.*?)\s*-\s*([A-Za-z]{2})\s*$/.exec(cidade),uf=match?.[2].toLocaleUpperCase('pt-BR')??'';
  return match&&ufsBrasil.has(uf)?{cidade:match[1].trim(),uf}:{cidade,uf:''};
}
export function dataFicha(value:unknown) {
  const date=dataCalendario(value);
  return date?date.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):'Não informado';
}
function instanteFicha(value:unknown) {
  const text=textoCard(value),stamp=text?new Date(text):null;
  return stamp&&Number.isFinite(stamp.getTime())?stamp.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Não informado';
}
function Campo({label,value,children}:{label:string;value?:unknown;children?:ReactNode}) {
  const text=typeof value==='number'?String(value):textoCard(value);
  return <div className="pf-campo"><span className="pf-label">{label}</span>{children??<p className={text?'pf-value':'pf-value pf-ausente'}>{text||'Não informado'}</p>}</div>;
}
function Secao({titulo,icone,children,aberta=false,contagem}:{titulo:string;icone:ReactNode;children:ReactNode;aberta?:boolean;contagem?:number}) {
  return <details className="pf-secao" open={aberta}><summary><span className="pf-secao-icon" aria-hidden="true">{icone}</span><span>{titulo}</span>{contagem!==undefined&&<span className="pf-contagem">{contagem}</span>}<ChevronDown className="pf-chevron" size={16} aria-hidden="true"/></summary><div className="pf-secao-body">{children}</div></details>;
}
function Comentarios({comentarios,renderAnexos}:{comentarios:NonNullable<DetalhesProducaoFicha['comentarios']>;renderAnexos?:ProducaoEspelhoFichaProps['renderComentarioAnexos']}) {
  const [todos,setTodos]=useState(false);
  const time=(stamp:string|null)=>stamp&&Number.isFinite(Date.parse(stamp))?Date.parse(stamp):0;
  const sorted=[...comentarios].sort((a,b)=>time(b.created_at)-time(a.created_at));
  if(!sorted.length)return <p className="pf-ausente">Nenhum comentário.</p>;
  return <div className="pf-comentarios">{(todos?sorted:sorted.slice(0,3)).map(comment=>{
    const autor=textoCard(comment.autor_nome)||'Usuário',initials=autor.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toLocaleUpperCase('pt-BR');
    return <article key={comment.id} className="pf-comentario"><span className="pf-avatar" aria-hidden="true">{initials}</span><div><header><strong>{autor}</strong><time dateTime={comment.created_at??undefined}>{instanteFicha(comment.created_at)}</time></header><p>{comment.conteudo}</p>{renderAnexos?.(comment.id)}</div></article>;
  })}{sorted.length>3&&<button type="button" className="pf-ver-mais" onClick={()=>setTodos(v=>!v)}>{todos?'Ver menos comentários':`Ver mais ${sorted.length-3} comentários`}</button>}</div>;
}
export function ProducaoEspelhoFicha({card,close,detalhes,carregando=false,erro=false,renderRecurso,renderComentarioAnexos}:ProducaoEspelhoFichaProps) {
  const [copia,setCopia]=useState<'pronto'|'copiando'|'copiado'|'erro'>('pronto');
  const raw=card.dadosOriginais,extra=!carregando&&!erro?detalhes:undefined;
  const projeto=extra?.projeto!==undefined?extra.projeto:raw.projeto;
  const logistica=extra?.logistica!==undefined?extra.logistica:raw.logistica;
  const carga=volumesFicha(logistica),destino=destinoFicha(raw.cidade_destino);
  const stage=etapasQuadro.find(e=>e.status===card.etapa),status=stage?.label||card.etapa||'Sem etapa';
  const progress=resumirAndamentoFicha(raw.setores),codigo=textoCard(raw.codigo_rastreio);
  const recurso=(tipo:RecursoProducaoFicha,ausente:string)=>carregando?<p role="status" className="pf-ausente">Consultando {tipo==='ordem-producao'?'ordem de produção':tipo}…</p>:erro?<p className="pf-ausente">Recurso indisponível nesta consulta.</p>:renderRecurso?.(tipo)??<p className="pf-ausente">{ausente}</p>;
  const copiar=async()=>{
    if(typeof raw.codigo_rastreio!=='string'||!codigo)return;
    setCopia('copiando');
    try {await navigator.clipboard.writeText(raw.codigo_rastreio);setCopia('copiado');}catch {setCopia('erro');}
  };
  return <section aria-label="Ficha do card" className="pf-shell">
    <header className="pf-header">
      <div className="pf-header-principal"><div><h2>{card.cliente}</h2><div className="pf-identificacao"><span className="pf-etapa">{status}</span><span><UserRound size={13} aria-hidden="true"/>{card.vendedor||'Sem vendedor'}</span><span>Orç. {card.numeroOrcamento||'Não informado'}</span>{codigo&&<button type="button" className="pf-copiar" aria-label={`Copiar rastreio ${codigo}`} onClick={copiar} disabled={copia==='copiando'}>{copia==='copiado'?<Check size={12} aria-hidden="true"/>:<Copy size={12} aria-hidden="true"/>}{codigo}</button>}</div></div><button type="button" className="pf-fechar" aria-label="Fechar ficha" onClick={close}><X size={18} aria-hidden="true"/></button></div>
      {(copia==='copiado'||copia==='erro')&&<p role="status" className="pf-copia-status">{copia==='copiado'?'Rastreio copiado.':'Não foi possível copiar o rastreio.'}</p>}
    </header>
    <div className="pf-body">
      {erro&&<p role="alert" className="pf-alerta">Não foi possível consultar os detalhes. Atualize a leitura para tentar novamente.</p>}
      {cardParado(card)&&<div className="pf-parado"><strong>Pedido parado</strong><p>{textoCard(raw.parado_motivo)||'Motivo não informado.'}</p></div>}
      <section className="pf-etapa-card" aria-label="Etapa atual e andamento"><div className="pf-etapa-linha"><span className="pf-label">Etapa atual</span><strong>{status}</strong>{stage&&<span className="pf-fase">{stage.fase}</span>}</div><div className="pf-andamento-label"><span>Andamento da produção</span><strong>{progress.total}%</strong></div><div className="pf-segmentos">{progress.segmentos.map(segment=><div key={segment.setor}><div className="pf-segmento-trilho"><span className={segment.concluido?'pf-progresso-concluido':'pf-progresso'} style={{width:`${Math.max(0,Math.min(100,segment.andamento))}%`}}/></div><div className="pf-segmento-label"><span>{segment.label}</span><span>{segment.andamento}%</span></div></div>)}</div></section>
      <Secao titulo="Dados do projeto" icone={<ClipboardList size={17}/>} aberta>
        <Campo label="Observação do vendedor" value={raw.observacao_vendedor}/>
        <Campo label="Responsável pelo projeto" value={projeto?.responsavel_nome}/>
        <div className="pf-grid"><Campo label="Previsão de término" value={dataFicha(projeto?.previsao_termino)}/><Campo label="Prazo de entrega" value={dataFicha(raw.prazo_data)}/></div>
        <div className="pf-grid"><Campo label="Tensão do motor" value={raw.motor_tensao}/><Campo label="Marca do motor" value={raw.motor_marca}/></div>
        <Campo label="Equipamento" value={textoCard(raw.titulo_equipamento)||textoCard(raw.resumo_equipamentos)}/>
        <Campo label="Vídeo do projeto">{recurso('video','Nenhum vídeo disponível nesta leitura.')}</Campo>
      </Secao>
      <Secao titulo="Ações & geração" icone={<Wrench size={17}/>} aberta>
        <div className="pf-grid"><Campo label="Placa de identificação">{recurso('placa','Placa não disponível nesta leitura.')}</Campo><Campo label="PDF da ordem de produção">{recurso('ordem-producao','Ordem de produção não disponível nesta leitura.')}</Campo></div>
        <Campo label="Anexos do pedido">{recurso('anexos','Nenhum anexo disponível nesta leitura.')}</Campo>
      </Secao>
      <Secao titulo="Documento do pedido" icone={<FileText size={17}/>} aberta>
        <p className="pf-documento-aviso">A produção vê só a versão sem preços.</p>
        {recurso('documento','Documento sem preços não disponível nesta leitura.')}
      </Secao>
      <Secao titulo="Logística e transporte" icone={<Truck size={17}/>}>
        <div className="pf-grid"><Campo label="Destino" value={destino.cidade}/><Campo label="UF" value={destino.uf}/></div>
        <div className="pf-campo"><span className="pf-label">Volumes da carga</span>{carga.formatoIndisponivel?<p className="pf-ausente">Medidas registradas em formato não disponível para visualização.</p>:carga.volumes.length?<div className="pf-tabela-scroll"><table className="pf-volumes"><thead><tr><th scope="col">Volume</th><th scope="col">Comprimento</th><th scope="col">Largura</th><th scope="col">Altura</th><th scope="col">Peso (kg)</th></tr></thead><tbody>{carga.volumes.map((volume,i)=><tr key={i}><td>{volume.descricao||`Volume ${i+1}`}</td><td>{volume.comprimento||'—'}</td><td>{volume.largura||'—'}</td><td>{volume.altura||'—'}</td><td>{volume.pesoKg||'—'}</td></tr>)}</tbody></table></div>:<p className="pf-ausente">Nenhum volume registrado.</p>}<p className="pf-carga-total"><span>Total · {carga.totalVolumes} {carga.totalVolumes===1?'volume':'volumes'}</span><strong>{carga.totalPeso.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} kg</strong></p></div>
        <Campo label="Observações do transporte" value={logistica?.observacoes}/>
        <Campo label="Fotos da logística">{recurso('fotos','Nenhuma foto disponível nesta leitura.')}</Campo>
      </Secao>
      <Secao titulo="Notas" icone={<NotebookPen size={17}/>}><p className={textoCard(raw.observacoes)?'pf-notas':'pf-ausente'}>{textoCard(raw.observacoes)||'Nenhuma nota registrada.'}</p></Secao>
      <Secao titulo="Comentários" icone={<MessageSquare size={17}/>} contagem={extra?.comentarios?.length}>
        {carregando?<p role="status" className="pf-ausente">Consultando comentários…</p>:erro?<p className="pf-ausente">Comentários indisponíveis nesta consulta.</p>:extra?.comentarios?<Comentarios comentarios={extra.comentarios} renderAnexos={renderComentarioAnexos}/>:<p className="pf-ausente">Comentários não disponíveis nesta leitura.</p>}
      </Secao>
      {(raw.historico.length>0||raw.setores.some(s=>s.checklists.length>0))&&<Secao titulo="Histórico e checklists" icone={<Layers size={17}/>}>
        {raw.historico.length>0&&<div><h3 className="pf-subtitulo">Histórico de etapas</h3><ol className="pf-historico">{raw.historico.map(entry=><li key={String(entry.id)}><span>{etapasQuadro.find(e=>e.status===entry.new_status)?.label||textoCard(entry.new_status)||'Sem etapa'}</span><time>{instanteFicha(entry.changed_at)}</time></li>)}</ol></div>}
        {raw.setores.filter(s=>s.checklists.length>0).map(sector=><div key={String(sector.id)}><h3 className="pf-subtitulo">{setoresFicha.find(s=>s.setor===sector.setor)?.label||textoCard(sector.setor)||'Setor'}</h3><ul className="pf-checklist">{sector.checklists.map(item=><li key={String(item.id)}><span className={item.concluido===true?'pf-check-concluido':'pf-check-pendente'}>{item.concluido===true?'Concluído':'Pendente'}</span><div><strong>{textoCard(item.titulo)||'Item de checklist'}</strong>{textoCard(item.descricao)&&<p>{textoCard(item.descricao)}</p>}</div></li>)}</ul></div>)}
      </Secao>}
    </div>
    <footer className="pf-footer"><span>Atualizado em {instanteFicha(card.atualizadoEm)}</span><span className="pf-somente-leitura">Somente leitura</span></footer>
  </section>;
}
