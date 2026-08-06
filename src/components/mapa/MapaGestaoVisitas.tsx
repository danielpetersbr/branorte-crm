import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { alertasDe, estadoDaVisita, type RepVisita } from '@/hooks/useRepresentantes'
import { RESULTADO_LABEL } from '@/hooks/useVisitasCampo'

// Mapa gerencial do campo. Cor = estado da visita, NÃO o vendedor:
// o que o gestor procura aqui é o que saiu do padrão, não quem foi onde.
//
// Quando há check-in com GPS e o pino do cliente é confiável, desenha os DOIS
// pontos e a linha entre eles. É assim que "fora do ponto" deixa de ser um
// número numa tabela e vira uma distância que se enxerga.

const COR = {
  alerta:    '#dc2626',
  ok:        '#16a34a',
  a_visitar: '#0284c7',
} as const

const LEGENDA: Array<[keyof typeof COR, string]> = [
  ['ok', 'Visitada, sem pendência'],
  ['alerta', 'Fora do padrão'],
  ['a_visitar', 'Ainda não visitada'],
]

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

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    const pontos: L.LatLngExpression[] = []
    for (const v of comPonto) {
      const cor = COR[estadoDaVisita(v)]
      const p: L.LatLngExpression = [v.lat as number, v.lng as number]
      pontos.push(p)
      L.marker(p, { icon: pino(cor, !v.ponto_exato) }).bindPopup(popup(v)).addTo(layer)

      // check-in longe do cliente: mostra o pulo em vez de só contar metros
      if (v.checkin_lat != null && v.checkin_lng != null && v.ponto_confiavel && (v.distancia_m ?? 0) > 300) {
        const q: L.LatLngExpression = [v.checkin_lat, v.checkin_lng]
        pontos.push(q)
        L.polyline([p, q], { color: '#dc2626', weight: 1.5, dashArray: '4 4', opacity: 0.85 }).addTo(layer)
        L.circleMarker(q, { radius: 4, color: '#dc2626', fillColor: '#fff', fillOpacity: 1, weight: 2 })
          .bindPopup(`<div style="font-size:12px">Check-in de <strong>${esc(v.rep_nome ?? v.rep)}</strong><br>${v.distancia_m} m do ponto do cliente</div>`)
          .addTo(layer)
      }
    }

    if (pontos.length) {
      try { map.fitBounds(L.latLngBounds(pontos), { padding: [28, 28], maxZoom: 11 }) } catch { /* noop */ }
    }
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
          contorno tracejado = local aproximado (cidade, não endereço)
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
