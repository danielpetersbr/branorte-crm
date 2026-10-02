import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {autorizarControleVendas,revalidarControleVendas,type SnapshotControleVendas} from './controle-vendas-acesso.js';
import {validarConsultaVendas,lerDadosControleVendas,type LeitorVendas} from './controle-vendas-reader.js';
import {lerControle} from './financeiro-core.js';

const uid='11111111-1111-4111-8111-111111111111';
const vid='22222222-2222-4222-8222-222222222222';
const admin:SnapshotControleVendas={userId:uid,role:'admin',approvedAt:'2026-10-01T00:00:00Z',vendorId:null,vendedores:null};
const vendor:SnapshotControleVendas={...admin,role:'vendor',vendorId:vid,vendedores:['JARDEL']};
function client(state:{role?:string;approved?:boolean;permission?:unknown;vendor?:string|null;user?:boolean}={}){
  const crm={auth:{getUser:async()=>({data:{user:state.user===false?null:{id:uid}},error:null})},from:(table:string)=>{
    const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='role_permissions'?{permissions:{'menu.financeiro':state.permission??true}}:{id:uid,role:state.role??'admin',approved_at:state.approved===false?null:admin.approvedAt,vendor_id:state.vendor??null},error:null})};return q;
  }} as unknown as SupabaseClient;
  const resolver=async()=>({userId:uid,role:state.role??'admin',displayName:'',vendedores:state.role==='vendor'?['JARDEL']:null});
  return {crm,resolver};
}
function row(id='33333333-3333-4333-8333-333333333333',extra:Record<string,unknown>={}){return {id,pedido_numero:'PV-1',numero_orcamento:'2026-1',cliente:'Cliente',vendedor:'JARDEL',vendedor_2:null,data_venda:'2026-01-15',valor_total:100,status:'ABERTO',atencao_a:'',descricao_equipamento:'Equipamento',data_primeiro_contato:null,fonte_origem:'Indicação',estado:'RS',equipamentos_detalhados:[],ajuste_valor:0,ajuste_motivo:null,ajuste_data:null,payment_plan_total:'150',valor_split_v1:null,valor_split_v2:null,...extra};}
function reader(pedidos:unknown[],vendedores:unknown[]=[]){const calls:Array<{recurso:string;colunas:string;filtro:string;options:unknown}>=[];const read=async(recurso:string,colunas:string,filtro='',options?:unknown)=>{calls.push({recurso,colunas,filtro,options});return recurso==='pedidos_venda'?pedidos:vendedores;};return {read:read as LeitorVendas,calls};}

test('fresh approval and explicit Financeiro permission are required',async()=>{
  assert.deepEqual(await autorizarControleVendas(undefined,client()),{ok:false,status:401,error:'no_auth'});
  assert.deepEqual(await autorizarControleVendas('Bearer token',client({approved:false})),{ok:false,status:403,error:'not_approved'});
  assert.deepEqual(await autorizarControleVendas('Bearer token',client({permission:false})),{ok:false,status:403,error:'sem_permissao'});
  assert.deepEqual(await autorizarControleVendas('Bearer token',client()),{ok:true,snapshot:admin});
});
test('a restricted identity without a vendor never acquires global scope',async()=>{
  assert.equal((await autorizarControleVendas('Bearer token',client({role:'vendor'}))).ok,false);
  assert.deepEqual(await autorizarControleVendas('Bearer token',client({role:'vendor',vendor:vid})),{ok:true,snapshot:vendor});
});
test('revalidation rejects revoked permission, changed identity and changed seller scope',async()=>{
  assert.deepEqual(await revalidarControleVendas('Bearer token',admin,client()),{ok:true,snapshot:admin});
  assert.equal((await revalidarControleVendas('Bearer token',admin,client({permission:false}))).ok,false);
  assert.equal((await revalidarControleVendas('Bearer token',admin,client({role:'vendor',vendor:vid}))).ok,false);
  const deps=client({role:'vendor',vendor:vid});deps.resolver=async()=>({userId:uid,role:'vendor',displayName:'',vendedores:['PEDRO']});
  assert.equal((await revalidarControleVendas('Bearer token',vendor,deps)).ok,false);
});
test('dates are real civil dates in a bounded annual interval and duplicate query parameters fail closed',()=>{
  assert.deepEqual(validarConsultaVendas({inicio:'2026-01-01',fim:'2026-12-31'}),{inicio:'2026-01-01',fim:'2026-12-31'});
  for(const query of [{inicio:'2026-02-30',fim:'2026-03-02'},{inicio:'2026-01-00',fim:'2026-03-02'},{inicio:'2026-10-01',fim:'2026-01-01'},{inicio:'2014-01-01',fim:'2014-01-31'},{inicio:'2025-01-01',fim:'2026-12-31'},{inicio:['2026-01-01','2025-01-01'],fim:'2026-12-31'}])assert.throws(()=>validarConsultaVendas(query));
});
test('source query includes the adjustment period and second seller, preserving split and plan totals',async()=>{
  const f=reader([row(undefined,{vendedor:'PEDRO',vendedor_2:'JARDEL',valor_split_v1:'90',valor_split_v2:'60',data_venda:'2025-12-12',ajuste_data:'2026-01-15',ajuste_valor:'20'})],[{nome:'JARDEL',comissao_percentual:'2'}]);
  const result=await lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},vendor,f.read);
  const query=decodeURIComponent(f.calls[0].filtro);
  assert.match(query,/data_venda\.gte\.2026-01-01/);assert.match(query,/ajuste_data\.gte\.2026-01-01/);assert.match(query,/vendedor_2\.ilike/);
  assert.match(query,/order=created_at\.desc,id\.desc/);
  assert.equal(result.data[0].payment_plan_json?.total,150);assert.equal(result.data[0].valor_split_v2,60);
  assert.deepEqual(result.escopo,{global:false,vendedorNome:'JARDEL'});assert.deepEqual(result.vendedores,[{nome:'JARDEL',percentual_comissao:null}]);
  assert.equal(f.calls[0].options!==undefined,true);assert.equal(f.calls[1].colunas,'nome');
});
test('scope and source period are checked again on loaded objects; unrequested fields never escape',async()=>{
  const forbidden=reader([row(undefined,{vendedor:'PEDRO',vendedor_2:null})]);
  await assert.rejects(lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},vendor,forbidden.read));
  const old=reader([row(undefined,{data_venda:'2025-01-01'})]);
  await assert.rejects(lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},admin,old.read));
  const safe=reader([row(undefined,{telefone:'secret',cpf_cnpj:'secret',payment_plan_total:150,equipamentos_detalhados:[{descricao:'Silo',quantidade:1,valor:150,secret:'hidden'}]})],[{nome:'JARDEL',comissao_percentual:2,salario_base:999,instance_token:'secret'}]);
  const result=await lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},admin,safe.read);
  assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('salario_base'),false);
  assert.deepEqual(result.vendedores,[{nome:'JARDEL',percentual_comissao:2}]);assert.deepEqual(result.data[0].equipamentos_detalhados,[{descricao:'Silo',quantidade:1,unidade:'',valor:150}]);
});
test('source failures, duplicate IDs and oversized integral reads fail instead of producing partial reports',async()=>{
  const duplicate=reader([row(),row()]);await assert.rejects(lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},admin,duplicate.read));
  const failed=async()=>{throw new Error('provider secret response');};await assert.rejects(lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},admin,failed as LeitorVendas),/controle_indisponivel/);
  const large=reader(Array.from({length:10001},()=>row()));await assert.rejects(lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31'},admin,large.read));
});
test('bounded transport probes the exact boundary, rejects an extra record and forwards cancellation',async()=>{
  const previous=globalThis.fetch;let calls=0;const signal=new AbortController().signal;
  try {
    globalThis.fetch=async(raw,init)=>{calls++;assert.equal(init?.signal,signal);const url=new URL(String(raw));assert.equal(url.searchParams.getAll('limit').length,1);return new Response(JSON.stringify(calls===1?Array.from({length:1000},(_,i)=>({id:i})):[]),{status:200});};
    assert.equal((await lerControle('pedidos_venda','id','',{maxRows:1000,signal})).length,1000);assert.equal(calls,2);
    calls=0;globalThis.fetch=async()=>new Response(JSON.stringify(Array.from({length:1000},(_,i)=>({id:i}))),{status:200});
    await assert.rejects(lerControle('pedidos_venda','id','',{maxRows:1000}));
    const aborted=new AbortController();aborted.abort();calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not fetch');};
    await assert.rejects(lerControle('pedidos_venda','id','',{maxRows:1000,signal:aborted.signal}));assert.equal(calls,0);
  } finally {globalThis.fetch=previous;}
});
test('the existing three-argument transport still fetches all pages without a new limit',async()=>{
  const previous=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async(raw)=>{calls++;const u=new URL(String(raw));assert.equal(u.searchParams.get('limit'),'1000');assert.equal(u.searchParams.get('offset'),calls===1?'0':'1000');return new Response(JSON.stringify(calls===1?Array.from({length:1000},(_,id)=>({id})):[{id:1000}]),{status:200});};
    assert.equal((await lerControle('pedidos_venda','id','&order=id.asc')).length,1001);assert.equal(calls,2);
  } finally {globalThis.fetch=previous;}
});
test('a requested colleague or wildcard can never widen a restricted seller scope',async()=>{
  const f=reader([]);await assert.rejects(lerDadosControleVendas({inicio:'2026-01-01',fim:'2026-01-31',vendedor:'PEDRO'},vendor,f.read),/fora_do_escopo/);assert.equal(f.calls.length,0);
  for(const vendedor of ['*','JAR%','JAR_DEL','JAR\\DEL'])assert.throws(()=>validarConsultaVendas({inicio:'2026-01-01',fim:'2026-01-31',vendedor}));
});
