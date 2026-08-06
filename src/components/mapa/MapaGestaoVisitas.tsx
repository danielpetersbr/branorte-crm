import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { alertasDe, estadoDaVisita, PESO_ESTADO, type RepVisita } from '@/hooks/useRepresentantes'
import { RESULTADO_LABEL } from '@/hooks/useVisitasCampo'

// Mapa gerencial do campo. Cor = estado da visita, NÃO o vendedor:
// o que o gestor procura aqui é o que saiu do padrão, não quem foi onde.
//
// Quando há check-in com GPS e o pino do cliente é confiável, desenha os DOIS
// pontos e a linha entre eles. É assim que "fora do ponto" deixa de ser um
// número numa tabela e vira uma distância que se enxerga.

const COR = {
  alerta:          '#dc2626',
  ok:              '#16a34a',
  sem_conferencia: '#94a3b8',
  a_visitar:       '#0284c7',
} as const

const LEGENDA: Array<[keyof typeof COR, string]> = [
  ['ok', 'Visitada e local conferido'],
  ['sem_conferencia', 'Visitada, sem como conferir o local'],
  ['alerta', 'Fora do padrão (inclui a que não foi visitada)'],
  ['a_visitar', 'Ainda não visitada'],
]

// O alerta "fora do ponto" nasce em 1 km (rep_visitas_base). Desenhar a linha
// vermelha a partir de 300 m criava um pino VERDE com risco vermelho saindo
// dele — a linha contradizia a cor. Agora o mesmo limiar governa os dois, e
// entre 300 m e 1 km a linha sai cinza: mostra o deslocamento sem acusar.
const M_LINHA_MIN = 300
const M_ALERTA = 1000

function pino(cor: string, tracejado: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;
      background:${cor};border:2px ${tracejado ? 'dashed' : 'solid'} #fff;
      box-shadow:0 0 0 1px rgba(15,23,42,.35)"></span>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  })
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function popup(v: RepVisita): string {
  const linhas: string[] = []
  linhas.push(`<strong>${esc(v.cliente)}</strong>`)
  linhas.push(`${esc(v.cidade ?? '—')}${v.uf ? '/' + esc(v.uf) : ''} · ${esc(v.rep_nome ?? v.rep)}`)
  if (v.data_prevista) linhas.push(`Previsto: ${esc(v.data_prevista)}`)
  if (v.checkin_at) {
    const h = new Date(v.checkin_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    linhas.push(`Chegou: ${esc(h)}${v.minutos != null ? ` · ${v.minutos} min` : ''}`)
  } else {
    linhas.push('<em>Sem check-in</em>')
  }
  if (v.resultado) linhas.push(`Resultado: ${esc(RESULTADO_LABEL[v.resultado] ?? v.resultado)}`)
  if (!v.ponto_exato) linhas.push('<em>Local aproximado (cidade)</em>')
  const alertas = alertasDe(v)
  if (alertas.length) linhas.push(`<span style="color:#dc2626">${esc(alertas.join(' · '))}</span>`)
  return `<div style="font-size:12px;line-height:1.45;min-width:180px">${linhas.join('<br>')}</div>`
}

export function MapaGestaoVisitas({ visitas }: { visitas: RepVisita[] }) {
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  const comPonto = useMemo(
    () => visitas.filter(v => v.lat != null && v.lng != null),
    [visitas],
  )

  useEffect(() => {
    const el = divRef.current
    if (!el || mapRef.current) return
    const map = L.map(el, { zoomControl: true, attributionControl: false, scrollWheelZoom: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map)
    map.setView([-15.8, -52.0], 4)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    return () => { layerRef.current = null; mapRef.current = null; map.remove() }
  }, [])

  // Enquadra ANTES de desenhar: o leque é calculado em metros a partir do zoom,
  // e com o zoom errado ele sairia com o passo errado.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !comPonto.length) return
    const brutos = comPonto.map(v => [v.lat as number, v.lng as number] as L.LatLngExpression)
    try { map.fitBounds(L.latLngBounds(brutos), { padding: [28, 28], maxZoom: 12 }) } catch { /* noop */ }
  }, [comPonto])

  const desenhar = () => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    // Quase todo pino é o centro do município, então várias visitas caem no
    // MESMO pixel. Leaflet empilha por posição: com empate, quem foi desenhado
    // por último fica em cima. Sem ordenar, um alerta podia sumir debaixo de um
    // pino verde — justamente o que o gestor abriu a tela pra ver.
    // Menos severo primeiro; e o que empata no mesmo ponto abre em leque.
    const ordenadas = [...comPonto].sort(
      (a, b) => PESO_ESTADO[estadoDaVisita(a)] - PESO_ESTADO[estadoDaVisita(b)])

    const vistos = new Map<string, number>()
    for (const v of ordenadas) {
      const estado = estadoDaVisita(v)
      const cor = COR[estado]
      const lat0 = v.lat as number
      const lng0 = v.lng as number

      // leque: 22px de raio por anel, calculado no zoom atual
      const chave = `${lat0.toFixed(5)},${lng0.toFixed(5)}`
      const i = vistos.get(chave) ?? 0
      vistos.set(chave, i + 1)
      let p: L.LatLngExpression = [lat0, lng0]
      if (i > 0) {
        const z = map.getZoom()
        const mPorPx = (156543.03392 * Math.cos((lat0 * Math.PI) / 180)) / Math.pow(2, z)
        const ang = (2 * Math.PI * (i - 1)) / 6 - Math.PI / 2
        const anel = Math.ceil(i / 6)
        const dm = 22 * anel * mPorPx
        p = [lat0 + (dm * Math.sin(ang)) / 111320,
             lng0 + (dm * Math.cos(ang)) / (111320 * Math.cos((lat0 * Math.PI) / 180))]
      }
      L.marker(p, { icon: pino(cor, !v.ponto_exato), zIndexOffset: PESO_ESTADO[estado] * 1000 })
        .bindPopup(popup(v)).addTo(layer)

      // check-in longe do pino: mostra o pulo em vez de só contar metros
      const dist = v.distancia_m ?? 0
      if (v.checkin_lat != null && v.checkin_lng != null && v.ponto_confiavel && dist > M_LINHA_MIN) {
        const acusa = dist > M_ALERTA
        const corLinha = acusa ? COR.alerta : '#64748b'
        const q: L.LatLngExpression = [v.checkin_lat, v.checkin_lng]
        L.polyline([p, q], { color: corLinha, weight: 1.5, dashArray: '4 4', opacity: 0.85 }).addTo(layer)
        L.circleMarker(q, { radius: 4, color: corLinha, fillColor: '#fff', fillOpacity: 1, weight: 2 })
          .bindPopup(`<div style="font-size:12px">Check-in de <strong>${esc(v.rep_nome ?? v.rep)}</strong><br>${dist} m do ponto do cliente${acusa ? '' : ' (dentro do tolerado)'}</div>`)
          .addTo(layer)
      }
    }
  }

  // redesenha ao mudar o dado E ao mudar o zoom: o passo do leque é em metros,
  // então sem isto os pinos separados no zoom de cidade voltariam a se tocar ao
  // afastar (ou virariam uma flor gigante ao aproximar).
  const desenharRef = useRef(desenhar)
  desenharRef.current = desenhar
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const fn = () => desenharRef.current()
    fn()
    map.on('zoomend', fn)
    return () => { map.off('zoomend', fn) }
  }, [comPonto])

  // o mapa nasce dentro de uma aba: sem isto ele mede 0px de altura e some
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [comPonto])

  const semPonto = visitas.length - comPonto.length

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div ref={divRef} className="h-[460px] w-full bg-surface-2" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-border bg-surface">
        {LEGENDA.map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COR[k] }} />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-ink-faint" />
          contorno tracejado = local aproximado (cidade, não endereço) · pinos no
          mesmo ponto abrem em leque
        </span>
        {semPonto > 0 && (
          <span className="text-[11px] text-warning">
            {semPonto} visita{semPonto > 1 ? 's' : ''} sem coordenada, fora do mapa
          </span>
        )}
      </div>
    </div>
  )
}
