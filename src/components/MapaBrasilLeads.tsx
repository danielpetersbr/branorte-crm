import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface UfItem { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }

// Mapa choropleth real do Brasil (Leaflet, sem tiles) colorido por volume de leads
// por estado. GeoJSON simplificado servido same-origin em /brasil-estados.geojson.
export default function MapaBrasilLeads({ items, hue = 152 }: { items: UfItem[]; hue?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const brasil = items.filter(i => i.isBrasil)
    const byUf = new Map(brasil.map(i => [i.uf, i]))
    const max = Math.max(...brasil.map(i => i.total), 1)
    const cor = (total: number) => {
      if (!total) return 'hsl(240 6% 22%)'
      const t = Math.sqrt(total / max) // sqrt suaviza a escala (SP não esmaga o resto)
      return `hsl(${hue} 62% ${Math.round(58 - t * 30)}%)`
    }

    const map = L.map(el, {
      zoomControl: false, attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
      keyboard: false, touchZoom: false, zoomSnap: 0.05,
    })
    el.style.background = 'transparent'
    let cancelled = false

    fetch('/brasil-estados.geojson')
      .then(r => { if (!r.ok) throw new Error('geojson'); return r.json() })
      .then((geo: GeoJSON.FeatureCollection) => {
        if (cancelled) return
        const layer = L.geoJSON(geo, {
          style: (f) => {
            const it = byUf.get((f?.properties as { sigla?: string })?.sigla ?? '')
            return { fillColor: cor(it?.total ?? 0), weight: 0.6, color: 'hsl(240 6% 38%)', fillOpacity: 0.92 }
          },
          onEachFeature: (f, lyr) => {
            const props = f.properties as { sigla?: string; name?: string }
            const it = byUf.get(props?.sigla ?? '')
            const nome = props?.name ?? props?.sigla ?? ''
            lyr.bindTooltip(
              `<b>${nome}</b><br>${it ? `${it.total} leads · ${it.pct.toFixed(1)}%` : 'sem leads'}`,
              { sticky: true, direction: 'top', opacity: 1 },
            )
            lyr.on('mouseover', () => (lyr as L.Path).setStyle({ weight: 1.8, color: '#fff', fillOpacity: 1 }))
            lyr.on('mouseout', () => (lyr as L.Path).setStyle({ weight: 0.6, color: 'hsl(240 6% 38%)', fillOpacity: 0.92 }))
          },
        }).addTo(map)
        try { map.fitBounds(layer.getBounds(), { padding: [6, 6] }) } catch { /* noop */ }
      })
      .catch(() => { if (!cancelled) setErro(true) })

    return () => { cancelled = true; map.remove() }
  }, [items])

  if (erro) return null
  return <div ref={ref} className="h-[330px] w-full rounded-lg overflow-hidden" style={{ background: 'transparent' }} />
}
