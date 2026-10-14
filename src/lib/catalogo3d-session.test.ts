import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogo3dAccessToken, catalogo3dSessionReply } from './catalogo3d-session'

const ownerId = '9cf979c3-17cc-4aee-b692-ff9d1eea5540'
const origin = 'https://branorte-configurador-3d.vercel.app'
const frame = {}
const now = 1_800_000_000_000
const session = { user: { id: ownerId }, access_token: 'test-access-token', expires_at: 1_800_000_060 }
const profile = { id: ownerId, role: 'admin', approved_at: '2026-10-01T00:00:00Z' }
const request = { origin, source: frame, data: { type: 'branorte:catalog:session', requestId: 'nonce-123' } }

test('responde apenas ao iframe confiável com o token corrente de Daniel', () => {
  assert.deepEqual(catalogo3dSessionReply(request, frame, session, profile, now), {
    type: 'branorte:catalog:session:result', requestId: 'nonce-123', accessToken: 'test-access-token',
  })
  assert.equal(catalogo3dSessionReply(request, frame, { ...session, access_token: 'refreshed-token' }, profile, now)?.accessToken, 'refreshed-token')
})

test('não entrega token a outra origem, preview, janela ou iframe ausente', () => {
  for (const unsafeOrigin of ['https://evil.example', 'https://branorte-configurador-3d.vercel.app.evil.example', 'https://branorte-configurador-preview.vercel.app', 'null']) {
    assert.equal(catalogo3dSessionReply({ ...request, origin: unsafeOrigin }, frame, session, profile, now), null)
  }
  assert.equal(catalogo3dSessionReply({ ...request, source: {} }, frame, session, profile, now), null)
  assert.equal(catalogo3dSessionReply({ ...request, source: null }, null, session, profile, now), null)
})

test('ignora solicitações sem nonce válido e outros tipos de mensagem', () => {
  for (const requestId of ['', ' ', ' nonce', 'x'.repeat(129), 4, null, undefined]) {
    assert.equal(catalogo3dSessionReply({ ...request, data: { ...request.data, requestId } }, frame, session, profile, now), null)
  }
  for (const data of [null, [], 'request', { ...request.data, type: 'branorte:store:list' }]) {
    assert.equal(catalogo3dSessionReply({ ...request, data }, frame, session, profile, now), null)
  }
  assert.equal(catalogo3dSessionReply({ ...request, data: { ...request.data, requestId: 'x'.repeat(128) } }, frame, session, profile, now)?.accessToken, 'test-access-token')
})

test('outro administrador, perfil divergente ou não aprovado recebe recusa explícita', () => {
  const denied = { type: 'branorte:catalog:session:result', requestId: 'nonce-123', accessToken: null }
  const otherSession = { ...session, user: { id: 'other-admin' } }
  assert.deepEqual(catalogo3dSessionReply(request, frame, otherSession, { ...profile, id: 'other-admin' }, now), denied)
  for (const rejectedProfile of [null, { ...profile, id: 'other-admin' }, { ...profile, role: 'vendor' }, { ...profile, approved_at: null }, { ...profile, approved_at: '' }]) {
    assert.deepEqual(catalogo3dSessionReply(request, frame, session, rejectedProfile, now), denied)
  }
})

test('sessão expirada, token ausente e logout nunca devolvem credencial', () => {
  for (const rejectedSession of [null, { ...session, expires_at: 1_800_000_000 }, { ...session, expires_at: 1_799_999_999 }, { ...session, expires_at: undefined }, { ...session, expires_at: Number.NaN }, { ...session, access_token: '' }]) {
    assert.equal(catalogo3dAccessToken(rejectedSession, profile, now), null)
    assert.equal(catalogo3dSessionReply(request, frame, rejectedSession, profile, now)?.accessToken, null)
  }
  assert.equal(catalogo3dAccessToken(session, profile, now), 'test-access-token')
})
