// Núcleo do Modo Planejamento de Viagem (/mapa-visitas).
// Lógica PURA: sem React, sem Leaflet, sem fetch. É o que os testes cobrem.
//
// Por que existe agrupamento por cidade:
// nenhum cliente do CRM tem coordenada de endereço (0 de 2.340 em 2026-08-04).
// cidade_geocache e vendas_mapa são AMBOS por município — Braço do Norte/SC tem
// 115 clientes numa coordenada só. Ordenar cliente-a-cliente dentro da cidade
// seria sorteio com cara de roteirização. Então: cliente com endereço vira parada
// própria; cliente em centroide entra numa parada-cidade junto com os vizinhos.

export type Precisao = 'endereco' | 'confirmada' | 'manual' | 'cidade' | 'estado'

export const PRECISAO_INFO: Record<Precisao, { rotulo: string; icone: string; cor: string; roteavel: boolean }> = {
  confirmada: { rotulo: 'Confirmada pelo vendedor', icone: '✅', cor: '#16a34a', roteavel: true },
  endereco:   { rotulo: 'Endereço do cadastro',     icone: '📍', cor: '#2563eb', roteavel: true },
  manual:     { rotulo: 'Informada manualmente',    icone: '✏️', cor: '#2563eb', roteavel: true },
  cidade:     { rotulo: 'Aproximada pela cidade',   icone: '🏙️', cor: '#d97706', roteavel: true },
  estado:     { rotulo: 'Sem localização real',     icone: '⚠️', cor: '#dc2626', roteavel: false },
}

/** Uma parada é um cliente com endereço, uma cidade com N clientes, ou um ponto livre. */
export type TipoParada = 'cliente' | 'cidade' | 'origem' | 'destino' | 'hotel' | 'parada'

export interface ClienteRef {
  cliKey: string
  nome: string | null
  telefone: string | null
  vendedor: string | null
  equipamento: string | null
  valor: number | null
  vendido: boolean
  numeros: string | null
}

export interface Parada {
  id: string
  tipo: TipoParada
  /** cliente: 1 item. cidade: N itens. ponto livre: vazio. */
  clientes: ClienteRef[]
  rotulo: string | null
  cidade: string | null
  uf: string | null
  endereco: string | null
  lat: number
  lng: number
  precisao: Precisao
  /** null = usa o padrão da viagem */
  visitaMinutos: number | null
  janelaInicio: string | null   // 'HH:MM'
  janelaFim: string | null      // 'HH:MM'
  ordemTravada: boolean
  notas: string | null
  confirmacao: Confirmacao
}

export type Confirmacao =
  | 'nao_solicitado' | 'aguardando_vendedor' | 'aguardando_cliente'
  | 'localizacao_recebida' | 'visita_confirmada' | 'indisponivel'

export interface ConfigViagem {
  nome: string
  dataInicio: string | null      // 'YYYY-MM-DD'
  dias: number
  horaInicio: string             // 'HH:MM'
  horaFim: string                // 'HH:MM'
  almocoInicio: string | null    // 'HH:MM'
  almocoMinutos: number
  visitaMinutosPadrao: number
  origem: PontoFixo | null
  destino: PontoFixo | null
  retornarOrigem: boolean
  modo: 'otimizar' | 'manual'
}

export interface PontoFixo { nome: string; lat: number; lng: number }

export const CONFIG_PADRAO: ConfigViagem = {
  nome: '', dataInicio: null, dias: 1,
  horaInicio: '08:00', horaFim: '18:00',
  almocoInicio: '12:00', almocoMinutos: 60,
  visitaMinutosPadrao: 90,
  origem: null, destino: null, retornarOrigem: true,
  modo: 'otimizar',
}

/** Teto de paradas. Acima disso o 2-opt fica lento e o roteiro deixa de ser útil. */
export const MAX_PARADAS = 40

// ── geo ──────────────────────────────────────────────────────────────────────

const R_TERRA = 6371

export function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_TERRA * Math.asin(Math.sqrt(s))
}

/**
 * Fator de sinuosidade: estrada não é linha reta. 1,30 é o que a literatura usa
 * pra rodovia brasileira. Só vale como ESTIMATIVA — quando o OSRM responde, o km
 * real substitui isso e a UI para de dizer "estimado".
 */
export const FATOR_ESTRADA = 1.3
/** Velocidade média em rodovia, km/h. Conservadora de propósito. */
export const VELOCIDADE_KMH = 70

export function estimarTrecho(a: Coord, b: Coord): { metros: number; segundos: number; estimado: true } {
  const km = distKm(a.lat, a.lng, b.lat, b.lng) * FATOR_ESTRADA
  return { metros: Math.round(km * 1000), segundos: Math.round((km / VELOCIDADE_KMH) * 3600), estimado: true }
}

export interface Coord { lat: number; lng: number }

/** Matriz simétrica de distância em metros (estimativa por haversine). */
export function matrizEstimada(pts: Coord[]): number[][] {
  const n = pts.length
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.round(distKm(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng) * FATOR_ESTRADA * 1000)
      m[i][j] = d; m[j][i] = d
    }
  }
  return m
}

// ── agrupamento por cidade ───────────────────────────────────────────────────

/** Ponto vindo de mapa_orcamentos_v2(). */
export interface PontoMapa {
  cli_key: string
  cliente: string | null
  telefone: string | null
  fone: string | null
  numeros: string | null
  cidade: string | null
  uf: string | null
  total: number | null
  vendedor: string | null
  vendido: boolean
  lat: number
  lng: number
  precisao: Precisao
}

export function refDoPonto(p: PontoMapa): ClienteRef {
  return {
    cliKey: p.cli_key, nome: p.cliente, telefone: p.telefone || p.fone,
    vendedor: p.vendedor, equipamento: null, valor: p.total,
    vendido: p.vendido, numeros: p.numeros,
  }
}

const chaveCoord = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`

/**
 * Monta as paradas a partir dos clientes escolhidos.
 * - precisão roteável e ÚNICA naquela coordenada → parada de cliente
 * - vários clientes na mesma coordenada → UMA parada-cidade com todos dentro
 * - precisão 'estado' → parada-cidade também, mas marcada como não-roteável
 * A ordem de entrada é preservada (a primeira ocorrência define a posição).
 */
export function montarParadas(pontos: PontoMapa[]): Parada[] {
  const porCoord = new Map<string, PontoMapa[]>()
  const ordem: string[] = []
  for (const p of pontos) {
    const k = chaveCoord(p.lat, p.lng)
    if (!porCoord.has(k)) { porCoord.set(k, []); ordem.push(k) }
    porCoord.get(k)!.push(p)
  }
  return ordem.map(k => {
    const grupo = porCoord.get(k)!
    const p0 = grupo[0]
    const sozinho = grupo.length === 1
    const enderecoReal = p0.precisao === 'endereco' || p0.precisao === 'confirmada' || p0.precisao === 'manual'
    const tipo: TipoParada = sozinho && enderecoReal ? 'cliente' : 'cidade'
    return {
      id: `p_${k}`,
      tipo,
      clientes: grupo.map(refDoPonto),
      rotulo: null,
      cidade: p0.cidade, uf: p0.uf, endereco: null,
      lat: p0.lat, lng: p0.lng,
      precisao: p0.precisao,
      visitaMinutos: null,
      janelaInicio: null, janelaFim: null,
      ordemTravada: false,
      notas: null,
      confirmacao: 'nao_solicitado',
    }
  })
}

export function pontoLivre(tipo: TipoParada, nome: string, lat: number, lng: number): Parada {
  return {
    id: `${tipo}_${chaveCoord(lat, lng)}`,
    tipo, clientes: [], rotulo: nome,
    cidade: null, uf: null, endereco: null,
    lat, lng, precisao: 'manual',
    visitaMinutos: tipo === 'hotel' || tipo === 'origem' || tipo === 'destino' ? 0 : null,
    janelaInicio: null, janelaFim: null,
    ordemTravada: false, notas: null, confirmacao: 'nao_solicitado',
  }
}

export const nomeParada = (p: Parada): string =>
  p.rotulo
  || (p.tipo === 'cidade' && p.clientes.length > 1
        ? `${p.cidade || 'Cidade'}${p.uf ? '/' + p.uf : ''} · ${p.clientes.length} clientes`
        : (p.clientes[0]?.nome || p.cidade || 'Parada'))

export const minutosDaParada = (p: Parada, cfg: ConfigViagem): number => {
  if (p.visitaMinutos != null) return p.visitaMinutos
  if (p.tipo === 'origem' || p.tipo === 'destino' || p.tipo === 'hotel') return 0
  // parada-cidade com N clientes custa mais que uma visita só
  const n = Math.max(1, p.clientes.length)
  return cfg.visitaMinutosPadrao * (p.tipo === 'cidade' ? n : 1)
}

export const roteavel = (p: Parada) => PRECISAO_INFO[p.precisao].roteavel

// ── otimizador ───────────────────────────────────────────────────────────────

/**
 * Ordena as paradas: vizinho-mais-próximo + 2-opt.
 * Respeita paradas com ordemTravada=true — elas ficam no índice em que estão.
 * Roda no cliente: com MAX_PARADAS=40 o 2-opt é instantâneo e não custa API.
 */
export function otimizarOrdem(paradas: Parada[], origem: Coord | null, destino: Coord | null): Parada[] {
  const livres = paradas.filter(p => !p.ordemTravada)
  if (livres.length <= 2) return paradas

  const travadasPorIndice = new Map<number, Parada>()
  paradas.forEach((p, i) => { if (p.ordemTravada) travadasPorIndice.set(i, p) })

  const pts: Coord[] = livres.map(p => ({ lat: p.lat, lng: p.lng }))
  const inicio: Coord = origem ?? pts[0]
  const m = matrizEstimada(pts)
  const custoAte = (c: Coord, i: number) => distKm(c.lat, c.lng, pts[i].lat, pts[i].lng) * FATOR_ESTRADA * 1000

  // 1) vizinho mais próximo a partir da origem
  const visitado = new Array(livres.length).fill(false)
  let seq: number[] = []
  let atualCoord = inicio
  let atual = -1
  for (let passo = 0; passo < livres.length; passo++) {
    let melhor = -1, melhorD = Infinity
    for (let j = 0; j < livres.length; j++) {
      if (visitado[j]) continue
      const d = atual < 0 ? custoAte(atualCoord, j) : m[atual][j]
      if (d < melhorD) { melhorD = d; melhor = j }
    }
    if (melhor < 0) break
    visitado[melhor] = true
    seq.push(melhor)
    atual = melhor
  }

  // 2) 2-opt
  const custoSeq = (s: number[]): number => {
    let t = custoAte(inicio, s[0])
    for (let i = 0; i < s.length - 1; i++) t += m[s[i]][s[i + 1]]
    if (destino) t += distKm(pts[s[s.length - 1]].lat, pts[s[s.length - 1]].lng, destino.lat, destino.lng) * FATOR_ESTRADA * 1000
    return t
  }
  let melhorou = true, guarda = 0
  while (melhorou && guarda++ < 200) {
    melhorou = false
    for (let i = 0; i < seq.length - 1; i++) {
      for (let k = i + 1; k < seq.length; k++) {
        const nova = [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)]
        if (custoSeq(nova) < custoSeq(seq) - 1) { seq = nova; melhorou = true }
      }
    }
  }

  // 3) recompõe devolvendo as travadas aos índices originais
  const ordenadas = seq.map(i => livres[i])
  const saida: Parada[] = []
  let cursor = 0
  for (let i = 0; i < paradas.length; i++) {
    const travada = travadasPorIndice.get(i)
    if (travada) saida.push(travada)
    else if (cursor < ordenadas.length) saida.push(ordenadas[cursor++])
  }
  while (cursor < ordenadas.length) saida.push(ordenadas[cursor++])
  return saida
}

// ── programação (dias + horários) ────────────────────────────────────────────

export interface Trecho { metros: number; segundos: number; estimado: boolean }

export interface ParadaProgramada {
  parada: Parada
  dia: number
  ordem: number
  chegada: number          // minutos desde 00:00 do dia
  saida: number
  visitaMinutos: number
  trechoAnterior: Trecho | null
  deQuem: string           // rótulo da origem do trecho
  alertas: string[]
}

export interface DiaProgramado {
  dia: number
  data: string | null
  paradas: ParadaProgramada[]
  metros: number
  deslocamentoSeg: number
  visitaSeg: number
  inicio: number
  fim: number
}

export interface Programacao {
  dias: DiaProgramado[]
  foraDoPlano: Parada[]        // não coube nos dias informados
  semLocalizacao: Parada[]     // precisão 'estado' — não entra em rota
  totalMetros: number
  totalDeslocamentoSeg: number
  totalVisitaSeg: number
  alertas: string[]
  estimado: boolean            // true = nenhum trecho veio de rota real
}

export const hhmmParaMin = (s: string): number => {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const minParaHhmm = (v: number): string => {
  const t = ((v % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/**
 * Hora com marcação de virada de dia. Um trecho de 16 h faz a chegada passar da
 * meia-noite; sem isso o painel mostrava "00:02" como se fosse o mesmo dia — o
 * relógio dava a volta e o roteiro mentia sobre quando o vendedor chega.
 */
export const hhmmComDia = (v: number): string => {
  const d = Math.floor(v / 1440)
  return minParaHhmm(v) + (d > 0 ? ` +${d}d` : '')
}

export const somarDias = (iso: string | null, n: number): string | null => {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Distância limite de um trecho antes de virar alerta (§11 do spec). */
export const TRECHO_LONGO_KM = 500

/**
 * Distribui as paradas ORDENADAS em dias, calculando chegada/saída.
 * `trechos` opcional: mapa 'idA>idB' -> Trecho vindo do OSRM. Sem ele, estima.
 */
export function programar(
  paradas: Parada[],
  cfg: ConfigViagem,
  trechos?: Map<string, Trecho>,
): Programacao {
  const semLoc = paradas.filter(p => !roteavel(p))
  const uteis = paradas.filter(roteavel)

  const iniDia = hhmmParaMin(cfg.horaInicio)
  const fimDia = hhmmParaMin(cfg.horaFim)
  const almocoIni = cfg.almocoInicio ? hhmmParaMin(cfg.almocoInicio) : null
  const almocoFim = almocoIni != null ? almocoIni + cfg.almocoMinutos : null

  const dias: DiaProgramado[] = []
  const foraDoPlano: Parada[] = []
  const alertas: string[] = []
  let algumReal = false

  let diaNum = 1
  let relogio = iniDia
  let anterior: { coord: Coord; nome: string } | null =
    cfg.origem ? { coord: cfg.origem, nome: cfg.origem.nome } : null
  let atual: DiaProgramado = novoDia(1, cfg, iniDia)

  const fecharDia = () => {
    if (atual.paradas.length) {
      atual.fim = relogio
      // volta pro ponto de partida/hotel no fim do dia
      const volta = cfg.retornarOrigem ? cfg.origem : cfg.destino
      if (volta && anterior) {
        const t = trechoEntre(anterior.coord, volta, trechos, anterior.nome, volta.nome)
        if (!t.estimado) algumReal = true
        atual.metros += t.metros
        atual.deslocamentoSeg += t.segundos
        atual.fim = relogio + Math.round(t.segundos / 60)
        // A visita pode caber até o horário de encerramento e a VOLTA não caber.
        // Sem este aviso o roteiro promete 18:00 e entrega meia-noite.
        if (atual.fim > fimDia) {
          const ultima = atual.paradas[atual.paradas.length - 1]
          const msg = `⚠️ Volta pra ${volta.nome} só às ${hhmmComDia(atual.fim)} (${Math.round(t.metros / 1000)} km depois do encerramento)`
          if (ultima) ultima.alertas.push(msg)
          alertas.push(`Dia ${atual.dia}: ${msg.replace('⚠️ ', '')}`)
        }
      }
      dias.push(atual)
    }
  }

  for (const p of uteis) {
    // Já estourou os dias informados: o resto vai pra foraDoPlano e NÃO some (§24).
    if (diaNum > cfg.dias) { foraDoPlano.push(p); continue }
    const visita = minutosDaParada(p, cfg)
    const t = anterior
      ? trechoEntre(anterior.coord, p, trechos, anterior.nome, nomeParada(p))
      : { metros: 0, segundos: 0, estimado: true }
    if (!t.estimado) algumReal = true

    const desloc = Math.round(t.segundos / 60)
    let chegada = relogio + desloc
    const alertasParada: string[] = []

    // almoço: se a chegada cai dentro da janela, empurra pro fim dela
    if (almocoIni != null && almocoFim != null && chegada >= almocoIni && chegada < almocoFim) {
      chegada = almocoFim
      alertasParada.push('Chegada empurrada pelo almoço')
    }

    // janela do cliente
    if (p.janelaInicio) {
      const ji = hhmmParaMin(p.janelaInicio)
      if (chegada < ji) { chegada = ji; alertasParada.push(`Espera até ${p.janelaInicio}`) }
    }
    if (p.janelaFim && chegada > hhmmParaMin(p.janelaFim)) {
      alertasParada.push(`⚠️ Chega ${hhmmComDia(chegada)}, depois da janela (${p.janelaFim})`)
    }

    if (t.metros / 1000 > TRECHO_LONGO_KM) {
      alertasParada.push(`⚠️ Trecho de ${Math.round(t.metros / 1000)} km (${(t.segundos / 3600).toFixed(1)} h)`)
    }

    const saida = chegada + visita
    const cabeNoDia = saida <= fimDia

    if (!cabeNoDia && atual.paradas.length > 0) {
      // fecha o dia e tenta no próximo
      fecharDia()
      diaNum++
      // Troca `atual` por um dia VAZIO em qualquer caso: senão o fecharDia() final
      // empilha de novo o mesmo objeto que acabou de entrar em `dias`.
      atual = novoDia(diaNum, cfg, iniDia)
      if (diaNum > cfg.dias) { foraDoPlano.push(p); continue }
      relogio = iniDia
      anterior = cfg.retornarOrigem && cfg.origem ? { coord: cfg.origem, nome: cfg.origem.nome } : anterior
      const t2 = anterior ? trechoEntre(anterior.coord, p, trechos, anterior.nome, nomeParada(p)) : { metros: 0, segundos: 0, estimado: true }
      if (!t2.estimado) algumReal = true
      const chegada2 = relogio + Math.round(t2.segundos / 60)
      const saida2 = chegada2 + visita
      if (saida2 > fimDia) {
        alertasParada.push('⚠️ Não cabe num dia inteiro — reveja a duração ou o ponto de partida')
      }
      push(atual, p, chegada2, saida2, visita, t2, anterior?.nome ?? '—', alertasParada)
      relogio = saida2
      anterior = { coord: p, nome: nomeParada(p) }
      continue
    }

    if (!cabeNoDia && atual.paradas.length === 0) {
      alertasParada.push('⚠️ Sozinha já estoura o dia')
    }

    push(atual, p, chegada, saida, visita, t, anterior?.nome ?? 'Início', alertasParada)
    relogio = saida
    anterior = { coord: p, nome: nomeParada(p) }
  }
  fecharDia()

  if (foraDoPlano.length) {
    alertas.push(`${foraDoPlano.length} parada(s) não couberam em ${cfg.dias} dia(s). Aumente os dias ou reduza o tempo de visita.`)
  }
  if (semLoc.length) {
    alertas.push(`${semLoc.length} cliente(s) sem localização real (coordenada de estado) ficaram fora da rota. Confirme o endereço antes de fechar a viagem.`)
  }

  return {
    dias, foraDoPlano, semLocalizacao: semLoc,
    totalMetros: dias.reduce((s, d) => s + d.metros, 0),
    totalDeslocamentoSeg: dias.reduce((s, d) => s + d.deslocamentoSeg, 0),
    totalVisitaSeg: dias.reduce((s, d) => s + d.visitaSeg, 0),
    alertas,
    estimado: !algumReal,
  }
}

/**
 * Menor número de dias em que TUDO cabe (ou `teto`, se nem assim couber).
 * Existe porque o padrão de 1 dia joga quase tudo em `foraDoPlano` assim que o
 * usuário escolhe o segundo cliente — a feature parece quebrada quando na verdade
 * só falta aumentar os dias. A UI usa isso pra oferecer "caber em N dias".
 */
export function diasNecessarios(paradas: Parada[], cfg: ConfigViagem, teto = 60): number {
  if (!paradas.some(roteavel)) return cfg.dias
  for (let d = 1; d <= teto; d++) {
    if (programar(paradas, { ...cfg, dias: d }).foraDoPlano.length === 0) return d
  }
  return teto
}

function novoDia(n: number, cfg: ConfigViagem, inicio: number): DiaProgramado {
  return {
    dia: n, data: somarDias(cfg.dataInicio, n - 1), paradas: [],
    metros: 0, deslocamentoSeg: 0, visitaSeg: 0, inicio, fim: inicio,
  }
}

function push(
  d: DiaProgramado, p: Parada, chegada: number, saida: number,
  visita: number, t: Trecho, deQuem: string, alertas: string[],
) {
  d.paradas.push({
    parada: p, dia: d.dia, ordem: d.paradas.length + 1,
    chegada, saida, visitaMinutos: visita, trechoAnterior: t, deQuem, alertas,
  })
  d.metros += t.metros
  d.deslocamentoSeg += t.segundos
  d.visitaSeg += visita * 60
  d.fim = saida
}

export const chaveTrecho = (a: Coord, b: Coord) =>
  `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`

function trechoEntre(a: Coord, b: Coord, trechos: Map<string, Trecho> | undefined, _na: string, _nb: string): Trecho {
  const achado = trechos?.get(chaveTrecho(a, b))
  if (achado) return achado
  return estimarTrecho(a, b)
}

// ── formatação ───────────────────────────────────────────────────────────────

export const km = (metros: number) => `${(metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km`
export const dur = (segundos: number) => {
  const h = Math.floor(segundos / 3600), m = Math.round((segundos % 3600) / 60)
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`
}
export const durMin = (minutos: number) => dur(minutos * 60)
export const dataBRcurta = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'
export const diaSemana = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : ''

/**
 * Link do Google Maps com a rota do dia (origem → paradas → destino).
 * Uma parada só vira waypoint se NÃO estiver sendo usada como origem ou destino —
 * senão ela some do link (era o bug: dia com 1 parada + origem + retorno gerava
 * um trajeto origem→origem sem passar em ninguém).
 */
export function linkGoogleMaps(d: DiaProgramado, cfg: ConfigViagem): string {
  const pts = d.paradas.map(x => `${x.parada.lat},${x.parada.lng}`)
  if (!pts.length) return ''
  const volta = cfg.retornarOrigem ? cfg.origem : cfg.destino

  let origem: string, destino: string, meio: string[]
  if (cfg.origem) {
    origem = `${cfg.origem.lat},${cfg.origem.lng}`
    if (volta) { destino = `${volta.lat},${volta.lng}`; meio = pts }
    else { destino = pts[pts.length - 1]; meio = pts.slice(0, -1) }
  } else {
    origem = pts[0]
    if (volta) { destino = `${volta.lat},${volta.lng}`; meio = pts.slice(1) }
    else if (pts.length === 1) { destino = pts[0]; meio = [] }
    else { destino = pts[pts.length - 1]; meio = pts.slice(1, -1) }
  }

  const waypoints = meio.length ? `&waypoints=${meio.join('|')}` : ''
  return `https://www.google.com/maps/dir/?api=1&origin=${origem}&destination=${destino}${waypoints}&travelmode=driving`
}

/** §21 — resumo colável no WhatsApp. Texto puro, sem markdown que o WA quebre. */
export function resumoWhatsApp(prog: Programacao, cfg: ConfigViagem): string {
  const L: string[] = []
  L.push(`*${cfg.nome || 'Viagem de visitas'}*`)
  if (cfg.origem) L.push(`Saída: ${cfg.origem.nome}`)
  L.push(`${prog.dias.length} dia(s) · ${km(prog.totalMetros)} · ${dur(prog.totalDeslocamentoSeg)} dirigindo`)
  if (prog.estimado) L.push('_Distâncias estimadas (rota não calculada)_')
  L.push('')
  for (const d of prog.dias) {
    L.push(`*DIA ${d.dia}${d.data ? ` — ${dataBRcurta(d.data)} (${diaSemana(d.data)})` : ''}*`)
    L.push(`${d.paradas.length} parada(s) · ${km(d.metros)} · ${dur(d.deslocamentoSeg)} na estrada`)
    for (const x of d.paradas) {
      const p = x.parada
      L.push(`${x.ordem}. ${hhmmComDia(x.chegada)}–${hhmmComDia(x.saida)} · ${nomeParada(p)}`)
      const loc = [p.cidade, p.uf].filter(Boolean).join('/')
      const info = [loc, p.clientes[0]?.vendedor, p.clientes[0]?.telefone].filter(Boolean).join(' · ')
      if (info) L.push(`   ${info}`)
      if (p.precisao === 'cidade') L.push('   ⚠️ localização aproximada (centro da cidade)')
      if (p.tipo === 'cidade' && p.clientes.length > 1) {
        for (const c of p.clientes) L.push(`   - ${c.nome || '—'}${c.telefone ? ' · ' + c.telefone : ''}`)
      }
      if (x.trechoAnterior && x.trechoAnterior.metros > 0) {
        L.push(`   (${km(x.trechoAnterior.metros)} · ${dur(x.trechoAnterior.segundos)} desde ${x.deQuem})`)
      }
    }
    const link = linkGoogleMaps(d, cfg)
    if (link) L.push(`Rota do dia: ${link}`)
    L.push('')
  }
  if (prog.semLocalizacao.length) {
    L.push(`⚠️ ${prog.semLocalizacao.length} cliente(s) SEM localização real ficaram fora:`)
    for (const p of prog.semLocalizacao) L.push(`   - ${nomeParada(p)} (${[p.cidade, p.uf].filter(Boolean).join('/')})`)
    L.push('')
  }
  if (prog.foraDoPlano.length) {
    L.push(`⚠️ Não coube nos ${cfg.dias} dia(s): ${prog.foraDoPlano.map(nomeParada).join(', ')}`)
  }
  return L.join('\n').trim()
}

/** §14 — mensagem pro vendedor confirmar visita e mandar a localização. */
export function mensagemConfirmacao(p: Parada, cfg: ConfigViagem, dia: DiaProgramado | null, chegada: number | null): string {
  const vendedor = p.clientes[0]?.vendedor || 'você'
  const nomes = p.clientes.map(c => c.nome || '—')
  const quando = dia?.data ? `${dataBRcurta(dia.data)} (${diaSemana(dia.data)})` : 'em breve'
  const hora = chegada != null ? ` por volta das ${hhmmComDia(chegada)}` : ''
  const L: string[] = []
  L.push(`Oi ${vendedor}, tudo bem?`)
  L.push('')
  L.push(`Tô montando a *${cfg.nome || 'viagem de visitas'}* e ${nomes.length > 1 ? 'esses clientes estão' : 'esse cliente está'} na lista:`)
  for (const n of nomes) L.push(`• ${n}`)
  L.push('')
  L.push(`Cidade: ${[p.cidade, p.uf].filter(Boolean).join('/') || '—'}`)
  L.push(`Previsão de visita: ${quando}${hora}`)
  L.push('')
  L.push('Preciso de duas coisas:')
  L.push('1) Confirma se dá pra visitar nessa data?')
  L.push('2) Me manda a *localização exata* da propriedade — pode ser o link do Google Maps.')
  L.push('')
  L.push('O que eu tenho aqui é só o centro da cidade, então sem isso a rota sai errada.')
  L.push('Valeu!')
  return L.join('\n')
}
