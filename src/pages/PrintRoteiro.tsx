// Rota /print/roteiro — usada APENAS pelo Puppeteer server-side (api/gerar-pdf-roteiro.ts)
// pra renderizar o roteiro da viagem (§20 do spec) e imprimir como PDF vetorial A4.
//
// Mesmo mecanismo do /print/orcamento: os dados vêm injetados em
// window.__BRANORTE_ROTEIRO__ pelo Puppeteer via page.evaluateOnNewDocument()
// ANTES do navigate. Sem auth, sem chrome do app, tema claro forçado.
//
// Diferença relevante pro orçamento: aqui tem MAPA. O Leaflet é carregado por
// import dinâmico (não entra no bundle principal do app) e as tiles vêm do
// endpoint OFICIAL do OpenStreetMap — o {s}.google.com que a /mapa-visitas usa
// é endpoint não-oficial e não é confiável saindo de um servidor. Se as tiles
// não carregarem no prazo, o mapa NÃO some: o fundo cartográfico é descartado e
// sobram a polyline, os pinos e a legenda sobre um fundo neutro. O PDF nunca sai
// sem mapa.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type * as LeafletNS from 'leaflet'
import {
  PRECISAO_INFO,
  nomeParada,
  minParaHhmm,
  km,
  dur,
  dataBRcurta,
  diaSemana,
  somarDias,
  linkGoogleMaps,
  type ConfigViagem,
  type Programacao,
  type DiaProgramado,
  type ParadaProgramada,
  type Parada,
  type Confirmacao,
} from '@/lib/viagem'

/** Payload que o Puppeteer injeta em window.__BRANORTE_ROTEIRO__. */
export interface RoteiroPrintPayload {
  cfg: ConfigViagem
  prog: Programacao
  /** Quem viaja / quem assina o roteiro. */
  responsavel?: string | null
  /** ISO. Default: agora. */
  geradoEm?: string | null
  observacoes?: string | null
}

declare global {
  interface Window {
    __BRANORTE_ROTEIRO__?: RoteiroPrintPayload
    __BRANORTE_ROTEIRO_READY__?: boolean
  }
}

// ── constantes visuais ───────────────────────────────────────────────────────

/** Uma cor por dia. 8 tons bem separados — acima disso repete (viagem de 9+ dias é rara). */
const COR_DIA = ['#1d4ed8', '#dc2626', '#047857', '#b45309', '#6d28d9', '#0e7490', '#be185d', '#4d7c0f']
const corDia = (n: number) => COR_DIA[(Math.max(1, n) - 1) % COR_DIA.length]

/** Tamanho FIXO do mapa em px. Fixo de propósito: o Chrome relayouta a página na
 *  impressão e um mapa em % mudaria de tamanho DEPOIS do Leaflet já ter posicionado
 *  as tiles. 720px cabe na largura útil do A4 (200mm ≈ 756px a 96dpi). */
const MAPA_W = 720
const MAPA_H = 560

/** Orçamento de espera pelas tiles. Passou disso, imprime sem fundo cartográfico. */
const TILE_TIMEOUT_MS = 15000

const CENTRO_BR: [number, number] = [-15.6, -52.0]

const CONFIRMACAO_ROTULO: Record<Confirmacao, string> = {
  nao_solicitado: 'Não solicitado',
  aguardando_vendedor: 'Aguardando vendedor',
  aguardando_cliente: 'Aguardando cliente',
  localizacao_recebida: 'Localização recebida',
  visita_confirmada: 'Visita confirmada',
  indisponivel: 'Indisponível',
}

// ── helpers ──────────────────────────────────────────────────────────────────

const brl = (v: number | null | undefined) =>
  v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const cidadeUf = (p: Parada) => [p.cidade, p.uf].filter(Boolean).join('/') || '—'

/** Precisão 'cidade' = centroide do município. Tem que ficar marcado no papel. */
const aproximada = (p: Parada) => p.precisao === 'cidade'

const telefoneDe = (p: Parada) =>
  p.clientes.map(c => c.telefone || c.numeros).filter(Boolean)[0] || ''

function clientesUnicos(prog: Programacao): number {
  const s = new Set<string>()
  for (const d of prog.dias) for (const x of d.paradas) for (const c of x.parada.clientes) s.add(c.cliKey)
  return s.size
}

/** Hora em que saiu do ponto anterior — não dá pra derivar de chegada-deslocamento
 *  porque almoço e janela do cliente empurram a chegada. Vem da parada anterior. */
function saidaAnterior(dia: DiaProgramado, i: number): number {
  return i === 0 ? dia.inicio : dia.paradas[i - 1].saida
}

type LeafletModule = typeof LeafletNS

async function carregarLeaflet(): Promise<LeafletModule> {
  const mod = (await import('leaflet')) as unknown as { default?: LeafletModule }
  return mod.default ?? (mod as unknown as LeafletModule)
}

// ── mapa ─────────────────────────────────────────────────────────────────────

interface ResultadoMapa {
  /** false = tiles não carregaram; desenhamos só os vetores sobre fundo neutro. */
  tiles: boolean
}

async function montarMapa(
  div: HTMLDivElement,
  cfg: ConfigViagem,
  prog: Programacao,
): Promise<{ map: LeafletNS.Map; resultado: ResultadoMapa }> {
  const L = await carregarLeaflet()

  const map = L.map(div, {
    zoomControl: false,
    attributionControl: true,
    // Tudo desligado: é uma imagem estática num PDF, não um mapa navegável.
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    // Sem animação: animação em curso na hora do page.pdf() = tile meio transparente.
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
  }).setView(CENTRO_BR, 4)

  // Tiles OFICIAIS do OSM. Sem {s}: o host tile.openstreetmap.org já balanceia.
  // O Chrome do Puppeteer manda User-Agent de browser real, que é o que a política
  // de uso do OSM exige. Volume aqui é baixo (um PDF por vez).
  let tilesOk = 0
  let tilesErro = 0
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap',
  })
  tiles.on('tileload', () => { tilesOk++ })
  tiles.on('tileerror', () => { tilesErro++ })
  tiles.addTo(map)

  const volta = cfg.retornarOrigem ? cfg.origem : cfg.destino
  const pontos: LeafletNS.LatLngTuple[] = []
  const multiDia = prog.dias.length > 1

  // Trajeto + pinos, um grupo por dia
  for (const d of prog.dias) {
    const cor = corDia(d.dia)
    const seq: LeafletNS.LatLngTuple[] = []
    if (cfg.origem) seq.push([cfg.origem.lat, cfg.origem.lng])
    for (const x of d.paradas) seq.push([x.parada.lat, x.parada.lng])
    if (volta) seq.push([volta.lat, volta.lng])
    pontos.push(...seq)

    if (seq.length > 1) {
      L.polyline(seq, {
        color: cor,
        weight: 3,
        opacity: 0.85,
        // Tracejado quando nenhum trecho veio de rota real — o desenho não pode
        // sugerir precisão que o dado não tem.
        dashArray: prog.estimado ? '7 5' : undefined,
      }).addTo(map)
    }

    for (const x of d.paradas) {
      const rotulo = multiDia ? `${d.dia}.${x.ordem}` : String(x.ordem)
      L.marker([x.parada.lat, x.parada.lng], {
        icon: pinoNumerado(L, cor, rotulo, aproximada(x.parada)),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(map)
    }
  }

  if (cfg.origem) {
    L.marker([cfg.origem.lat, cfg.origem.lng], {
      icon: pinoFixo(L, '#111827', 'A'),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(map)
    pontos.push([cfg.origem.lat, cfg.origem.lng])
  }
  if (volta && (!cfg.origem || volta.lat !== cfg.origem.lat || volta.lng !== cfg.origem.lng)) {
    L.marker([volta.lat, volta.lng], {
      icon: pinoFixo(L, '#111827', 'B'),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(map)
    pontos.push([volta.lat, volta.lng])
  }

  map.invalidateSize()
  if (pontos.length >= 2) {
    map.fitBounds(L.latLngBounds(pontos), { padding: [30, 30], maxZoom: 13 })
  } else if (pontos.length === 1) {
    map.setView(pontos[0], 11)
  }

  // Espera as tiles. NÃO dá pra usar o evento 'load' do Leaflet como veredito:
  // ele dispara mesmo quando TODAS as tiles falharam (o Leaflet conta a tile como
  // "pronta" tanto no load quanto no error) e pode disparar pro viewport inicial,
  // antes do fitBounds. Então o critério é a contagem ficar estável: 3 leituras
  // seguidas sem tile nova (~900ms de silêncio) = acabou de baixar.
  await new Promise<void>(resolve => {
    const inicio = Date.now()
    let anterior = -1
    let estaveis = 0
    const timer = setInterval(() => {
      const total = tilesOk + tilesErro
      if (total > 0 && total === anterior) estaveis++
      else { estaveis = 0; anterior = total }
      if (estaveis >= 3 || Date.now() - inicio > TILE_TIMEOUT_MS) {
        clearInterval(timer)
        resolve()
      }
    }, 300)
  })

  const ok = tilesOk > 0
  if (!ok) {
    // Sem fundo cartográfico: tira a camada (senão sobram ícones de imagem quebrada)
    // e liga o fundo neutro. Polyline e pinos continuam desenhados.
    map.removeLayer(tiles)
    div.classList.add('mapa-sem-tiles')
  }
  // respiro pro paint final das tiles já baixadas
  await new Promise<void>(r => setTimeout(r, 350))

  return { map, resultado: { tiles: ok } }
}

function pinoNumerado(L: LeafletModule, cor: string, texto: string, aprox: boolean): LeafletNS.DivIcon {
  const anel = aprox ? 'box-shadow:0 0 0 2px #fff,0 0 0 5px #d97706;' : 'box-shadow:0 0 0 2px #fff;'
  return L.divIcon({
    className: 'pino-roteiro',
    html:
      `<div style="width:24px;height:24px;border-radius:50%;background:${cor};` +
      `${anel}display:flex;align-items:center;justify-content:center;` +
      `color:#fff;font-size:11px;font-weight:700;line-height:1;letter-spacing:-.2px;">${texto}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

function pinoFixo(L: LeafletModule, cor: string, texto: string): LeafletNS.DivIcon {
  return L.divIcon({
    className: 'pino-roteiro',
    html:
      `<div style="width:26px;height:26px;border-radius:5px;background:${cor};` +
      `box-shadow:0 0 0 2px #fff;display:flex;align-items:center;justify-content:center;` +
      `color:#fff;font-size:12px;font-weight:700;line-height:1;">${texto}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

// ── página ───────────────────────────────────────────────────────────────────

export default function PrintRoteiro() {
  const [payload, setPayload] = useState<RoteiroPrintPayload | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [mapaTiles, setMapaTiles] = useState<boolean | null>(null)
  const mapaRef = useRef<HTMLDivElement | null>(null)
  const jaMontou = useRef(false)
  const mapaInstancia = useRef<LeafletNS.Map | null>(null)

  // FORÇA LIGHT MODE (mesma razão do PrintOrcamento: com .dark no <html> as
  // margens da folha saem pretas) + Carlito, que é metric-compatible com Calibri
  // e existe no Linux do Vercel.
  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = 'light'
    document.documentElement.style.background = '#ffffff'
    document.body.style.background = '#ffffff'
    if (!document.getElementById('carlito-font-link')) {
      const link = document.createElement('link')
      link.id = 'carlito-font-link'
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=block'
      document.head.appendChild(link)
    }
  }, [])

  // Lê o payload injetado (polling por 5s, igual /print/orcamento)
  useEffect(() => {
    let tentativas = 0
    let vivo = true
    const tick = () => {
      if (!vivo) return
      const data = window.__BRANORTE_ROTEIRO__
      if (data) {
        if (!data.cfg || !data.prog || !Array.isArray(data.prog.dias)) {
          setErro('Payload inválido: esperado { cfg, prog }')
          return
        }
        setPayload(data)
        return
      }
      if (++tentativas > 50) {
        setErro('window.__BRANORTE_ROTEIRO__ não foi injetado em 5s')
        return
      }
      setTimeout(tick, 100)
    }
    tick()
    return () => { vivo = false }
  }, [])

  // Mapa
  //
  // NÃO existe cleanup destrutivo aqui, e o setMapaTiles NÃO é guardado por um
  // flag "vivo". Isso é deliberado — o <React.StrictMode> do main.tsx monta o
  // efeito, roda o cleanup e monta de novo:
  //
  //   efeito #1  → jaMontou=true, montarMapa() dispara (assíncrono: import do
  //                Leaflet + espera das tiles, ~1-15s)
  //   cleanup #1 → apagaria o mapa e marcaria vivo=false — só que `mapa` ainda
  //                é null, porque a promise não resolveu
  //   efeito #2  → early-return no jaMontou, não remonta nada
  //   promise    → resolve com o `vivo` do closure #1, que já é false
  //                → setMapaTiles NUNCA roda → mapaTiles fica null
  //                → o efeito de READY abaixo nunca libera a flag
  //                → o Puppeteer estoura os 30s e o endpoint devolve 500.
  //
  // O StrictMode não recria o nó do DOM, então o mapa montado no efeito #1 segue
  // válido e o jaMontou já garante que L.map() não roda duas vezes no mesmo div
  // ("Map container is already initialized"). A instância fica no ref só para
  // quem precisar liberá-la; nesta rota a página é descartada pelo Puppeteer.
  useEffect(() => {
    if (!payload || !mapaRef.current || jaMontou.current) return
    jaMontou.current = true
    const div = mapaRef.current

    montarMapa(div, payload.cfg, payload.prog)
      .then(({ map, resultado }) => {
        mapaInstancia.current = map
        setMapaTiles(resultado.tiles)
      })
      .catch(e => {
        // Leaflet quebrou por completo: registra e segue — o resto do PDF vale mais
        // do que a página inteira falhar por causa do mapa.
        console.error('[print-roteiro] mapa falhou', e)
        div.classList.add('mapa-sem-tiles')
        setMapaTiles(false)
      })
  }, [payload])

  // Sinaliza pro Puppeteer: dados + mapa resolvido + fontes + imagens.
  useEffect(() => {
    if (!payload || mapaTiles === null) return
    Promise.all([
      document.fonts?.ready,
      ...Array.from(document.images).map(img => {
        if (img.complete) return Promise.resolve()
        return new Promise<void>(resolve => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        })
      }),
    ]).then(() => {
      setTimeout(() => { window.__BRANORTE_ROTEIRO_READY__ = true }, 250)
    })
  }, [payload, mapaTiles])

  if (erro) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#dc2626' }}>{erro}</div>
  }
  if (!payload) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Aguardando dados do roteiro…</div>
  }

  const { cfg, prog } = payload
  const multiDia = prog.dias.length > 1
  const fimPeriodo = somarDias(cfg.dataInicio, Math.max(0, cfg.dias - 1))
  const volta = cfg.retornarOrigem ? cfg.origem : cfg.destino
  const totalClientes = clientesUnicos(prog)
  const todasParadas = prog.dias.flatMap(d => d.paradas)
  const aprox = todasParadas.filter(x => aproximada(x.parada))
  const naoConfirmadas = todasParadas.filter(x => x.parada.confirmacao !== 'visita_confirmada')
  const alertasParada = todasParadas.filter(x => x.alertas.length > 0)
  const geradoEm = payload.geradoEm ? new Date(payload.geradoEm) : new Date()

  return (
    <div className="roteiro">
      <style>{estilos}</style>

      {/* ══════════════════════ CAPA ══════════════════════ */}
      <section className="secao">
        <div className="capa-logo">
          <img src="/branorte-logo.png" alt="BRANORTE" width={305} height={48}
               style={{ display: 'inline-block', width: 305, height: 48 }} crossOrigin="anonymous" />
        </div>

        <div className="capa-titulo">
          <div className="capa-kicker">Roteiro de viagem comercial</div>
          <h1>{cfg.nome || 'Viagem de visitas'}</h1>
          <div className="capa-sub">
            {payload.responsavel ? <>Responsável: <b>{payload.responsavel}</b> · </> : null}
            Emitido em {geradoEm.toLocaleDateString('pt-BR')} às{' '}
            {geradoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <table className="ficha">
          <tbody>
            <tr>
              <th>Período</th>
              <td>
                {cfg.dataInicio
                  ? <>{dataBRcurta(cfg.dataInicio)} a {dataBRcurta(fimPeriodo)}</>
                  : <span className="fraco">sem data definida</span>}
                {' · '}{cfg.dias} dia{cfg.dias > 1 ? 's' : ''} planejado{cfg.dias > 1 ? 's' : ''}
              </td>
              <th>Jornada</th>
              <td>
                {cfg.horaInicio}–{cfg.horaFim}
                {cfg.almocoInicio ? ` · almoço ${cfg.almocoInicio} (${cfg.almocoMinutos} min)` : ''}
              </td>
            </tr>
            <tr>
              <th>Origem</th>
              <td>{cfg.origem?.nome || <span className="fraco">não definida</span>}</td>
              <th>{cfg.retornarOrigem ? 'Retorno' : 'Destino final'}</th>
              <td>{volta?.nome || <span className="fraco">não definido</span>}</td>
            </tr>
            <tr>
              <th>Modo</th>
              <td>{cfg.modo === 'otimizar' ? 'Ordem otimizada' : 'Ordem manual'}</td>
              <th>Visita padrão</th>
              <td>{cfg.visitaMinutosPadrao} min por cliente</td>
            </tr>
          </tbody>
        </table>

        <div className="kpis">
          <div className="kpi"><span className="kpi-v">{totalClientes}</span><span className="kpi-l">clientes</span></div>
          <div className="kpi"><span className="kpi-v">{todasParadas.length}</span><span className="kpi-l">paradas</span></div>
          <div className="kpi"><span className="kpi-v">{prog.dias.length}</span><span className="kpi-l">dias com rota</span></div>
          <div className="kpi"><span className="kpi-v">{km(prog.totalMetros)}</span><span className="kpi-l">distância total</span></div>
          <div className="kpi"><span className="kpi-v">{dur(prog.totalDeslocamentoSeg)}</span><span className="kpi-l">dirigindo</span></div>
          <div className="kpi"><span className="kpi-v">{dur(prog.totalVisitaSeg)}</span><span className="kpi-l">em visitas</span></div>
        </div>

        {prog.estimado && (
          <div className="aviso aviso-amb">
            <b>Distâncias e horários são ESTIMADOS.</b> Nenhum trecho foi calculado por
            rota real — os números vêm de distância em linha reta com fator de estrada
            e velocidade média. Use como ordem de grandeza, não como promessa de horário.
          </div>
        )}
        {aprox.length > 0 && (
          <div className="aviso aviso-amb">
            <b>{aprox.length} parada{aprox.length > 1 ? 's têm' : ' tem'} localização APROXIMADA</b> (centro
            da cidade, não o endereço do cliente). Estão marcadas com <span className="tag tag-aprox">APROX.</span> no
            roteiro. Confirme o ponto exato com o vendedor antes de sair.
          </div>
        )}
        {prog.semLocalizacao.length > 0 && (
          <div className="aviso aviso-vermelho">
            <b>{prog.semLocalizacao.length} cliente{prog.semLocalizacao.length > 1 ? 's ficaram' : ' ficou'} FORA
            da rota</b> por não ter localização real (só a coordenada do estado). Lista no resumo.
          </div>
        )}
        {prog.foraDoPlano.length > 0 && (
          <div className="aviso aviso-vermelho">
            <b>{prog.foraDoPlano.length} parada{prog.foraDoPlano.length > 1 ? 's não couberam' : ' não coube'}</b> nos{' '}
            {cfg.dias} dia{cfg.dias > 1 ? 's' : ''} planejados. Lista no resumo.
          </div>
        )}
        {payload.observacoes && (
          <div className="obs-capa"><b>Observações:</b> {payload.observacoes}</div>
        )}
      </section>

      {/* ══════════════════════ MAPA ══════════════════════ */}
      <section className="secao quebra">
        <h2 className="h-secao">Mapa do trajeto</h2>

        <div className="mapa-wrap">
          <div ref={mapaRef} className="mapa" style={{ width: MAPA_W, height: MAPA_H }} />
          {mapaTiles === false && (
            <div className="mapa-nota">
              Fundo cartográfico indisponível na geração — o trajeto e as paradas
              estão desenhados em escala sobre fundo neutro.
            </div>
          )}
        </div>

        <div className="legenda">
          <div className="legenda-linha">
            <span className="lg lg-fixo">A</span> ponto de partida
            {volta && <><span className="lg lg-fixo">B</span> {cfg.retornarOrigem ? 'retorno' : 'destino final'}</>}
            <span className="lg lg-aprox">n</span> parada com localização aproximada
            {prog.estimado && <span className="lg-traco" />}
            {prog.estimado && <span>trajeto estimado (sem rota real)</span>}
          </div>
          <div className="legenda-linha">
            {prog.dias.map(d => (
              <span key={d.dia} className="legenda-dia">
                <i style={{ background: corDia(d.dia) }} />
                Dia {d.dia}{d.data ? ` · ${dataBRcurta(d.data)}` : ''} ({d.paradas.length})
              </span>
            ))}
          </div>
          <div className="legenda-nota">
            Os pinos trazem {multiDia ? 'dia.ordem' : 'a ordem'} de visita.
            Clientes sem localização real não aparecem no mapa.
          </div>
        </div>
      </section>

      {/* ══════════════════ PROGRAMAÇÃO DIÁRIA ══════════════════ */}
      <section className="secao quebra">
        <h2 className="h-secao">Programação diária</h2>
        {prog.dias.length === 0 && <p className="fraco">Nenhuma parada programada.</p>}
        {prog.dias.map(d => (
          <BlocoDia key={d.dia} dia={d} cfg={cfg} />
        ))}
      </section>

      {/* ══════════════════════ RESUMO ══════════════════════ */}
      <section className="secao quebra">
        <h2 className="h-secao">Resumo da viagem</h2>

        <table className="tab">
          <thead>
            <tr>
              <th>Dia</th><th>Data</th><th className="num">Paradas</th><th className="num">Clientes</th>
              <th className="num">Km</th><th className="num">Dirigindo</th><th className="num">Visitas</th>
              <th className="num">Início</th><th className="num">Fim</th>
            </tr>
          </thead>
          <tbody>
            {prog.dias.map(d => {
              const cl = new Set<string>()
              d.paradas.forEach(x => x.parada.clientes.forEach(c => cl.add(c.cliKey)))
              return (
                <tr key={d.dia}>
                  <td><span className="bolinha" style={{ background: corDia(d.dia) }} />Dia {d.dia}</td>
                  <td>{d.data ? `${dataBRcurta(d.data)} (${diaSemana(d.data)})` : '—'}</td>
                  <td className="num">{d.paradas.length}</td>
                  <td className="num">{cl.size}</td>
                  <td className="num">{km(d.metros)}</td>
                  <td className="num">{dur(d.deslocamentoSeg)}</td>
                  <td className="num">{dur(d.visitaSeg)}</td>
                  <td className="num">{minParaHhmm(d.inicio)}</td>
                  <td className="num">{minParaHhmm(d.fim)}</td>
                </tr>
              )
            })}
            <tr className="total">
              <td colSpan={2}>TOTAL</td>
              <td className="num">{todasParadas.length}</td>
              <td className="num">{totalClientes}</td>
              <td className="num">{km(prog.totalMetros)}</td>
              <td className="num">{dur(prog.totalDeslocamentoSeg)}</td>
              <td className="num">{dur(prog.totalVisitaSeg)}</td>
              <td className="num" colSpan={2}>—</td>
            </tr>
          </tbody>
        </table>
        {prog.estimado && <p className="rodape-tab">Distâncias e tempos estimados (nenhuma rota real calculada).</p>}

        <h3 className="h-sub">Confirmação das visitas</h3>
        {naoConfirmadas.length === 0 ? (
          <p className="ok">Todas as {todasParadas.length} paradas estão com visita confirmada.</p>
        ) : (
          <table className="tab">
            <thead>
              <tr><th>Parada</th><th>Cidade/UF</th><th>Vendedor</th><th>WhatsApp</th><th>Situação</th><th>Localização</th></tr>
            </thead>
            <tbody>
              {naoConfirmadas.map(x => (
                <tr key={x.parada.id}>
                  <td>{nomeParada(x.parada)}</td>
                  <td>{cidadeUf(x.parada)}</td>
                  <td>{x.parada.clientes[0]?.vendedor || '—'}</td>
                  <td className="tel">{telefoneDe(x.parada) || '—'}</td>
                  <td>{CONFIRMACAO_ROTULO[x.parada.confirmacao]}</td>
                  <td>{PRECISAO_INFO[x.parada.precisao].rotulo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {aprox.length > 0 && (
          <>
            <h3 className="h-sub">Paradas com localização aproximada</h3>
            <p className="fraco mini">
              Coordenada = centro do município. O deslocamento até o cliente dentro da cidade
              NÃO está contabilizado nos horários abaixo.
            </p>
            <table className="tab">
              <thead><tr><th>Dia</th><th>Parada</th><th>Cidade/UF</th><th>Vendedor</th><th>WhatsApp</th></tr></thead>
              <tbody>
                {aprox.map(x => (
                  <tr key={x.parada.id}>
                    <td>Dia {x.dia} · {x.ordem}</td>
                    <td>{nomeParada(x.parada)}</td>
                    <td>{cidadeUf(x.parada)}</td>
                    <td>{x.parada.clientes[0]?.vendedor || '—'}</td>
                    <td className="tel">{telefoneDe(x.parada) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {prog.semLocalizacao.length > 0 && (
          <>
            <h3 className="h-sub h-vermelho">Fora da rota — sem localização real</h3>
            <p className="fraco mini">
              A única coordenada disponível é a do estado. Não dá pra roteirizar sem chutar.
              Peça a localização exata ao vendedor e recalcule a viagem.
            </p>
            <table className="tab tab-vermelha">
              <thead><tr><th>Cliente / parada</th><th>Cidade/UF</th><th>Vendedor</th><th>WhatsApp</th><th>Precisão</th></tr></thead>
              <tbody>
                {prog.semLocalizacao.map(p => (
                  <tr key={p.id}>
                    <td>{nomeParada(p)}</td>
                    <td>{cidadeUf(p)}</td>
                    <td>{p.clientes[0]?.vendedor || '—'}</td>
                    <td className="tel">{telefoneDe(p) || '—'}</td>
                    <td>{PRECISAO_INFO[p.precisao].rotulo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {prog.foraDoPlano.length > 0 && (
          <>
            <h3 className="h-sub h-vermelho">Não coube no plano</h3>
            <table className="tab tab-vermelha">
              <thead><tr><th>Parada</th><th>Cidade/UF</th><th>Vendedor</th><th>WhatsApp</th></tr></thead>
              <tbody>
                {prog.foraDoPlano.map(p => (
                  <tr key={p.id}>
                    <td>{nomeParada(p)}</td>
                    <td>{cidadeUf(p)}</td>
                    <td>{p.clientes[0]?.vendedor || '—'}</td>
                    <td className="tel">{telefoneDe(p) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {(prog.alertas.length > 0 || alertasParada.length > 0) && (
          <>
            <h3 className="h-sub">Alertas</h3>
            <ul className="alertas">
              {prog.alertas.map((a, i) => <li key={`g${i}`}>{a}</li>)}
              {alertasParada.map(x =>
                x.alertas.map((a, i) => (
                  <li key={`${x.parada.id}-${i}`}>
                    <b>Dia {x.dia} · parada {x.ordem} ({nomeParada(x.parada)}):</b> {a}
                  </li>
                )),
              )}
            </ul>
          </>
        )}
      </section>

      {/* ══════════════════ ACESSO DIGITAL ══════════════════ */}
      <section className="secao quebra">
        <h2 className="h-secao">Acesso digital · rota no Google Maps</h2>
        <p className="fraco mini">
          Um link por dia, já com origem, paradas na ordem e retorno. Abra pelo celular
          para navegar com trânsito em tempo real.
        </p>
        {prog.dias.map(d => {
          const link = linkGoogleMaps(d, cfg)
          return (
            <div key={d.dia} className="link-dia">
              <div className="link-cab">
                <span className="bolinha" style={{ background: corDia(d.dia) }} />
                <b>Dia {d.dia}</b>
                {d.data ? ` · ${dataBRcurta(d.data)} (${diaSemana(d.data)})` : ''}
                {' · '}{d.paradas.length} parada{d.paradas.length > 1 ? 's' : ''} · {km(d.metros)}
              </div>
              {link
                ? <div className="link-url">{link}</div>
                : <div className="fraco mini">Sem paradas roteáveis neste dia.</div>}
            </div>
          )
        })}
        <p className="rodape-tab">
          O link do Google Maps aceita até 10 pontos por rota. Dias com mais paradas
          podem precisar ser abertos em duas partes.
        </p>
      </section>
    </div>
  )
}

// ── bloco de um dia na programação ───────────────────────────────────────────

function BlocoDia({ dia, cfg }: { dia: DiaProgramado; cfg: ConfigViagem }) {
  const cor = corDia(dia.dia)
  const clientes = new Set<string>()
  dia.paradas.forEach(x => x.parada.clientes.forEach(c => clientes.add(c.cliKey)))
  const volta = cfg.retornarOrigem ? cfg.origem : cfg.destino

  return (
    <div className="dia">
      <div className="dia-cab" style={{ borderLeftColor: cor }}>
        <div className="dia-titulo">
          <span className="bolinha" style={{ background: cor }} />
          DIA {dia.dia}
          {dia.data ? <span className="dia-data"> · {dataBRcurta(dia.data)} ({diaSemana(dia.data)})</span> : null}
        </div>
        <div className="dia-metricas">
          {minParaHhmm(dia.inicio)}–{minParaHhmm(dia.fim)} · {dia.paradas.length} parada
          {dia.paradas.length > 1 ? 's' : ''} · {clientes.size} cliente{clientes.size > 1 ? 's' : ''} ·{' '}
          {km(dia.metros)} · {dur(dia.deslocamentoSeg)} dirigindo · {dur(dia.visitaSeg)} em visita
        </div>
      </div>

      <table className="tab tab-prog">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Sai</th>
            <th>Deslocamento</th>
            <th>Chega</th>
            <th>Cliente / parada</th>
            <th>Cidade / UF</th>
            <th>Visita</th>
            <th>Sai daqui</th>
          </tr>
        </thead>
        {dia.paradas.map((x, i) => (
          <LinhaParada key={x.parada.id} x={x} saiu={saidaAnterior(dia, i)} />
        ))}
        {volta && dia.paradas.length > 0 && (
          <tbody className="grupo">
            <tr className="linha-volta">
              <td>↩</td>
              <td>{minParaHhmm(dia.paradas[dia.paradas.length - 1].saida)}</td>
              <td>—</td>
              <td>{minParaHhmm(dia.fim)}</td>
              <td colSpan={4}>
                {cfg.retornarOrigem ? 'Retorno a ' : 'Destino final: '}<b>{volta.nome}</b>
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  )
}

function LinhaParada({ x, saiu }: { x: ParadaProgramada; saiu: number }) {
  const p = x.parada
  const t = x.trechoAnterior
  const c0 = p.clientes[0]
  const tel = telefoneDe(p)
  const info = PRECISAO_INFO[p.precisao]
  const multi = p.tipo === 'cidade' && p.clientes.length > 1

  return (
    <tbody className={`grupo${aproximada(p) ? ' grupo-aprox' : ''}`}>
      <tr className="linha-a">
        <td className="num">{x.ordem}</td>
        <td className="num">{minParaHhmm(saiu)}</td>
        <td className="num">
          {t && t.metros > 0 ? <>{km(t.metros)} · {dur(t.segundos)}</> : '—'}
        </td>
        <td className="num forte">{minParaHhmm(x.chegada)}</td>
        <td>
          <b>{nomeParada(p)}</b>
          {aproximada(p) && <span className="tag tag-aprox">APROX.</span>}
          {p.endereco && <div className="mini fraco">{p.endereco}</div>}
        </td>
        <td>{cidadeUf(p)}</td>
        <td className="num">{x.visitaMinutos} min</td>
        <td className="num forte">{minParaHhmm(x.saida)}</td>
      </tr>
      <tr className="linha-b">
        <td />
        <td colSpan={7}>
          <div className="detalhes">
            <span><i>Vendedor:</i> {c0?.vendedor || '—'}</span>
            <span><i>WhatsApp:</i> <span className="tel">{tel || '—'}</span></span>
            <span><i>Localização:</i> {info.rotulo}</span>
            <span><i>Confirmação:</i> {CONFIRMACAO_ROTULO[p.confirmacao]}</span>
            {c0?.equipamento && <span><i>Equipamento:</i> {c0.equipamento}</span>}
            {c0?.valor != null && <span><i>Valor:</i> {brl(c0.valor)}</span>}
            {p.janelaInicio || p.janelaFim
              ? <span><i>Janela:</i> {p.janelaInicio || '—'}–{p.janelaFim || '—'}</span>
              : null}
          </div>
          {multi && (
            <div className="clientes-parada">
              <i>Clientes nesta cidade:</i>
              <ul>
                {p.clientes.map(c => (
                  <li key={c.cliKey}>
                    {c.nome || '—'}
                    {c.telefone || c.numeros ? <span className="tel"> · {c.telefone || c.numeros}</span> : null}
                    {c.vendedor ? ` · ${c.vendedor}` : ''}
                    {c.valor != null ? ` · ${brl(c.valor)}` : ''}
                    {c.vendido ? <span className="tag tag-ok">JÁ COMPROU</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aproximada(p) && (
            <div className="nota-aprox">
              Localização aproximada: a coordenada é o centro de {cidadeUf(p)}, não o endereço
              do cliente. Confirme o ponto exato antes de sair.
            </div>
          )}
          {p.notas && <div className="notas"><i>Observações:</i> {p.notas}</div>}
          {x.alertas.length > 0 && (
            <div className="alertas-linha">{x.alertas.map((a, i) => <span key={i}>{a}</span>)}</div>
          )}
        </td>
      </tr>
    </tbody>
  )
}

// ── CSS de impressão ─────────────────────────────────────────────────────────
// Tudo em classe própria (nada de Tailwind) pra não depender do purge nem de
// variável de tema — esta página é renderizada fora do app, num Chrome headless.

const estilos = `
@import url('https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap');

html, body {
  background: #ffffff !important;
  color: #111827 !important;
  color-scheme: light !important;
  font-family: 'Carlito', 'Calibri', 'Segoe UI', sans-serif !important;
  margin: 0;
}
@page { size: A4; margin: 8mm 8mm 14mm 8mm; background: #ffffff; }

.roteiro { font-size: 9.5pt; line-height: 1.35; color: #111827; }
.roteiro b { font-weight: 700; }
.secao { }
.quebra { break-before: page; page-break-before: always; }

/* ---- capa ---- */
.capa-logo { text-align: center; margin: 4mm 0 6mm; }
.capa-titulo { text-align: center; border-top: 2px solid #111827; border-bottom: 2px solid #111827; padding: 4mm 0; margin-bottom: 5mm; }
.capa-kicker { font-size: 9pt; letter-spacing: 2px; text-transform: uppercase; color: #6b7280; }
.capa-titulo h1 { font-size: 22pt; margin: 2mm 0 1mm; font-weight: 700; letter-spacing: -.3px; }
.capa-sub { font-size: 9pt; color: #4b5563; }

.ficha { width: 100%; border-collapse: collapse; margin-bottom: 5mm; font-size: 9.5pt; }
.ficha th, .ficha td { border: 1px solid #d1d5db; padding: 2mm 2.5mm; text-align: left; vertical-align: top; }
.ficha th { background: #f3f4f6; width: 14%; font-weight: 700; white-space: nowrap; }

.kpis { display: flex; gap: 2mm; margin-bottom: 5mm; }
.kpi { flex: 1; border: 1px solid #d1d5db; border-top: 3px solid #111827; padding: 2.5mm 2mm; text-align: center; }
.kpi-v { display: block; font-size: 14pt; font-weight: 700; line-height: 1.1; }
.kpi-l { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; margin-top: 1mm; }

.aviso { border-left: 4px solid; padding: 2.5mm 3mm; margin-bottom: 3mm; font-size: 9pt; }
.aviso-amb { border-color: #d97706; background: #fffbeb; }
.aviso-vermelho { border-color: #dc2626; background: #fef2f2; }
.obs-capa { border: 1px solid #d1d5db; padding: 2.5mm 3mm; font-size: 9pt; margin-top: 3mm; }

/* ---- seções ---- */
.h-secao { font-size: 13pt; font-weight: 700; border-bottom: 2px solid #111827; padding-bottom: 1.5mm; margin: 0 0 4mm; }
.h-sub { font-size: 10.5pt; font-weight: 700; margin: 6mm 0 2mm; }
.h-vermelho { color: #b91c1c; }
.fraco { color: #6b7280; }
.mini { font-size: 8.5pt; }
.ok { color: #047857; font-size: 9pt; }
.rodape-tab { font-size: 8pt; color: #6b7280; margin-top: 1.5mm; }

/* ---- mapa ---- */
.mapa-wrap { text-align: center; }
.mapa { margin: 0 auto; border: 1.5px solid #111827; max-width: 100%; }
.leaflet-container { background: #eef2f7; font-family: 'Carlito', sans-serif; }
.mapa-sem-tiles {
  background: #eef2f7 !important;
  background-image:
    linear-gradient(#dde5ef 1px, transparent 1px),
    linear-gradient(90deg, #dde5ef 1px, transparent 1px) !important;
  background-size: 40px 40px !important;
}
.mapa-sem-tiles .leaflet-tile-pane { display: none !important; }
.mapa-nota { font-size: 8pt; color: #b45309; margin-top: 1.5mm; }
.leaflet-control-attribution { font-size: 7pt !important; background: rgba(255,255,255,.8) !important; }
.pino-roteiro { background: none; border: 0; }

.legenda { margin-top: 3mm; border: 1px solid #d1d5db; padding: 2.5mm 3mm; font-size: 8.5pt; }
.legenda-linha { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 4mm; margin-bottom: 1.5mm; }
.legenda-dia { display: inline-flex; align-items: center; gap: 1.5mm; }
.legenda-dia i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.lg { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; font-size: 7.5pt; font-weight: 700; color: #fff; margin-right: 1mm; }
.lg-fixo { background: #111827; border-radius: 3px; }
.lg-aprox { background: #6b7280; border-radius: 50%; box-shadow: 0 0 0 1px #fff, 0 0 0 3px #d97706; }
.lg-traco { display: inline-block; width: 22px; border-top: 2px dashed #6b7280; }
.legenda-nota { color: #6b7280; }

/* ---- tabelas ---- */
.tab { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
.tab th, .tab td { border: 1px solid #d1d5db; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
.tab thead th { background: #111827; color: #fff; font-weight: 700; font-size: 8pt; text-transform: uppercase; letter-spacing: .3px; }
.tab thead { display: table-header-group; }
.tab .num { text-align: right; white-space: nowrap; }
.tab .forte { font-weight: 700; }
.tab .total td { background: #f3f4f6; font-weight: 700; }
.tab-vermelha thead th { background: #b91c1c; }
.tel { white-space: nowrap; font-variant-numeric: tabular-nums; }
.bolinha { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 1.5mm; vertical-align: middle; }

/* ---- programação ---- */
.dia { margin-bottom: 6mm; }
.dia-cab { border-left: 5px solid #111827; background: #f9fafb; padding: 2mm 3mm; margin-bottom: 1.5mm; break-after: avoid; page-break-after: avoid; }
.dia-titulo { font-size: 11pt; font-weight: 700; }
.dia-data { font-weight: 400; color: #4b5563; font-size: 10pt; }
.dia-metricas { font-size: 8.5pt; color: #4b5563; margin-top: .5mm; }

.tab-prog tbody.grupo { break-inside: avoid; page-break-inside: avoid; }
.tab-prog tbody.grupo-aprox .linha-a td:first-child { box-shadow: inset 3px 0 0 #d97706; }
.tab-prog .linha-a td { border-bottom-width: 0; }
.tab-prog .linha-b td { border-top-width: 0; padding-top: 0; font-size: 8pt; color: #374151; }
.tab-prog .linha-b td:first-child { border-right-width: 1px; }
.linha-volta td { background: #f9fafb; color: #4b5563; font-size: 8pt; }

.detalhes { display: flex; flex-wrap: wrap; gap: .5mm 4mm; }
.detalhes i, .clientes-parada i, .notas i { font-style: normal; color: #6b7280; }
.clientes-parada { margin-top: 1mm; }
.clientes-parada ul { margin: .5mm 0 0; padding-left: 5mm; }
.clientes-parada li { margin-bottom: .3mm; }
.notas { margin-top: 1mm; }
.nota-aprox { margin-top: 1mm; color: #92400e; background: #fffbeb; border-left: 3px solid #d97706; padding: 1mm 2mm; }
.alertas-linha { margin-top: 1mm; display: flex; flex-direction: column; gap: .3mm; color: #b91c1c; font-weight: 700; }

.tag { display: inline-block; font-size: 7pt; font-weight: 700; padding: 0 1.2mm; border-radius: 2px; margin-left: 1.5mm; vertical-align: middle; letter-spacing: .3px; }
.tag-aprox { background: #fef3c7; color: #92400e; border: 1px solid #d97706; }
.tag-ok { background: #d1fae5; color: #065f46; border: 1px solid #047857; }

.alertas { margin: 0; padding-left: 5mm; font-size: 8.5pt; }
.alertas li { margin-bottom: 1mm; }

/* ---- links ---- */
.link-dia { border: 1px solid #d1d5db; padding: 2.5mm 3mm; margin-bottom: 2.5mm; break-inside: avoid; page-break-inside: avoid; }
.link-cab { font-size: 9.5pt; margin-bottom: 1.5mm; }
.link-url { font-family: 'Consolas', 'Courier New', monospace; font-size: 7.5pt; color: #1d4ed8; word-break: break-all; background: #f9fafb; border: 1px solid #e5e7eb; padding: 1.5mm 2mm; }

/* Nunca deixar a página rolar na horizontal na impressão */
.roteiro, .roteiro * { box-sizing: border-box; }
`
