import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {VercelRequest,VercelResponse} from '@vercel/node';
import {criarHandlerArquivoProducao,lerArquivoProducao,parametrosArquivoFicha,type ArquivoFicha} from '../../api/controle-producao-arquivo.js';
import type {FonteEspelho,ReciboEspelho} from '../../api/_lib/producao-espelho-reader.js';
import type {autorizarCardFicha} from '../../api/_lib/producao-ficha-reader.js';
import type {EscopoEspelho} from '../../api/_lib/producao-espelho-acesso.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=id(1),vid=id(2),cid=id(10),aid=id(11),commentId=id(12),other=id(999),stamp='2026-10-02T12:00:00Z',CHUNK=3*1024*1024;
const global:EscopoEspelho={userId:uid,role:'admin',displayName:'',vendedores:null};
const valid:ArquivoFicha={bytes:Buffer.from('read only bytes'),nome:'projeto da produção.mp4',mime:'video/mp4',total:15,inicio:0,versao:'etag'};
function crmFixture(){
  const state={user:uid,profile:{id:uid,role:'admin',approved_at:stamp,vendor_id:vid} as Record<string,unknown>,permission:true,override:undefined as boolean|undefined,errorTable:'',vendors:[{id:vid,key:'ANA',name:'Ana Doe'}]};
  const reads:string[]=[];
  const crm={auth:{async getUser(){return {data:{user:{id:state.user}},error:null};}},from(table:string){
    reads.push(table);const filters:Array<[string,unknown]>=[];
    const q={select:()=>q,eq(k:string,v:unknown){filters.push([k,v]);return q;},async maybeSingle(){
      let data:unknown=null,error:unknown=state.errorTable===table?Error('PRIVATE LOOKUP'):null;
      if(table==='user_profiles')data=state.profile;
      if(table==='role_permissions')data={permissions:{'menu.producao_fabrica':state.permission}};
      if(table==='controle_permissoes_usuario')data=state.override===undefined?null:{permitido:state.override};
      if(table==='vendors'){
        const rows=state.vendors.filter(row=>filters.every(([key,value])=>row[key as keyof typeof row]===value));data=rows[0]??null;if(rows.length>1)error=Error('PRIVATE AMBIGUOUS');
      }
      return {data,error};
    }};return q;
  }} as unknown as SupabaseClient;
  return {state,reads,crm};
}
async function call(options:{fixture?:ReturnType<typeof crmFixture>;request?:Partial<VercelRequest>;output?:ArquivoFicha|Error;after?:()=>void;deadlineMs?:number;delay?:number}={}) {
  const f=options.fixture??crmFixture(),headers:Record<string,unknown>={};let status=0,body:unknown,crms=0,sourceReads=0,emits=0;
  const res={setHeader(k:string,v:unknown){headers[k]=v;return res;},status(code:number){status=code;return res;},json(value:unknown){body=value;emits++;return res;},send(value:unknown){body=value;emits++;return res;}} as unknown as VercelResponse;
  const handler=criarHandlerArquivoProducao({crm:()=>{crms++;return f.crm;},deadlineMs:options.deadlineMs,ler:async(scope,recurso,signal)=>{
    sourceReads++;assert.equal(scope.userId,uid);assert.equal(recurso.cardId,cid);assert.equal(signal.aborted,false);
    if(options.delay)await new Promise(resolve=>setTimeout(resolve,options.delay));options.after?.();
    if(options.output instanceof Error)throw options.output;return options.output??valid;
  }});
  await handler({method:'GET',query:{cardId:cid,tipo:'video',arquivoId:aid},headers:{authorization:'Bearer synthetic'},...options.request} as VercelRequest,res);
  return {status,body,headers,crms,sourceReads,get emits(){return emits;}};
}

test('authenticated binary responses preserve bytes and publish private no-store receipt headers',async()=>{
  const f=crmFixture(),result=await call({fixture:f});
  assert.equal(result.status,200);assert.deepEqual(result.body,valid.bytes);
  assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers.Vary,'Authorization');assert.equal(result.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(result.headers['Content-Type'],'video/mp4');assert.equal(result.headers['X-Arquivo-Total'],String(valid.total));assert.equal(result.headers['X-Arquivo-Inicio'],'0');
  assert.match(String(result.headers['Content-Disposition']),/produ%C3%A7%C3%A3o/);assert.equal(f.reads.includes('vendors'),false);
});

test('binary methods, duplicate parameters, caller paths and malformed auth stop before private IO',async()=>{
  const bad:Array<[Partial<VercelRequest>,number]>=[
    [{method:'POST'},405],[{method:'OPTIONS'},405],[{query:{cardId:cid,tipo:'pedido',url:'https://outside.test'}},400],
    [{query:{cardId:cid,tipo:'pedido',arquivoId:aid}},400],[{query:{cardId:[cid],tipo:'pedido'}},400],
    [{query:{cardId:cid,tipo:['video'],arquivoId:aid}},400],[{query:Object.create({cardId:cid,tipo:'pedido'})},400],
    [{query:{cardId:cid,tipo:'video',arquivoId:aid,inicio:'1'}},400],[{query:{cardId:cid,tipo:'pedido',inicio:'0'}},400],
    [{body:{}},400],[{headers:{}},401],[{headers:{authorization:'Bearer one two'}},401],
  ];
  for(const [request,expected] of bad){const result=await call({request});assert.equal(result.status,expected,JSON.stringify(request));assert.equal(result.crms,0);assert.equal(result.sourceReads,0);}
});

test('binary parameter contract preserves aligned chunks without allowing fractional, negative or oversized offsets',()=>{
  assert.deepEqual(parametrosArquivoFicha({cardId:cid,tipo:'pedido'}),{cardId:cid,tipo:'pedido',arquivoId:undefined,inicio:0});
  assert.equal(parametrosArquivoFicha({cardId:cid,tipo:'video',arquivoId:aid,inicio:String(CHUNK)}).inicio,CHUNK);
  for(const inicio of ['-1','0.5','01','1',String(81*1024*1024),['0'],0])assert.throws(()=>parametrosArquivoFicha({cardId:cid,tipo:'video',arquivoId:aid,inicio}));
});

test('binary access rejects missing approval or production capability before the selected source read',async()=>{
  for(const change of [{approved_at:null},{role:'unknown'},{id:other}]){
    const f=crmFixture();Object.assign(f.state.profile,change);const result=await call({fixture:f});assert.equal(result.status,403);assert.equal(result.sourceReads,0);
  }
  for(const mode of ['permission','override']){
    const f=crmFixture();if(mode==='permission')f.state.permission=false;else f.state.override=false;
    const result=await call({fixture:f});assert.equal(result.status,403);assert.equal(result.sourceReads,0);
  }
});

test('identity, role, approval and permission revoked during binary fetch never emit bytes',async()=>{
  for(const change of [{vendor_id:other},{role:'financeiro'},{approved_at:'changed'},{id:other}]){
    const f=crmFixture(),result=await call({fixture:f,after:()=>Object.assign(f.state.profile,change)});assert.equal(result.status,403);assert.ok(!Buffer.isBuffer(result.body));
  }
  for(const mode of ['permission','user']){
    const f=crmFixture(),result=await call({fixture:f,after:()=>{if(mode==='permission')f.state.override=false;else f.state.user=other;}});assert.equal(result.status,403);assert.ok(!Buffer.isBuffer(result.body));
  }
});

test('restricted binary wallet is rechecked after source IO instead of upgrading to a new seller mapping',async()=>{
  for(const mode of ['key','name','removed','collision','lookup-error']){
    const f=crmFixture();f.state.profile.role='vendor';
    const result=await call({fixture:f,after:()=>{
      if(mode==='key')f.state.vendors[0].key='OTHER';if(mode==='name')f.state.vendors[0].name='Other Name';
      if(mode==='removed')f.state.vendors=[];if(mode==='collision')f.state.vendors.push({id:other,key:'OTHER',name:'ANA'});if(mode==='lookup-error')f.state.errorTable='vendors';
    }});
    assert.equal(result.status,mode==='key'||mode==='name'?403:503,mode);assert.ok(!Buffer.isBuffer(result.body));assert.equal(result.emits,1);
  }
});

test('source failures and invalid binary budgets fail wholly without exposing private error text',async()=>{
  for(const output of [Error('PRIVATE STORAGE URL TOKEN'),{...valid,bytes:Buffer.alloc(0)},{...valid,bytes:Buffer.alloc(CHUNK+1)},{...valid,total:valid.bytes.length-1},{...valid,total:NaN},{...valid,inicio:1}]){
    const result=await call({output});assert.equal(result.status,503);assert.deepEqual(result.body,{error:'arquivo_indisponivel'});assert.ok(!JSON.stringify(result.body).includes('PRIVATE'));
  }
});

test('binary deadline aborts pending IO and cannot emit late bytes or a second response',async()=>{
  const result=await call({deadlineMs:5,delay:20});assert.equal(result.status,503);assert.deepEqual(result.body,{error:'arquivo_indisponivel'});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(result.emits,1);
});

function sourceRow(row:Record<string,unknown>,table='card_attachments',alter?:(table:string,receipt:ReciboEspelho)=>ReciboEspelho){
  const calls:Array<{table:string;filters:Array<[string,string[]]>}>=[];
  const fonte={from(name:string){const call={table:name,filters:[] as Array<[string,string[]]>};const q={select:()=>q,in(field:string,values:string[]){call.filters.push([field,values]);return q;},order:()=>q,range:()=>q,async abortSignal(){calls.push(call);const receipt={data:name===table?[row]:[],count:name===table?1:0,error:null};return alter?.(name,receipt)??receipt;}};return q;}} as FonteEspelho;
  return {fonte,calls};
}
const attachment=()=>({id:aid,card_id:cid,file_name:'projeto.mp4',file_path:`${cid}/projeto.mp4`,file_type:'video/mp4',file_size:15,categoria:'geral'});
function readerDeps(fonte:FonteEspelho,path:string|null='em_projeto/order-123/ORCAMENTO_TRATADO.docx'){
  let fetches=0;const autorizar=(async()=>({fonte,card:{id:cid,pedido_id:'MANUAL',doc_tratado_path:path},signal:new AbortController().signal})) as typeof autorizarCardFicha;
  const fetch=async()=>{fetches++;throw Error('fetch must not occur');};return {autorizar,fetch,get fetches(){return fetches;}};
}

test('foreign attachment rows and paths cannot reach Storage after card authorization',async()=>{
  for(const patch of [{card_id:other},{file_path:`${other}/projeto.mp4`},{file_path:`${cid}/../other.mp4`},{file_path:'https://outside.test/file.mp4'}]){
    const s=sourceRow({...attachment(),...patch}),deps=readerDeps(s.fonte);
    await assert.rejects(lerArquivoProducao(global,{cardId:cid,tipo:'video',arquivoId:aid,inicio:0},new AbortController().signal,deps));assert.equal(deps.fetches,0);
  }
});

test('original or absent production documents fail before any Storage read',async()=>{
  for(const path of [null,'em_projeto/order-123/ORCAMENTO_ORIGINAL.docx','em_projeto/order-123/ORCAMENTO_TRATADO.pdf','https://outside.test/order.docx']){
    const s=sourceRow(attachment()),deps=readerDeps(s.fonte,path);
    await assert.rejects(lerArquivoProducao(global,{cardId:cid,tipo:'pedido',inicio:0},new AbortController().signal,deps));assert.equal(deps.fetches,0);
  }
});

test('comment attachments require their actual comment to belong to the selected card before Storage',async()=>{
  const row={id:aid,comentario_id:commentId,file_name:'anexo.pdf',file_path:'comment-owned/anexo.pdf',file_type:'application/pdf',file_size:15};
  const s=sourceRow(row,'comentarios_anexos',(table,receipt)=>table==='comentarios'?{data:[{id:commentId,card_id:other}],count:1,error:null}:receipt),deps=readerDeps(s.fonte);
  await assert.rejects(lerArquivoProducao(global,{cardId:cid,tipo:'comentario',arquivoId:aid,inicio:0},new AbortController().signal,deps));assert.equal(deps.fetches,0);
  assert.deepEqual(s.calls.find(c=>c.table==='comentarios')?.filters,[['id',[commentId]],['card_id',[cid]]]);
});

test('photo and video resource kinds reject unexpected category or MIME before Storage',async()=>{
  for(const [tipo,patch] of [['foto',{file_type:'image/svg+xml',categoria:'logistica'}],['foto',{file_type:'image/png',categoria:'geral'}],['video',{file_type:'text/html'}]] as const){
    const s=sourceRow({...attachment(),...patch}),deps=readerDeps(s.fonte);
    await assert.rejects(lerArquivoProducao(global,{cardId:cid,tipo,arquivoId:aid,inicio:0},new AbortController().signal,deps));assert.equal(deps.fetches,0);
  }
});

const syntheticConfig={PRODUCAO_SUPABASE_URL:'https://yyfosrvlpsaycjnxcnkj.supabase.co',PRODUCAO_PRIVATE_READ_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz0123456'};
test('selected attachment Storage request is pinned, private, bounded and cannot follow redirects',async()=>{
  const s=sourceRow(attachment()),deps=readerDeps(s.fonte),bytes=Buffer.alloc(15,7);
  const output=await lerArquivoProducao(global,{cardId:cid,tipo:'video',arquivoId:aid,inicio:0},new AbortController().signal,{...deps,config:syntheticConfig,fetch:async(url,init)=>{
    assert.equal(String(url),`https://yyfosrvlpsaycjnxcnkj.supabase.co/storage/v1/object/authenticated/card-attachments/${cid}/projeto.mp4`);
    assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal((init?.headers as Record<string,string>).Range,`bytes=0-${CHUNK-1}`);
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+syntheticConfig.PRODUCAO_PRIVATE_READ_KEY);
    return new Response(bytes,{status:206,headers:{'Content-Range':'bytes 0-14/15','Content-Length':'15',ETag:'version-one'}});
  }});
  assert.deepEqual(output.bytes,bytes);assert.equal(output.total,15);assert.equal(output.versao,'version-one');
});

test('contradictory, truncated or unversioned Storage ranges never produce a partial file',async()=>{
  const cases=[
    {range:'bytes 0-0/15',length:15},
    {range:'bytes 1-15/16',length:15},
    {range:'bytes 0-14/15',length:14},
    {range:`bytes 0-${CHUNK-1}/${CHUNK+1}`,length:CHUNK,version:''},
  ];
  for(const c of cases){
    const s=sourceRow(attachment()),deps=readerDeps(s.fonte);
    await assert.rejects(lerArquivoProducao(global,{cardId:cid,tipo:'video',arquivoId:aid,inicio:0},new AbortController().signal,{...deps,config:syntheticConfig,fetch:async()=>new Response(Buffer.alloc(c.length),{status:206,headers:{'Content-Range':c.range,ETag:c.version??'stable'}})}));
  }
});

test('malformed selected attachment receipts cannot omit required error ownership',async()=>{
  const s=sourceRow(attachment(),'card_attachments',(_table,receipt)=>({data:receipt.data,count:receipt.count} as ReciboEspelho)),deps=readerDeps(s.fonte);
  let storage=0;
  await assert.rejects(lerArquivoProducao(global,{cardId:cid,tipo:'video',arquivoId:aid,inicio:0},new AbortController().signal,{...deps,config:syntheticConfig,fetch:async()=>{storage++;return new Response(Buffer.alloc(15),{status:206,headers:{'Content-Range':'bytes 0-14/15'}});}}));
  assert.equal(storage,0);
});
