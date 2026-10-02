import type {SnapshotControleVendas} from './controle-vendas-acesso.js';
import {lerControle} from './financeiro-core.js';
export type ConsultaVendas={inicio:string;fim:string;vendedor?:string};
export type LeitorVendas=<T>(recurso:string,colunas:string,filtro?:string,options?:{signal?:AbortSignal;maxRows?:number})=>Promise<T[]>;
export class ErroControleVendas extends Error {constructor(public status:number,message:string){super(message);}}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const normalizar=(v:string)=>v.trim().toUpperCase();
const invalid=():never=>{throw new ErroControleVendas(400,'consulta_invalida');};
const unavailable=():never=>{throw new ErroControleVendas(502,'controle_indisponivel');};
const cols='id,pedido_numero,numero_orcamento,cliente,vendedor,vendedor_2,data_venda,valor_total,status,atencao_a,descricao_equipamento,data_primeiro_contato,fonte_origem,estado,equipamentos_detalhados,ajuste_valor,ajuste_motivo,ajuste_data,payment_plan_total:payment_plan_json->total,valor_split_v1,valor_split_v2';
const civil=(v:unknown):v is string=>typeof v==='string'&&/^(20[1-9][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(v)&&v>='2015-01-01'&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const safeSeller=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=160&&!/[\u0000-\u001f\u007f%_*\\]/.test(v);
function text(v:unknown,max=2000):string {if(v==null)return '';if(typeof v!=='string'||v.length>max)return unavailable();return v;}
function nullableText(v:unknown,max=2000):string|null{return v==null?null:text(v,max);}
function number(v:unknown):number{if(v==null||v==='')return 0;if(typeof v!=='number'&&typeof v!=='string')return unavailable();const result=Number(v);return Number.isFinite(result)&&Math.abs(result)<=1e15?result:unavailable();}
function nullableNumber(v:unknown):number|null{return v==null?null:number(v);}
function date(v:unknown):string|null {if(v==null||v==='')return null;const d=text(v,40).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:unavailable();}
function sellerFilter(names:string[]):string {
  if(!names.length||names.some(n=>!safeSeller(n)))throw new ErroControleVendas(403,'sem_escopo');
  return `or(${names.flatMap(n=>['vendedor','vendedor_2'].map(field=>`${field}.ilike.${JSON.stringify(normalizar(n))}`)).join(',')})`;
}
export function validarConsultaVendas(query:Record<string,unknown>):ConsultaVendas {
  if(Object.keys(query).some(k=>!['inicio','fim','vendedor'].includes(k))||!civil(query.inicio)||!civil(query.fim)||query.inicio>query.fim)return invalid();
  const duration=(Date.parse(query.fim)-Date.parse(query.inicio))/86400000+1;
  if(duration>366)return invalid();
  if(query.vendedor!==undefined&&!safeSeller(query.vendedor))return invalid();
  const vendedor=typeof query.vendedor==='string'&&normalizar(query.vendedor)!=='TODOS'?normalizar(query.vendedor):undefined;
  return {inicio:query.inicio,fim:query.fim,...(vendedor?{vendedor}:{})};
}
function projectPedido(raw:unknown,query:ConsultaVendas,snapshot:SnapshotControleVendas){
  if(!record(raw)||!cols.split(',').every(field=>own(raw,field.split(':')[0])))return unavailable();
  const id=text(raw.id,64);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return unavailable();
  const vendedor=text(raw.vendedor,160),vendedor_2=nullableText(raw.vendedor_2,160);
  const names=[vendedor,vendedor_2].filter((n):n is string=>!!n).map(normalizar);
  if(snapshot.vendedores!==null&&!snapshot.vendedores.some(v=>names.includes(normalizar(v))))return unavailable();
  if(query.vendedor&&!names.includes(query.vendedor))return unavailable();
  const data_venda=date(raw.data_venda),ajuste_data=date(raw.ajuste_data);
  if(![data_venda,ajuste_data].some(d=>d!==null&&d>=query.inicio&&d<=query.fim))return unavailable();
  if(!['ABERTO','FECHADO','CANCELADO'].includes(String(raw.status)))return unavailable();
  const equipment=raw.equipamentos_detalhados;if(equipment!==null&&(!Array.isArray(equipment)||equipment.length>250))return unavailable();
  const equipamentos_detalhados=(equipment??[] as unknown[]).map((e:unknown)=>{
    if(!record(e))return unavailable();return {descricao:text(e.descricao,10000),quantidade:number(e.quantidade),unidade:text(e.unidade,100),valor:number(e.valor)};
  });
  return {id,pedido_numero:text(raw.pedido_numero,160),numero_orcamento:text(raw.numero_orcamento,160),cliente:text(raw.cliente),vendedor,vendedor_2,data_venda:data_venda??'',valor_total:number(raw.valor_total),status:raw.status as 'ABERTO'|'FECHADO'|'CANCELADO',atencao_a:text(raw.atencao_a),descricao_equipamento:text(raw.descricao_equipamento,30000),data_primeiro_contato:date(raw.data_primeiro_contato),fonte_origem:nullableText(raw.fonte_origem,1000),estado:nullableText(raw.estado,100),equipamentos_json:[],equipamentos_detalhados,ajuste_valor:number(raw.ajuste_valor),ajuste_motivo:nullableText(raw.ajuste_motivo,30000),ajuste_data,payment_plan_json:raw.payment_plan_total==null?null:{total:number(raw.payment_plan_total)},valor_split_v1:nullableNumber(raw.valor_split_v1),valor_split_v2:nullableNumber(raw.valor_split_v2)};
}
export type DadosControleVendas={data:ReturnType<typeof projectPedido>[];vendedores:Array<{nome:string;percentual_comissao:number|null}>;escopo:{global:boolean;vendedorNome:string|null}};

/** Live integral read of the original columns, with no mirror or stale fallback. */
export async function lerDadosControleVendas(query:ConsultaVendas,snapshot:SnapshotControleVendas,read:LeitorVendas=lerControle,signal?:AbortSignal):Promise<DadosControleVendas>{
  const global=snapshot.vendedores===null&&['admin','financeiro'].includes(snapshot.role);
  if(!global&&(snapshot.vendedores===null||!snapshot.vendedores.length))throw new ErroControleVendas(403,'sem_escopo');
  if(query.vendedor&&snapshot.vendedores!==null&&!snapshot.vendedores.some(v=>normalizar(v)===query.vendedor))throw new ErroControleVendas(403,'fora_do_escopo');
  const conditions=[`or(and(data_venda.gte.${query.inicio},data_venda.lte.${query.fim}),and(ajuste_data.gte.${query.inicio},ajuste_data.lte.${query.fim}))`];
  if(snapshot.vendedores!==null)conditions.push(sellerFilter(snapshot.vendedores));
  if(query.vendedor)conditions.push(sellerFilter([query.vendedor]));
  const filtro=`&and=${encodeURIComponent('('+conditions.join(',')+')')}&order=created_at.desc,id.desc`;
  const vendorFiltro='&ativo=eq.true&order=nome.asc'+(snapshot.vendedores!==null?`&or=${encodeURIComponent('('+snapshot.vendedores.map(v=>'nome.ilike.'+JSON.stringify(normalizar(v))).join(',')+')')}`:'');
  try {
    signal?.throwIfAborted();
    const [raw,rawVendors]=await Promise.all([read<unknown>('pedidos_venda',cols,filtro,{maxRows:10000,signal}),read<unknown>('vendedores',global?'nome,comissao_percentual':'nome',vendorFiltro,{maxRows:250,signal})]);
    signal?.throwIfAborted();if(!Array.isArray(raw)||raw.length>10000||!Array.isArray(rawVendors)||rawVendors.length>250)return unavailable();
    const seen=new Set<string>(),data=raw.map(p=>{const item=projectPedido(p,query,snapshot);if(seen.has(item.id))return unavailable();seen.add(item.id);return item;});
    const vendors=new Map<string,number|null>();
    for(const v of rawVendors){if(!record(v)||!safeSeller(v.nome))return unavailable();const nome=normalizar(v.nome);if(snapshot.vendedores!==null&&!snapshot.vendedores.some(n=>normalizar(n)===nome))return unavailable();const percentual_comissao=global?nullableNumber(v.comissao_percentual):null;if(percentual_comissao!==null&&(percentual_comissao<0||percentual_comissao>100))return unavailable();if(vendors.has(nome)&&vendors.get(nome)!==percentual_comissao)return unavailable();vendors.set(nome,percentual_comissao);}
    const result={data,vendedores:[...vendors].sort(([a],[b])=>a.localeCompare(b)).map(([nome,percentual_comissao])=>({nome,percentual_comissao})),escopo:{global,vendedorNome:global?null:snapshot.vendedores![0]}};
    if(Buffer.byteLength(JSON.stringify(result),'utf8')>4_000_000)return unavailable();
    return result;
  } catch(error){if(error instanceof ErroControleVendas)throw error;return unavailable();}
}
