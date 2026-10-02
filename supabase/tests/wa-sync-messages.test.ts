import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {transformSync} from 'esbuild'
import * as policy from '../functions/wa-sync-messages/media-policy.ts'

const dataUrl=(mime:string,n=120)=>'data:'+mime+';base64,'+Buffer.alloc(n).toString('base64')
function encodedBytes(n:number) {
  return 'A'.repeat(Math.floor(n/3)*4)+(n%3===1?'AA==':n%3===2?'AAA=':'')
}
test('ANA captures document/video/sticker independently of the legacy capture set',()=> {
  assert.deepEqual(policy.captureTypes('IGOR'),['ptt','audio','image'])
  assert.deepEqual(policy.captureTypes('ANA'),['ptt','audio','image','video','document','sticker'])
  for (const [type,mime,ext] of [['video','video/mp4','mp4'],['video','video/webm','webm'],['document','application/pdf','pdf'],['document','text/plain','txt'],['sticker','image/webp','webp']]) {
    const result=policy.validateMedia('ANA',type,dataUrl(mime))
    assert.equal(result.ok,true)
    if(result.ok) {assert.equal(result.extension,ext);assert.equal(result.bucket,type==='document'||type==='video'?'crm-chat-media':'wa-midias')}
  }
  assert.deepEqual(policy.validateMedia('IGOR','video',dataUrl('video/mp4')),{ok:false,reason:'unsupported_type'})
})
test('MIME validation follows the stored message type and controlled filename fallback',()=> {
  for (const mime of ['text/html','image/svg+xml','application/x-msdownload']) assert.deepEqual(policy.validateMedia('ANA','document',dataUrl(mime)),{ok:false,reason:'unsupported_mime'})
  assert.deepEqual(policy.validateMedia('ANA','image',dataUrl('audio/ogg')),{ok:false,reason:'unsupported_mime'})
  assert.deepEqual(policy.validateMedia('ANA','document',dataUrl('application/octet-stream'),'programa.exe'),{ok:false,reason:'unsupported_mime'})
  const office=policy.validateMedia('ANA','document',dataUrl('application/octet-stream'),'Proposta.XLSX')
  assert.equal(office.ok,true)
  if(office.ok)assert.equal(office.mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const zip=policy.validateMedia('ANA','document',dataUrl('application/x-zip-compressed'))
  assert.equal(zip.ok,true)
  if(zip.ok)assert.equal(zip.mime,'application/zip')
  const opus=policy.validateMedia('ANA','ptt',dataUrl('audio/ogg;codecs=opus'))
  assert.equal(opus.ok,true)
  if(opus.ok)assert.equal(opus.bucket,'wa-audios')
})
test('encoded size is checked before allocation and the exact 20 MiB boundary is accepted',()=> {
  const limit=policy.CRM_MAX_MEDIA_BYTES
  const valid=policy.validateMedia('ANA','document','data:application/pdf;base64,'+encodedBytes(limit))
  assert.equal(valid.ok,true)
  if(valid.ok)assert.equal(valid.decodedLength,limit)
  assert.deepEqual(policy.validateMedia('ANA','document','data:application/pdf;base64,'+encodedBytes(limit+1)),{ok:false,reason:'too_large'})
  assert.deepEqual(policy.validateMedia('IGOR','audio','data:audio/ogg;base64,'+encodedBytes(policy.LEGACY_MAX_MEDIA_BYTES+1)),{ok:false,reason:'too_large'})
})
test('malformed/empty/internal-padding base64 is rejected before Storage upload',()=> {
  for(const encoded of ['', 'AAAA=', 'AA=A', 'AAAA;alert(1)', '=AAA']) {
    assert.deepEqual(policy.validateMedia('ANA','video','data:video/mp4;base64,'+encoded),{ok:false,reason:'invalid_base64'})
  }
})
test('bounded JSON reader handles UTF-8, malformed JSON and streamed overflow',async()=> {
  const payload=JSON.stringify({text:'ação'})
  assert.deepEqual(await policy.readLimitedJson(new Request('https://example.test',{method:'POST',body:payload}),Buffer.byteLength(payload)),{text:'ação'})
  await assert.rejects(policy.readLimitedJson(new Request('https://example.test',{method:'POST',body:payload}),payload.length),policy.PayloadTooLargeError)
  await assert.rejects(policy.readLimitedJson(new Request('https://example.test',{method:'POST',body:'{' })),SyntaxError)
  let cancelled=false
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(12))},cancel(){cancelled=true}})
  await assert.rejects(policy.readLimitedJson(new Request('https://example.test',{method:'POST',body:stream,duplex:'half'} as RequestInit),10),policy.PayloadTooLargeError)
  assert.equal(cancelled,true)
})
test('32 MiB request ceiling preserves the actual legacy batch of four 6MB binaries',()=> {
  const legacyEncodedBytes=4*(4*Math.ceil(policy.LEGACY_MAX_MEDIA_BYTES/3))
  assert.ok(legacyEncodedBytes+4096<policy.MAX_JSON_BODY_BYTES)
  assert.ok(4*Math.ceil(policy.CRM_MAX_MEDIA_BYTES/3)+4096<policy.MAX_JSON_BODY_BYTES)
})

function edgeServer(row:{id:number;tipo:string;filename?:string;vendor?:string;chat_id?:string}|null,uploadError=false,secretMode:'primary'|'alias'|'none'='primary',conversation:string|null='11111111-1111-4111-8111-111111111111') {
  let handler:(request:Request)=>Promise<Response>
  const uploads:Array<{bucket:string;path:string;size:number;mime:string}>=[]
  const updates:unknown[]=[]
  const filters:Array<[string,unknown]>=[]
  const sb={from(table:string){
    const query:any={select(){return query},eq(key:string,value:unknown){filters.push([key,value]);return query},is(){return query},
      update(value:unknown){updates.push(value);return query},
      async maybeSingle(){return {data:table==='crm_chat_conversations' ? conversation ? {id:conversation} : null : row && (!row.vendor||filters.some(([k,v])=>k==='vendedor_nome'&&v===row.vendor))?{chat_id:'stored-chat@c.us',...row}:null,error:null}},
      then(resolve:Function){resolve({data:null,error:null})}}
    return query
  },storage:{from(bucket:string){return {async upload(path:string,bytes:Uint8Array,options:any){uploads.push({bucket,path,size:bytes.length,mime:options.contentType});return {error:uploadError?new Error('temporary failure'):null}}}}}}
  const source=readFileSync(new URL('../functions/wa-sync-messages/index.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'')
  const code=transformSync(source,{loader:'ts',target:'es2022',format:'cjs'}).code
  vm.runInNewContext(code,{...policy,Request,Response,Uint8Array,TextDecoder,atob,crypto:globalThis.crypto,console:{error(){},log(){}},Deno:{env:{get(name:string){
    if(name==='SHARED_SECRET')return secretMode==='primary'?'test-secret':undefined
    if(name==='WA_SYNC_SHARED_SECRET')return secretMode==='alias'?'test-secret':undefined
    return name==='SUPABASE_URL'?'https://example.test':'test-server-key'
  }}},
    serve(fn:any){handler=fn},createClient(){return sb}})
  return {call:async(body:unknown)=>handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test-secret'},body:JSON.stringify(body)})),uploads,updates,filters}
}
test('actual Edge caches video/documents using the stored type and filename',async()=> {
  for(const [type,mime,filename,ext] of [['video','video/mp4','video.mp4','mp4'],['document','application/octet-stream','Proposta.xlsx','xlsx'],['sticker','image/webp','sticker.webp','webp']]) {
    const edge=edgeServer({id:42,tipo:type,filename,vendor:'ANA'})
    const result=await edge.call({vendedor_nome:'ANA',media:[{msg_id:'hash',dataUrl:dataUrl(mime)}]})
    assert.equal(result.status,200)
    assert.equal((await result.json()).media_saved,1)
    const privateFile=type==='video'||type==='document'
    assert.equal(edge.uploads[0].bucket,privateFile?'crm-chat-media':'wa-midias')
    if(privateFile) {
      assert.match(edge.uploads[0].path,new RegExp('^11111111-1111-4111-8111-111111111111/[a-f0-9-]{36}\\.'+ext+'$'))
      assert.ok(edge.filters.some(([k,v])=>k==='wa_chat_id'&&v==='stored-chat@c.us'))
    } else assert.equal(edge.uploads[0].path,'ANA/hash.'+ext)
    assert.ok(edge.filters.some(([k,v])=>k==='vendedor_nome'&&v==='ANA'))
    assert.deepEqual(JSON.parse(JSON.stringify(edge.updates)),[{media_url:'https://example.test/storage/v1/object/'+(privateFile?'authenticated/crm-chat-media/':'public/wa-midias/')+edge.uploads[0].path}])
  }
})
test('actual Edge skips other-vendor/missing messages and rejects unsafe MIME without upload',async()=> {
  const missing=edgeServer({id:42,tipo:'video',vendor:'IGOR'})
  assert.equal((await (await missing.call({vendedor_nome:'ANA',media:[{msg_id:'hash',dataUrl:dataUrl('video/mp4')}]})).json()).media_saved,0)
  assert.equal(missing.uploads.length,0)
  const unsafe=edgeServer({id:42,tipo:'document',vendor:'ANA'})
  await unsafe.call({vendedor_nome:'ANA',media:[{msg_id:'hash',dataUrl:dataUrl('text/html')}]})
  assert.equal(unsafe.uploads.length,0)
  assert.deepEqual(JSON.parse(JSON.stringify(unsafe.updates)),[{media_url:'unavailable'}])
})
test('transient Storage failure keeps media pending for the next retry',async()=> {
  const edge=edgeServer({id:42,tipo:'video',vendor:'ANA'},true)
  const result=await edge.call({vendedor_nome:'ANA',media:[{msg_id:'hash',dataUrl:dataUrl('video/mp4')}]})
  assert.equal((await result.json()).media_saved,0)
  assert.equal(edge.uploads.length,1)
  assert.equal(edge.updates.length,0)
})

test('Edge supports the configured legacy secret alias and fails closed without secrets',async()=> {
  const alias=edgeServer(null,false,'alias')
  assert.equal((await alias.call({vendedor_nome:'ANA',media:[{msg_id:'hash',indisponivel:true}]})).status,200)
  const missing=edgeServer(null,false,'none')
  assert.equal((await missing.call({vendedor_nome:'ANA',media:[{msg_id:'hash',indisponivel:true}]})).status,401)
  assert.equal(missing.updates.length,0)
})

test('generic WebM MIME uses the stored message category to distinguish video/audio',()=> {
  for(const [type,mime]of [['video','video/webm'],['audio','audio/webm']]) {
    const value=policy.validateMedia('ANA',type,dataUrl('application/octet-stream'),'clip.webm')
    assert.equal(value.ok,true)
    if(value.ok)assert.equal(value.mime,mime)
  }
})

test('documents/video have no public fallback when their conversation is missing',async()=> {
  for(const type of ['document','video']) {
    const edge=edgeServer({id:42,tipo:type,vendor:'ANA'},false,'primary',null)
    const result=await edge.call({vendedor_nome:'ANA',media:[{msg_id:'hash',chat_id:'caller-supplied-chat',dataUrl:dataUrl(type==='document'?'application/pdf':'video/mp4')}]})
    assert.equal((await result.json()).media_saved,0)
    assert.equal(edge.uploads.length,0)
    assert.equal(edge.updates.length,0)
    assert.ok(edge.filters.some(([k,v])=>k==='wa_chat_id'&&v==='stored-chat@c.us'))
  }
})
test('private media MIME allowlist matches the existing 20-type bucket',()=> {
  assert.deepEqual(policy.validateMedia('ANA','document',dataUrl('image/gif')),{ok:false,reason:'unsupported_mime'})
  assert.equal(policy.validateMedia('ANA','image',dataUrl('image/gif')).ok,true)
})
