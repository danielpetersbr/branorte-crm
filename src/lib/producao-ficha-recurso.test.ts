import test from 'node:test';
import assert from 'node:assert/strict';
import {consultarRecursoFicha,type DepsRecursoFicha} from './producao-ficha-recurso';
import type {AutoridadeEspelho} from './producao-espelho-consulta';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,CHUNK=3*1024*1024;
function fixture(total=4){
  const initial:AutoridadeEspelho={userId:id(1),profileId:id(1),role:'admin',vendorId:null,approvedAt:'2026-10-02T00:00:00Z',menu:true,loading:false,profileError:false,generation:1};
  const state={authority:initial,token:'synthetic',calls:[] as string[],controller:new AbortController()};
  const deps:DepsRecursoFicha={cardId:id(2),authority:initial,recurso:{tipo:'video',arquivoId:id(3)},signal:state.controller.signal,getCurrentAuthority:()=>state.authority,getCurrentToken:()=>state.token,getSession:async()=>({user:{id:id(1)},access_token:state.token}),fetch:async(url,init)=>{
    state.calls.push(url);assert.equal(init.cache,'no-store');assert.deepEqual(init.headers,{Authorization:'Bearer synthetic'});assert.equal(init.signal,state.controller.signal);
    const offset=Number(new URL(url,'https://local.test').searchParams.get('inicio')??0);
    return new Response(new Uint8Array(Math.min(CHUNK,total-offset)).fill(7),{headers:{'Content-Type':'video/mp4','Content-Disposition':"attachment; filename*=UTF-8''projeto.mp4",'X-Arquivo-Total':String(total),'X-Arquivo-Inicio':String(offset),'X-Arquivo-Versao':'same-etag'}});
  }};return {state,deps};
}
test('private chunks reconstruct the same complete file with current session around every read',async()=>{
  const f=fixture(CHUNK+7),out=await consultarRecursoFicha(f.deps);assert.equal(out.nome,'projeto.mp4');assert.equal(out.blob.size,CHUNK+7);assert.equal(out.blob.type,'video/mp4');assert.equal(f.state.calls.length,2);assert.ok(f.state.calls[1].includes('inicio='+CHUNK));const bytes=new Uint8Array(await out.blob.arrayBuffer());assert.equal(bytes[bytes.length-1],7);
});
test('identity, permission, token or abort changes after source reads cannot return a blob',async()=>{
  for(const change of ['token','menu','generation','abort']){const f=fixture(),fetch=f.deps.fetch;f.deps.fetch=async(...args)=>{const response=await fetch(...args);if(change==='token')f.state.token='changed';if(change==='menu')f.state.authority={...f.state.authority,menu:false};if(change==='generation')f.state.authority={...f.state.authority,generation:2};if(change==='abort')f.state.controller.abort();return response;};await assert.rejects(consultarRecursoFicha(f.deps),/Sessão alterada/);}
});
test('file changes between chunks and contradictory receipt lengths fail without partial success',async()=>{
  for(const mode of ['version','total','offset','name','size']){const f=fixture(CHUNK+7),fetch=f.deps.fetch;f.deps.fetch=async(...args)=>{const response=await fetch(...args);if(f.state.calls.length===2){if(mode==='version')response.headers.set('X-Arquivo-Versao','new');if(mode==='total')response.headers.set('X-Arquivo-Total',String(CHUNK+9));if(mode==='offset')response.headers.set('X-Arquivo-Inicio','0');if(mode==='name')response.headers.set('Content-Disposition',"attachment; filename*=UTF-8''changed.mp4");if(mode==='size')return new Response(new Uint8Array(1),{headers:response.headers});}return response;};await assert.rejects(consultarRecursoFicha(f.deps),/Arquivo indisponível/);}
});
test('invalid resource kind, extra document ID and response failures stay closed',async()=>{
  for(const recurso of [{tipo:'other'},{tipo:'pedido',arquivoId:id(3)},{tipo:'foto',arquivoId:'bad'}]){const f=fixture();f.deps.recurso=recurso as DepsRecursoFicha['recurso'];await assert.rejects(consultarRecursoFicha(f.deps));assert.equal(f.state.calls.length,0);}
  const f=fixture();f.deps.fetch=async()=>new Response('PRIVATE URL KEY',{status:403});await assert.rejects(consultarRecursoFicha(f.deps),/^Error: Arquivo indisponível/);
});
