import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumoUtil, limparEquipamento } from './atendimentos-texto'

test('resumoUtil corta o texto de sistema que ocupava toda linha', () => {
  // O caso real: 100% dos leads de 30 dias tinham exatamente isto.
  assert.equal(resumoUtil('Lead chegou via webhook'), null)
  assert.equal(resumoUtil('lead chegou via webhook'), null)
  assert.equal(resumoUtil('  Lead chegou via webhook  '), null)
  assert.equal(resumoUtil('Lead chegou via formulário'), null)
})

test('resumoUtil trata vazio e "null" escrito como ausente', () => {
  assert.equal(resumoUtil(null), null)
  assert.equal(resumoUtil(undefined), null)
  assert.equal(resumoUtil(''), null)
  assert.equal(resumoUtil('   '), null)
  assert.equal(resumoUtil('null'), null)
  assert.equal(resumoUtil('undefined'), null)
})

test('resumoUtil preserva fala de verdade', () => {
  assert.equal(resumoUtil('Preciso de um moinho de 300 kg/h'), 'Preciso de um moinho de 300 kg/h')
  assert.equal(resumoUtil('  quanto custa a compacta 01?  '), 'quanto custa a compacta 01?')
  // Não pode confundir "lead" no meio da frase com o prefixo de sistema.
  assert.equal(resumoUtil('meu lead chegou via indicação'), 'meu lead chegou via indicação')
  // "nulo" não é "null".
  assert.equal(resumoUtil('estoque nulo'), 'estoque nulo')
})

test('limparEquipamento tira o "null" grudado', () => {
  assert.equal(limparEquipamento('moinho null'), 'moinho')
  assert.equal(limparEquipamento('misturador null'), 'misturador')
  assert.equal(limparEquipamento('ensacadeira null'), 'ensacadeira')
  assert.equal(limparEquipamento('moega null'), 'moega')
})

test('limparEquipamento devolve null quando não sobra nada', () => {
  assert.equal(limparEquipamento('null'), null)
  assert.equal(limparEquipamento(''), null)
  assert.equal(limparEquipamento(null), null)
  assert.equal(limparEquipamento(undefined), null)
  assert.equal(limparEquipamento('   '), null)
})

test('limparEquipamento preserva o nome bom, inclusive com parêntese útil', () => {
  assert.equal(limparEquipamento('misturador horizontal'), 'misturador horizontal')
  assert.equal(limparEquipamento('misturador (ração)'), 'misturador (ração)')
  assert.equal(limparEquipamento('misturador 500 kg'), 'misturador 500 kg')
  assert.equal(limparEquipamento('ensacadeira saco aberto (sacaria)'), 'ensacadeira saco aberto (sacaria)')
})

test('limparEquipamento não amputa palavra que CONTÉM null', () => {
  // \b garante que "nullita" (nome inventado) e "anular" sobrevivem inteiros.
  assert.equal(limparEquipamento('anulador de ruído'), 'anulador de ruído')
})

test('limparEquipamento fecha o parêntese que ficou vazio', () => {
  assert.equal(limparEquipamento('misturador (null)'), 'misturador')
})
