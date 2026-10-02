import test from 'node:test';
import assert from 'node:assert/strict';
import type {VercelRequest,VercelResponse} from '@vercel/node';
import {criarHandlerAnaliseVendas} from '../controle-vendas-analise.js';
import type {DependenciasAnaliseVendas} from './controle-vendas-analise.js';

function reply(){const headers:Record<string,unknown>={};let status=0;let body:unknown;const res={setHeader:(name:string,value:unknown)=>{headers[name]=value;},status:(value:number)=>{status=value;return res;},json:(value:unknown)=>{body=value;return res;}} as unknown as VercelResponse;return {res,headers,status:()=>status,body:()=>body};}
function req(extra:Partial<VercelRequest>={}){return {method:'POST',headers:{authorization:'Bearer synthetic-test','content-type':'application/json'},query:{},body:{dados:{periodo:'Ano de 2026',totalVendas:0,quantidadePedidos:0,ticketMedio:0,vendedores:[],estados:[],origens:[],conversoesRapidas:[],tempoConversao:[],equipamentos:[]}},...extra} as VercelRequest;}
function deps(){let calls=0;const snapshot={userId:'11111111-1111-4111-8111-111111111111',role:'admin',approvedAt:'2026-10-01T00:00:00Z',vendorId:null,vendedores:null};const d:DependenciasAnaliseVendas={apiKey:'synthetic-test-key',authorize:async()=>({ok:true,snapshot}),revalidate:async()=>({ok:true,snapshot}),takeSlot:()=>true,fetch:async()=>{calls++;return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Somente dados sintéticos.'}]}]}));}};return {d,calls:()=>calls};}

test('analysis accepts only POST, advertises the allowed method and never caches user results',async()=>{
  const f=deps();const result=reply();await criarHandlerAnaliseVendas(f.d)(req({method:'GET'}),result.res);
  assert.equal(result.status(),405);assert.equal(result.headers.Allow,'POST');assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers.Vary,'Authorization, Origin');assert.equal(f.calls(),0);
});
test('a foreign Origin is rejected before approval checks or a paid request',async()=>{
  let approvals=0;const f=deps();f.d.authorize=async()=>{approvals++;return {ok:false,status:403,error:'sem_permissao'};};
  const result=reply();await criarHandlerAnaliseVendas(f.d)(req({headers:{authorization:'Bearer synthetic-test','content-type':'application/json',origin:'https://outside.invalid'}}),result.res);
  assert.equal(result.status(),400);assert.deepEqual(result.body(),{error:'origin_invalida'});assert.equal(approvals,0);assert.equal(f.calls(),0);
});
test('only exact CRM, owned preview and local origins receive a matching CORS header',async()=>{
  for(const origin of ['https://branorte-crm.vercel.app','https://branorte-test-danielpetersbrs-projects.vercel.app','http://localhost:3000']){
    const f=deps();const result=reply();await criarHandlerAnaliseVendas(f.d)(req({headers:{authorization:'Bearer synthetic-test','content-type':'application/json',origin}}),result.res);
    assert.equal(result.status(),200);assert.equal(result.headers['Access-Control-Allow-Origin'],origin);assert.equal(result.headers.Vary,'Authorization, Origin');
  }
});
test('oversized declared or actual bodies cannot launch provider calls',async()=>{
  for(const request of [req({headers:{authorization:'Bearer synthetic-test','content-type':'application/json','content-length':'32769'}}),req({body:' '.repeat(32769)})]){
    const f=deps();const result=reply();await criarHandlerAnaliseVendas(f.d)(request,result.res);assert.equal(result.status(),413);assert.equal(f.calls(),0);
  }
});
test('extra URL parameters, malformed JSON media type and duplicate length headers fail',async()=>{
  for(const request of [req({query:{prompt:'arbitrary'}}),req({headers:{authorization:'Bearer synthetic-test','content-type':'text/plain'}}),req({headers:{authorization:'Bearer synthetic-test','content-type':'application/json','content-length':['1','2'] as unknown as string}})]){
    const f=deps();const result=reply();await criarHandlerAnaliseVendas(f.d)(request,result.res);assert.notEqual(result.status(),200);assert.equal(f.calls(),0);
  }
});
test('the HTTP adapter preserves the original analysis response contract',async()=>{
  const f=deps();const result=reply();await criarHandlerAnaliseVendas(f.d)(req(),result.res);
  assert.equal(result.status(),200);assert.deepEqual(result.body(),{analise:'Somente dados sintéticos.'});assert.equal(f.calls(),1);
});
