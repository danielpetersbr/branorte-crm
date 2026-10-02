import test from 'node:test'
import assert from 'node:assert/strict'
import { chatOriginDate, chatOriginUrl } from './chat-origin'

test('links de criativo aceitam somente HTTP e HTTPS absolutos sem credenciais', () => {
  assert.equal(chatOriginUrl(' https://drive.google.com/file/d/creative/view '), 'https://drive.google.com/file/d/creative/view')
  assert.equal(chatOriginUrl('http://example.com/arte?code=18'), 'http://example.com/arte?code=18')
  for (const value of [null, '', '/arte', '//example.com/arte', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/arte', 'blob:https://example.com/id', 'https://user:password@example.com', 'https:\\example.com', 'https://example.com\n.evil.test', 'java\tscript:alert(1)', 'https://']) {
    assert.equal(chatOriginUrl(value), null, String(value))
  }
})

test('data de clique ausente, inválida ou sem fuso não inventa horário', () => {
  assert.equal(chatOriginDate('2026-10-02T10:30:00Z'), '2026-10-02T10:30:00Z')
  assert.equal(chatOriginDate('2026-10-02T10:30:00-03:00'), '2026-10-02T10:30:00-03:00')
  for (const value of [null, '', 'invalid', '2026-10-02', '2026-10-02T10:30:00', '2026-99-02T10:30:00Z', '2026-02-30T10:30:00Z']) assert.equal(chatOriginDate(value), null)
})
