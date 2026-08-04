import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatarFoneBr, formatarFoneIntl, formatarFone, montarFone, separarFone,
  validarFone, OPCOES_DDI, DDI_BRASIL,
} from './telefone-ddi'

// ═════════════════════════════════════════════════════════════════════════════
// o defeito relatado: máscara BR destruía número estrangeiro
// ═════════════════════════════════════════════════════════════════════════════

test('o caso do relato: máscara BR mutilava E TRUNCAVA o número estrangeiro', () => {
  // +595 981 123456 são 12 dígitos. A máscara brasileira para em 11: saía
  // "(59) 59811-2345" — com cara de número brasileiro válido E com o último
  // dígito COMIDO. Plausível o bastante pra ninguém notar até tentar ligar.
  const errado = formatarFoneBr('595981123456')
  assert.equal(errado, '(59) 59811-2345', 'é isto que acontecia antes')
  assert.equal(errado.replace(/\D/g, '').length, 11, 'perdia 1 dos 12 dígitos')

  const certo = montarFone('981123456', '595')
  assert.ok(certo.startsWith('+595 '), certo)
  assert.equal(certo.replace(/\D/g, ''), '595981123456', 'agora não perde nenhum')
})

test('fora do Brasil não se inventa máscara — só agrupa pra ler', () => {
  // Cada país agrupa de um jeito. Chutar formato faria o número sair errado no
  // PDF que vai pro cliente.
  assert.equal(formatarFoneIntl('981123456'), '981 123 456')
  assert.equal(formatarFoneIntl('15551234567'), '155 512 345 67')
})

test('Brasil continua com a máscara de sempre', () => {
  assert.equal(formatarFoneBr('48999999999'), '(48) 99999-9999')
  assert.equal(formatarFoneBr('4833334444'), '(48) 3333-4444')
  assert.equal(formatarFone('48999999999', DDI_BRASIL), '(48) 99999-9999')
})

// ═════════════════════════════════════════════════════════════════════════════
// gravação: BR sem prefixo, estrangeiro com
// ═════════════════════════════════════════════════════════════════════════════

test('telefone BR é gravado SEM +55 — mexer nisso quebraria orçamento antigo', () => {
  // O CRM casa orçamento com lead por fone_canon. Pôr "+55" na frente mudaria o
  // formato gravado em todo orçamento novo, contra o histórico inteiro.
  const br = montarFone('48999999999', '55')
  assert.equal(br, '(48) 99999-9999')
  assert.ok(!br.includes('+'), 'não pode ganhar prefixo')
})

test('estrangeiro é gravado COM +DDI — sem isso não disca e não se sabe o país', () => {
  assert.equal(montarFone('11 1234 5678', '54'), '+54 111 234 567 8')
  assert.ok(montarFone('9121234567', '351').startsWith('+351 '))
})

test('campo vazio devolve vazio, não "+55"', () => {
  assert.equal(montarFone('', '55'), '')
  assert.equal(montarFone('', '595'), '')
  assert.equal(montarFone('   ', '351'), '')
})

// ═════════════════════════════════════════════════════════════════════════════
// reabrir o modal: separar de volta
// ═════════════════════════════════════════════════════════════════════════════

test('telefone antigo (sem +) é lido como brasileiro, nunca como estrangeiro', () => {
  // É como o campo sempre funcionou. Ler "(48) 99999-9999" como DDI 48 jogaria
  // o cliente pra outro país ao reabrir o orçamento.
  const s = separarFone('(48) 99999-9999')
  assert.equal(s.ddi, '55')
  assert.equal(s.numero, '(48) 99999-9999')
})

test('separarFone casa o DDI MAIS LONGO primeiro', () => {
  // "+1" abocanharia o começo de "+55" e de "+595" se a ordem fosse ingênua.
  assert.equal(separarFone('+595 981 123456').ddi, '595')
  assert.equal(separarFone('+55 48 99999-9999').ddi, '55')
  assert.equal(separarFone('+1 555 123 4567').ddi, '1')
  assert.equal(separarFone('+351 912 345 678').ddi, '351')
})

test('ida e volta preserva o número em todos os países da lista', () => {
  for (const p of OPCOES_DDI) {
    const digitos = '912345678'
    const gravado = montarFone(digitos, p.ddi)
    const voltou = separarFone(gravado)
    assert.equal(voltou.ddi, p.ddi, `${p.nome}: DDI se perdeu em "${gravado}"`)
    assert.equal(voltou.numero.replace(/\D/g, ''), digitos, `${p.nome}: número mudou`)
  }
})

test('valor nulo/vazio volta como Brasil em branco', () => {
  assert.deepEqual(separarFone(null), { ddi: '55', numero: '' })
  assert.deepEqual(separarFone(''), { ddi: '55', numero: '' })
})

test('DDI desconhecido não some o número — cai como BR', () => {
  // Melhor mostrar o número do que engolir. +999 não existe na lista.
  const s = separarFone('+999 123456789')
  assert.equal(s.ddi, '55')
  assert.ok(s.numero.replace(/\D/g, '').length > 0, 'o número tem que sobreviver')
})

// ═════════════════════════════════════════════════════════════════════════════
// validação: a regra do Brasil NÃO serve pro resto do mundo
// ═════════════════════════════════════════════════════════════════════════════

test('Brasil continua exigindo DDD + número (10 dígitos)', () => {
  assert.equal(validarFone('48999999999', '55').ok, true)
  assert.equal(validarFone('4833334444', '55').ok, true)
  assert.equal(validarFone('999999999', '55').ok, false, '9 dígitos: falta DDD')
  assert.match(validarFone('999', '55').erro, /DDD/)
})

test('estrangeiro NÃO pode ser medido pela régua brasileira', () => {
  // Exigir 10 dígitos recusaria número legítimo: no mundo o nacional vai de 6 a
  // 12 dígitos. E aqui o telefone não casa lead nenhum — serve pra ligar.
  assert.equal(validarFone('981123456', '595').ok, true, 'Paraguai, 9 dígitos')
  assert.equal(validarFone('912345678', '351').ok, true, 'Portugal, 9 dígitos')
  assert.equal(validarFone('12345678', '54').ok, true, 'Argentina, 8 dígitos')
})

test('estrangeiro ainda tem limite — não aceita qualquer coisa', () => {
  assert.equal(validarFone('123', '595').ok, false, 'curto demais')
  assert.match(validarFone('123', '595').erro, /curto/i)
  assert.equal(validarFone('1234567890123456', '595').ok, false, 'passa do E.164')
  assert.match(validarFone('1234567890123456', '595').erro, /15 d[íi]gitos/i)
})

test('a mensagem de erro do Brasil explica POR QUE, não só que faltou', () => {
  assert.match(validarFone('999', '55').erro, /lead|cliente/i)
})

// ═════════════════════════════════════════════════════════════════════════════
// a lista de países
// ═════════════════════════════════════════════════════════════════════════════

test('Brasil é o primeiro da lista — é 99% dos orçamentos', () => {
  assert.equal(OPCOES_DDI[0].ddi, '55')
  assert.equal(OPCOES_DDI[0].sigla, 'BR')
})

test('a lista tem os vizinhos que a Branorte de fato atende', () => {
  const ddis = OPCOES_DDI.map(o => o.ddi)
  for (const [ddi, pais] of [['595', 'Paraguai'], ['54', 'Argentina'], ['598', 'Uruguai'], ['591', 'Bolívia']]) {
    assert.ok(ddis.includes(ddi), `faltou ${pais}`)
  }
})

test('nenhum DDI repetido — repetido faria o seletor escolher errado', () => {
  const ddis = OPCOES_DDI.map(o => o.ddi)
  assert.equal(new Set(ddis).size, ddis.length)
})

test('todo item tem rótulo legível', () => {
  for (const o of OPCOES_DDI) {
    assert.match(o.rotulo, /^\+\d+ .+ \([A-Z]{2}\)$/, o.rotulo)
  }
})
