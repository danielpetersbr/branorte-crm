import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planoDasParadas, paradasComVisita, linhaDaParada, type ParadaGravada } from './viagem-db'
import { montarParadas, type PontoMapa } from './viagem'

// 29/09/2026: salvar pelo planejador apagava as paradas e reinseria — o check-in e o
// relatório do representante (ON DELETE CASCADE) sumiam junto. Estes testes travam o
// plano que decide quem é UPDATE (preserva a visita) e quem pode ir no apaga-e-insere.

const ponto = (cli_key: string, lat: number, lng: number): PontoMapa => ({
  cli_key, lat, lng, cliente: `Cliente ${cli_key}`, telefone: null, fone: null, numeros: null,
  cidade: 'Teresina', uf: 'PI', total: null, vendedor: null, vendido: false, precisao: 'endereco',
})

const gravada = (o: Partial<ParadaGravada> & { id: string }): ParadaGravada => ({
  cli_key: null, cli_keys: null, checkin_at: null, checkout_at: null, ...o,
})

/** Monta [{paradaId, linha}] como o hook faz, a partir de pontos soltos. */
function planejadas(...pts: PontoMapa[]) {
  return montarParadas(pts).map((p, i) => ({ paradaId: p.id, linha: linhaDaParada('v1', p, i, undefined) }))
}

test('paradasComVisita: check-in, checkout OU relatório contam como visita feita', () => {
  const rows = [
    gravada({ id: 'a', checkin_at: '2026-09-29T10:00:00Z' }),
    gravada({ id: 'b', checkout_at: '2026-09-29T11:00:00Z' }),
    gravada({ id: 'c' }),                    // só relatório (o RPC não exige check-in)
    gravada({ id: 'd' }),                    // nada: pode apagar
  ]
  assert.deepEqual(paradasComVisita(rows, ['c']).map(r => r.id), ['a', 'b', 'c'])
})

test('sem visita no banco: tudo é INSERT e nada fica preservado (comportamento de antes)', () => {
  const pl = planejadas(ponto('x', -5.1, -42.8), ponto('y', -5.2, -42.9))
  const plano = planoDasParadas(pl, [])
  assert.equal(plano.atualizar.length, 0)
  assert.equal(plano.inserir.length, 2)
  assert.deepEqual(plano.preservar, [])
  assert.deepEqual(plano.foraDoPlano, [])
})

test('parada visitada que continua no plano (mesmo id) vira UPDATE por id, não INSERT', () => {
  const pl = planejadas(ponto('x', -5.1, -42.8), ponto('y', -5.2, -42.9))
  const visitada = gravada({ id: pl[1].paradaId, cli_key: 'y', cli_keys: ['y'], checkin_at: '2026-09-29T10:00:00Z' })
  const plano = planoDasParadas(pl, [visitada])
  assert.deepEqual(plano.atualizar.map(a => a.id), [visitada.id])
  assert.equal(plano.atualizar[0].linha.cli_key, 'y')
  assert.deepEqual(plano.inserir.map(l => l.cli_key), ['x'])
  assert.deepEqual(plano.preservar, [visitada.id])
  assert.deepEqual(plano.foraDoPlano, [])
})

test('id velho na tela (depois de um salvar) ainda casa pelos mesmos clientes — sem duplicar a parada', () => {
  // a tela guarda "p_…" / o uuid antigo; no banco a parada visitada tem uuid novo
  const pl = planejadas(ponto('x', -5.1, -42.8), ponto('y', -5.2, -42.9))
  const visitada = gravada({ id: 'uuid-do-banco', cli_key: 'x', cli_keys: ['x'], checkin_at: '2026-09-29T10:00:00Z' })
  const plano = planoDasParadas(pl, [visitada])
  assert.deepEqual(plano.atualizar.map(a => [a.id, a.linha.cli_key]), [['uuid-do-banco', 'x']])
  assert.deepEqual(plano.inserir.map(l => l.cli_key), ['y'])
})

test('parada-cidade visitada casa pelo conjunto de clientes, em qualquer ordem', () => {
  // dois clientes no mesmo ponto → uma parada-cidade (cli_key NULL, cli_keys [a,b])
  const pl = planejadas(ponto('a', -5.3, -42.7), ponto('b', -5.3, -42.7))
  assert.equal(pl.length, 1)
  assert.equal(pl[0].linha.cli_key, null)
  const visitada = gravada({ id: 'cid', cli_keys: ['b', 'a'], checkout_at: '2026-09-29T12:00:00Z' })
  const plano = planoDasParadas(pl, [visitada])
  assert.deepEqual(plano.atualizar.map(a => a.id), ['cid'])
  assert.equal(plano.inserir.length, 0)
})

test('registro velho (só cli_key, cli_keys nulo) também casa', () => {
  const pl = planejadas(ponto('x', -5.1, -42.8))
  const plano = planoDasParadas(pl, [gravada({ id: 'velha', cli_key: 'x', checkin_at: '2026-09-29T10:00:00Z' })])
  assert.deepEqual(plano.atualizar.map(a => a.id), ['velha'])
  assert.equal(plano.inserir.length, 0)
})

test('cliente visitado foi pra uma parada com mais gente e tipo cliente: casa pelo cli_key (senão 23505 no INSERT)', () => {
  const pl = planejadas(ponto('x', -5.1, -42.8))
  // força uma parada "cliente" com 2 clientes: cli_key = x, assinatura [x,z] ≠ [x]
  const linha = { ...pl[0].linha, cli_keys: ['x', 'z'] }
  const plano = planoDasParadas([{ paradaId: 'nova', linha }], [
    gravada({ id: 'visitada', cli_key: 'x', cli_keys: ['x'], checkin_at: '2026-09-29T10:00:00Z' }),
  ])
  assert.deepEqual(plano.atualizar.map(a => a.id), ['visitada'])
  assert.equal(plano.inserir.length, 0)
})

test('visitada que saiu do plano NÃO é apagada: fica em preservar e é devolvida em foraDoPlano', () => {
  const pl = planejadas(ponto('y', -5.2, -42.9))
  const visitada = gravada({ id: 'foi', cli_key: 'x', cli_keys: ['x'], cliente_nome: 'Fazenda X', checkin_at: '2026-09-29T10:00:00Z' })
  const plano = planoDasParadas(pl, [visitada])
  assert.deepEqual(plano.preservar, ['foi'])
  assert.deepEqual(plano.foraDoPlano.map(g => g.cliente_nome), ['Fazenda X'])
  assert.equal(plano.atualizar.length, 0)
  assert.deepEqual(plano.inserir.map(l => l.cli_key), ['y'])
})

test('uma parada visitada casa com UMA parada do plano só', () => {
  const pl = planejadas(ponto('x', -5.1, -42.8))
  const dupla = [pl[0], { paradaId: 'outra', linha: { ...pl[0].linha } }]
  const plano = planoDasParadas(dupla, [gravada({ id: 'v', cli_key: 'x', cli_keys: ['x'], checkin_at: 't' })])
  assert.equal(plano.atualizar.length, 1)
  assert.equal(plano.inserir.length, 1)
})
