import {supabase} from '@/lib/supabase'
import {requisitarControleVendas} from './controle-vendas-request'

export interface PedidoControleVendas {
  id:string;pedido_numero:string;numero_orcamento:string|null;cliente:string;vendedor:string;vendedor_2?:string|null;
  data_venda:string;valor_total:number;status:'ABERTO'|'FECHADO'|'CANCELADO';atencao_a:string;descricao_equipamento:string;
  data_primeiro_contato:string|null;fonte_origem:string|null;estado:string|null;equipamentos_json:unknown[];
  equipamentos_detalhados?:Array<{descricao?:string;quantidade?:number;unidade?:string;valor?:number}>;
  ajuste_valor:number;ajuste_motivo:string|null;ajuste_data:string|null;payment_plan_json?:{total?:number;parcelas?:unknown[]};
  valor_split_v1?:number|null;valor_split_v2?:number|null;
}
export type ConsultaVendasControle={data:PedidoControleVendas[];vendedores:Array<{nome:string;percentual_comissao:number|null}>;escopo:{global:boolean;vendedorNome:string|null}}
const getSession=async()=>{const {data,error}=await supabase.auth.getSession();if(error)throw new Error('Não foi possível verificar a sessão.');return data.session}
const request=(url:string,signal?:AbortSignal,body?:unknown)=>requisitarControleVendas({url,signal,body,getSession,fetch:(url,init)=>fetch(url,init)})

export async function buscarVendasControle({inicio,fim,vendedor,signal}:{inicio:string;fim:string;vendedor?:string;signal?:AbortSignal}):Promise<ConsultaVendasControle>{
  const query=new URLSearchParams({inicio,fim});if(vendedor&&vendedor!=='todos')query.set('vendedor',vendedor)
  const input=await request(`/api/controle-vendas?${query}`,signal) as ConsultaVendasControle
  if(!input||!Array.isArray(input.data)||input.data.length>10000||!Array.isArray(input.vendedores)||typeof input.escopo?.global!=='boolean'||
    (!input.escopo.global&&(!input.escopo.vendedorNome||typeof input.escopo.vendedorNome!=='string'))||
    input.data.some(p=>!p||typeof p.id!=='string'||typeof p.cliente!=='string')||input.vendedores.some(v=>!v||typeof v.nome!=='string'))throw new Error('Leitura de vendas inválida. Tente novamente.')
  return input
}
export async function analisarVendasControle({dados,signal}:{dados:unknown;signal?:AbortSignal}):Promise<{analise:string}>{
  const input=await request('/api/controle-vendas-analise',signal,{dados}) as {analise?:unknown}
  if(!input||typeof input.analise!=='string'||input.analise.length>20000)throw new Error('Não foi possível gerar a análise.')
  return {analise:input.analise}
}
