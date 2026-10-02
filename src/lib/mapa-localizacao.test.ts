import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLocalizacaoMapa } from './mapa-localizacao'

test('aceita coordenadas coladas com pontos, inteiros e sinais', () => {
  assert.deepEqual(parseLocalizacaoMapa(' -28.275, -49.165 '), { tipo: 'coordenadas', lat: -28.275, lng: -49.165 })
  assert.deepEqual(parseLocalizacaoMapa('+90, -180'), { tipo: 'coordenadas', lat: 90, lng: -180 })
  assert.deepEqual(parseLocalizacaoMapa('0, 0'), { tipo: 'coordenadas', lat: 0, lng: 0 })
})

test('preserva o formato brasileiro com decimais separados por ponto e vírgula', () => {
  assert.deepEqual(parseLocalizacaoMapa('-28,275; -49,165'), { tipo: 'coordenadas', lat: -28.275, lng: -49.165 })
})

test('aceita coordenadas entre parênteses e rejeita um par numérico incompleto', () => {
  assert.deepEqual(parseLocalizacaoMapa('(-28.275, -49.165)'), { tipo: 'coordenadas', lat: -28.275, lng: -49.165 })
  for (const texto of ['(-28.275, -49.165', '-28.275, nada', 'https://www.google.com/maps?q=-28.275%2Cnada']) {
    assert.equal(parseLocalizacaoMapa(texto).tipo, 'invalido', texto)
  }
})

test('extrai coordenadas do centro em URLs completas do Google Maps', () => {
  assert.deepEqual(parseLocalizacaoMapa('https://www.google.com.br/maps/@-28.275,-49.165,15z'), { tipo: 'coordenadas', lat: -28.275, lng: -49.165 })
})

test('aceita q/query codificados e o prefixo loc sem pesquisar a URL', () => {
  for (const parametro of ['q=-28.275%2C%20-49.165', 'query=-28.275%2C-49.165', 'q=loc%3A-28.275%2C-49.165']) {
    assert.deepEqual(parseLocalizacaoMapa(`https://maps.google.com/maps?${parametro}`), { tipo: 'coordenadas', lat: -28.275, lng: -49.165 })
  }
})

test('prefere o ponto real !3d/!4d ao centro da câmera @', () => {
  assert.deepEqual(parseLocalizacaoMapa('https://www.google.com/maps/place/Fazenda/@-28,-49,15z/data=!4m6!3m5!1sabc!8m2!3d-28.275!4d-49.165!16sfoo'), { tipo: 'coordenadas', lat: -28.275, lng: -49.165 })
})

test('coordenadas inválidas não viram endereço ou centro alternativo', () => {
  for (const texto of [
    '90.001, 0', '0, -180.001', 'NaN, -49', 'Infinity, 0', '1e309, 0',
    '-28.1, -49.2, 17z', '-28.1, -49abc', '-28.1 -49.2',
    'https://www.google.com/maps/@91,-49,15z',
    'https://www.google.com/maps?q=NaN%2C-49',
    'https://www.google.com/maps?query=-28%2CInfinity',
    'https://www.google.com/maps?q=loc%3A-28%2C-181',
    'https://www.google.com/maps/@-28,-49,15z/data=!3d91!4d-49',
    'https://www.google.com/maps/@-28,-49,15z/data=!3d-28',
    'https://www.google.com/maps/@-28,-49,15z/data=!3d!4d-49',
    'https://www.google.com/maps/@-28,NaN,15z',
    'https://www.google.com/maps?q=-28%2C-49%ZZ',
  ]) {
    const resultado = parseLocalizacaoMapa(texto)
    assert.equal(resultado.tipo, 'invalido', texto)
    if (resultado.tipo === 'invalido') assert.ok(resultado.mensagem.length > 0)
  }
})

test('link curto orienta copiar localização completa e não fornece endereço para geocoder', () => {
  for (const texto of ['https://maps.app.goo.gl/abc123?g_st=iw', 'https://goo.gl/maps/abc123']) {
    const resultado = parseLocalizacaoMapa(texto)
    assert.equal(resultado.tipo, 'linkCurtoGoogleMaps')
    if (resultado.tipo === 'linkCurtoGoogleMaps') assert.match(resultado.mensagem, /abra o link no Google Maps e copie o endereço completo ou as coordenadas/i)
    assert.equal('endereco' in resultado, false)
  }
})

test('endereços colados e q/query de texto conservam os dados para busca', () => {
  assert.deepEqual(parseLocalizacaoMapa('  Rua Brasil, 123, Braço do Norte - SC  '), { tipo: 'endereco', endereco: 'Rua Brasil, 123, Braço do Norte - SC' })
  assert.deepEqual(parseLocalizacaoMapa('https://www.google.com/maps/search/?api=1&query=Rua+Brasil%2C+123'), { tipo: 'endereco', endereco: 'Rua Brasil, 123' })
  assert.deepEqual(parseLocalizacaoMapa('https://maps.google.com/?q=Bra%C3%A7o+do+Norte%2C+SC'), { tipo: 'endereco', endereco: 'Braço do Norte, SC' })
})

test('entrada vazia, URL quebrada e links de outros serviços não vão ao geocoder', () => {
  for (const texto of [
    '', '   ', 'https://', 'https://www.google.com/maps',
    'https://maps.app.goo.gl.evil.example/abc', 'https://goo.gl/other/abc',
    'https://example.com/?q=-28,-49', 'javascript:alert(1)',
    'https://user:pass@maps.app.goo.gl/abc', 'https://www.google.com:444/maps?q=-28,-49',
  ]) assert.equal(parseLocalizacaoMapa(texto).tipo, 'invalido', texto)
})
