import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEM_ETIQUETA, SEM_WHATSAPP, etiquetasDoCliente, passaEtiqueta, opcoesEtiqueta, etiquetaQuePinta,
  nomeCanonicoEtiqueta, corDoPinoEtiqueta, corDaOpcaoEtiqueta, type EtiquetasDoFone, type MapaEtiquetas,
} from './mapa-etiquetas'

/** Fixture: conversa etiquetada; `pares` = [etiqueta, VENDEDOR]. */
const ef = (principal: string | null, pares: [string, string][], principalVendedor: string | null = pares[0]?.[1] ?? null): EtiquetasDoFone => ({
  principal, principalVendedor, todas: [...new Set(pares.map(p => p[0]))], porVendedor: pares,
})
const semEtq = ef(null, [])

const mapa: MapaEtiquetas = new Map([
  ['4899990001', ef('VENDIDO', [['VENDIDO', 'PEDRO'], ['ORCAMENTO ENVIADO', 'PEDRO']])],
  ['1199990002', semEtq],
])

test('etiquetasDoCliente: casa pelo canônico — com/sem 55 e com/sem o 9', () => {
  assert.equal(etiquetasDoCliente(mapa, ['+55 (48) 99999-0001'])?.principal, 'VENDIDO')
  assert.equal(etiquetasDoCliente(mapa, ['48 9999-0001'])?.principal, 'VENDIDO')
  assert.equal(etiquetasDoCliente(mapa, [null, '5511999990002'])?.todas.length, 0)
  assert.equal(etiquetasDoCliente(mapa, ['48 8888-0000']), null, 'sem conversa = null')
  assert.equal(etiquetasDoCliente(mapa, [null, undefined, '']), null)
})

test('etiquetasDoCliente: o primeiro telefone que casa manda', () => {
  assert.equal(etiquetasDoCliente(mapa, ['48 8888-0000', '11 99999-0002'])?.todas.length, 0)
})

test('passaEtiqueta: seleção vazia deixa tudo passar', () => {
  const nada = new Set<string>()
  assert.equal(passaEtiqueta(nada, null), true)
  assert.equal(passaEtiqueta(nada, semEtq), true)
})

test('passaEtiqueta: marcar várias SOMA (qualquer uma serve)', () => {
  const sel = new Set(['ORCAMENTO ENVIADO', 'INTERESSE FUTURO'])
  assert.equal(passaEtiqueta(sel, ef('VENDIDO', [['VENDIDO', 'PEDRO'], ['ORCAMENTO ENVIADO', 'PEDRO']])), true)
  assert.equal(passaEtiqueta(sel, ef('VENDIDO', [['VENDIDO', 'PEDRO']])), false)
})

test('passaEtiqueta: os dois "sem" são coisas diferentes', () => {
  assert.equal(passaEtiqueta(new Set([SEM_ETIQUETA]), semEtq), true)
  assert.equal(passaEtiqueta(new Set([SEM_ETIQUETA]), null), false, 'sem conversa NÃO é "sem etiqueta"')
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), null), true)
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), semEtq), false)
  assert.equal(passaEtiqueta(new Set(['VENDIDO']), null), false)
})

test('etiquetaQuePinta: sem conversa e sem etiqueta viram os sentinelas', () => {
  assert.equal(etiquetaQuePinta(null, 'PEDRO', new Set()), SEM_WHATSAPP)
  assert.equal(etiquetaQuePinta(semEtq, 'PEDRO', new Set()), SEM_ETIQUETA)
})

test('etiquetaQuePinta: com filtro ligado, pinta a etiqueta PEDIDA', () => {
  const e = ef('RESOLVIDO', [['RESOLVIDO', 'EDER'], ['VENDIDO', 'PEDRO']])
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set(['VENDIDO'])), 'VENDIDO')
  // pediu duas e o cliente tem as duas: a mais adiantada do funil
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set(['VENDIDO', 'RESOLVIDO'])), 'RESOLVIDO')
  // pediu uma que ele NÃO tem (passou por outro motivo): cai na regra normal
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set(['FEIRA'])), 'RESOLVIDO')
})

test('etiquetaQuePinta: sem filtro, a etiqueta do VENDEDOR DO PINO vence a principal de outro', () => {
  // principal (RESOLVIDO) é do EDER; o pino é do PEDRO, que etiquetou VENDIDO
  const e = ef('RESOLVIDO', [['RESOLVIDO', 'EDER'], ['VENDIDO', 'PEDRO']], 'EDER')
  assert.equal(etiquetaQuePinta(e, 'PEDRO', new Set()), 'VENDIDO')
  assert.equal(etiquetaQuePinta(e, 'EDER', new Set()), 'RESOLVIDO', 'dono da principal continua com ela')
  assert.equal(etiquetaQuePinta(e, 'IGOR', new Set()), 'RESOLVIDO', 'vendedor que não etiquetou cai na principal')
  assert.equal(etiquetaQuePinta(e, null, new Set()), 'RESOLVIDO', 'pino sem vendedor cai na principal')
  assert.equal(etiquetaQuePinta(e, ' pedro ', new Set()), 'VENDIDO', 'comparação ignora caixa e espaço')
})

test('etiquetaQuePinta: entre as do vendedor do pino, o estágio mais adiantado do funil', () => {
  const e = ef('ORCAMENTO ENVIADO', [['ORCAMENTO ENVIADO', 'ALVARO'], ['NAO RESPONDEU MAIS', 'ALVARO']], 'ALVARO')
  // principal é dele e está entre as dele: fica a principal (é a escolha da matview)
  assert.equal(etiquetaQuePinta(e, 'ALVARO', new Set()), 'ORCAMENTO ENVIADO')
  // principal de OUTRO: entre as do Alvaro, o desfecho vence a etapa
  const e2 = ef('PROSPECCAO', [['PROSPECCAO', 'IGOR'], ['ORCAMENTO ENVIADO', 'ALVARO'], ['NAO RESPONDEU MAIS', 'ALVARO']], 'IGOR')
  assert.equal(etiquetaQuePinta(e2, 'ALVARO', new Set()), 'NAO RESPONDEU MAIS')
  // etiqueta fora do funil só vale se não houver nenhuma do funil
  const e3 = ef('FEIRA', [['FEIRA', 'IGOR'], ['FEIRA', 'ALVARO'], ['NOVO LEAD', 'ALVARO']], 'IGOR')
  assert.equal(etiquetaQuePinta(e3, 'ALVARO', new Set()), 'NOVO LEAD')
})

test('opcoesEtiqueta: funil na ordem oficial, internas no fim, "sem" por último, contagem por cliente', () => {
  const ops = opcoesEtiqueta([
    ef('VENDIDO', [['VENDIDO', 'A'], ['ORCAMENTO ENVIADO', 'A']]),
    ef('ORCAMENTO ENVIADO', [['ORCAMENTO ENVIADO', 'A']]),
    ef('BRANORTE', [['BRANORTE', 'A']]),
    ef('FEIRA', [['FEIRA', 'A']]),
    ef('FEIRA', [['FEIRA', 'B']]),
    ef('PROSPECCAO', [['PROSPECCAO', 'A']]),
    semEtq,
    null, null,
  ])
  assert.deepEqual(ops.map(o => `${o.valor}:${o.n}`), [
    'PROSPECCAO:1', 'ORCAMENTO ENVIADO:2', 'VENDIDO:1',   // ordem do funil
    'FEIRA:2',                                            // fora do funil: por volume
    'BRANORTE:1',                                         // interna
    `${SEM_ETIQUETA}:1`, `${SEM_WHATSAPP}:2`,
  ])
  assert.equal(ops.find(o => o.valor === 'BRANORTE')?.interna, true)
  assert.equal(ops.find(o => o.valor === 'FEIRA')?.interna, false)
})

test('opcoesEtiqueta: lista vazia não inventa "sem"', () => {
  assert.deepEqual(opcoesEtiqueta([]), [])
})

test('nomeCanonicoEtiqueta: caixa e alias iguais aos do funil', () => {
  assert.equal(nomeCanonicoEtiqueta(' fallow up '), 'FOLLOW UP')
  assert.equal(nomeCanonicoEtiqueta('Vendidos'), 'VENDIDO')
})

test('cores: sem WhatsApp, sem etiqueta e etiqueta são três cores distintas nos dois temas', () => {
  for (const escuro of [false, true]) {
    const a = corDaOpcaoEtiqueta(SEM_WHATSAPP, escuro)
    const b = corDaOpcaoEtiqueta(SEM_ETIQUETA, escuro)
    const c = corDaOpcaoEtiqueta('VENDIDO', escuro)
    assert.equal(new Set([a, b, c]).size, 3, `tema ${escuro ? 'escuro' : 'claro'}`)
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
