import {test} from 'node:test'
import assert from 'node:assert/strict'
import {anaCrmGate} from '../../supabase/functions/ia-atendente/crm-gate'

test('gate consulta o chat exato e preserva a pausa registrada antes da IA',async()=>{
  const calls:unknown[]=[]
  const result=await anaCrmGate({rpc:async(name,args)=>{calls.push({name,args});return {data:{allowed:false,reason:'crm_resolved'},error:null}}},'5548999999999@c.us')
  assert.deepEqual(calls,[{name:'crm_ana_automation_gate',args:{p_chat_id:'5548999999999@c.us'}}])
  assert.deepEqual(result,{allowed:false,reason:'crm_resolved'})
})
test('gate permite uma conversa que o servidor liberou',async()=>{
  assert.deepEqual(await anaCrmGate({rpc:async()=>({data:{allowed:true,reason:'allowed'},error:null})},'lead@lid'),{allowed:true,reason:'allowed'})
})
test('falha, ausência e resposta incompleta do gate não liberam automação',async()=>{
  for(const result of [{data:null,error:{message:'offline'}},{data:null,error:null},{data:{allowed:'true'},error:null}]) {
    await assert.rejects(anaCrmGate({rpc:async()=>result},'lead@lid'),/Não foi possível verificar/)
  }
})
test('exceção de rede não é convertida em autorização',async()=>{
  const failure=new Error('network')
  await assert.rejects(anaCrmGate({rpc:async()=>{throw failure}},'lead@lid'),e=>e===failure)
})
