import test from 'node:test';
import assert from 'node:assert/strict';
import {executarAnaliseVendas,validarDadosAnalise,type DependenciasAnaliseVendas} from './controle-vendas-analise.js';
import type {SnapshotControleVendas} from './controle-vendas-acesso.js';

const snapshot:SnapshotControleVendas={userId:'11111111-1111-4111-8111-111111111111',role:'admin',approvedAt:'2026-10-01T00:00:00Z',vendorId:null,vendedores:null};
function dados(){return {periodo:'Outubro de 2026',totalVendas:1200,quantidadePedidos:2,ticketMedio:600,vendedores:[{nome:'Vendedor teste',valor:1200,pedidos:2}],estados:[{estado:'RS',valor:1200,pedidos:2}],origens:[{origem:'Indicação',valor:1200,pedidos:2}],conversoesRapidas:[{origem:'Indicação',conversoes:1}],tempoConversao:[{origem:'Indicação',mediaDias:12}],equipamentos:[{nome:'Silos',quantidade:2}]};}
function response(text='## INSIGHTS PRINCIPAIS\nDados sintéticos.'){return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}),{status:200});}
function deps(extra:Partial<DependenciasAnaliseVendas>={}){let calls=0;let current=0;const d:DependenciasAnaliseVendas={apiKey:'synthetic-test-key',authorize:async()=>({ok:true,snapshot}),revalidate:async()=>{current++;return {ok:true,snapshot};},fetch:async()=>{calls++;return response();},takeSlot:()=>true,...extra};return {d,calls:()=>calls,current:()=>current};}

test('the original aggregate shape is accepted, including zero and negative signed adjustments',()=>{
  assert.deepEqual(validarDadosAnalise({dados:dados()}),dados());
  const signed={...dados(),totalVendas:-30,ticketMedio:-15,vendedores:[{nome:'Vendedor teste',valor:-30,pedidos:2}]};
  assert.deepEqual(validarDadosAnalise({dados:signed}),signed);
});
test('the state summary can contain all 27 federative units plus N/D',()=>{
  const states=Array.from({length:28},(_,index)=>({estado:index===27?'N/D':`UF ${index}`,valor:0,pedidos:0}));
  assert.notEqual(validarDadosAnalise({dados:{...dados(),estados:states}}),null);
  assert.equal(validarDadosAnalise({dados:{...dados(),estados:[...states,states[0]]}}),null);
});
test('only explicit aggregate fields are accepted; identifiers, credentials and free records fail',()=>{
  for(const body of [{dados:dados(),prompt:'arbitrary'}, {dados:{...dados(),clientes:[{cpf:'123'}]}}, {dados:{...dados(),vendedores:[{...dados().vendedores[0],instance_token:'secret'}]}}, {dados:{...dados(),equipamentos:[{nome:'Silos',quantidade:2,pedido_id:'id'}]}}])assert.equal(validarDadosAnalise(body),null);
});
test('malformed, excessive, non-finite and oversized aggregate bodies fail',()=>{
  const body=dados();
  for(const invalid of [null,{},'{"dados":', {dados:{...body,periodo:'x'.repeat(121)}}, {dados:{...body,quantidadePedidos:-1}}, {dados:{...body,totalVendas:Infinity}}, {dados:{...body,ticketMedio:1e13}}, {dados:{...body,tempoConversao:[{origem:'Indicação',mediaDias:-3}]}}, {dados:{...body,vendedores:Array.from({length:41},()=>body.vendedores[0])}}, ' '.repeat(33000)])assert.equal(validarDadosAnalise(invalid),null);
});
test('denied access never reaches the paid provider',async()=>{
  const f=deps({authorize:async()=>({ok:false,status:403,error:'sem_permissao'})});
  assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},f.d),{status:403,body:{error:'sem_permissao'}});
  assert.equal(f.calls(),0);assert.equal(f.current(),0);
});
test('missing configuration and invalid input never reach the provider',async()=>{
  const noKey=deps({apiKey:undefined});
  assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},noKey.d),{status:503,body:{error:'analise_indisponivel'}});assert.equal(noKey.calls(),0);
  const invalid=deps();assert.equal((await executarAnaliseVendas('Bearer test',{dados:{cpf:'123'}},invalid.d)).status,400);assert.equal(invalid.calls(),0);
});
test('the private Responses request uses only validated aggregates and returns original markdown',async()=>{
  let seen:RequestInit|undefined;let target='';
  const f=deps({fetch:async(url,init)=>{target=String(url);seen=init;return response();}});
  const result=await executarAnaliseVendas('Bearer test',{dados:dados()},f.d);
  assert.equal(result.status,200);assert.deepEqual(result.body,{analise:'## INSIGHTS PRINCIPAIS\nDados sintéticos.'});assert.equal(f.current(),1);
  assert.equal(target,'https://api.openai.com/v1/responses');assert.equal(seen?.method,'POST');assert.ok(seen?.signal instanceof AbortSignal);
  const payload=JSON.parse(String(seen?.body));
  assert.equal(payload.model,'gpt-4.1-mini-2025-04-14');assert.equal(payload.store,false);assert.equal(payload.max_output_tokens,2000);assert.deepEqual(JSON.parse(payload.input),dados());
  assert.match(payload.instructions,/INSIGHTS PRINCIPAIS/);assert.match(payload.instructions,/ALERTAS E OPORTUNIDADES/);assert.match(payload.instructions,/SUGESTÕES PRÁTICAS/);assert.match(payload.instructions,/DADOS FALTANTES/);
  assert.equal(JSON.stringify(payload).includes('synthetic-test-key'),false);
});
test('permission revocation after the provider completes suppresses its entire analysis',async()=>{
  const f=deps({revalidate:async()=>({ok:false,status:403,error:'identity_changed'})});
  assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},f.d),{status:403,body:{error:'identity_changed'}});assert.equal(f.calls(),1);
});
test('provider errors are generic and never expose provider payload or secrets',async()=>{
  for(const status of [400,401,429,500]){
    const f=deps({fetch:async()=>new Response('private-provider-error-synthetic-test-key',{status})});
    const result=await executarAnaliseVendas('Bearer test',{dados:dados()},f.d);
    assert.deepEqual(result,{status:status===429?429:503,body:{error:status===429?'limite_analise_excedido':'analise_indisponivel'}});
  }
});
test('incomplete, empty, malformed and oversized provider responses never become partial reports',async()=>{
  const responses=[new Response('{broken'), new Response(JSON.stringify({status:'incomplete',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'partial'}]}]})),new Response(JSON.stringify({status:'completed',output:[]})),response('x'.repeat(66000))];
  for(const value of responses){const f=deps({fetch:async()=>value});assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},f.d),{status:503,body:{error:'analise_indisponivel'}});}
});
test('a bounded deadline aborts pending provider work, even if transport ignores cancellation',async()=>{
  let signal:AbortSignal|undefined;
  const f=deps({deadlineMs:10,fetch:async(_url,init)=>{signal=init?.signal??undefined;return new Promise<Response>(()=>{});}});
  assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},f.d),{status:503,body:{error:'analise_indisponivel'}});assert.equal(signal?.aborted,true);
});
test('an expired authorization deadline does not launch a late paid request',async()=>{
  let release:(value:{ok:true;snapshot:SnapshotControleVendas})=>void=()=>{};
  const f=deps({deadlineMs:5,authorize:()=>new Promise(resolve=>{release=resolve;})});
  assert.equal((await executarAnaliseVendas('Bearer test',{dados:dados()},f.d)).status,503);
  release({ok:true,snapshot});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.calls(),0);
});
test('a per-user exhausted analysis slot fails before any provider call',async()=>{
  const f=deps({takeSlot:()=>false});assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},f.d),{status:429,body:{error:'limite_analise_excedido'}});assert.equal(f.calls(),0);
});
test('the default instance limiter refuses a repeated request for the same authorized user',async()=>{
  const limitedSnapshot={...snapshot,userId:'33333333-3333-4333-8333-333333333333'};
  const f=deps({takeSlot:undefined,authorize:async()=>({ok:true,snapshot:limitedSnapshot}),revalidate:async()=>({ok:true,snapshot:limitedSnapshot})});
  assert.equal((await executarAnaliseVendas('Bearer test',{dados:dados()},f.d)).status,200);
  assert.deepEqual(await executarAnaliseVendas('Bearer test',{dados:dados()},f.d),{status:429,body:{error:'limite_analise_excedido'}});assert.equal(f.calls(),1);
});
