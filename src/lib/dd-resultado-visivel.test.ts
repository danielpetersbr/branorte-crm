import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selecionarConsultaVisivel } from './dd-resultado-visivel'
import type { DDConsulta, DDConsultaResponse } from '../hooks/useDueDiligence'
const a = { id: 'consulta-A' } as DDConsulta, b = { id: 'consulta-B' } as DDConsulta
const nova = { consulta: a, _cache_hit: false, ok: true } as DDConsultaResponse
test('histórico B selecionado vence resultado A de uma consulta anterior', () => {
  assert.equal(selecionarConsultaVisivel(nova,b,'consulta-B'),b)
})
test('leitura B pendente ou com falha não exibe consulta anterior A', () => {
  assert.equal(selecionarConsultaVisivel(nova,null,'consulta-B'),null)
})
test('resultado do histórico com identidade diferente é recusado', () => {
  assert.equal(selecionarConsultaVisivel(nova,a,'consulta-B'),null)
})
test('nova consulta confirmada aparece após sair do histórico', () => {
  assert.equal(selecionarConsultaVisivel(nova,null,null),a)
})
