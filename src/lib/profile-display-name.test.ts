import test from 'node:test'
import assert from 'node:assert/strict'
import { atualizarNomePerfilAtual } from './profile-display-name'

test('troca somente o nome do perfil confirmado, preservando atributos de acesso', () => {
  const profile = { id: 'a', display_name: 'Antigo', email: 'a@a.com', role: 'vendor', vendor_id: 'v1', approved_at: '2026-01-01' }
  assert.deepEqual(atualizarNomePerfilAtual(profile, 'a', 'Novo'), { ...profile, display_name: 'Novo' })
  assert.equal(profile.display_name, 'Antigo')
})

test('resultado de outro usuário não modifica o perfil após trocar de conta', () => {
  const profile = { id: 'b', display_name: 'Usuário atual', role: 'admin' }
  assert.equal(atualizarNomePerfilAtual(profile, 'a', 'Novo'), profile)
  assert.equal(atualizarNomePerfilAtual(null, 'a', 'Novo'), null)
})
