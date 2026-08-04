import test from 'node:test'
import assert from 'node:assert/strict'
import { lerLocal, ehLinkCurto, urlCurta, dentroDoBrasil, distanciaKm } from './local-link'

// Uruçuí/PI, onde a Branorte tem cliente de verdade.
const URUCUI = { lat: -7.2297, lng: -44.5561 }
const perto = (a: number, b: number) => Math.abs(a - b) < 0.0001

test('WhatsApp: "Enviar localização" vira maps?q=', () => {
  const r = lerLocal('https://maps.google.com/maps?q=-7.2297,-44.5561')
  assert.ok(r && perto(r.lat, URUCUI.lat) && perto(r.lng, URUCUI.lng), JSON.stringify(r))
})

test('Google Maps web: @lat,lng no caminho', () => {
  const r = lerLocal('https://www.google.com/maps/@-7.2297,-44.5561,15z')
  assert.ok(r && perto(r.lat, URUCUI.lat))
})

test('o PINO (!3d!4d) ganha da CÂMERA (@) quando os dois vêm juntos', () => {
  // A câmera pode estar deslocada do lugar; quem marca a propriedade é o pino.
  const url = 'https://www.google.com/maps/place/Fazenda/@-7.5000,-44.9000,14z/data=!3m1!4b1!4m5!3m4!1s0x0!8m2!3d-7.2297!4d-44.5561'
  const r = lerLocal(url)
  assert.ok(r, 'não leu')
  assert.ok(perto(r.lat, URUCUI.lat), `pegou a câmera (-7.5) em vez do pino: ${r.lat}`)
})

test('geo: do Android', () => {
  const r = lerLocal('geo:-7.2297,-44.5561?q=Fazenda')
  assert.ok(r && perto(r.lat, URUCUI.lat))
})

test('coordenada colada na mão, com vírgula decimal', () => {
  const r = lerLocal('-7,2297; -44,5561')
  assert.ok(r && perto(r.lat, URUCUI.lat) && perto(r.lng, URUCUI.lng), JSON.stringify(r))
})

test('lat/lng TROCADOS são consertados — mas só quando a troca é a que faz sentido', () => {
  // -44,-7 não existe no Brasil; -7,-44 existe. A inversão é inequívoca.
  const r = lerLocal('-44.5561, -7.2297')
  assert.ok(r, 'devia ter consertado')
  assert.ok(perto(r.lat, URUCUI.lat), `não inverteu: ${r.lat}`)
  assert.ok(r.fonte.endsWith('_invertido'), 'a fonte tem que registrar que foi invertido')
})

test('coordenada certa NÃO é "consertada"', () => {
  // Ambas as ordens caem no Brasil (é perto da diagonal). A original tem que vencer.
  const r = lerLocal('-10.5, -40.2')
  assert.ok(r && perto(r.lat, -10.5) && perto(r.lng, -40.2), JSON.stringify(r))
  assert.ok(!r.fonte.includes('invertido'))
})

test('coordenada fora do Brasil é RECUSADA, não marcada', () => {
  // Paris. Marcar cliente no exterior é pior que não marcar: some da conta e
  // ninguém vê o erro até alguém abrir a rota.
  assert.equal(lerLocal('https://maps.google.com/maps?q=48.8566,2.3522'), null)
  assert.equal(lerLocal('0,0'), null, 'ilha nula é o erro clássico de campo vazio')
})

test('link CURTO não tem coordenada — tem que ser detectado, não devolvido errado', () => {
  const curto = 'https://maps.app.goo.gl/AbC123XyZ'
  assert.equal(lerLocal(curto), null, 'não pode inventar coordenada de link curto')
  assert.ok(ehLinkCurto(curto), 'tem que ser reconhecido como curto')
  assert.equal(urlCurta(`olha aqui ó ${curto} valeu`), curto, 'tem que achar a url no meio do texto')
})

test('os três encurtadores que o Google usa', () => {
  for (const u of ['https://maps.app.goo.gl/x', 'https://goo.gl/maps/y', 'https://g.co/kgs/z']) {
    assert.ok(ehLinkCurto(u), u)
  }
})

test('texto de endereço não vira coordenada', () => {
  assert.equal(lerLocal('Rodovia BR-135, km 12, Uruçuí PI'), null)
  assert.equal(lerLocal('Fazenda Santa Maria'), null)
  assert.equal(lerLocal(''), null)
})

test('número solto no meio de endereço não é lido como coordenada', () => {
  // O padrão de coordenada colada exige a LINHA INTEIRA, justamente por isto.
  assert.equal(lerLocal('Rua 7.5, casa -44.5'), null)
})

test('dentroDoBrasil cobre os extremos reais do país', () => {
  assert.ok(dentroDoBrasil(-33.75, -53.4), 'Chuí/RS')
  assert.ok(dentroDoBrasil(5.27, -60.2), 'Monte Caburaí/RR')
  assert.ok(dentroDoBrasil(-7.15, -34.79), 'Ponta do Seixas/PB')
  assert.ok(!dentroDoBrasil(-34.6, -58.4), 'Buenos Aires não é Brasil')
})

test('distanciaKm mede a correção — pra flagrar link errado antes de virar rota', () => {
  const d = distanciaKm(URUCUI.lat, URUCUI.lng, -5.0919, -42.8034) // Uruçuí -> Teresina
  assert.ok(d > 250 && d < 350, `Uruçuí→Teresina deu ${Math.round(d)} km (esperado ~300)`)
  assert.ok(distanciaKm(URUCUI.lat, URUCUI.lng, URUCUI.lat, URUCUI.lng) < 0.001)
})

// ═════════════════════════════════════════════════════════════════════════════
// defeitos achados na conferência adversarial (04/08) — cada um mandava o
// vendedor pra coordenada errada EM SILÊNCIO, por baixo do aviso de 150 km
// ═════════════════════════════════════════════════════════════════════════════

test('link de DIREÇÕES não devolve a câmera — ela fica no meio do caminho', () => {
  // Rota Uruçuí→Balsas: o @ da URL é o centro da tela, ~83 km da fazenda. Como
  // 83 < 150, o confirm não disparava e gravava errado sem ninguém ver.
  const dir = 'https://www.google.com/maps/dir/-7.2297,-44.5561/-7.5326,-46.0353/@-7.3811,-45.2958,9z'
  const r = lerLocal(dir)
  if (r) {
    assert.ok(Math.abs(r.lat - (-7.3811)) > 0.01,
      `devolveu a câmera (${r.lat}) — é o ponto do meio da rota, não o cliente`)
  }
})

test('em texto com DUAS coordenadas, a que o CLIENTE mandou ganha da câmera', () => {
  // Vendedor cola o link novo junto com uma câmera velha que estava no
  // clipboard. Antes a câmera vencia por prioridade e gravava 17 km errado.
  const dois = 'https://www.google.com/maps/@-7.3200,-44.6800,12z e o novo https://maps.google.com/maps?q=-7.2297,-44.5561'
  const r = lerLocal(dois)
  assert.ok(r, 'não leu nada')
  assert.ok(Math.abs(r.lat - (-7.2297)) < 0.001,
    `pegou a câmera velha (${r.lat}) em vez do que o cliente mandou`)
})

test('formato ESTRUTURADO não tem inversão "consertada"', () => {
  // A ordem em @lat,lng e !3d!4d é definida pelo Google. Inverter ali vira
  // coordenada de aparência confiável no meio do Atlântico.
  assert.equal(lerLocal('https://www.google.com/maps/@-45.0,-33.0,10z'), null,
    'inverteu uma URL do Google e pôs o cliente no oceano')
  assert.equal(lerLocal('data=!3d-44.5561!4d-7.2297'), null)
})

test('coordenada colada na mão CONTINUA sendo consertada', () => {
  // Aqui a inversão é real: gente copia de planilha com as colunas trocadas.
  const r = lerLocal('-44.5561, -7.2297')
  assert.ok(r && Math.abs(r.lat - (-7.2297)) < 0.001)
  assert.ok(r.fonte.endsWith('_invertido'))
})

test('primeiro padrão fora do Brasil não aborta os seguintes', () => {
  // Antes era `return null`: um !3d!4d apontando pra outra coisa (uma foto, um
  // negócio vizinho) fazia perder a câmera correta logo abaixo. E o servidor
  // fazia `continue`, então o MESMO link dava resposta diferente conforme fosse
  // curto ou completo.
  const misto = 'https://www.google.com/maps/place/X/@-7.2297,-44.5561,15z/data=!3d48.8566!4d2.3522'
  const r = lerLocal(misto)
  assert.ok(r, 'desistiu no primeiro padrão fora da caixa')
  assert.ok(Math.abs(r.lat - (-7.2297)) < 0.001, `pegou ${r.lat}`)
})

test('texto gigante não trava a aba (era 21 s com 125 KB)', () => {
  // `\s*[,;\s]\s*` fazia os dois \s* disputarem os mesmos espaços: O(n²).
  const bomba = '-7.2297' + ' '.repeat(120_000) + 'x'
  const t0 = Date.now()
  lerLocal(bomba)
  const ms = Date.now() - t0
  assert.ok(ms < 500, `levou ${ms} ms — a regex voltou a fazer backtracking`)
})
