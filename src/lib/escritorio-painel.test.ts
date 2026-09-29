import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diaComercial, intervaloDia, nomeCadastrado, valorPorNome, atendimentoHoje, rankingMensal } from './escritorio-painel'

test('virada do dia segue São Paulo mesmo com tablet em outro fuso', () => {
  assert.equal(diaComercial(new Date('2026-10-01T02:59:59Z')), '2026-09-30')
  assert.deepEqual(intervaloDia('2026-09-30'), { inicio: '2026-09-30T03:00:00.000Z', fim: '2026-10-01T03:00:00.000Z' })
  assert.equal(diaComercial(new Date('2026-10-01T03:00:00Z')), '2026-10-01')
})

test('nome abreviado do mês identifica EDILSON JR sem confundir homônimos', () => {
  assert.equal(nomeCadastrado('EDILSON', ['EDILSON JR', 'ALVARO']), 'EDILSON JR')
  assert.equal(nomeCadastrado('EDILSON', ['EDILSON JR', 'EDILSON SILVA']), null)
  assert.equal(nomeCadastrado('EDILSON JR', ['EDILSON JR', 'EDILSON SILVA']), 'EDILSON JR')
})

test('falha não vira zero e resultado agregado ambíguo não é duplicado', () => {
  assert.equal(valorPorNome(null, 'ALVARO', ['ALVARO']), null)
  assert.equal(valorPorNome({}, 'ALVARO', ['ALVARO']), 0)
  assert.equal(valorPorNome({ EDILSON: 3 }, 'EDILSON JR', ['EDILSON JR']), 3)
  assert.equal(valorPorNome({ EDILSON: 3 }, 'EDILSON JR', ['EDILSON JR', 'EDILSON SILVA']), null)
})

test('heartbeat de ontem não aparece como produção de hoje', () => {
  assert.equal(atendimentoHoje({ atendimentos: 24, atualizado_em: '2026-09-28T22:00:00Z' }, '2026-09-29'), null)
  assert.equal(atendimentoHoje({ atendimentos: 0, atualizado_em: '2026-09-29T03:01:00Z' }, '2026-09-29'), 0)
  assert.equal(atendimentoHoje(undefined, '2026-09-29'), null)
})

test('ranking exclui dono, preserva histórico e resolve nome cadastrado', () => {
  const rows = rankingMensal([
    { vend: 'DANIEL', atendimentos: 615, leads: 144, orcamentos: 45 },
    { vend: 'EDILSON', atendimentos: 389, leads: 56, orcamentos: 24 },
    { vend: 'ANA', atendimentos: 45, leads: 2, orcamentos: 0 },
  ], ['EDILSON JR'])
  assert.deepEqual(rows, [
    { nome: 'EDILSON JR', atendimentos: 389, leads: 56, orcamentos: 24, historico: false },
    { nome: 'ANA', atendimentos: 45, leads: 2, orcamentos: 0, historico: true },
  ])
})
