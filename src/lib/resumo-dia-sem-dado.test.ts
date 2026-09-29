import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colunaSemDado, marcaNoRanking, type ColunaResumo, type FontesFora } from './resumo-dia-sem-dado'

// Espelho das colunas do ResumoDiaVendedores (key + snapshot).
const COLS: { key: ColunaResumo; snapshot: boolean }[] = [
  { key: 'leads', snapshot: false },
  { key: 'atendimentos', snapshot: false },
  { key: 'ligacoes', snapshot: false },
  { key: 'orcamentos', snapshot: false },
  { key: 'negociacao', snapshot: true },
  { key: 'quente', snapshot: true },
  { key: 'carteira', snapshot: true },
  { key: 'score', snapshot: true },
]
const ok: FontesFora = { funil: false, carteira: false, fluxo: false, liveHoje: false }
const semDado = (fora: FontesFora) => COLS.filter(c => colunaSemDado(c, fora)).map(c => c.key)

test('tudo respondeu: nenhuma coluna vira "· · ·"', () => {
  assert.deepEqual(semDado(ok), [])
  assert.deepEqual(semDado({ ...ok, liveHoje: true }), [])
})

test('fluxo fora num período (7d, 30d…): Leads, Atendidos, Ligações, Orçamentos e Score — nunca zero', () => {
  assert.deepEqual(semDado({ ...ok, fluxo: true }), ['leads', 'atendimentos', 'ligacoes', 'orcamentos', 'score'])
})

test('fluxo fora em Hoje/Tudo: Atendidos e Score vêm do funil vivo e continuam valendo', () => {
  assert.deepEqual(semDado({ ...ok, fluxo: true, liveHoje: true }), ['leads', 'ligacoes', 'orcamentos'])
})

test('funil vivo fora: em Hoje/Tudo leva Atendidos e Score junto; nos períodos, não', () => {
  assert.deepEqual(semDado({ ...ok, funil: true, liveHoje: true }), ['atendimentos', 'negociacao', 'quente', 'score'])
  assert.deepEqual(semDado({ ...ok, funil: true }), ['negociacao', 'quente'])
})

test('carteira fora: Carteira e Score (o denominador sumiu)', () => {
  assert.deepEqual(semDado({ ...ok, carteira: true }), ['carteira', 'score'])
})

const marcas = (fora: FontesFora) => [0, 1, 2, 3, 4].map(i => marcaNoRanking(i, fora)).join('')

test('medalha no WhatsApp: top 3 quando Atendidos tem dado', () => {
  assert.equal(marcas(ok), '🥇🥈🥉••')
  // Hoje/Tudo: Atendidos vem do funil vivo — fluxo fora não mexe no pódio.
  assert.equal(marcas({ ...ok, fluxo: true, liveHoje: true }), '🥇🥈🥉••')
  // Carteira fora derruba o Score, não o ranking de Atendidos.
  assert.equal(marcas({ ...ok, carteira: true }), '🥇🥈🥉••')
})

test('medalha no WhatsApp: sem Atendidos a ordem é alfabética — ninguém ganha pódio', () => {
  assert.equal(marcas({ ...ok, fluxo: true }), '•••••')                   // período, fluxo fora/carregando
  assert.equal(marcas({ ...ok, funil: true, liveHoje: true }), '•••••')   // Hoje/Tudo, funil vivo fora
})
