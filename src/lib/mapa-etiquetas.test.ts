import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEM_ETIQUETA, SEM_WHATSAPP, SEM_TELEFONE, etiquetasDoCliente, passaEtiqueta, opcoesEtiqueta,
  etiquetaQuePinta, rotuloEtiquetaOpcao,
  nomeCanonicoEtiqueta, corDoPinoEtiqueta, corDaOpcaoEtiqueta,
  type EtiquetasDoFone, type MapaEtiquetas, type ConversaDoCliente,
} from './mapa-etiquetas'

/** Fixture: conversa etiquetada; `pares` = [etiqueta, VENDEDOR]. */
const ef = (principal: string | null, pares: [string, string][], principalVendedor: string | null = pares[0]?.[1] ?? null): EtiquetasDoFone => ({
  principal, principalVendedor, todas: [...new Set(pares.map(p => p[0]))], porVendedor: pares,
})
const semEtq = ef(null, [])
/** Cliente COM conversa. */
const cv = (e: EtiquetasDoFone): ConversaDoCliente => ({ etiquetas: e, semFone: false })
/** Tem telefone, procuramos e não achamos conversa. */
const SEM_CONV: ConversaDoCliente = { etiquetas: null, semFone: false }
/** Nem telefone tem: não havia o que procurar. */
const SEM_FONE: ConversaDoCliente = { etiquetas: null, semFone: true }

const mapa: MapaEtiquetas = new Map([
  ['4899990001', ef('VENDIDO', [['VENDIDO', 'PEDRO'], ['ORCAMENTO ENVIADO', 'PEDRO']])],
  ['1199990002', semEtq],
])

test('etiquetasDoCliente: casa pelo canônico — com/sem 55 e com/sem o 9', () => {
  assert.equal(etiquetasDoCliente(mapa, ['+55 (48) 99999-0001']).etiquetas?.principal, 'VENDIDO')
  assert.equal(etiquetasDoCliente(mapa, ['48 9999-0001']).etiquetas?.principal, 'VENDIDO')
  assert.equal(etiquetasDoCliente(mapa, [null, '5511999990002']).etiquetas?.todas.length, 0)
  assert.deepEqual(etiquetasDoCliente(mapa, ['48 8888-0000']), SEM_CONV, 'telefone bom, sem conversa')
})

test('etiquetasDoCliente: separa "não achei" de "não havia o que procurar"', () => {
  // sem telefone nenhum (427 pinos em 03/09/2026)
  assert.deepEqual(etiquetasDoCliente(mapa, [null, undefined, '']), SEM_FONE)
  // fixo de 8 dígitos sem DDD não vira canônico — 94 pinos, mesmo caso na prática
  assert.deepEqual(etiquetasDoCliente(mapa, ['32422079']), SEM_FONE)
  // telefone válido que ninguém conversou: semFone FALSE (3.785 pinos)
  assert.deepEqual(etiquetasDoCliente(mapa, ['48 98888-0000']), SEM_CONV)
  // um telefone ruim + um bom sem conversa: houve o que procurar
  assert.deepEqual(etiquetasDoCliente(mapa, ['32422079', '48 98888-0000']), SEM_CONV)
})

test('etiquetasDoCliente: o primeiro telefone que casa manda', () => {
  assert.equal(etiquetasDoCliente(mapa, ['48 8888-0000', '11 99999-0002']).etiquetas?.todas.length, 0)
})

test('passaEtiqueta: seleção vazia deixa tudo passar', () => {
  const nada = new Set<string>()
  assert.equal(passaEtiqueta(nada, SEM_CONV), true)
  assert.equal(passaEtiqueta(nada, SEM_FONE), true)
  assert.equal(passaEtiqueta(nada, cv(semEtq)), true)
})

test('passaEtiqueta: marcar várias SOMA (qualquer uma serve)', () => {
  const sel = new Set(['ORCAMENTO ENVIADO', 'INTERESSE FUTURO'])
  assert.equal(passaEtiqueta(sel, cv(ef('VENDIDO', [['VENDIDO', 'PEDRO'], ['ORCAMENTO ENVIADO', 'PEDRO']]))), true)
  assert.equal(passaEtiqueta(sel, cv(ef('VENDIDO', [['VENDIDO', 'PEDRO']]))), false)
})

test('passaEtiqueta: os TRÊS "sem" são coisas diferentes', () => {
  assert.equal(passaEtiqueta(new Set([SEM_ETIQUETA]), cv(semEtq)), true)
  assert.equal(passaEtiqueta(new Set([SEM_ETIQUETA]), SEM_CONV), false, 'sem conversa NÃO é "sem etiqueta"')
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), SEM_CONV), true)
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), cv(semEtq)), false)
  // o que motivou a separação: quem filtra "sem conversa" pra prospectar não
  // pode receber cliente que nem telefone tem
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), SEM_FONE), false, 'sem telefone NÃO entra em "sem conversa"')
  assert.equal(passaEtiqueta(new Set([SEM_TELEFONE]), SEM_FONE), true)
  assert.equal(passaEtiqueta(new Set([SEM_TELEFONE]), SEM_CONV), false)
  assert.equal(passaEtiqueta(new Set(['VENDIDO']), SEM_CONV), false)
  assert.equal(passaEtiqueta(new Set(['VENDIDO']), SEM_FONE), false)
})

test('etiquetaQuePinta: os três sentinelas', () => {
  assert.equal(etiquetaQuePinta(SEM_CONV, 'PEDRO', new Set()), SEM_WHATSAPP)
  assert.equal(etiquetaQuePinta(SEM_FONE, 'PEDRO', new Set()), SEM_TELEFONE)
  assert.equal(etiquetaQuePinta(cv(semEtq), 'PEDRO', new Set()), SEM_ETIQUETA)
})

test('etiquetaQuePinta: com filtro ligado, pinta a etiqueta PEDIDA', () => {
  const e = cv(ef('RESOLVIDO', [['RESOLVIDO', 'EDER'], ['VENDIDO', 'PEDRO']]))
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set(['VENDIDO'])), 'VENDIDO')
  // pediu duas e o cliente tem as duas: a mais adiantada do funil
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set(['VENDIDO', 'RESOLVIDO'])), 'RESOLVIDO')
  // pediu uma que ele NÃO tem (passou por outro motivo): cai na regra normal
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set(['FEIRA'])), 'RESOLVIDO')
})

test('etiquetaQuePinta: sem filtro, a etiqueta do VENDEDOR DO PINO vence a principal de outro', () => {
  // principal (RESOLVIDO) é do EDER; o pino é do PEDRO, que etiquetou VENDIDO
  const e = cv(ef('RESOLVIDO', [['RESOLVIDO', 'EDER'], ['VENDIDO', 'PEDRO']], 'EDER'))
  assert.equal(etiquetaQuePinta(e, 'PEDRO', new Set()), 'VENDIDO')
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set()), 'RESOLVIDO', 'dono da principal continua com ela')
  assert.equal(etiquetaQuePinta(e, 'IGOR', new Set()), 'RESOLVIDO', 'vendedor que não etiquetou cai na principal')
  assert.equal(etiquetaQuePinta(e, null, new Set()), 'RESOLVIDO', 'pino sem vendedor cai na principal')
  assert.equal(etiquetaQuePinta(e, ' pedro ', new Set()), 'VENDIDO', 'comparação ignora caixa e espaço')
})

test('etiquetaQuePinta: entre as do vendedor do pino, o estágio mais adiantado do funil', () => {
  const e = cv(ef('ORCAMENTO ENVIADO', [['ORCAMENTO ENVIADO', 'ALVARO'], ['NAO RESPONDEU MAIS', 'ALVARO']], 'ALVARO'))
  // principal é dele e está entre as dele: fica a principal (é a escolha da matview)
  assert.equal(etiquetaQuePinta(e, 'ALVARO', new Set()), 'ORCAMENTO ENVIADO')
  // principal de OUTRO: entre as do Alvaro, o desfecho vence a etapa
  const e2 = cv(ef('PROSPECCAO', [['PROSPECCAO', 'IGOR'], ['ORCAMENTO ENVIADO', 'ALVARO'], ['NAO RESPONDEU MAIS', 'ALVARO']], 'IGOR'))
  assert.equal(etiquetaQuePinta(e2, 'ALVARO', new Set()), 'NAO RESPONDEU MAIS')
  // etiqueta fora do funil só vale se não houver nenhuma do funil
  const e3 = cv(ef('FEIRA', [['FEIRA', 'IGOR'], ['FEIRA', 'ALVARO'], ['NOVO LEAD', 'ALVARO']], 'IGOR'))
  assert.equal(etiquetaQuePinta(e3, 'ALVARO', new Set()), 'NOVO LEAD')
})

test('opcoesEtiqueta: funil na ordem oficial, internas no fim, "sem" por último, contagem por cliente', () => {
  const ops = opcoesEtiqueta([
    cv(ef('VENDIDO', [['VENDIDO', 'A'], ['ORCAMENTO ENVIADO', 'A']])),
    cv(ef('ORCAMENTO ENVIADO', [['ORCAMENTO ENVIADO', 'A']])),
    cv(ef('BRANORTE', [['BRANORTE', 'A']])),
    cv(ef('FEIRA', [['FEIRA', 'A']])),
    cv(ef('FEIRA', [['FEIRA', 'B']])),
    cv(ef('PROSPECCAO', [['PROSPECCAO', 'A']])),
    cv(semEtq),
    SEM_CONV, SEM_CONV,
    SEM_FONE,
  ])
  assert.deepEqual(ops.map(o => `${o.valor}:${o.n}`), [
    'PROSPECCAO:1', 'ORCAMENTO ENVIADO:2', 'VENDIDO:1',   // ordem do funil
    'FEIRA:2',                                            // fora do funil: por volume
    'BRANORTE:1',                                         // interna
    `${SEM_ETIQUETA}:1`, `${SEM_WHATSAPP}:2`, `${SEM_TELEFONE}:1`,
  ])
  assert.equal(ops.find(o => o.valor === 'BRANORTE')?.interna, true)
  assert.equal(ops.find(o => o.valor === 'FEIRA')?.interna, false)
})

test('opcoesEtiqueta: cada "sem" só aparece se existir', () => {
  assert.deepEqual(opcoesEtiqueta([]), [])
  assert.deepEqual(opcoesEtiqueta([SEM_FONE]).map(o => o.valor), [SEM_TELEFONE])
  assert.deepEqual(opcoesEtiqueta([SEM_CONV]).map(o => o.valor), [SEM_WHATSAPP])
})

test('rótulos dos "sem" dizem o que fazer com cada um', () => {
  assert.equal(rotuloEtiquetaOpcao(SEM_WHATSAPP), 'Tem telefone, sem conversa')
  assert.equal(rotuloEtiquetaOpcao(SEM_TELEFONE), 'Sem telefone no cadastro')
  assert.equal(rotuloEtiquetaOpcao(SEM_ETIQUETA), 'Sem etiqueta (tem conversa)')
  assert.equal(rotuloEtiquetaOpcao('VENDIDO'), 'VENDIDO')
})

test('nomeCanonicoEtiqueta: caixa e alias iguais aos do funil', () => {
  assert.equal(nomeCanonicoEtiqueta(' fallow up '), 'FOLLOW UP')
  assert.equal(nomeCanonicoEtiqueta('Vendidos'), 'VENDIDO')
})

test('cores: os três "sem" e uma etiqueta são quatro cores distintas nos dois temas', () => {
  for (const escuro of [false, true]) {
    const cores = [SEM_WHATSAPP, SEM_TELEFONE, SEM_ETIQUETA, 'VENDIDO'].map(v => corDaOpcaoEtiqueta(v, escuro))
    assert.equal(new Set(cores).size, 4, `tema ${escuro ? 'escuro' : 'claro'}`)
  }
})

test('cores: o PINO usa a paleta clara em qualquer tema (o mapa é claro nos dois)', () => {
  assert.equal(corDoPinoEtiqueta('VENDIDO'), corDaOpcaoEtiqueta('VENDIDO', false))
  assert.notEqual(corDoPinoEtiqueta('VENDIDO'), corDaOpcaoEtiqueta('VENDIDO', true))
})

test('cores: no tema escuro o swatch da legenda clareia (não some no fundo)', () => {
  const claro = corDaOpcaoEtiqueta('VENDIDO', false)
  const escuro = corDaOpcaoEtiqueta('VENDIDO', true)
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
  assert.ok(lum(escuro) > lum(claro))
})
