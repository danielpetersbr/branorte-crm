import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { anaTagNames, chatResolution } from './chat-ana'
import { ChatAnaContext, ChatAnaTags, ChatResolutionBadge } from '../components/chat/ChatAnaContext'

test('etiquetas reais são preservadas sem inventar catálogo ou misturar etiquetas manuais',()=>{
  const labels=['RESOLVIDOS','ORÇAMENTO','RESOLVIDOS','']
  assert.deepEqual(anaTagNames(labels),['RESOLVIDOS','ORÇAMENTO'])
  assert.deepEqual(labels,['RESOLVIDOS','ORÇAMENTO','RESOLVIDOS',''])
  assert.deepEqual(anaTagNames(undefined),[])
})
test('conversa reaberta não mostra encerramento mesmo mantendo etiqueta antiga e metadados',()=>{
  const reopened={status:'open' as const,ana_tags:['RESOLVIDOS'],resolution_source:'ana' as const,resolution_reason:'Resolvido',resolved_at:'2026-10-02T10:00:00Z'}
  assert.equal(chatResolution(reopened),null)
  const html=renderToStaticMarkup(createElement(ChatAnaContext,{conversation:reopened}))
  assert.match(html,/RESOLVIDOS/);assert.doesNotMatch(html,/Finalizado|Finalizado em/)
  assert.equal(renderToStaticMarkup(createElement(ChatResolutionBadge,{conversation:reopened})), '')
})
test('origem desconhecida não atribui encerramento nem motivo antigo à Ana',()=>{
  const result=chatResolution({status:'resolved',resolution_source:null,resolution_reason:'Texto sem origem',resolved_at:'inválida'})
  assert.equal(result?.label,'Finalizado (origem desconhecida)')
  assert.equal(result?.reason,null);assert.equal(result?.closedAt,null);assert.equal(result?.observedAt,null)
})
test('data observada da etiqueta é distinguida da data efetiva de finalização',()=>{
  const conversation={status:'resolved' as const,resolution_source:'ana' as const,resolution_reason:'Etiqueta RESOLVIDOS',resolved_at:null,resolution_observed_at:'2026-10-02T10:00:00+00:00'}
  const result=chatResolution(conversation)
  assert.equal(result?.closedAt,null);assert.equal(result?.observedAt,conversation.resolution_observed_at)
  const html=renderToStaticMarkup(createElement(ChatAnaContext,{conversation}))
  assert.match(html,/Finalizado pela Ana/);assert.match(html,/Etiqueta atualizada em/)
  assert.doesNotMatch(html,/Finalizado em|Invalid Date/)
  assert.equal(chatResolution({...conversation,resolution_observed_at:'2026'})?.observedAt,null)
})
test('encerramento explícito no CRM mostra data válida, sem atribuir observação da Ana',()=>{
  const result=chatResolution({status:'resolved',resolution_source:'crm',resolution_reason:'Atendimento concluído',resolved_at:'2026-10-02T10:00:00Z',resolution_observed_at:'2026-10-02T12:00:00Z'})
  assert.equal(result?.label,'Finalizado no CRM');assert.equal(result?.closedAt,'2026-10-02T10:00:00Z')
  assert.equal(result?.reason,'Atendimento concluído');assert.equal(result?.observedAt,null)
})
test('nova detecção da Ana não apresenta horário como finalização exata do WhatsApp',()=>{
  const html=renderToStaticMarkup(createElement(ChatAnaContext,{conversation:{status:'resolved',resolution_source:'ana',resolved_at:'2026-10-02T10:00:00Z'}}))
  assert.match(html,/Encerramento detectado em/);assert.doesNotMatch(html,/Finalizado em/)
})
test('painel completo exibe todas as etiquetas como texto, sem depender do título de mais etiquetas',()=>{
  const tags=['RESOLVIDOS','ORÇAMENTO','RETORNO','ÚLTIMA ETIQUETA COMPLETA']
  const html=renderToStaticMarkup(createElement(ChatAnaContext,{conversation:{status:'open',ana_tags:tags}}))
  const text=html.replace(/<[^>]*>/g,'')
  for(const tag of tags)assert.ok(text.includes(tag))
  assert.doesNotMatch(text,/\+\d/)
})
test('chips são somente leitura e compactos, com nomes restantes acessíveis',()=>{
  const html=renderToStaticMarkup(createElement(ChatAnaTags,{tags:['RESOLVIDOS','ORÇAMENTO','<script>teste</script>','RETORNO'],limit:2}))
  assert.match(html,/RESOLVIDOS/);assert.match(html,/ORÇAMENTO/);assert.match(html,/\+2/)
  assert.match(html,/title="&lt;script&gt;teste&lt;\/script&gt;, RETORNO"/)
  assert.doesNotMatch(html,/<button|<script>/)
})
