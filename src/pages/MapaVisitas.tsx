import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useVisitas, useGeocodarVisitas, type Visita } from '@/hooks/useVisitas'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Mapa de visitas — pinos dos clientes com "Dados pra visita" salvos pela
// extensão WA. Geocoding por cidade/UF (Nominatim). Cor do pino por vendedor.

const CENTRO_BR: [number, number] = [-15.78, -47.93]

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4']
function corDoVendedor(vendedor: string | null, ordem: string[]): string {
  const i = Math.max(0, ordem.indexOf(vendedor || '—'))
  return CORES[i % CORES.length]
}

function pinIcon(cor: string): L.DivIcon {
  return L.divIcon({
    className: 'visita-pin',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:${cor};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -22],
  })
}

const brl = (v: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function popupHtml(v: Visita): string {
  const tel = (v.telefone || '').replace(/\D/g, '')
  const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
  return `
    <div style="min-width:180px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(v.nome) || 'Sem nome'}</div>
      <div style="font-size:12px;color:#64748b">${esc(v.cidade)}${v.estado ? ' - ' + esc(v.estado) : ''}</div>
      ${v.interesse ? `<div style="font-size:12px;margin-top:4px">🎯 ${esc(v.interesse)}</div>` : ''}
      ${v.valor_negociando != null ? `<div style="font-size:13px;font-weight:600;color:#10b981;margin-top:2px">${brl(v.valor_negociando)}</div>` : ''}
      <div style="font-size:11px;color:#64748b;margin-top:4px">Vendedor: ${esc(v.vendedor_nome) || '—'}</div>
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
    </div>`
}

export function MapaVisitas() {
  const { data: visitas = [], isLoading } = useVisitas()
  const geocodar = useGeocodarVisitas()
  const [vendedorSel, setVendedorSel] = useState<string>('')
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const divRef = useRef<HTMLDivElement | null>(null)
  const autoGeoRef = useRef(false)

  const vendedores = useMemo(
    () => [...new Set(visitas.map(v => v.vendedor_nome || '—'))].sort(),
    [visitas]
  )

  const comCoord = useMemo(() => visitas.filter(v => v.lat != null && v.lng != null), [visitas])
  const semCoord = visitas.length - comCoord.length
  const filtradas = useMemo(
    () => (vendedorSel ? comCoord.filter(v => (v.vendedor_nome || '—') === vendedorSel) : comCoord),
    [comCoord, vendedorSel]
  )

  // init do mapa (uma vez, quando o container existir)
  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const map = L.map(divRef.current, { center: CENTRO_BR, zoom: 4, scrollWheelZoom: true, zoomControl: true })

    // Tiles do Google Maps (mesma abordagem do /mapa-vendas do controle.branorte.com)
    const mapa = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    })
    const satelite = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    })
    mapa.addTo(map)
    L.control.layers({ 'Mapa': mapa, 'Satélite': satelite }, {}, { collapsed: false, position: 'topright' }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // o container do mapa entra num flex que assenta depois — força recálculo
    // do tamanho senão os tiles ficam cinza/preto até um resize manual
    setTimeout(() => map.invalidateSize(), 0)
    setTimeout(() => map.invalidateSize(), 250)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // redesenha marcadores quando dados/filtro mudam
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    map.invalidateSize() // legenda aparecendo/sumindo muda a largura do mapa
    layer.clearLayers()
    const bounds: [number, number][] = []
    for (const v of filtradas) {
      const cor = corDoVendedor(v.vendedor_nome, vendedores)
      const m = L.marker([v.lat as number, v.lng as number], { icon: pinIcon(cor) })
      m.bindPopup(popupHtml(v))
      m.addTo(layer)
      bounds.push([v.lat as number, v.lng as number])
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
  }, [filtradas, vendedores])

  // auto-geocoda os pendentes ao abrir o mapa (uma vez por montagem). Sem isso,
  // clientes novos ficam "sem localização" até alguém clicar no botão manual.
  useEffect(() => {
    if (autoGeoRef.current || isLoading || semCoord === 0 || geocodar.isPending) return
    autoGeoRef.current = true
    geocodar.mutate()
  }, [isLoading, semCoord, geocodar])

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Mapa de Visitas</h1>
          <p className="text-[13px] text-ink-muted">
            Clientes com dados de visita salvos · {comCoord.length} no mapa
            {semCoord > 0 && <> · <span className="text-warning">{semCoord} sem localização</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={vendedorSel}
            onChange={e => setVendedorSel(e.target.value)}
            className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink"
          >
            <option value="">Todos os vendedores</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {semCoord > 0 && (
            <button
              onClick={() => geocodar.mutate()}
              disabled={geocodar.isPending}
              className="h-9 px-3 rounded-md bg-accent-bg border border-accent/30 text-accent text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
            >
              {geocodar.isPending ? 'Localizando…' : `Localizar ${semCoord} no mapa`}
            </button>
          )}
        </div>
      </div>

      {geocodar.data && (
        <div className="shrink-0 rounded-md border border-border bg-surface-2 text-[12px] text-ink-muted px-3 py-2">
          {geocodar.data.atualizados} localizado(s).
          {geocodar.data.falhas?.length ? ` Não achei: ${geocodar.data.falhas.join(', ')}.` : ''}
        </div>
      )}

      <div className="flex-1 flex gap-3 min-h-0 relative">
        {/* container do mapa SEMPRE montado (Leaflet precisa do div no init) */}
        <div ref={divRef} className="flex-1 rounded-xl border border-border overflow-hidden z-0" style={{ minHeight: 300 }} />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center"><PageLoading /></div>
        )}
        {/* Legenda de vendedores */}
        {!isLoading && vendedores.length > 1 && (
          <div className="w-44 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto">
            <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Vendedores</div>
            <ul className="space-y-1.5">
              {vendedores.map(v => (
                <li key={v} className="flex items-center gap-2 text-[12px] text-ink">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: corDoVendedor(v, vendedores) }} />
                  <span className="truncate">{v}</span>
                  <span className="ml-auto tabular-nums text-ink-faint">
                    {comCoord.filter(x => (x.vendedor_nome || '—') === v).length}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
