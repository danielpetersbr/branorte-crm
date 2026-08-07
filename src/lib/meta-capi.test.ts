// O fbc e o unico elo entre um clique em /l/<slug> e o anuncio que o pagou.
// Se o formato sair errado, o Meta ACEITA o evento (HTTP 200, aparece no
// Gerenciador) e simplesmente nao atribui a campanha nenhuma -- falha muda, do
// tipo que so aparece semanas depois como "a campanha nao otimiza".
// Estes testes travam o formato e a rejeicao de entrada suja.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { montarFbc, lerFbp, capiConfigurada, montarEvento, hashTelefone } from '../../api/_lib/meta-capi'

test('fbc sai no formato fb.1.<ms>.<fbclid> exigido pelo Meta', () => {
  const fbc = montarFbc('IwAR0abc-DEF_123', 1_754_500_000_000)
  assert.equal(fbc, 'fb.1.1754500000000.IwAR0abc-DEF_123')
  // O contrato do Meta e literal: 4 partes separadas por ponto, prefixo "fb",
  // subdominio numerico e timestamp em MILISSEGUNDOS (nao segundos).
  const partes = fbc!.split('.')
  assert.equal(partes.length, 4)
  assert.equal(partes[0], 'fb')
  assert.match(partes[2], /^\d{13}$/)
})

test('clique organico (sem fbclid) nao inventa fbc', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    assert.equal(montarFbc(v as unknown, 1), null)
  }
})

test('fbclid sujo e recusado em vez de entrar no payload', () => {
  // Vem da URL, ou seja: de qualquer um. Nada fora de base64url passa.
  assert.equal(montarFbc('abc def', 1), null)
  assert.equal(montarFbc('abc"drop', 1), null)
  assert.equal(montarFbc('a/b+c=', 1), null)
  assert.equal(montarFbc('x'.repeat(256), 1), null)
  // 255 e o limite aceito
  assert.notEqual(montarFbc('x'.repeat(255), 1), null)
})

test('timestamp entra inteiro mesmo com Date.now fracionado', () => {
  assert.equal(montarFbc('abc', 1_754_500_000_000.9), 'fb.1.1754500000000.abc')
})

test('_fbp e lido do header Cookie e validado', () => {
  assert.equal(lerFbp('_fbp=fb.1.1754500000000.987654321'), 'fb.1.1754500000000.987654321')
  assert.equal(lerFbp('outro=1; _fbp=fb.1.1.2; x=3'), 'fb.1.1.2')
  // Formato errado nao vai pro Meta -- ele rejeita o evento inteiro por isso.
  assert.equal(lerFbp('_fbp=qualquercoisa'), null)
  assert.equal(lerFbp('_fbpx=fb.1.1.2'), null)
  assert.equal(lerFbp(undefined), null)
})

// ── payload ───────────────────────────────────────────────────────────────
// O Meta responde HTTP 200 / events_received:1 para payload torto. Teste de
// integracao nao pega isso; so asserção sobre o CORPO pega.

const BASE = {
  nome: 'Lead',
  eventId: 'ABC123-c',
  fbc: 'fb.1.1754500000000.IwAR0abc',
  ip: '177.87.120.10',
  userAgent: 'Mozilla/5.0 Chrome/120',
  sourceUrl: 'https://branorte-crm.vercel.app/l/compacta02',
}

test('event_time sai em SEGUNDOS e vem de quandoMs, nao de agora', () => {
  const ev = montarEvento({ ...BASE, quandoMs: 1_754_500_123_456 })!
  // A conversa aconteceu quando a mensagem chegou. A varredura roda depois --
  // mandar "agora" atribuiria a conversa ao minuto da varredura.
  assert.equal(ev.event_time, 1_754_500_123)
  assert.equal(String(ev.event_time).length, 10)
})

test('sem quandoMs cai em agora (caminho do clique)', () => {
  const antes = Math.floor(Date.now() / 1000)
  const ev = montarEvento({ ...BASE })!
  assert.ok((ev.event_time as number) >= antes)
})

test('o evento carrega fbc -- sem ele nao credita anuncio nenhum', () => {
  const ev = montarEvento({ ...BASE })!
  const ud = ev.user_data as Record<string, string>
  assert.equal(ud.fbc, BASE.fbc)
  assert.equal(ud.client_ip_address, BASE.ip)
  assert.equal(ud.client_user_agent, BASE.userAgent)
  assert.equal(ev.action_source, 'website')
  assert.equal(ev.event_id, 'ABC123-c')
})

test('sem identificador nenhum nao monta evento (o Meta recusaria)', () => {
  const ev = montarEvento({ nome: 'Lead', eventId: 'X', fbc: null, ip: null, userAgent: null, sourceUrl: null })
  assert.equal(ev, null)
})

test('campo ausente nao vira chave vazia no payload', () => {
  const ev = montarEvento({ nome: 'Lead', eventId: 'X', fbc: 'fb.1.1.a', ip: null, userAgent: null, sourceUrl: null })!
  assert.ok(!('event_source_url' in ev))
  assert.ok(!('custom_data' in ev))
  assert.deepEqual(Object.keys(ev.user_data as object), ['fbc'])
})

test('clique e conversa nao colidem na deduplicacao do Meta', () => {
  const clique = montarEvento({ ...BASE, nome: 'ViewContent', eventId: 'ABC123' })!
  const conversa = montarEvento({ ...BASE, nome: 'Lead', eventId: 'ABC123-c' })!
  assert.notEqual(clique.event_id, conversa.event_id)
  assert.notEqual(clique.event_name, conversa.event_name)
})

test('sem env configurada a CAPI fica desligada (nao quebra o clique)', () => {
  const pixel = process.env.META_PIXEL_ID
  const token = process.env.META_CAPI_TOKEN
  delete process.env.META_PIXEL_ID
  delete process.env.META_CAPI_TOKEN
  try {
    assert.equal(capiConfigurada(), false)
  } finally {
    if (pixel !== undefined) process.env.META_PIXEL_ID = pixel
    if (token !== undefined) process.env.META_CAPI_TOKEN = token
  }
})

// --- ph (telefone) ---------------------------------------------------------
// Sem fbc o evento chegava anonimo e nao creditava criativo nenhum. O `ph` e a
// rede: atribui sem fbc. Mas hash de numero MAL NORMALIZADO nao casa com nada e
// falha do mesmo jeito mudo -- o Meta responde 200 e nao atribui. Estes testes
// travam a normalizacao exigida pela spec: so digitos, com DDI, sem '+'.

test('ph e o SHA-256 hex minusculo do numero so-digitos com DDI', () => {
  // sha256("5548999998888") — valor fixo, calculado fora, pra travar o contrato.
  const esperado = createHash('sha256').update('5548999998888').digest('hex')
  assert.equal(hashTelefone('5548999998888'), esperado)
  assert.match(hashTelefone('5548999998888')!, /^[0-9a-f]{64}$/)
})

test('pontuacao, espaco e + sao removidos antes do hash', () => {
  const base = hashTelefone('5548999998888')
  for (const v of ['+55 48 99999-8888', '55 (48) 99999 8888', '+5548999998888']) {
    assert.equal(hashTelefone(v), base, `falhou para: ${v}`)
  }
})

test('numero brasileiro sem DDI ganha o 55', () => {
  assert.equal(hashTelefone('48999998888'), hashTelefone('5548999998888'))
  assert.equal(hashTelefone('4833334444'), hashTelefone('554833334444'))
})

test('o 9o digito NAO e inventado nem removido', () => {
  // Fixo e movel do mesmo DDD sao pessoas diferentes: nao podem colidir.
  assert.notEqual(hashTelefone('554833334444'), hashTelefone('5548933334444'))
})

test('lixo vira null em vez de hash de lixo', () => {
  for (const v of [null, undefined, '', '   ', 'abc', '123', 42, {}, '1'.repeat(20)]) {
    assert.equal(hashTelefone(v as unknown), null, `deveria recusar: ${String(v)}`)
  }
})

test('conversa sem fbc ainda atribui, porque vai o ph', () => {
  const ev = montarEvento({
    nome: 'Lead', eventId: 'X-c', fbc: null, telefone: '5548999998888',
    ip: '191.253.1.1', userAgent: 'Mozilla/5.0', sourceUrl: null,
  })
  assert.ok(ev, 'evento nao deveria ser recusado')
  const ud = (ev as any).user_data
  assert.match(ud.ph, /^[0-9a-f]{64}$/)
  assert.equal(ud.fbc, undefined)
  // O numero legivel NAO pode aparecer em lugar nenhum do payload.
  assert.equal(JSON.stringify(ev).includes('5548999998888'), false)
})
