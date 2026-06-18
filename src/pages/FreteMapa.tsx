// /frete/mapa — mapa das cotações de frete já respondidas. Cada ponto = um destino
// com valor cotado, transportadora e data (parâmetro histórico pro vendedor). Lê da
// view frete_mapa (lances respondidos com lat/lng). Leaflet + tiles Google.
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useFreteMapa, useTiposCaminhao, UFS_BR, type FreteMapaPonto } from '@/hooks/useFrete'
import { PageLoading } from '@/components/ui/LoadingSpinner'

const CENTRO_BR: [number, number] = [-15.78, -47.93]
const VERDE = '#22c55e', AZUL = '#3b82f6'

function pinIcon(cor: string): L.DivIcon {
  return L.divIcon({
    className: 'frete-pin',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:${cor};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22],
  })
}

const brl = (v: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

function equipLabel(p: FreteMapaPonto): string {
  const arr = Array.isArray(p.equipamentos_itens) ? p.equipamentos_itens : []
  if (arr.length) return arr.map(i => `${i.qtd && i.qtd > 1 ? i.qtd + 'x ' : ''}${i.nome ?? ''}`).join(' + ')
  return 'Equipamento'
}

function popup(p: FreteMapaPonto, caminhao: string): string {
  const data = p.respondido_em ? new Date(p.respondido_em).toLocaleDateString('pt-BR') : '—'
  return `
    <div style="min-width:190px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(equipLabel(p))}</div>
      <div style="font-size:12px;color:#64748b">${esc(p.cidade_destino)}/${esc(p.uf_destino)}${p.distancia_km ? ` · ${Math.round(p.distancia_km)} km` : ''}</div>
      <div style="font-size:16px;font-weight:700;color:#22c55e;margin-top:4px">${brl(p.valor)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(p.transportadora_nome)}${p.prazo_dias != null ? ` · ${p.prazo_dias} dias` : ''}</div>
      ${caminhao ? `<div style="font-size:11px;color:#475569;margin-top:2px">🚚 ${esc(caminhao)}</div>` : ''}
      <div style="font-size:11px;color:#94a3b8;margin-top:3px">Cotado em ${data} · ${esc(p.codigo)}${p.vencedor ? ' · <b style="color:#16a34a">vencedor</b>' : ''}</div>
    </div>`
}

export function FreteMapa() {
  const { data: pontos = [], isLoading } = useFreteMapa()
  const tipos = useTiposCaminhao()
  const [uf, setUf] = useState('')
  const [busca, setBusca] = useState('')
  const [soVencedores, setSoVencedores] = useState(false)

  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  const caminhaoNome = (id: number | null) => tipos.data?.find(t => t.id === id)?.nome ?? ''

  const termo = busca.trim().toLowerCase()
  const filtrados = useMemo(() => pontos.filter(p =>
    p.destino_lat != null && p.destino_lng != null &&
    (!uf || p.uf_destino === uf) &&
    (!soVencedores || p.vencedor) &&
    (!termo || [p.cidade_destino, p.transportadora_nome, equipLabel(p), p.codigo].some(x => (x || '').toLowerCase().includes(termo)))
  ), [pontos, uf, soVencedores, termo])

  // init mapa (uma vez)
  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const map = L.map(divRef.current, { center: CENTRO_BR, zoom: 4, scrollWheelZoom: true, zoomControl: true })
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
    setTimeout(() => map.invalidateSize(), 0)
    setTimeout(() => map.invalidateSize(), 250)
    return () => { map.remove(); mapRef.current = null; layerRef.current = null }
  }, [])

  // redesenha marcadores
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current
    if (!map || !layer) return
    map.invalidateSize()
    layer.clearLayers()
    const bounds: [number, number][] = []
    for (const p of filtrados) {
      const m = L.marker([p.destino_lat, p.destino_lng], { icon: pinIcon(p.vencedor ? VERDE : AZUL) })
      m.bindPopup(popup(p, caminhaoNome(p.caminhao_recomendado_id)))
      m.addTo(layer)
      bounds.push([p.destino_lat, p.destino_lng])
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, tipos.data])

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Mapa de Fretes</h1>
          <p className="text-[13px] text-ink-muted">{filtrados.length} cotação(ões) no mapa · parâmetro histórico por região</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint pointer-events-none">🔍</span>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Cidade, transportadora, equipamento…"
              className="h-9 w-60 pl-8 pr-3 rounded-md bg-surface border border-border text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent" />
          </div>
          <select value={uf} onChange={e => setUf(e.target.value)} className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink">
            <option value="">Todas UFs</option>
            {UFS_BR.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={() => setSoVencedores(v => !v)}
            className={`h-9 px-3 rounded-md border text-[13px] font-semibold transition-colors ${soVencedores ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface border-border text-ink-muted hover:text-ink'}`}>
            🏆 Só fechados
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div ref={divRef} className="h-full w-full rounded-xl border border-border overflow-hidden z-0" style={{ minHeight: 300 }} />
        {isLoading && <div className="absolute inset-0 flex items-center justify-center"><PageLoading /></div>}
        {!isLoading && filtrados.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-surface-1 border border-border rounded-xl px-5 py-3 text-sm text-ink-muted">Sem cotações respondidas ainda. Conforme as transportadoras preenchem, os pontos aparecem aqui.</div>
          </div>
        )}
        <div className="absolute bottom-3 left-3 z-[400] bg-surface/95 border border-border rounded-lg px-3 py-2 text-[12px] text-ink-muted flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: VERDE }} /> Fechado</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: AZUL }} /> Cotado</span>
        </div>
      </div>
    </div>
  )
}

export default FreteMapa
