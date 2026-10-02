import {filtrarEspelho,type CardEspelho,type FiltrosEspelho} from './producao-espelho-consulta';

export type FiltrosQuadro=FiltrosEspelho&{parados:''|'somente'|'sem';ordem:'antigos'|'recentes'|'entrega'};
export const filtrosIniciaisQuadro:FiltrosQuadro={busca:'',status:'',exclusao:'incluidos',vendedor:'',parados:'',ordem:'antigos'};
export const etapasQuadro=[
  {status:'PPCP',label:'PPCP',fase:'entrada'},
  {status:'PROJETOS_PADROES',label:'Projetos Padrões',fase:'projeto'},
  {status:'EM_PROJETO',label:'Projetos Especiais',fase:'projeto'},
  {status:'PROJETO_CONCLUIDO',label:'PPCP',fase:'pós-projeto'},
  {status:'SOLDA',label:'Solda',fase:'fabricação'},
  {status:'MONTAGEM',label:'Montagem',fase:'fabricação'},
  {status:'EXPEDICAO',label:'Expedição',fase:'logística'},
  {status:'ORGANIZANDO_TRANSPORTE',label:'Organizando o Transporte',fase:'logística'},
  {status:'ENTREGUE',label:'Entregue',fase:'saída'},
  {status:'ORDEM_PRODUCAO',label:'Ordem de Produção',fase:'OPs concluídas'},
  {status:'CANCELADO',label:'Cancelado',fase:'fora do fluxo'},
] as const;

export function textoCard(value:unknown){return typeof value==='string'?value.trim():'';}
export function cardParado(card:CardEspelho){return textoCard(card.dadosOriginais.parado_status).toLocaleUpperCase()==='PARADO';}

/** Parse explicitly supported calendar formats without Date's rollover or UTC midnight shift. */
export function dataCalendario(value:unknown):Date|null {
  const text=textoCard(value),iso=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text),br=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if(!iso&&!br)return null;
  if(iso&&text.includes('T')&&!Number.isFinite(Date.parse(text)))return null;
  const year=Number(iso?iso[1]:br![3]),month=Number(iso?iso[2]:br![2]),day=Number(iso?iso[3]:br![1]);
  const date=new Date(year,month-1,day);
  return year>=1900&&date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
}
const diaCalendario=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
export function prazoCard(card:CardEspelho,hoje:Date){
  const date=dataCalendario(card.dadosOriginais.prazo_data);
  if(!date)return null;
  const dias=Math.round((diaCalendario(date)-diaCalendario(hoje))/86400000);
  const base=`${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
  return {data:date,label:base+(date.getFullYear()===hoje.getFullYear()?'':`/${String(date.getFullYear()).slice(-2)}`),dias,descricao:dias<0?`${Math.abs(dias)} d de atraso`:dias===0?'entrega hoje':`faltam ${dias} d`};
}
function instanteCard(card:CardEspelho){const n=Date.parse(textoCard(card.dadosOriginais.created_at));return Number.isFinite(n)?n:null;}

export function consultarQuadro(cards:readonly CardEspelho[],filters:FiltrosQuadro){
  const search=filters.busca.trim().toLocaleLowerCase();
  return filtrarEspelho(cards,{...filters,busca:''}).filter(card=>(!search||[card.id,card.numeroOrcamento,card.cliente,card.vendedor,card.etapa,card.dadosOriginais.codigo_rastreio].some(value=>textoCard(value).toLocaleLowerCase().includes(search)))&&(filters.parados===''||(filters.parados==='somente'?cardParado(card):!cardParado(card)))).sort((a,b)=>{
    const left=filters.ordem==='entrega'?dataCalendario(a.dadosOriginais.prazo_data)?.getTime()??null:instanteCard(a);
    const right=filters.ordem==='entrega'?dataCalendario(b.dadosOriginais.prazo_data)?.getTime()??null:instanteCard(b);
    if(left===null&&right===null)return 0;if(left===null)return 1;if(right===null)return -1;
    return filters.ordem==='recentes'?right-left:left-right;
  });
}

export function agruparQuadro(cards:readonly CardEspelho[]){
  const groups=new Map<string,CardEspelho[]>();
  for(const card of cards){const rows=groups.get(card.etapa);if(rows)rows.push(card);else groups.set(card.etapa,[card]);}
  const known=new Set<string>(etapasQuadro.map(e=>e.status));
  return [...etapasQuadro,...[...groups.keys()].filter(status=>!known.has(status)).map(status=>({status,label:status||'Sem etapa',fase:'outros'}))].map(stage=>({...stage,cards:groups.get(stage.status)??[]}));
}
