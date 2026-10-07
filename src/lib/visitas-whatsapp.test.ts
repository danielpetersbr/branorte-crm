import test from 'node:test'
import assert from 'node:assert/strict'
import { filtrarVisitasWhatsApp, entradaVisitasWhatsApp } from './visitas-whatsapp'

const clientes = [
  { id: 'a', visitar: true, vendedor_nome: ' DANIEL ' },
  { id: 'b', visitar: false, vendedor_nome: 'DANIEL' },
  { id: 'c', visitar: true, vendedor_nome: 'ANA' },
  { id: 'd', visitar: null, vendedor_nome: 'DANIEL' },
]

test('atalho abre marcados do vendedor, sem alterar a entrada normal do mapa', () => {
  assert.deepEqual(entradaVisitasWhatsApp(new URLSearchParams('origem=whatsapp&vendedor=daniel')), { ativo: true, vendedor: 'DANIEL' })
  assert.deepEqual(entradaVisitasWhatsApp(new URLSearchParams()), { ativo: false, vendedor: '' })
})
test('só os meus exclui desmarcados e vendedores diferentes', () => {
  assert.deepEqual(filtrarVisitasWhatsApp(clientes, 'daniel', true).map(c => c.id), ['a'])
})
test('todos os vendedores mantém somente os explicitamente marcados', () => {
  assert.deepEqual(filtrarVisitasWhatsApp(clientes, null, true).map(c => c.id), ['a', 'c'])
})
test('só os meus sem identidade não mostra a carteira inteira', () => {
  assert.deepEqual(filtrarVisitasWhatsApp(clientes, '', true), [])
})
test('mostrar desmarcados permite voltar a marcar um cliente', () => {
  assert.deepEqual(filtrarVisitasWhatsApp(clientes, 'daniel', false).map(c => c.id), ['a', 'b', 'd'])
})
test('seletor sem vendedor preserva clientes sem atribuição', () => {
  const semVendedor = [{ id: 'e', visitar: true, vendedor_nome: null }, { id: 'f', visitar: true, vendedor_nome: '' }]
  assert.deepEqual(filtrarVisitasWhatsApp([...clientes, ...semVendedor], '—', true).map(c => c.id), ['e', 'f'])
})
