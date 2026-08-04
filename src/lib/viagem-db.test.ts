import test from 'node:test'
import assert from 'node:assert/strict'
import { linhaDaParada, paradaDaLinha, cfgDaLinha, linhaDaCfg, validarCfg, praHora, soHora } from './viagem-db'
import { montarParadas, CONFIG_PADRAO, type PontoMapa, type ConfigViagem, type Parada } from './viagem'

// Round-trip Parada <-> linha do banco. É o que faz o §25.19 valer:
// salvar, atualizar a página e reabrir tem que devolver a MESMA viagem.

const TERESINA = { lat: -5.0919, lng: -42.8034 }
const AEROPORTO = { lat: -5.0597, lng: -42.8236 }

const ponto = (o: Partial<PontoMapa> & { cli_key: string; lat: number; lng: number }): PontoMapa => ({
  cliente: 'Cliente', telefone: null, fone: null, numeros: null, cidade: 'Teresina', uf: 'PI',
  total: null, vendedor: null, vendido: false, precisao: 'cidade', ...o,
})

test('parada-cidade com 2 clientes faz round-trip sem perder ninguém', () => {
  const [p] = montarParadas([
    ponto({ cli_key: 'a', ...TERESINA, cliente: 'Fazenda Alvorada', telefone: '8699', vendedor: 'ALVARO', total: 120000 }),
    ponto({ cli_key: 'b', ...TERESINA, cliente: 'Granja São Jorge' }),
  ])
  assert.equal(p.tipo, 'cidade')
  assert.equal(p.clientes.length, 2)

  const linha = linhaDaParada('v1', p, 1, undefined) as Record<string, unknown>
  // CHECK viagem_paradas_cliente_tem_key + o índice UNIQUE parcial
  assert.equal(linha.cli_key, null, 'parada-cidade grava cli_key NULL pra escapar do unique parcial')
  assert.deepEqual(linha.cli_keys, ['a', 'b'])

  const volta = paradaDaLinha({ ...linha, id: p.id })
  assert.equal(volta.tipo, 'cidade')
  assert.equal(volta.clientes.length, 2, 'os 2 clientes voltaram')
  assert.deepEqual(volta.clientes.map(c => c.cliKey), ['a', 'b'])
  assert.equal(volta.clientes[0].nome, 'Fazenda Alvorada')
  assert.equal(volta.lat, TERESINA.lat)
  assert.equal(volta.precisao, 'cidade')
})

test('parada de cliente grava cli_key (senão o CHECK do banco recusa)', () => {
  const [p] = montarParadas([ponto({ cli_key: 'c', ...AEROPORTO, precisao: 'endereco' })])
  assert.equal(p.tipo, 'cliente')
  const linha = linhaDaParada('v1', p, 1, undefined) as Record<string, unknown>
  assert.equal(linha.cli_key, 'c')
  assert.equal(paradaDaLinha({ ...linha, id: p.id }).tipo, 'cliente')
})

test('tempo, janela, trava, nota e confirmação sobrevivem ao round-trip', () => {
  const base = montarParadas([ponto({ cli_key: 'a', ...TERESINA })])[0]
  const p: Parada = {
    ...base,
    visitaMinutos: 180, janelaInicio: '09:00', janelaFim: '11:30',
    ordemTravada: true, notas: 'portão azul depois da ponte', confirmacao: 'visita_confirmada',
  }
  const volta = paradaDaLinha({ ...(linhaDaParada('v1', p, 1, undefined) as Record<string, unknown>), id: p.id })
  assert.equal(volta.visitaMinutos, 180)
  assert.equal(volta.janelaInicio, '09:00')
  assert.equal(volta.janelaFim, '11:30')
  assert.equal(volta.ordemTravada, true)
  assert.equal(volta.notas, 'portão azul depois da ponte')
  assert.equal(volta.confirmacao, 'visita_confirmada')
})

test('parada marcada cliente sem cli_key falha ANTES do INSERT, com mensagem', () => {
  const p: Parada = { ...montarParadas([ponto({ cli_key: 'a', ...TERESINA })])[0], tipo: 'cliente', clientes: [] }
  assert.throws(() => linhaDaParada('v1', p, 1, undefined), /cli_key/)
})

test('janela invertida e visita absurda são barradas antes do banco', () => {
  const base = montarParadas([ponto({ cli_key: 'a', ...TERESINA, cliente: 'Agro Sul' })])[0]
  assert.throws(
    () => linhaDaParada('v1', { ...base, janelaInicio: '14:00', janelaFim: '09:00' }, 1, undefined),
    /Agro Sul/,
  )
  assert.throws(() => linhaDaParada('v1', { ...base, visitaMinutos: 9999 }, 1, undefined), /1440/)
})

test('config faz round-trip, inclusive origem e destino', () => {
  const cfg: ConfigViagem = {
    ...CONFIG_PADRAO,
    nome: 'Viagem Piauí — Agosto', dataInicio: '2026-08-10', dias: 3,
    horaInicio: '07:30', horaFim: '19:00', almocoInicio: '12:30', almocoMinutos: 45,
    visitaMinutosPadrao: 120, modo: 'manual', retornarOrigem: false,
    origem: { nome: 'Aeroporto de Teresina', ...AEROPORTO },
    destino: { nome: 'Hotel Centro', ...TERESINA },
  }
  const volta = cfgDaLinha(linhaDaCfg(cfg) as Record<string, unknown>)
  for (const k of ['nome', 'dataInicio', 'dias', 'horaInicio', 'horaFim', 'almocoInicio',
                   'almocoMinutos', 'visitaMinutosPadrao', 'modo', 'retornarOrigem'] as const) {
    assert.deepEqual(volta[k], cfg[k], `campo ${k} divergiu`)
  }
  assert.deepEqual(volta.origem, cfg.origem)
  assert.deepEqual(volta.destino, cfg.destino)
})

test('validarCfg barra os CHECK do banco com mensagem em português', () => {
  const ok: ConfigViagem = { ...CONFIG_PADRAO, nome: 'x' }
  assert.doesNotThrow(() => validarCfg(ok))
  assert.throws(() => validarCfg({ ...ok, horaInicio: '18:00', horaFim: '08:00' }), /depois do início/)
  assert.throws(() => validarCfg({ ...ok, dias: 0 }), /1 e 60/)
  assert.throws(() => validarCfg({ ...ok, dias: 61 }), /1 e 60/)
  assert.throws(() => validarCfg({ ...ok, almocoMinutos: 300 }), /0 e 240/)
  assert.throws(() => validarCfg({ ...ok, visitaMinutosPadrao: 4 }), /5 e 600/)
  assert.throws(() => validarCfg({ ...ok, visitaMinutosPadrao: 601 }), /5 e 600/)
})

test('praHora recusa hora impossível em vez de mandar pro Postgres', () => {
  assert.equal(praHora('09:00'), '09:00:00')
  assert.equal(praHora('9:05'), '09:05:00')
  assert.equal(praHora('99:99'), null, '99:99 casava com \\d{1,2}:\\d{2} e ia pro banco')
  assert.equal(praHora('24:00'), null)
  assert.equal(praHora('12:60'), null)
  assert.equal(praHora(''), null)
  assert.equal(praHora(null), null)
  assert.equal(soHora('09:00:00'), '09:00')
  assert.equal(soHora(null), null)
})
