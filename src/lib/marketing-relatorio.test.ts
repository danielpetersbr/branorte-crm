import { test } from 'node:test'
import assert from 'node:assert/strict'
import { intervaloMkt, lerFonte, montarRelatorio, seloProposta, type FonteMkt } from './marketing-relatorio'

const fonte = (p: Partial<FonteMkt>): FonteMkt => ({
  tipo: 'canal', chave: 'X', nome: null, leads: 100, rastreaveis: 100, qualificados: 0, comProposta: 0,
  propPor100: 0, icMin: 0, icMax: 0, rsProposto: 0, compraram: 0, rsVendido: 0, fechados: 0, nunca: 0,
  sumiu: 0, semInteresse: 0, preco: 0, concorrente: 0, nadaAVer: 0, boi200: 0, ...p,
})

test('mês passado vai do dia 1 ao dia 1 do mês atual (fim exclusivo)', () => {
  const r = intervaloMkt('mes_passado', new Date(2026, 9, 20, 15))
  assert.deepEqual([r.from.getMonth(), r.from.getDate(), r.to.getMonth(), r.to.getDate()], [8, 1, 9, 1])
  assert.equal(r.label, 'setembro de 2026')
})

test('virada de ano: janeiro olha dezembro do ano anterior', () => {
  const r = intervaloMkt('mes_passado', new Date(2027, 0, 5))
  assert.equal(r.from.getFullYear(), 2026)
  assert.equal(r.label, 'dezembro de 2026')
})

test('este mês termina à meia-noite de amanhã', () => {
  const r = intervaloMkt('mes', new Date(2026, 9, 20, 15))
  assert.deepEqual([r.from.getDate(), r.to.getDate(), r.to.getHours()], [1, 21, 0])
})

test('selo só sai do "na média" quando a margem inteira fica de um lado', () => {
  assert.equal(seloProposta(fonte({ icMin: 4, icMax: 13, propPor100: 7 }), 3.7), 'acima')
  assert.equal(seloProposta(fonte({ icMin: 2, icMax: 4.2, propPor100: 2.9 }), 3.7), 'media')
  assert.equal(seloProposta(fonte({ icMin: 0.4, icMax: 3, propPor100: 1 }), 3.7), 'abaixo')
  assert.equal(seloProposta(fonte({ leads: 15, rastreaveis: 15 }), 3.7), 'pouco')
  assert.equal(seloProposta(fonte({ leads: 35, rastreaveis: 17 }), 3.7), 'sem_fone')
})

test('números vêm como texto da RPC e viram número', () => {
  const f = lerFonte({ tipo: 'criativo', chave: '&90', nome: 'MINI', leads: 109, leads_rastreaveis: 109, prop_por_100: '4.59', prop_ic95_min: '2.0', rs_proposto: '330703' })
  assert.equal(f.propPor100, 4.59)
  assert.equal(f.rsProposto, 330703)
  assert.equal(f.icMax, null)
})

test('destaque de criativo ignora amostra pequena', () => {
  const rel = montarRelatorio([
    fonte({ tipo: 'total', chave: 'TOTAL', leads: 1000, propPor100: 3.7 }),
    fonte({ tipo: 'criativo', chave: '&1', leads: 8, rastreaveis: 8, comProposta: 4, propPor100: 50, nadaAVer: 8 }),
    fonte({ tipo: 'criativo', chave: '&2', leads: 50, rastreaveis: 50, comProposta: 3, propPor100: 6, nadaAVer: 5 }),
  ], [])
  assert.match(rel.destaques.find(d => d.chave === 'criativo')!.texto, /&2/)
  assert.match(rel.destaques.find(d => d.chave === 'nada')!.texto, /&2/)
})
