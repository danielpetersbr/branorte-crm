import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assinaturaRota } from './mapa-rota-assinatura'
import type { ConfigViagem, Parada } from './viagem'

const paradas: Pick<Parada, 'id' | 'lat' | 'lng'>[] = [
  { id: 'cliente-a', lat: -28.27, lng: -49.16 },
  { id: 'cliente-b', lat: -27.59, lng: -48.55 },
]
const config: Pick<ConfigViagem, 'origem' | 'destino' | 'retornarOrigem' | 'modo'> = {
  origem: { nome: 'Base', lat: -28.3, lng: -49.2 },
  destino: { nome: 'Hotel', lat: -27.5, lng: -48.5 },
  retornarOrigem: false,
  modo: 'otimizar',
}

test('confirmar novas coordenadas com o mesmo ID invalida a rota anterior', () => {
  const anterior = assinaturaRota(paradas, config, true)
  for (const alteracao of [{ lat: -28.271 }, { lng: -49.161 }]) {
    assert.notEqual(assinaturaRota([{ ...paradas[0], ...alteracao }, paradas[1]], config, true), anterior)
  }
})

test('identidade e ordem das paradas fazem parte da rota', () => {
  const anterior = assinaturaRota(paradas, config, true)
  assert.notEqual(assinaturaRota([...paradas].reverse(), config, true), anterior)
  assert.notEqual(assinaturaRota([{ ...paradas[0], id: 'outro-cliente' }, paradas[1]], config, true), anterior)
  assert.notEqual(assinaturaRota([paradas[0]], config, true), anterior)
})

test('origem e destino incluem ambas as coordenadas e sua remoção', () => {
  const anterior = assinaturaRota(paradas, config, true)
  for (const campo of ['origem', 'destino'] as const) {
    for (const ponto of [null, { ...config[campo]!, lat: -26 }, { ...config[campo]!, lng: -47 }]) {
      assert.notEqual(assinaturaRota(paradas, { ...config, [campo]: ponto }, true), anterior)
    }
  }
})

test('destino mudou com retorno ligado também invalida a configuração da rota', () => {
  const comRetorno = { ...config, retornarOrigem: true }
  assert.notEqual(assinaturaRota(paradas, { ...comRetorno, destino: { ...config.destino!, lat: -26 } }, true), assinaturaRota(paradas, comRetorno, true))
})

test('retorno, modo de ordenação e ativação do planejamento invalidam a rota', () => {
  const anterior = assinaturaRota(paradas, config, true)
  assert.notEqual(assinaturaRota(paradas, { ...config, retornarOrigem: true }, true), anterior)
  assert.notEqual(assinaturaRota(paradas, { ...config, modo: 'manual' }, true), anterior)
  assert.notEqual(assinaturaRota(paradas, config, false), anterior)
})

test('mesma configuração permanece estável em objetos novos e nomes não alteram trajeto', () => {
  const anterior = assinaturaRota(paradas, config, true)
  assert.equal(assinaturaRota(paradas.map(p => ({ ...p })), { ...config, origem: { ...config.origem!, nome: 'Nova descrição' }, destino: { ...config.destino!, nome: 'Descrição do hotel' } }, true), anterior)
})

test('IDs com delimitadores não colidem entre conjuntos de paradas', () => {
  assert.notEqual(
    assinaturaRota([{ id: 'a|b', lat: 0, lng: 0 }, { id: 'c', lat: 1, lng: 1 }], config, true),
    assinaturaRota([{ id: 'a', lat: 0, lng: 0 }, { id: 'b|c', lat: 1, lng: 1 }], config, true),
  )
})
