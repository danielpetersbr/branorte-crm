import test from 'node:test'
import assert from 'node:assert/strict'
import { paisDoTelefone, ufFromTelefone, DDIS_CONHECIDOS } from './ddd-uf'

// A colisão que estes testes travam: o DDD brasileiro ocupa a MESMA posição do
// DDI, então telefone daqui gravado sem o 55 era lido como estrangeiro. Já saía
// errado no dashboard e na tela de Atendimentos.

test('telefone BRASILEIRO sem o 55 não vira estrangeiro', () => {
  const casos: Array<[string, string]> = [
    ['1199999999', 'São Paulo virava EUA (DDI 1)'],
    ['5199999999', 'Porto Alegre virava Peru (DDI 51)'],
    ['5499999999', 'Caxias do Sul virava Argentina (DDI 54)'],
    ['3499999999', 'Uberlândia virava Espanha (DDI 34)'],
    ['3399999999', 'Gov. Valadares virava França (DDI 33)'],
    ['4899999999', 'Florianópolis viraria Polônia com a lista nova (DDI 48)'],
    ['2799999999', 'Vitória viraria África do Sul (DDI 27)'],
    ['6299999999', 'Goiânia viraria Indonésia (DDI 62)'],
    ['(11) 99999-9999', 'mascarado'],
  ]
  for (const [tel, nota] of casos) {
    assert.equal(paisDoTelefone(tel), null, `${tel}: ${nota}`)
  }
})

test('número COM código de país continua sendo classificado', () => {
  assert.equal(paisDoTelefone('+1 555 123 4567')?.sigla, 'US')
  assert.equal(paisDoTelefone('+595 981 123456')?.sigla, 'PY')
  assert.equal(paisDoTelefone('+351 912 345 678')?.sigla, 'PT')
  assert.equal(paisDoTelefone('+49 151 12345678')?.sigla, 'DE')
})

test('sem "+", 12 dígitos ou mais também conta como internacional', () => {
  // É como o WhatsApp entrega: sem "+", mas com o país na frente.
  assert.equal(paisDoTelefone('595981123456')?.sigla, 'PY')
  assert.equal(paisDoTelefone('351912345678')?.sigla, 'PT')
})

test('brasileiro COM o 55 continua devolvendo null (quer dizer "é daqui")', () => {
  assert.equal(paisDoTelefone('5548999999999'), null)
  assert.equal(paisDoTelefone('+55 48 99999-9999'), null)
})

test('o DDI mais LONGO ganha — senão "1" abocanha "1809"', () => {
  assert.equal(paisDoTelefone('+1809 555 1234')?.sigla, 'DO', 'Rep. Dominicana')
  assert.equal(paisDoTelefone('+1 555 123 4567')?.sigla, 'US')
})

test('a lista cobre o mundo, não só a vizinhança', () => {
  assert.ok(DDIS_CONHECIDOS.length > 100, `só ${DDIS_CONHECIDOS.length} países`)
  const ddis = new Set(DDIS_CONHECIDOS.map(p => p.ddi))
  // Onde a Branorte de fato exporta ou pode exportar.
  for (const [ddi, pais] of [
    ['595', 'Paraguai'], ['54', 'Argentina'], ['598', 'Uruguai'], ['591', 'Bolívia'],
    ['244', 'Angola'], ['258', 'Moçambique'], ['234', 'Nigéria'], ['1', 'EUA'],
    ['86', 'China'], ['91', 'Índia'], ['972', 'Israel'], ['966', 'Arábia Saudita'],
  ]) {
    assert.ok(ddis.has(ddi), `faltou ${pais} (+${ddi})`)
  }
})

test('Brasil é o primeiro da lista e não está no mapa de classificação', () => {
  assert.equal(DDIS_CONHECIDOS[0].ddi, '55')
  // Se '55' entrasse em DDI_TO_PAIS, paisDoTelefone passaria a dizer que
  // brasileiro é estrangeiro — o null ali significa "é daqui".
  assert.equal(paisDoTelefone('+55 48 99999-9999'), null)
})

test('nenhum DDI repetido', () => {
  const ddis = DDIS_CONHECIDOS.map(p => p.ddi)
  assert.equal(new Set(ddis).size, ddis.length)
})

test('ufFromTelefone não foi afetado', () => {
  assert.equal(ufFromTelefone('5548999999999'), 'SC')
  assert.equal(ufFromTelefone('5511999999999'), 'SP')
  assert.equal(ufFromTelefone('+1 555 123 4567'), 'INTL')
})
