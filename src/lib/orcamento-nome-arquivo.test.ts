import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_NOME_ARQUIVO, nomeBase, nomeBaseWhatsApp, sanitizeNomeArquivo,
} from './orcamento-nome-arquivo.js'

// O caso EXATO do roadmap #70 (31/07/2026, vendas5). O vendedor digitou a
// descrição inteira, a tela confirmou, e o arquivo saiu cortado em "silos 56,6".
const DESC_REAL = 'Fabrica de Racao Master - 5001000 - 6000 com elevador 40t, calhas th, silos 56,63 e 30,65 m3'

test('roadmap #70: descrição de 92 chars não é mais cortada em 80', () => {
  const nome = nomeBase('2026 - 1946', 'Phillip Neves Machado', DESC_REAL)
  assert.ok(nome.includes('silos 56,63 e 30,65 m3'), `perdeu o final: ${nome}`)
  assert.equal(nome, `2026 - 1946 - Phillip Neves Machado (${DESC_REAL})`)
})

test('nome inteiro respeita o teto do Windows', () => {
  const nome = nomeBase('2026 - 1946', 'Cliente Com Nome Bem Comprido Ltda ME', 'x'.repeat(400))
  assert.ok(nome.length <= MAX_NOME_ARQUIVO, `passou do teto: ${nome.length}`)
})

test('quando estoura, quem encolhe é a descrição — número e cliente ficam', () => {
  const nome = nomeBase('2026 - 1946', 'Phillip Neves Machado', 'y'.repeat(400))
  assert.ok(nome.startsWith('2026 - 1946 - Phillip Neves Machado ('), nome)
  assert.ok(nome.endsWith(')'), nome)
})

test('sufixo -ALT vai pro fim do nome, mesmo com descrição gigante', () => {
  const nome = nomeBase('2026 - 1946-ALT2', 'Phillip Neves Machado', 'z'.repeat(400))
  assert.ok(nome.endsWith('-ALT2'), nome)
  assert.ok(nome.startsWith('2026 - 1946 - Phillip Neves Machado ('), nome)
  assert.ok(nome.length <= MAX_NOME_ARQUIVO, `passou do teto: ${nome.length}`)
})

test('acento e caractere proibido do Windows saem do nome', () => {
  assert.equal(sanitizeNomeArquivo('GRÃOS'), 'GRAOS')
  assert.equal(sanitizeNomeArquivo('Fabrica 500/1000: "Master"'), 'Fabrica 5001000 Master')
})

test('descrição vazia vira Personalizado', () => {
  assert.equal(nomeBase('2026 - 0001', 'Fulano', ''), '2026 - 0001 - Fulano (Personalizado)')
})

test('nome do WhatsApp é só número + cliente', () => {
  assert.equal(nomeBaseWhatsApp('2026 - 1946', 'Phillip Neves Machado'), '2026 - 1946 - Phillip Neves Machado')
})
