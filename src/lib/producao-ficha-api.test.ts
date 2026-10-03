import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {VercelRequest,VercelResponse} from '@vercel/node';
import {criarHandlerProducaoFicha} from '../../api/controle-producao-ficha.js';
import {consultarFichaEspelho,type DepsConsultaFicha,type FichaEspelho} from './producao-ficha-consulta.js';
const id=(n:number)=>'00000000-0000-4000-8abc-'+n.toString(16).padStart(12,'0'),stamp='2026-10-02T09:00:00Z';
const empty: FichaEspelho={cardId:id(1),consultadoEm:stamp,parcial:false,aviso:'Independent reads',complete:{projeto:true,logistica:true,bom:true,projetoChecklist:true,comentarios:true,anexos:true},totals:{projeto:0,logistica:0,bom:0,projetoChecklist:0,comentarios:0,anexos:0},documento:{disponivel:false},projeto:null,logistica:null,bom:[],projetoChecklist:[],comentarios:[],anexos:[]};
function crmFixture(){
  const state={userId:id(99),profile:{id:id(99),role:'admin',approved_at:stamp,vendor_id:null},permitido:true};
  const client={auth:{async getUser(){return {data:{user:{id:state.userId}},error:null};}},from(table:string){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:table==='user_profiles'?state.profile:table==='role_permissions'?{permissions:{'menu.producao_fabrica':state.permitido}}:null,error:null};}};return q;}} as unknown as SupabaseClient;
  return {state,client};
}
async function call(request:Partial<VercelRequest>={},mutate?:(f:ReturnType<typeof crmFixture>)=>void,output:unknown=empty,deadlineMs?:number){
  const f=crmFixture();let sources=0,clients=0,status=0,emits=0;let body:unknown;const headers:Record<string,unknown>={};
  const res={setHeader(k:string,v:unknown){headers[k]=v;return res;},status(n:number){status=n;return res;},json(v:unknown){body=v;emits++;return res;}} as unknown as VercelResponse;
  const handler=criarHandlerProducaoFicha({crm:()=>{clients++;return f.client;},lerFicha:async(_scope,cardId)=>{sources++;assert.equal(cardId,id(1));if(deadlineMs)await new Promise(resolve=>setTimeout(resolve,20));mutate?.(f);if(output instanceof Error)throw output;return output as FichaEspelho;},deadlineMs});
  await handler({method:'GET',query:{cardId:id(1)},headers:{authorization:'Bearer synthetic'},...request} as VercelRequest,res);
  return {status,body:body as Record<string,unknown>,sources,clients,headers,get emits(){return emits;}};
}
test('ficha GET requires one selected UUID and projects private no-store output',async()=>{
  const r=await call();assert.equal(r.status,200);assert.deepEqual(r.body,empty);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers.Vary,'Authorization');assert.equal(r.sources,1);
});
test('invalid method, query, body and authentication stop before CRM and source channels',async()=>{
  for(const [request,status] of [[{method:'POST'},405],[{query:{cardId:'not-id'}},400],[{query:{cardId:[id(1)]}},400],[{query:{cardId:id(1),path:'PRIVATE'}},400],[{query:Object.create({cardId:id(1)})},400],[{body:{}},400],[{headers:{}},401],[{headers:{authorization:'Bearer x y'}},401]] as const){const r=await call(request as Partial<VercelRequest>);assert.equal(r.status,status);assert.equal(r.clients,0);assert.equal(r.sources,0);}
});
test('fresh approval, capability and account identity changes during source await never emit ficha',async()=>{
  for(const mutate of [(f:ReturnType<typeof crmFixture>)=>{f.state.permitido=false;},(f:ReturnType<typeof crmFixture>)=>{f.state.profile.approved_at='';},(f:ReturnType<typeof crmFixture>)=>{f.state.userId=id(100);},(f:ReturnType<typeof crmFixture>)=>{f.state.profile.role='financeiro';}]){const r=await call({},mutate);assert.equal(r.status,403);assert.equal(r.body.cardId,undefined);}
});
test('source error, foreign identity, partial data and wrong totals fail wholly with no private details',async()=>{
  for(const output of [Error('PRIVATE SOURCE'),{...empty,cardId:id(3)},{...empty,parcial:true},{...empty,totals:{...empty.totals,comentarios:3}}]){const r=await call({},undefined,output);assert.equal(r.status,503);assert.deepEqual(r.body,{error:'producao_indisponivel'});}
});
test('late ficha after endpoint deadline cannot emit a second response',async()=>{
  const r=await call({},undefined,empty,5);assert.equal(r.status,503);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(r.emits,1);
});

function clientFixture(){
  const authority={userId:id(99),profileId:id(99),role:'admin',vendorId:null,approvedAt:stamp,menu:true,loading:false,profileError:false,generation:1};
  const state={current:{...authority},token:'synthetic'};let requests=0;
  const deps:DepsConsultaFicha={cardId:id(1),authority,signal:new AbortController().signal,getCurrentAuthority:()=>state.current,getCurrentToken:()=>state.token,getSession:async()=>({user:{id:id(99)},access_token:state.token}),fetch:async(url,init)=>{requests++;assert.equal(url,'/api/controle-producao-ficha?cardId='+id(1));assert.equal(init.cache,'no-store');assert.equal((init.headers as Record<string,string>).Authorization,'Bearer synthetic');return {ok:true,status:200,json:async()=>empty};}};
  return {deps,state,get requests(){return requests;}};
}
test('ficha client uses selected UUID and bearer only after verifying the current session',async()=>{
  const f=clientFixture();assert.deepEqual(await consultarFichaEspelho(f.deps),empty);assert.equal(f.requests,1);
  const revoked=clientFixture();revoked.state.current.menu=false;await assert.rejects(consultarFichaEspelho(revoked.deps));assert.equal(revoked.requests,0);
});
test('late token, card generation, capability and abort changes discard all downloaded ficha data',async()=>{
  for(const mode of ['token','generation','menu','abort'] as const){const f=clientFixture(),controller=new AbortController();f.deps.signal=controller.signal;f.deps.fetch=async()=>{
    if(mode==='token')f.state.token='changed';if(mode==='generation')f.state.current.generation++;if(mode==='menu')f.state.current.menu=false;if(mode==='abort')controller.abort();
    return {ok:true,status:200,json:async()=>empty};
  };await assert.rejects(consultarFichaEspelho(f.deps),/Sessão alterada/);}
});

test('production ficha opt-in requires actual complete detail receipts and rejects unknown selectors',async()=>{
  const producao={complete:{historico:true,setores:true,checklists:true},totals:{historico:0,setores:0,checklists:0},historico:[],setores:[]};
  const request={query:{cardId:id(1),detalhes:'producao'}};const r=await call(request,undefined,{...empty,producao});assert.equal(r.status,200);assert.deepEqual(r.body.producao,producao);
  assert.equal((await call(request)).status,503);
  for(const detalhes of ['','unknown',['producao']])assert.equal((await call({query:{cardId:id(1),detalhes}} as Partial<VercelRequest>)).status,400);
  const f=clientFixture();f.deps.producao=true;f.deps.fetch=async url=>{assert.equal(url,'/api/controle-producao-ficha?cardId='+id(1)+'&detalhes=producao');return {ok:true,status:200,json:async()=>empty};};await assert.rejects(consultarFichaEspelho(f.deps));
});
