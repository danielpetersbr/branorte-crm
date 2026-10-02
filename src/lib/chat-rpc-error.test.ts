import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatRpcError, recoverRejectedChatQuote } from './chat-rpc-error'

const request={id:'original-id',chat:'chat-a',body:'Resposta preparada',path:'chat-a/original-id.pdf',mime:'application/pdf',filename:'proposta.pdf',reply_msg_id:'EXACT-ID',reply_preview:'Citação original',reply_sender_name:'Cliente'}
const rejected=()=>new ChatRpcError({message:'Mensagem citada não pertence a esta conversa.',code:'P0002',details:'crm_chat_quote_rejected'})

test('erro RPC preserva mensagem, código e detalhe devolvidos pelo servidor',()=>{
  const error=rejected()
  assert.ok(error instanceof Error)
  assert.equal(error.message,'Mensagem citada não pertence a esta conversa.')
  assert.equal(error.code,'P0002');assert.equal(error.details,'crm_chat_quote_rejected')
})
test('rejeição dedicada libera nova solicitação preservando texto e mídia, sem reaproveitar a citação',()=>{
  assert.deepEqual(recoverRejectedChatQuote(rejected(),request),{
    body:'Resposta preparada',media:{path:'chat-a/original-id.pdf',mime:'application/pdf',filename:'proposta.pdf'},
  })
  assert.deepEqual(recoverRejectedChatQuote(rejected(),{...request,path:undefined}),{body:'Resposta preparada',media:null})
})
test('rede, timeout, permissão e erro SQL genérico mantêm envio incerto e chave original',()=>{
  for(const error of [new TypeError('Failed to fetch'),new Error('Timeout'),new ChatRpcError({message:'Acesso negado',code:'42501'}),new ChatRpcError({message:'Falha',code:'P0001'}),new ChatRpcError({message:'Sem dados',code:'P0002'}),new ChatRpcError({message:'Sem dados',code:'P0002',details:'outro_marcador'})]) {
    assert.equal(recoverRejectedChatQuote(error,request),null)
    assert.equal(request.id,'original-id');assert.equal(request.reply_msg_id,'EXACT-ID')
  }
  assert.equal(recoverRejectedChatQuote(rejected(),{...request,reply_msg_id:undefined}),null)
  assert.equal(recoverRejectedChatQuote(rejected(),{...request,reply_msg_id:' '}),null)
})
