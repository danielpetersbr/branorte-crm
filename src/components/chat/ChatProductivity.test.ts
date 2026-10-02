import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ChatFollowUp, ChatReplyPreview, ChatSalesPanel } from './ChatProductivity'

test('prévia de citação escapa conteúdo e permite cancelar sem inventar remetente',()=>{
  const html=renderToStaticMarkup(createElement(ChatReplyPreview,{preview:'<script>texto</script>',author:null,onCancel(){}}))
  assert.match(html,/Mensagem citada/);assert.match(html,/Cancelar citação/)
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/)
})
test('retorno vencido mostra prazo e ações internas, sem controle de envio',()=>{
  const html=renderToStaticMarkup(createElement(ChatFollowUp,{dueAt:'2026-10-02T10:00:00Z',now:Date.parse('2026-10-02T11:00:00Z'),disabled:false,onSave:async()=>true,onDone:async()=>true}))
  assert.match(html,/Atrasado há 1h/);assert.match(html,/Concluir/);assert.match(html,/Cancelar retorno/)
  assert.match(html,/Não envia mensagens/);assert.doesNotMatch(html,/Enviar mensagem/)
})
test('painel mantém resumos autorizados sem links quando a rota não é permitida',()=>{
  const data={orders:[{id:'order',number:'123',status:'Aberto',total:150,date:null,href:null}],quotes:[{id:1,number:'321',year:2026,status:null,date:null,href:null}]}
  const html=renderToStaticMarkup(createElement(ChatSalesPanel,{data,loading:false,onRetry(){}}))
  assert.match(html,/Pedido 123/);assert.match(html,/Orçamento 321\/2026/);assert.match(html,/150,00/)
  assert.doesNotMatch(html,/<a /)
})
test('painel usa somente rotas conhecidas para links devolvidos pelo servidor',()=>{
  const data={orders:[{id:'order',number:'123',status:null,total:null,date:null,href:'/controle/pedidos/order'}],quotes:[{id:1,number:'321',year:2026,status:null,date:null,href:'https://external.invalid'}]}
  const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(ChatSalesPanel,{data,loading:false,onRetry(){}})))
  assert.match(html,/href="\/controle\/pedidos\/order"/);assert.match(html,/Orçamento 321\/2026/)
  assert.doesNotMatch(html,/external\.invalid/)
})
