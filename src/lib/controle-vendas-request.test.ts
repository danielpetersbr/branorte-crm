import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ControleVendasErro,requisitarControleVendas} from './controle-vendas-request'

const session={user:{id:'usuario-1'},access_token:'token-1'}
test('sem sessão não lê dados de vendas',async()=>{
  let reads=0
  await assert.rejects(requisitarControleVendas({url:'/api/controle-vendas',getSession:async()=>null,fetch:async()=>{reads++;return new Response('{}')}}),/sessão/i)
  assert.equal(reads,0)
})
test('rejeita leitura concluída depois da troca de usuário ou token',async()=>{
  for(const next of [null,{user:{id:'usuario-2'},access_token:'token-2'},{...session,access_token:'token-renovado'}]){
    let calls=0
    await assert.rejects(requisitarControleVendas({url:'/api/controle-vendas',getSession:async()=>calls++===0?session:next,fetch:async()=>new Response(JSON.stringify({data:[{id:'privado'}]}))}),/sessão/i)
  }
})
test('revogação retorna erro e nunca entrega payload anterior',async()=>{
  await assert.rejects(requisitarControleVendas({url:'/api/controle-vendas',getSession:async()=>session,fetch:async()=>new Response('{"data":[{"id":"privado"}]}',{status:403})}),e=>e instanceof ControleVendasErro&&e.status===403&&/permissão/i.test(e.message))
})
test('cancela seleção antiga mesmo quando transporte entrega resposta',async()=>{
  const controller=new AbortController()
  await assert.rejects(requisitarControleVendas({url:'/api/controle-vendas',signal:controller.signal,getSession:async()=>session,fetch:async()=>{controller.abort();return new Response('{"data":[]}')}}),/cancelada/i)
})
test('envia Bearer somente à API local e não permite URL externa',async()=>{
  let auth:string|null=null
  assert.deepEqual(await requisitarControleVendas({url:'/api/controle-vendas?inicio=2026-01-01',getSession:async()=>session,fetch:async(_url,init)=>{auth=new Headers(init?.headers).get('Authorization');return new Response('{"data":[]}')}}),{data:[]})
  assert.equal(auth,'Bearer token-1')
  await assert.rejects(requisitarControleVendas({url:'https://outro.test',getSession:async()=>session,fetch:async()=>new Response('{}')}),/destino/i)
})
