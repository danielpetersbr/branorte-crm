import test from 'node:test'
import assert from 'node:assert/strict'
import { foneCanon } from './fone-canon'

// Estes testes não existiam porque a função morava dentro de um hook que importa
// o client do Supabase — não rodava fora do Vite. Ela é a chave que casa o
// orçamento com o lead, e estava copiada em dois hooks + no banco.

test('o que sempre funcionou continua funcionando', () => {
  assert.equal(foneCanon('5548999999999'), '4899999999', 'WhatsApp cru')
  assert.equal(foneCanon('+55 48 99999-9999'), '4899999999', 'BR com +55')
  assert.equal(foneCanon('(48) 99999-9999'), '4899999999', 'BR mascarado')
  assert.equal(foneCanon('(48) 3333-4444'), '4833334444', 'fixo')
})

test('casa com e sem o 9º dígito — é pra isso que o canônico existe', () => {
  assert.equal(foneCanon('(48) 99999-9999'), foneCanon('(48) 9999-9999'))
})

test('DDD 55 não é confundido com o código do país', () => {
  // Santa Maria/RS é DDD 55. Cortar "55" de um número de 10 dígitos comeria o DDD.
  assert.equal(foneCanon('(55) 5123-4567'), '5551234567')
  assert.equal(foneCanon('5551234567'), '5551234567')
})

test('telefone ESTRANGEIRO não gera canônico — fabricava colisão com brasileiro', () => {
  // Medido: o slice(-10) transformava o DDI em DDD.
  //   +1 555 123 4567    -> 5551234567 = (55) 5123-4567, Santa Maria/RS
  //   +54 9 11 1234 5678 -> 1112345678 = DDD 11, São Paulo
  //   +351 912 345 678   -> 1912345678 = DDD 19, Campinas
  for (const [tel, onde] of [
    ['+1 555 123 4567', 'EUA colidia com Santa Maria/RS'],
    ['+54 9 11 1234 5678', 'Buenos Aires colidia com São Paulo'],
    ['+351 912 345 678', 'Portugal colidia com Campinas'],
    ['+49 151 12345678', 'Alemanha colidia com Porto Alegre'],
    ['+595 981 123456', 'Paraguai'],
  ]) {
    assert.equal(foneCanon(tel), null, `${tel}: ${onde}`)
  }
})

test('a colisão que existia é reproduzível pelo mecanismo antigo', () => {
  // Sem a trava, os dois dariam o MESMO canônico. Com a trava, só o brasileiro
  // tem canônico — e é ele que deve casar com o lead.
  const brasileiro = foneCanon('(55) 5123-4567')
  const americano = foneCanon('+1 555 123 4567')
  assert.equal(brasileiro, '5551234567')
  assert.equal(americano, null)
  assert.notEqual(brasileiro, americano, 'não podem mais ser a mesma chave')
})

test('sem "+" não dá pra distinguir — e o benefício da dúvida é do Brasil', () => {
  // "(917) 555-1234" dos EUA e um celular brasileiro são os mesmos 10 dígitos.
  // Sem o prefixo explícito não há sinal, e recusar quebraria o CRM inteiro.
  assert.equal(foneCanon('(917) 555-1234'), '9175551234')
})

test('lixo e curto demais devolvem null', () => {
  assert.equal(foneCanon(null), null)
  assert.equal(foneCanon(''), null)
  assert.equal(foneCanon('999999999'), null, '9 dígitos')
  assert.equal(foneCanon('abc'), null)
})
