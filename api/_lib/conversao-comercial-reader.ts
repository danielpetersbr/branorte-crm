import type { SupabaseClient } from '@supabase/supabase-js'
import { calcularConversao, type ConversaoAttendance, type ConversaoClient, type ConversaoSale, type Vendedor } from '../../src/lib/conversao-comercial.js'
import type { DadosConversaoComercial, FiltroConversao } from '../../src/hooks/useConversaoComercial.js'
import { lerControle } from './financeiro-core.js'
import { criarCrmEspelho, pedidoNoEscopoEspelho, type EscopoEspelho } from './producao-espelho-acesso.js'

const NOVE = ['ALVARO','EDER','IGOR','JARDEL','LUCAS','RAMON','EDILSON JR','GUSTAVO','PEDRO']
const saleColumns='id,pedido_numero,cliente,vendedor,vendedor_2,data_venda,telefone,valor_total,payment_plan_json,status,fonte_origem'
export type SaleRaw={id:string;pedido_numero:string|null;cliente:string|null;vendedor:string|null;vendedor_2:string|null;data_venda:string|null;telefone:string|null;valor_total:number|string|null;payment_plan_json:{total?:number|string}|null;status:string|null;fonte_origem:string|null}
type ClientRaw={id:string;phone_canon:string;phone_display?:string;name:string;classification:ConversaoClient['classification']}
type AttendanceRaw={id:string;client_id:string;seller_key:string;inbound_at:string|null;outbound_at:string|null;answered_call_at:string|null;last_event_at:string;source:'historical'|'tracked';client:ClientRaw|ClientRaw[]}
type LinkRaw={sale_id:string;client_id:string;same_day_confirmed:boolean}
type RunRaw={seller_key:string;version:string;finished_at:string;received_at:string;failed_chats:number;complete:boolean}
export const crmConversao=()=>criarCrmEspelho({SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY})
export function telefoneConversao(value:string|null):string|null {
  if(!value||/@|[a-z]/i.test(value))return null
  let d=value.replace(/\D/g,'')
  if(value.trim().startsWith('+')&&!d.startsWith('55'))return null
  if([12,13].includes(d.length)&&d.startsWith('55'))d=d.slice(2)
  if(d.length===11&&d[2]==='9')d=d.slice(0,2)+d.slice(3)
  return /^[1-9]\d{9}$/.test(d)?d:null
}
export function vendaMaterial(p:SaleRaw):boolean {
  let amount=Number(p.payment_plan_json?.total)
  if(!Number.isFinite(amount)||amount<=0)amount=Number(p.valor_total)
  return p.status!=='CANCELADO'&&(p.fonte_origem??'').trim().toLowerCase()!=='garantia'&&Number.isFinite(amount)&&amount>0.01
}
export function hojeSP(now=new Date()):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-')
}
export function validarFiltro(query:Record<string,unknown>):FiltroConversao {
  if(Object.keys(query).some(k=>!['from','to','window'].includes(k)))throw new Error('parametros_invalidos')
  const {from,to,window:windowDays}=query
  const valid=(v:unknown):v is string=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v
  if(!valid(from)||!valid(to)||from>=to||!['30','60','90'].includes(String(windowDays))||Array.isArray(windowDays))throw new Error('periodo_invalido')
  if(Date.parse(to)-Date.parse(from)>367*86400000||to>new Date(Date.parse(hojeSP()+'T12:00:00Z')+86400000).toISOString().slice(0,10))throw new Error('periodo_invalido')
  return {from,to,windowDays:Number(windowDays) as 30|60|90}
}
async function collection<T>(db:SupabaseClient,table:string,columns:string,signal:AbortSignal,scope?:string[]):Promise<T[]> {
  const out:T[]=[];let total:number|undefined
  for(let offset=0;offset<=20000;offset+=1000){
    let q=db.from(table).select(columns,{count:'exact'}).order(table==='comercial_vinculos_pedidos'?'sale_id':'id').range(offset,offset+999)
    if(scope)q=q.in('seller_key',scope)
    const {data,error,count}=await q.abortSignal(signal)
    if(error||!data||count===null||count>20000||total!==undefined&&total!==count)throw new Error('leitura_incompleta')
    total=count;out.push(...data as T[])
    if(out.length===total)return out
    if(!data.length)throw new Error('leitura_incompleta')
  }
  throw new Error('leitura_incompleta')
}
export function projetarConversao(scope:EscopoEspelho,filtro:FiltroConversao,sellers:Vendedor[],rows:AttendanceRaw[],allSales:SaleRaw[],links:LinkRaw[],captureSince:string|null,runs:RunRaw[],unresolved:number,now=new Date()):DadosConversaoComercial {
  const allowed=new Set(sellers.map(s=>s.key)),clientMap=new Map<string,ConversaoClient>(),attendances:ConversaoAttendance[]=[]
  for(const a of rows){
    if(!allowed.has(a.seller_key))continue
    const c=Array.isArray(a.client)?a.client[0]:a.client
    if(!c||c.id!==a.client_id)throw new Error('identidade_incompleta')
    clientMap.set(c.id,{id:c.id,name:c.name,phone:c.phone_display||c.phone_canon,classification:c.classification})
    attendances.push({id:a.id,clientId:a.client_id,sellerKey:a.seller_key,inboundAt:a.inbound_at,outboundAt:a.outbound_at,answeredCallAt:a.answered_call_at,lastEventAt:a.last_event_at,source:a.source})
  }
  const byPhone=new Map([...clientMap.values()].map(c=>[telefoneConversao(c.phone),c.id])),bySale=new Map(links.map(l=>[l.sale_id,l]))
  const cutoffAt=hojeSP(now)+'T00:00:00-03:00',lastDay=hojeSP(now)
  const sales:ConversaoSale[]=[],unlinkedSales:DadosConversaoComercial['unlinkedSales']=[]
  const seen=new Set<string>()
  for(const p of allSales){
    if(seen.has(p.id))throw new Error('pedidos_duplicados');seen.add(p.id)
    if(!vendaMaterial(p)||!p.data_venda||p.data_venda.slice(0,10)>=lastDay)continue
    const date=p.data_venda.slice(0,10),manual=bySale.get(p.id),phone=telefoneConversao(p.telefone)
    const candidate=manual?.client_id??(phone?byPhone.get(phone):undefined)
    const clientId=candidate&&clientMap.has(candidate)?candidate:null
    // Only a date is exposed: no other seller's sale or identity is returned.
    if(clientId){const c=clientMap.get(clientId)!;if(!c.firstCompanyPurchaseDate||date<c.firstCompanyPurchaseDate)c.firstCompanyPurchaseDate=date}
    if(!pedidoNoEscopoEspelho(p,scope))continue
    const sellerKeys=[...new Set([p.vendedor,p.vendedor_2].filter((s):s is string=>!!s&&allowed.has(s)))]
    if(!sellerKeys.length)continue
    sales.push({id:p.id,orderNumber:p.pedido_numero??'',date,clientId,sellerKeys,material:true,link:clientId?(manual?'manual':'phone'):null,sameDayConfirmed:manual?.same_day_confirmed??false})
    const saleEnd=new Date(Date.parse(filtro.to+'T12:00:00Z')+filtro.windowDays*86400000).toISOString().slice(0,10)
    if(!clientId&&date>=filtro.from&&date<saleEnd)unlinkedSales.push({id:p.id,orderNumber:p.pedido_numero,date,clientName:p.cliente,phone:p.telefone,sellerKeys,reason:manual?'O cliente do vínculo não tem atendimento nesta carteira.':phone?'Telefone do pedido sem atendimento identificado.':'Pedido sem telefone válido.'})
  }
  const result=calcularConversao({from:filtro.from,to:filtro.to,windowDays:filtro.windowDays,cutoffAt,sellers,clients:[...clientMap.values()],attendances,sales,captureSince,captureVerified:false})
  const queued=new Set(unlinkedSales.map(p=>p.id))
  for(const detail of result.clients){
    const firstDay=hojeSP(new Date(detail.firstAttendedAt))
    for(const order of detail.sales){
      if(order.date!==firstDay||bySale.get(order.id)?.same_day_confirmed===true||queued.has(order.id))continue
      const raw=allSales.find(p=>p.id===order.id),sale=sales.find(p=>p.id===order.id)
      if(!raw||!sale)continue
      queued.add(order.id)
      unlinkedSales.push({id:order.id,orderNumber:order.orderNumber,date:order.date,clientName:raw.cliente,phone:raw.telefone,sellerKeys:sale.sellerKeys,reason:'Conversa e venda no mesmo dia; sequência ainda não confirmada.'})
    }
  }
  const unclassified=new Set(result.clients.filter(c=>c.status==='unclassified').map(c=>c.clientId))
  result.quality.missingIdentity+=unresolved
  if(unresolved)result.quality.gaps.push('conversas_com_identidade_pendente')
  for(const seller of sellers){
    const last=runs.filter(r=>r.seller_key===seller.key).sort((a,b)=>b.received_at.localeCompare(a.received_at))[0]
    if(!last)result.quality.gaps.push(`captura_nova_ausente:${seller.key}`)
    else if(!Number.isFinite(Date.parse(last.finished_at))||!Number.isFinite(Date.parse(last.received_at))||now.getTime()-Math.min(Date.parse(last.finished_at),Date.parse(last.received_at))>24*3600000)result.quality.gaps.push(`captura_sem_atualizacao:${seller.key}`)
    else if(last.failed_chats)result.quality.gaps.push(`captura_com_falhas:${seller.key}`)
  }
  result.quality.gaps.push('A classificação de envios humanos e automáticos ainda não cobre todos os canais.')
  result.quality.status='partial'
  return {version:1,generatedAt:now.toISOString(),cutoffAt,cohort:{from:filtro.from,to:filtro.to,windowDays:filtro.windowDays},scope:{canManage:scope.role==='admin',sellers},...result,unlinkedSales,
    unclassifiedClients:[...clientMap.values()].filter(c=>unclassified.has(c.id)).map(c=>({id:c.id,name:c.name,phone:c.phone})),
    allClients:[...clientMap.values()].map(c=>({id:c.id,name:c.name,phone:c.phone,classification:c.classification}))}
}
export async function lerConversao(scope:EscopoEspelho,filtro:FiltroConversao,signal:AbortSignal,db=crmConversao()):Promise<DadosConversaoComercial> {
  const vendorReceipt=await db.from('vendors').select('key,name').abortSignal(signal)
  if(vendorReceipt.error||!vendorReceipt.data)throw new Error('vendedores_indisponiveis')
  const sellers=vendorReceipt.data.filter(v=>NOVE.includes(v.name)&&(!scope.vendedores||scope.vendedores.includes(v.name)||scope.vendedores.includes(v.key))).map(v=>({key:v.name,name:v.name}))
  if(!sellers.length)throw new Error('sem_escopo')
  const keys=sellers.map(v=>v.key)
  const [rows,allSales,links,state]=await Promise.all([
    collection<AttendanceRaw>(db,'comercial_atendimentos','id,client_id,seller_key,inbound_at,outbound_at,answered_call_at,last_event_at,source,client:comercial_clientes(id,phone_canon,phone_display,name,classification)',signal,keys),
    lerControle<SaleRaw>('pedidos_venda',saleColumns,'&order=id.asc',{signal,maxRows:20000}),
    collection<LinkRaw>(db,'comercial_vinculos_pedidos','sale_id,client_id,same_day_confirmed',signal),
    db.rpc('comercial_estado',{p_sellers:keys}).abortSignal(signal),
  ])
  if(state.error||!state.data||!Array.isArray(state.data.runs)||!Number.isInteger(state.data.pendingIdentities))throw new Error('qualidade_indisponivel')
  signal.throwIfAborted()
  return projetarConversao(scope,filtro,sellers,rows,allSales,links,state.data.captureSince,state.data.runs,state.data.pendingIdentities)
}
export async function ajustarConversao(actor:string,body:Record<string,unknown>,signal:AbortSignal,db=crmConversao()) {
  if(!['link_sale','classify_client'].includes(String(body.action)))throw new Error('acao_invalida')
  const allowed=body.action==='link_sale'?['action','saleId','clientId','reason','sameDayConfirmed']:['action','clientId','classification','reason']
  if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.clientId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.clientId)||typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>1000)throw new Error('ajuste_invalido')
  if(body.action==='classify_client'&&(typeof body.classification!=='string'||!['commercial','internal'].includes(body.classification)))throw new Error('ajuste_invalido')
  if(body.action==='link_sale'){
    if(typeof body.saleId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.saleId)||body.sameDayConfirmed!==undefined&&typeof body.sameDayConfirmed!=='boolean')throw new Error('ajuste_invalido')
    const sale=await lerControle<SaleRaw>('pedidos_venda',saleColumns,`&id=eq.${encodeURIComponent(body.saleId)}&order=id.asc`,{signal,maxRows:2})
    if(sale.length!==1||!vendaMaterial(sale[0])||![sale[0].vendedor,sale[0].vendedor_2].some(s=>s&&NOVE.includes(s)))throw new Error('pedido_nao_encontrado')
  }
  const {data,error}=await db.rpc('comercial_alterar',{p_actor:actor,p_action:body.action,p_entity:body.saleId??null,p_client:body.clientId,p_classification:body.classification??null,p_reason:body.reason.trim(),p_same_day:body.sameDayConfirmed===true}).abortSignal(signal)
  if(error||data?.ok!==true)throw new Error(error?.code==='42501'?'sem_permissao':'ajuste_indisponivel')
  return {ok:true}
}
