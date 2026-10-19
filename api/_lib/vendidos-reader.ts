import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lerControle } from './financeiro-core.js'
import { criarCrmEspelho, pedidoNoEscopoEspelho, type EscopoEspelho } from './producao-espelho-acesso.js'
import { criarFonteEspelhoPrivada } from './producao-espelho-reader.js'
import { situacaoVendido, type DadosVendidos, type PedidoVendido } from '../../src/lib/vendidos.js'
export type VendaRaw={id:string;pedido_numero:string|null;numero_orcamento:string|null;cliente:string|null;vendedor:string|null;vendedor_2:string|null;data_venda:string|null;telefone:string|null;cidade:string|null;estado:string|null;descricao_equipamento:string|null;cpf_cnpj:string|null;status:string|null}
export type CardVendido={id:string;pedido_id:string;status:string;excluido:boolean}
export type EntregaVendida={order_id:string;entregue_em:string}
const cols='id,pedido_numero,numero_orcamento,cliente,vendedor,vendedor_2,data_venda,telefone,cidade,estado,descricao_equipamento,cpf_cnpj,status'
const normal=(s:string|null)=> (s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()
export function projetarVendidos(rows:VendaRaw[],cards:CardVendido[]|null,entregas:EntregaVendida[]|null,escopo:EscopoEspelho):DadosVendidos {
  const pedidos=rows.filter(p=>p.status!=='CANCELADO'&&pedidoNoEscopoEspelho(p,escopo))
  const porPedido=new Map<string,string[]>()
  for(const c of cards??[])if(!c.excluido){const a=porPedido.get(c.pedido_id)??[];a.push(c.status);porPedido.set(c.pedido_id,a)}
  const entregues=new Map((entregas??[]).map(e=>[e.order_id,e.entregue_em]))
  const result:PedidoVendido[]=pedidos.map(p=>{
    const documento=(p.cpf_cnpj??'').replace(/\D/g,''),telefone=(p.telefone??'').replace(/\D/g,'')
    const identidade=documento?`doc:${documento}`:telefone?`tel:${telefone}`:`nome:${normal(p.cliente)}|${normal(p.cidade)}|${normal(p.estado)}${p.cliente?.trim()?'':p.id}`
    const etapas=[...new Set(porPedido.get(p.id)??[])],entregaEm=entregues.get(p.id)??null
    return {id:p.id,clienteId:createHash('sha256').update(identidade).digest('hex'),numero:p.pedido_numero??'',orcamento:p.numero_orcamento??'',cliente:p.cliente??'',vendedor:p.vendedor??'',vendedor2:p.vendedor_2,dataVenda:p.data_venda,telefone:p.telefone??'',cidade:p.cidade??'',estado:p.estado??'',produto:p.descricao_equipamento??'',etapas,situacao:situacaoVendido(etapas,entregaEm),entregaEm}
  }).sort((a,b)=>(b.dataVenda??'').localeCompare(a.dataVenda??'')||b.id.localeCompare(a.id))
  return {pedidos:result,vendedores:escopo.vendedores,consultadoEm:new Date().toISOString(),producaoDisponivel:cards!==null,entregasDisponiveis:entregas!==null}
}
/** Narrow collections by authorized order IDs; stable pagination, exact counts, no silent truncation. */
async function colecao<T>(db:SupabaseClient,table:string,columns:string,field:string,ids:string[],signal:AbortSignal):Promise<T[]> {
  const out:T[]=[]
  for(let i=0;i<ids.length;i+=100){
    let total:number|undefined,counted=0
    for(let offset=0;;offset+=500){
      const {data,error,count}=await db.from(table).select(columns,{count:'exact'}).in(field,ids.slice(i,i+100)).order(table==='fin_entregas'?'order_id':'id').range(offset,offset+499).abortSignal(signal)
      if(error||count===null||count>10000||total!==undefined&&total!==count||!data)throw new Error('leitura_incompleta')
      total=count;out.push(...data as T[]);counted+=data.length
      if(counted===total)break
      if(!data.length||offset>=10000)throw new Error('leitura_incompleta')
    }
  }
  return out
}
export async function lerVendidos(escopo:EscopoEspelho,signal:AbortSignal):Promise<DadosVendidos> {
  const all=await lerControle<VendaRaw>('pedidos_venda',cols,'&order=id.asc',{signal,maxRows:10000})
  signal.throwIfAborted()
  const rows=all.filter(p=>p.status!=='CANCELADO'&&pedidoNoEscopoEspelho(p,escopo)),ids=rows.map(p=>p.id)
  const [cards,entregas]=await Promise.allSettled([
    (async()=>{const fonte=criarFonteEspelhoPrivada({PRODUCAO_SUPABASE_URL:process.env.PRODUCAO_SUPABASE_URL,PRODUCAO_PRIVATE_READ_KEY:process.env.PRODUCAO_PRIVATE_READ_KEY},'fabrica') as unknown as SupabaseClient
      return colecao<CardVendido>(fonte,'producao_cards','id,pedido_id,status,excluido','pedido_id',ids,signal)})(),
    colecao<EntregaVendida>(criarCrmEspelho({SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY}),'fin_entregas','order_id,entregue_em','order_id',ids,signal),
  ])
  signal.throwIfAborted()
  return projetarVendidos(rows,cards.status==='fulfilled'?cards.value:null,entregas.status==='fulfilled'?entregas.value:null,escopo)
}
