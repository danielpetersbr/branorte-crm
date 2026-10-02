import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarPatch } from '../functions/wa-sync-avatars/avatar-patch.ts'

const now='2026-10-01T23:00:00.000Z'
test('only an authoritative no-photo response clears the cached profile', () => {
  assert.deepEqual(avatarPatch({pic_url:null,pic_checked:true},null,now),{foto_url:null,foto_checked_at:now})
  assert.equal(avatarPatch({pic_url:null},null,now),null)
  assert.equal(avatarPatch({pic_url:null,pic_checked:false},null,now),null)
  assert.equal(avatarPatch({pic_checked:true},null,now),null)
})
test('download failure and missing lookup keep the record eligible for retry', () => {
  assert.equal(avatarPatch({pic_url:'https://example.test/expired.jpg',pic_checked:true},null,now),null)
  assert.equal(avatarPatch({},null,now),null)
})
test('successful storage download refreshes both cache URL and timestamp', () => {
  const url='https://example.test/storage/avatar.jpg'
  assert.deepEqual(avatarPatch({pic_url:'https://example.test/picture'},url,now),{foto_url:url,foto_checked_at:now})
})

import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {transformSync} from 'esbuild'
import {normalizeAvatarCursor,nextAvatarCursor} from '../functions/wa-sync-avatars/avatar-patch.ts'

test('avatar cursor advances beyond failed lookups and resets at the end',()=> {
  assert.equal(normalizeAvatarCursor('551234567890'),'551234567890')
  assert.equal(normalizeAvatarCursor('invalid/or=query'),null)
  assert.equal(normalizeAvatarCursor('9'.repeat(100)),null)
  assert.equal(nextAvatarCursor([{phone:'551234567890'},{phone:'551234567891'}]),'551234567891')
  assert.equal(nextAvatarCursor([]),null)
})
function avatarEdge(secretMode:'primary'|'alias'|'none'='primary') {
  let handler:(request:Request)=>Promise<Response>
  const ordered:string[]=[]; const cursor:string[]=[]
  const query:any={select(){return query},eq(){return query},neq(){return query},or(){return query},
    order(column:string){ordered.push(column);return query},gt(column:string,value:string){cursor.push(value);return query},
    async limit(n:number){return {data:['551000000001','551000000002'].filter(p=>!cursor.length||p>cursor[0]).slice(0,n).map(phone=>({phone,chat_id:phone+'@c.us'}))}}}
  const source=readFileSync(new URL('../functions/wa-sync-avatars/index.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'')
  vm.runInNewContext(transformSync(source,{loader:'ts',target:'es2022',format:'cjs'}).code,{
    avatarPatch,normalizeAvatarCursor,nextAvatarCursor,Request,Response,console:{error(){}},
    Deno:{env:{get(name:string){if(name==='SHARED_SECRET')return secretMode==='primary'?'test-secret':undefined;if(name==='WA_SYNC_SHARED_SECRET')return secretMode==='alias'?'test-secret':undefined;return 'https://example.test'}}},
    serve(fn:any){handler=fn},createClient(){return {from(){return query}}}
  })
  return {async call(body:unknown){return handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test-secret'},body:JSON.stringify(body)}))},ordered,cursor}
}
test('actual avatar Edge scopes cursor ordering to ANA, preserves legacy ordering and returns null at the end',async()=> {
  const edge=avatarEdge()
  const response=await edge.call({vendedor_nome:'ANA',avatar_cursor:'551000000001'})
  const data=await response.json()
  assert.equal(data.precisam_foto.length,1)
  assert.equal(data.precisam_foto[0].phone,'551000000002')
  assert.equal(data.avatar_cursor,'551000000002')
  assert.deepEqual(edge.ordered,['phone'])
  assert.deepEqual(edge.cursor,['551000000001'])
  const end=avatarEdge()
  const empty=await (await end.call({vendedor_nome:'ANA',avatar_cursor:'551000000002'})).json()
  assert.deepEqual(empty.precisam_foto,[])
  assert.equal(empty.avatar_cursor,null)
  const legacy=avatarEdge()
  await legacy.call({vendedor_nome:'IGOR',avatar_cursor:'551000000001'})
  assert.deepEqual(legacy.ordered,['foto_checked_at'])
  assert.deepEqual(legacy.cursor,[])
})
test('avatar Edge authorizes the configured legacy alias and rejects missing secrets',async()=> {
  assert.equal((await avatarEdge('alias').call({vendedor_nome:'ANA'})).status,200)
  assert.equal((await avatarEdge('none').call({vendedor_nome:'ANA'})).status,401)
})
