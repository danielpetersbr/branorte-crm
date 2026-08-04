/**
 * Testes do núcleo do Modo Planejamento de Viagem (/mapa-visitas).
 *
 * Runner nativo do Node (mesmo do wa-funil.test.ts, sem dependência nova):
 *   npx tsx --test src/lib/viagem.test.ts
 *   npm test                      (roda src/**\/*.test.ts)
 *
 * Cobre a lógica PURA de viagem.ts: agrupamento por cidade, otimização de
 * ordem, programação em dias/horários (§9, §11 do spec) e os textos colados
 * no WhatsApp (§14, §21).
 *
 * Coordenadas são reais: Teresina, Aeroporto de Teresina, Braço do Norte/SC
 * e São Paulo — os mesmos casos que aparecem no banco hoje.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_PADRAO, TRECHO_LONGO_KM,
  montarParadas, otimizarOrdem, programar, minutosDaParada, roteavel, nomeParada,
  hhmmParaMin, minParaHhmm, chaveTrecho, distKm, linkGoogleMaps,
  resumoWhatsApp, mensagemConfirmacao,
  type Parada, type ConfigViagem, type PontoMapa, type Coord,
  type Programacao, type Trecho, type Precisao,
  hhmmComDia,
  diasNecessarios,
} from './viagem'

// ── coordenadas reais ────────────────────────────────────────────────────────

const TERESINA:    Coord = { lat: -5.0919,     lng: -42.8034 }
const AEROPORTO:   Coord = { lat: -5.0597,     lng: -42.8236 }    // Aeroporto de Teresina
const BRACO_NORTE: Coord = { lat: -28.2728633, lng: -49.1622712 } // 115 clientes numa coordenada só
const SAO_PAULO:   Coord = { lat: -23.5506507, lng: -46.6333824 }

// ── fábricas ─────────────────────────────────────────────────────────────────

const ponto = (o: Partial<PontoMapa> & { cli_key: string; lat: number; lng: number }): PontoMapa => ({
  cliente: null, telefone: null, fone: null, numeros: null,
  cidade: null, uf: null, total: null, vendedor: null, vendido: false,
  precisao: 'cidade' as Precisao,
  ...o,
})

const parada = (o: Partial<Parada> & { id: string; lat: number; lng: number }): Parada => ({
  tipo: 'cliente', clientes: [], rotulo: o.id,
  cidade: null, uf: null, endereco: null,
  precisao: 'endereco', visitaMinutos: null,
  janelaInicio: null, janelaFim: null,
  ordemTravada: false, notas: null, confirmacao: 'nao_solicitado',
  ...o,
})

const cfg = (over: Partial<ConfigViagem> = {}): ConfigViagem => ({ ...CONFIG_PADRAO, ...over })

/** Todas as paradas programadas, achatadas — pra achar uma parada em qualquer dia. */
const programadas = (p: Programacao) => p.dias.flatMap(d => d.paradas)

/** Custo em km de uma sequência (origem → p1 → p2 → …), pra comparar ordens. */
const custoRota = (ps: Parada[], origem: Coord | null): number => {
  let total = 0
  let de: Coord | null = origem
  for (const p of ps) {
    if (de) total += distKm(de.lat, de.lng, p.lat, p.lng)
    de = p
  }
  return total
}

// ═════════════════════════════════════════════════════════════════════════════
// montarParadas — o agrupamento por coordenada
// ═════════════════════════════════════════════════════════════════════════════

test('cliente com endereço próprio numa coordenada única vira parada de cliente', () => {
  const ps = montarParadas([
    ponto({ cli_key: 'c1', ...AEROPORTO, precisao: 'endereco', cliente: 'Fazenda Boa Vista', cidade: 'Teresina', uf: 'PI' }),
  ])
  assert.equal(ps.length, 1)
  assert.equal(ps[0].tipo, 'cliente')
  assert.equal(ps[0].clientes.length, 1)
  assert.equal(ps[0].clientes[0].cliKey, 'c1')
  assert.equal(roteavel(ps[0]), true)
})

test('5 clientes na MESMA coordenada viram UMA parada-cidade com os 5 dentro', () => {
  // caso real: centroide de cidade — Braço do Norte/SC tem 115 clientes num ponto só
  const ps = montarParadas([1, 2, 3, 4, 5].map(i =>
    ponto({ cli_key: `c${i}`, ...TERESINA, cidade: 'Teresina', uf: 'PI', cliente: `Cliente ${i}`, precisao: 'cidade' })))
  assert.equal(ps.length, 1)
  assert.equal(ps[0].tipo, 'cidade')
  assert.equal(ps[0].clientes.length, 5)
  assert.deepEqual(ps[0].clientes.map(c => c.cliKey), ['c1', 'c2', 'c3', 'c4', 'c5'])
  assert.equal(nomeParada(ps[0]), 'Teresina/PI · 5 clientes')
})

test("precisão 'estado' vira parada, mas NÃO é roteável", () => {
  const ps = montarParadas([
    ponto({ cli_key: 'sem-loc', ...SAO_PAULO, precisao: 'estado', cidade: 'São Paulo', uf: 'SP' }),
  ])
  assert.equal(ps.length, 1)
  assert.equal(ps[0].precisao, 'estado')
  assert.equal(roteavel(ps[0]), false)
})

test('montarParadas preserva a ordem de entrada (primeira ocorrência define a posição)', () => {
  const ps = montarParadas([
    ponto({ cli_key: 'sp', ...SAO_PAULO, cidade: 'São Paulo', uf: 'SP' }),
    ponto({ cli_key: 'te', ...TERESINA, cidade: 'Teresina', uf: 'PI' }),
    ponto({ cli_key: 'bn', ...BRACO_NORTE, cidade: 'Braço do Norte', uf: 'SC' }),
    ponto({ cli_key: 'sp2', ...SAO_PAULO, cidade: 'São Paulo', uf: 'SP' }), // volta pro grupo já criado
  ])
  assert.deepEqual(ps.map(p => p.cidade), ['São Paulo', 'Teresina', 'Braço do Norte'])
  assert.equal(ps[0].clientes.length, 2) // sp + sp2 no mesmo grupo, sem furar a ordem
})

// ═════════════════════════════════════════════════════════════════════════════
// otimizarOrdem
// ═════════════════════════════════════════════════════════════════════════════

// Paradas no meridiano de Teresina, embaralhadas de propósito (mais longe primeiro).
const emLinha = () => [
  parada({ id: 'a-12', lat: -12, lng: -42.8034 }),
  parada({ id: 'b-06', lat: -6,  lng: -42.8034 }),
  parada({ id: 'c-10', lat: -10, lng: -42.8034 }),
  parada({ id: 'd-08', lat: -8,  lng: -42.8034 }),
]

test('otimizarOrdem devolve rota MAIS BARATA que a ordem de entrada', () => {
  const original = emLinha()
  const otimizada = otimizarOrdem(original, TERESINA, null)
  const antes = custoRota(original, TERESINA)
  const depois = custoRota(otimizada, TERESINA)
  assert.equal(otimizada.length, original.length)
  assert.deepEqual([...otimizada].map(p => p.id).sort(), [...original].map(p => p.id).sort())
  assert.ok(depois < antes, `otimizada (${depois.toFixed(0)} km) devia ser menor que a original (${antes.toFixed(0)} km)`)
})

test('parada com ordemTravada=true NÃO sai do índice dela', () => {
  const ps = [
    parada({ id: 'a-12', lat: -12, lng: -42.8034 }),
    parada({ id: 'b-06', lat: -6,  lng: -42.8034 }),
    parada({ id: 'TRAVADA', lat: -14, lng: -42.8034, ordemTravada: true }),
    parada({ id: 'c-10', lat: -10, lng: -42.8034 }),
    parada({ id: 'd-08', lat: -8,  lng: -42.8034 }),
  ]
  const r = otimizarOrdem(ps, TERESINA, null)
  assert.equal(r.length, 5)
  assert.equal(r[2].id, 'TRAVADA')
  assert.deepEqual([...r].map(p => p.id).sort(), [...ps].map(p => p.id).sort())
})

test('com 2 paradas ou menos devolve a lista igual (não há o que otimizar)', () => {
  const duas = [
    parada({ id: 'longe', ...SAO_PAULO }),
    parada({ id: 'perto', ...AEROPORTO }),
  ]
  assert.deepEqual(otimizarOrdem(duas, TERESINA, null).map(p => p.id), ['longe', 'perto'])
  assert.deepEqual(otimizarOrdem([duas[0]], TERESINA, null).map(p => p.id), ['longe'])
  assert.deepEqual(otimizarOrdem([], TERESINA, null), [])
})

// ═════════════════════════════════════════════════════════════════════════════
// programar — dias e horários
// ═════════════════════════════════════════════════════════════════════════════

test('2 paradas curtas cabem no dia 1', () => {
  const ps = [
    parada({ id: 'p1', ...TERESINA,  visitaMinutos: 30 }),
    parada({ id: 'p2', ...AEROPORTO, visitaMinutos: 30 }),
  ]
  const prog = programar(ps, cfg({ dias: 1 }))
  assert.equal(prog.dias.length, 1)
  assert.deepEqual(prog.dias[0].paradas.map(x => x.parada.id), ['p1', 'p2'])
  assert.deepEqual(prog.foraDoPlano, [])
  assert.equal(prog.dias[0].paradas[0].chegada, hhmmParaMin('08:00'))
  assert.equal(prog.dias[0].paradas[0].saida, hhmmParaMin('08:30'))
  assert.equal(prog.estimado, true) // sem OSRM, tudo estimado
})

// Fixture usada nos dois testes de estouro: 4 visitas de 200 min (dia útil = 600 min).
const quatroLongas = () => [
  parada({ id: 'p1', ...TERESINA,  visitaMinutos: 200 }),
  parada({ id: 'p2', ...AEROPORTO, visitaMinutos: 200 }),
  parada({ id: 'p3', ...TERESINA,  visitaMinutos: 200 }),
  parada({ id: 'p4', ...AEROPORTO, visitaMinutos: 200 }),
]

test('o que não cabe no dia 1 escorrega pro dia 2', () => {
  const prog = programar(quatroLongas(), cfg({ dias: 2 }))
  assert.equal(prog.dias.length, 2)
  assert.deepEqual(prog.dias[0].paradas.map(x => x.parada.id), ['p1', 'p2'])
  assert.deepEqual(prog.dias[1].paradas.map(x => x.parada.id), ['p3', 'p4'])
  assert.deepEqual(prog.foraDoPlano, [])
  // o dia 2 recomeça no horário de início, não continua o relógio do dia 1
  assert.equal(prog.dias[1].paradas[0].chegada < hhmmParaMin('09:00'), true)
})

test('com dias=1 o excedente cai em foraDoPlano — NÃO some', () => {
  const prog = programar(quatroLongas(), cfg({ dias: 1 }))
  assert.deepEqual(prog.foraDoPlano.map(p => p.id), ['p3', 'p4'])
  assert.ok(prog.alertas.some(a => a.includes('não couberam')), `alertas: ${JSON.stringify(prog.alertas)}`)
  // nada se perde: o que entrou tem que sair em dias + foraDoPlano + semLocalizacao
  const noPlano = new Set(programadas(prog).map(x => x.parada.id))
  const todos = new Set([...noPlano, ...prog.foraDoPlano.map(p => p.id), ...prog.semLocalizacao.map(p => p.id)])
  assert.deepEqual([...todos].sort(), ['p1', 'p2', 'p3', 'p4'])
})

test('com dias=1 o dia já fechado NÃO é empilhado de novo em prog.dias', () => {
  // Regressão: quando uma parada estoura e diaNum > cfg.dias, o loop faz `continue`
  // sem trocar o `atual`, então o mesmo DiaProgramado pode ser fechado várias vezes.
  const prog = programar(quatroLongas(), cfg({ dias: 1 }))
  assert.equal(prog.dias.length, 1)
  assert.equal(new Set(prog.dias).size, prog.dias.length, 'o mesmo objeto de dia apareceu mais de uma vez')
  assert.deepEqual(prog.dias.map(d => d.dia), [1])
})

test("parada com precisão 'estado' vai pra semLocalizacao e não entra em nenhum dia", () => {
  const ps = [
    parada({ id: 'ok', ...TERESINA, visitaMinutos: 30 }),
    parada({ id: 'sem-loc', ...SAO_PAULO, precisao: 'estado', visitaMinutos: 30, cidade: 'São Paulo', uf: 'SP' }),
  ]
  const prog = programar(ps, cfg({ dias: 2 }))
  assert.deepEqual(prog.semLocalizacao.map(p => p.id), ['sem-loc'])
  assert.deepEqual(programadas(prog).map(x => x.parada.id), ['ok'])
  assert.ok(prog.alertas.some(a => a.includes('sem localização real')), `alertas: ${JSON.stringify(prog.alertas)}`)
})

test('janelaInicio empurra a chegada e gera alerta de espera', () => {
  const ps = [
    parada({ id: 'p1', ...TERESINA,  visitaMinutos: 30 }),
    parada({ id: 'p2', ...AEROPORTO, visitaMinutos: 30, janelaInicio: '14:00' }),
  ]
  const prog = programar(ps, cfg({ dias: 1 }))
  const p2 = programadas(prog).find(x => x.parada.id === 'p2')!
  assert.equal(minParaHhmm(p2.chegada), '14:00')
  assert.ok(p2.alertas.some(a => a.includes('Espera até 14:00')), `alertas: ${JSON.stringify(p2.alertas)}`)
})

test('chegada dentro do almoço é empurrada pro fim do almoço', () => {
  // p1 sai 12:00 em ponto; p2 chega ~12:05, dentro da janela 12:00–13:00
  const ps = [
    parada({ id: 'p1', ...TERESINA,  visitaMinutos: 240 }),
    parada({ id: 'p2', ...AEROPORTO, visitaMinutos: 30 }),
  ]
  const prog = programar(ps, cfg({ dias: 1, almocoInicio: '12:00', almocoMinutos: 60 }))
  const p2 = programadas(prog).find(x => x.parada.id === 'p2')!
  assert.equal(minParaHhmm(p2.chegada), '13:00')
  assert.ok(p2.alertas.some(a => a.includes('almoço')), `alertas: ${JSON.stringify(p2.alertas)}`)
})

test(`trecho acima de ${TRECHO_LONGO_KM} km gera alerta (Teresina → São Paulo)`, () => {
  const ps = [
    parada({ id: 'te', ...TERESINA,  visitaMinutos: 30, cidade: 'Teresina', uf: 'PI' }),
    parada({ id: 'sp', ...SAO_PAULO, visitaMinutos: 30, cidade: 'São Paulo', uf: 'SP' }),
  ]
  const prog = programar(ps, cfg({ dias: 3 }))
  const sp = programadas(prog).find(x => x.parada.id === 'sp')!
  assert.ok(sp.trechoAnterior!.metros / 1000 > TRECHO_LONGO_KM)
  assert.ok(sp.alertas.some(a => /Trecho de \d+ km/.test(a)), `alertas: ${JSON.stringify(sp.alertas)}`)
})

test('trecho real (OSRM) substitui a estimativa e derruba o flag estimado', () => {
  const ps = [
    parada({ id: 'p1', ...TERESINA,  visitaMinutos: 30 }),
    parada({ id: 'p2', ...AEROPORTO, visitaMinutos: 30 }),
  ]
  const trechos = new Map<string, Trecho>([
    [chaveTrecho(TERESINA, AEROPORTO), { metros: 600_000, segundos: 3600, estimado: false }],
  ])
  const prog = programar(ps, cfg({ dias: 1 }), trechos)
  const p2 = programadas(prog).find(x => x.parada.id === 'p2')!
  assert.equal(p2.trechoAnterior!.metros, 600_000)
  assert.equal(minParaHhmm(p2.chegada), '09:30') // 08:30 + 1h de estrada
  assert.equal(prog.estimado, false)
  assert.ok(p2.alertas.some(a => /Trecho de 600 km/.test(a)), `alertas: ${JSON.stringify(p2.alertas)}`)
})

test('§9 — mudar o tempo de visita de uma parada muda a chegada da SEGUINTE', () => {
  const monta = (visitaP1: number) => programar([
    parada({ id: 'p1', ...TERESINA,  visitaMinutos: visitaP1 }),
    parada({ id: 'p2', ...AEROPORTO, visitaMinutos: 30 }),
  ], cfg({ dias: 1 }))

  const curta = monta(30)
  const longa = monta(90)
  const chegadaCurta = programadas(curta).find(x => x.parada.id === 'p2')!.chegada
  const chegadaLonga = programadas(longa).find(x => x.parada.id === 'p2')!.chegada
  assert.equal(chegadaLonga - chegadaCurta, 60)
})

// ═════════════════════════════════════════════════════════════════════════════
// minutosDaParada + relógio
// ═════════════════════════════════════════════════════════════════════════════

test('parada-cidade com N clientes custa N × o tempo padrão de visita', () => {
  const c = cfg({ visitaMinutosPadrao: 90 })
  const cidade5 = montarParadas([1, 2, 3, 4, 5].map(i =>
    ponto({ cli_key: `c${i}`, ...BRACO_NORTE, cidade: 'Braço do Norte', uf: 'SC' })))[0]
  const clienteUnico = montarParadas([
    ponto({ cli_key: 'x', ...AEROPORTO, precisao: 'endereco' }),
  ])[0]

  assert.equal(minutosDaParada(cidade5, c), 450)
  assert.equal(minutosDaParada(clienteUnico, c), 90)
  // pontos fixos não consomem tempo, e o override manual manda em tudo
  assert.equal(minutosDaParada(parada({ id: 'h', ...TERESINA, tipo: 'hotel' }), c), 0)
  assert.equal(minutosDaParada(parada({ id: 'o', ...TERESINA, tipo: 'origem' }), c), 0)
  assert.equal(minutosDaParada({ ...cidade5, visitaMinutos: 45 }, c), 45)
})

test('hhmmParaMin e minParaHhmm fecham ida e volta', () => {
  for (const hhmm of ['00:00', '08:00', '12:30', '18:00', '23:59']) {
    assert.equal(minParaHhmm(hhmmParaMin(hhmm)), hhmm)
  }
  assert.equal(hhmmParaMin('08:00'), 480)
  assert.equal(hhmmParaMin('23:59'), 1439)
  assert.equal(minParaHhmm(1440), '00:00') // vira o dia
  assert.equal(minParaHhmm(-30), '23:30')  // não estoura pra negativo
})

// ═════════════════════════════════════════════════════════════════════════════
// textos de WhatsApp (§14, §21)
// ═════════════════════════════════════════════════════════════════════════════

test('resumoWhatsApp traz o nome da viagem, o DIA 1 e o aviso de localização aproximada', () => {
  const ps = montarParadas([
    ponto({ cli_key: 'a', ...TERESINA, cidade: 'Teresina', uf: 'PI', cliente: 'Fazenda Alvorada', precisao: 'cidade', vendedor: 'Ronaldo' }),
    ponto({ cli_key: 'b', ...TERESINA, cidade: 'Teresina', uf: 'PI', cliente: 'Granja São Jorge', precisao: 'cidade' }),
    ponto({ cli_key: 'c', ...AEROPORTO, cidade: 'Teresina', uf: 'PI', cliente: 'Nutrição Piauí', precisao: 'endereco' }),
  ])
  const c = cfg({ nome: 'Rota Piauí — agosto', dias: 1, dataInicio: '2026-08-10' })
  const texto = resumoWhatsApp(programar(ps, c), c)

  assert.ok(texto.includes('Rota Piauí — agosto'), texto)
  assert.ok(texto.includes('DIA 1'), texto)
  assert.ok(texto.includes('localização aproximada'), texto)
  assert.ok(texto.includes('Fazenda Alvorada'), texto)
  assert.ok(texto.includes('Granja São Jorge'), texto)
})

test('mensagemConfirmacao chama o vendedor pelo nome e pede a localização exata', () => {
  const p = montarParadas([
    ponto({ cli_key: 'a', ...BRACO_NORTE, cidade: 'Braço do Norte', uf: 'SC', cliente: 'Agro Sul', vendedor: 'Ronaldo Cardoso' }),
  ])[0]
  const c = cfg({ nome: 'Rota Sul', dataInicio: '2026-08-10' })
  const prog = programar([p], c)
  const dia = prog.dias[0]
  const msg = mensagemConfirmacao(p, c, dia, dia.paradas[0].chegada)

  assert.ok(msg.includes('Ronaldo Cardoso'), msg)
  assert.ok(msg.includes('localização exata'), msg)
  assert.ok(msg.includes('Agro Sul'), msg)
  assert.ok(msg.includes('Braço do Norte/SC'), msg)
})

test('dia com UMA parada ainda leva a parada no link do Google Maps', () => {
  // Regressão: com origem+retorno, o waypoint some quando o dia tem só 1 parada.
  const c = cfg({ dias: 1, origem: { nome: 'Fábrica Branorte', ...TERESINA }, retornarOrigem: true })
  const prog = programar([parada({ id: 'a', ...AEROPORTO, visitaMinutos: 30 })], c)
  const link = linkGoogleMaps(prog.dias[0], c)
  assert.ok(link.includes('-5.0597'), `a parada sumiu do link: ${link}`)
})

test('hhmmComDia marca a virada de meia-noite em vez de dar a volta no relógio', () => {
  // Regressão: trecho de 16h fazia o painel mostrar "00:02" como se fosse o mesmo
  // dia. minParaHhmm sozinho faz módulo 1440 e mente sobre quando o vendedor chega.
  assert.equal(hhmmComDia(480), '08:00')
  assert.equal(hhmmComDia(1439), '23:59')
  assert.equal(hhmmComDia(1442), '00:02 +1d')
  assert.equal(hhmmComDia(1440 * 2 + 90), '01:30 +2d')
  assert.equal(minParaHhmm(1442), '00:02', 'minParaHhmm continua sendo só a hora')
})

test('diasNecessarios acha o menor número de dias em que tudo cabe', () => {
  const ps = [
    parada({ id: 'a', lat: -5.09, lng: -42.80, visitaMinutos: 200 }),
    parada({ id: 'b', lat: -5.15, lng: -42.85, visitaMinutos: 200 }),
    parada({ id: 'c', lat: -5.20, lng: -42.90, visitaMinutos: 200 }),
    parada({ id: 'd', lat: -5.25, lng: -42.95, visitaMinutos: 200 }),
  ]
  const c = cfg({ dias: 1 })
  assert.ok(programar(ps, c).foraDoPlano.length > 0, 'com 1 dia sobra gente')
  const n = diasNecessarios(ps, c)
  assert.ok(n > 1, `precisa de mais de 1 dia (deu ${n})`)
  assert.equal(programar(ps, { ...c, dias: n }).foraDoPlano.length, 0, 'com o nº sugerido nada fica de fora')
  assert.ok(programar(ps, { ...c, dias: n - 1 }).foraDoPlano.length > 0, 'e é o MENOR: com 1 a menos ainda sobra')
})
