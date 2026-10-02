import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatAvatar, ChatMedia } from './ChatMedia'

test('histórico mostra controles de áudio e vídeo e documento com nome', () => {
  assert.match(renderToStaticMarkup(createElement(ChatMedia,{type:'audio',url:'https://example.test/audio'})), /<audio[^>]*controls/)
  assert.match(renderToStaticMarkup(createElement(ChatMedia,{type:'video',url:'https://example.test/video'})), /<video[^>]*controls/)
  assert.match(renderToStaticMarkup(createElement(ChatMedia,{type:'document',url:'https://example.test/file',filename:'Proposta.docx'})), /Proposta\.docx/)
})

test('histórico e avatar rejeitam URLs inseguras e mantêm fallback', () => {
  assert.doesNotMatch(renderToStaticMarkup(createElement(ChatMedia,{type:'image',url:'javascript:alert(1)'})), /<img/)
  assert.match(renderToStaticMarkup(createElement(ChatAvatar,{name:'Maria Silva',url:'http://example.test/avatar'})), /MS/)
  assert.match(renderToStaticMarkup(createElement(ChatAvatar,{name:'Maria Silva',url:'https://example.test/avatar'})), /<img/)
})
