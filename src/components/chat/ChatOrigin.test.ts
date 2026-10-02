import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatOriginButton, ChatOriginCard } from './ChatOrigin'
import type { ChatOrigin } from '../../lib/chat-origin'

const empty:ChatOrigin={origin:null,code:null,code_source:null,creative:null,ad:null}
function render(data:ChatOrigin|null, options:{loading?:boolean;error?:boolean}={}) {
  return renderToStaticMarkup(createElement(ChatOriginCard,{data,onRetry(){},...options}))
}

test('primeira entrada e último clique aparecem como evidências separadas', () => {
  const html=render({...empty,origin:'Meta ADS',code:'&18',code_source:'message',creative:{name:'Compacta 01',headline:'Conheça a compacta',url:'https://drive.google.com/creative'},ad:{id:'12345',name:'AD - &18 RO',title:null,campaign:'Campanha Rondônia',adset:'Conjunto RO',seen_at:'2026-10-02T10:30:00Z',url:'https://fb.me/creative',platform:'facebook'}})
  assert.match(html,/Código na primeira mensagem recebida/)
  assert.match(html,/Último clique registrado/)
  assert.match(html,/Campanha Rondônia/);assert.match(html,/Conjunto RO/)
  assert.match(html,/Origem registrada:<\/span> Meta ADS/)
  assert.match(html,/Anúncio do Facebook/)
  assert.match(html,/Ver criativo/);assert.match(html,/Ver anúncio/);assert.match(html,/href="https:\/\/fb.me\/creative"/);assert.doesNotMatch(html,/Ver no Facebook/)
  assert.match(html,/dateTime="2026-10-02T10:30:00Z"/i)
  assert.match(html,/não confirma uma campanha específica/)
})

test('código do lead não vira primeira entrada e anúncio sem campanha não a inventa', () => {
  const ad={id:'12345',name:null,title:'Anúncio identificado',campaign:null,adset:null,seen_at:'invalid',url:'https://fb.me/creative',platform:'facebook'}
  const html=render({...empty,origin:'atendimento_auto',code:'&18',code_source:'lead',ad})
  assert.match(html,/Código registrado no CRM/);assert.match(html,/Anúncio identificado/)
  assert.match(html,/Anúncio do Facebook/)
  assert.doesNotMatch(html,/Origem não identificada|Código na primeira mensagem recebida|Invalid Date|<time|Campanha:/)
  assert.doesNotMatch(html,/atendimento_auto|Origem registrada/)
  assert.match(render({...empty,ad:{...ad,platform:'instagram'}}),/Anúncio do Instagram/)
  assert.match(render({...empty,ad:{...ad,platform:null}}),/Anúncio com clique registrado/)
  const registered=render({...empty,origin:'Meta ADS',ad:{...ad,platform:'instagram'}})
  assert.match(registered,/Anúncio do Instagram/);assert.match(registered,/Origem registrada:<\/span> Meta ADS/)
})

test('origem desconhecida permanece desconhecida e links perigosos não são renderizados', () => {
  assert.match(render(empty),/Origem não identificada/)
  assert.match(render({...empty,origin:'atendimento_auto'}),/Origem não identificada/)
  assert.doesNotMatch(render({...empty,origin:'atendimento_auto'}),/atendimento_auto|Origem registrada/)
  assert.doesNotMatch(render(empty),/Orgânico|Facebook/)
  const html=render({...empty,code:'&18',code_source:'ad',creative:{name:'<script>arte</script>',headline:null,url:'javascript:alert(1)'}})
  assert.match(html,/Código associado ao anúncio/);assert.match(html,/&lt;script&gt;/)
  assert.doesNotMatch(html,/<script>|href=|javascript:/)
  assert.doesNotMatch(render({...empty,ad:{id:'12345',name:null,title:null,campaign:null,adset:null,seen_at:'invalid',url:'data:text/html,attack',platform:null}}),/href=|data:text/)
})

test('carregamento e falha mantêm estado explícito e falha oferece nova tentativa', () => {
  assert.match(render(null,{loading:true}),/Carregando origem/)
  const html=render(empty,{error:true})
  assert.match(html,/role="alert"/);assert.match(html,/Tentar novamente/)
  assert.doesNotMatch(html,/Origem não identificada/)
})

test('botão de origem é acessível por teclado com nome explícito', () => {
  const html=renderToStaticMarkup(createElement(ChatOriginButton,{data:empty,onRetry(){}}))
  assert.match(html,/type="button"/);assert.match(html,/aria-label="Origem do cliente"/)
  assert.match(html,/aria-haspopup="dialog"/)
  const withCode=renderToStaticMarkup(createElement(ChatOriginButton,{data:{...empty,code:'&18'},onRetry(){}}))
  assert.match(withCode,/Origem · &amp;18/)
  assert.match(withCode,/aria-label="Origem do cliente"/)
})
