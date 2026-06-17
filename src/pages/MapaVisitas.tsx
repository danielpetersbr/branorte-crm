import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  useVisitas, useGeocodarVisitas, useOrcamentosMapa,
  type Visita, type OrcamentoPonto,
} from '@/hooks/useVisitas'
import { useEtiquetas } from '@/hooks/useEtiquetas'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Mapa de visitas — DUAS camadas (liga/desliga):
//  • Orçamentos: 1 pino por cliente (telefone), cor pela IDADE do orçamento mais recente
//    (≤1 mês verde · 1–3 meses amarelo · >3 meses vermelho). Total = soma dos orçamentos.
//  • Visitas WhatsApp: pinos dos "Dados pra visita" salvos pela extensão, cor por follow-up.
// Geocoding por cidade/UF (Nominatim) com cache compartilhado.

const CENTRO_BR: [number, number] = [-15.78, -47.93]

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4']
const CINZA = '#9ca3af'
const FOLLOWUP_NOMES = new Set(['FOLLOW UP', 'FALLOW UP'])
function corDoVendedor(vendedor: string | null, ordem: string[]): string {
  const i = Math.max(0, ordem.indexOf(vendedor || '—'))
  return CORES[i % CORES.length]
}

// Cor do pino de ORÇAMENTO pela idade (data do orçamento mais recente do cliente)
const VERDE = '#22c55e', AMARELO = '#f59e0b', VERMELHO = '#ef4444'
function diasDesde(dataISO: string | null): number | null {
  if (!dataISO) return null
  const t = new Date(dataISO.length <= 10 ? dataISO + 'T00:00:00' : dataISO).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}
function corOrcamento(dataRecente: string | null): string {
  const d = diasDesde(dataRecente)
  if (d == null) return CINZA
  if (d <= 30) return VERDE
  if (d <= 90) return AMARELO
  return VERMELHO
}
function idadeLabel(dataRecente: string | null): string {
  const d = diasDesde(dataRecente)
  if (d == null) return '—'
  if (d <= 30) return `há ${d} dia${d === 1 ? '' : 's'}`
  const m = Math.floor(d / 30)
  return `há ${m} ${m === 1 ? 'mês' : 'meses'}`
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
const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

function popupVisita(v: Visita, isFollowUp: boolean, labels: string[]): string {
  const tel = (v.telefone || '').replace(/\D/g, '')
  const loc = [esc(v.cidade), esc(v.estado)].filter(Boolean).join(' - ')
  const badge = labels.length
    ? (isFollowUp
        ? `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:600">🟢 Follow up</span>`
        : `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#e5e7eb;color:#374151;font-weight:600">⚪ ${labels.map(esc).join(', ')}</span>`)
    : ''
  return `
    <div style="min-width:180px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(v.nome) || 'Sem nome'}</div>
      ${loc ? `<div style="font-size:12px;color:#64748b">${loc}</div>` : ''}
      ${badge ? `<div style="margin-top:4px">${badge}</div>` : ''}
      ${v.interesse ? `<div style="font-size:12px;margin-top:4px">🎯 ${esc(v.interesse)}</div>` : ''}
      ${v.valor_negociando != null ? `<div style="font-size:13px;font-weight:600;color:#10b981;margin-top:2px">${brl(v.valor_negociando)}</div>` : ''}
      <div style="font-size:11px;color:#64748b;margin-top:4px">Vendedor: ${esc(v.vendedor_nome) || '—'}</div>
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
    </div>`
}

function popupOrcamento(p: OrcamentoPonto): string {
  const tel = (p.telefone || '').replace(/\D/g, '')
  const foneFmt = p.fone || p.telefone || ''
  const loc = [esc(p.cidade), esc(p.uf)].filter(Boolean).join(' - ')
  const dataFmt = p.data_recente ? new Date(p.data_recente + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
  return `
    <div style="min-width:190px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(p.cliente) || 'Sem nome'}</div>
      ${loc ? `<div style="font-size:12px;color:#64748b">${loc}</div>` : ''}
      ${p.numeros ? `<div style="font-size:11px;color:#475569;margin-top:3px">🧾 Nº ${esc(p.numeros)}</div>` : ''}
      <div style="font-size:14px;font-weight:700;color:#10b981;margin-top:3px">${brl(p.total)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">${p.n_orcamentos} orçamento${p.n_orcamentos === 1 ? '' : 's'} · último ${dataFmt} <b>(${idadeLabel(p.data_recente)})</b></div>
      <div style="font-size:11px;color:#64748b;margin-top:3px">Vendedor: ${esc(p.vendedor) || '—'}</div>
      ${foneFmt ? `<div style="font-size:12px;color:#0f172a;margin-top:4px">📱 ${esc(foneFmt)}</div>` : ''}
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
    </div>`
}

export function MapaVisitas() {
  const { data: visitas = [], isLoading } = useVisitas()
  const { data: orcPontos = [], isLoading: loadingOrc, refetch: refetchOrc } = useOrcamentosMapa()
  const { data: etiquetasWa = [] } = useEtiquetas()
  const geocodar = useGeocodarVisitas()
  const [vendedorSel, setVendedorSel] = useState<string>('')
  const [showOrc, setShowOrc] = useState(true)
  const [showVis, setShowVis] = useState(false)
  const [busca, setBusca] = useState('')

  // resolve etiqueta_id (por vendedor) -> nome (IDs do Wascript não são globais).
  const { byVendId, globId } = useMemo(() => {
    const byVendId = new Map<string, string>()
    const cont = new Map<string, Map<string, number>>()
    for (const e of etiquetasWa) {
      const nome = e.etiqueta_nome || ''
      if (!nome) continue
      const id = String(e.etiqueta_id_wascript)
      const vend = (e.vendedor_nome || '').toUpperCase()
      if (vend) byVendId.set(`${vend}|${id}`, nome)
      if (!cont.has(id)) cont.set(id, new Map())
      const m = cont.get(id)!
      m.set(nome, (m.get(nome) || 0) + 1)
    }
    const globId = new Map<string, string>()
    for (const [id, m] of cont) {
      let best = '', bestN = -1
      for (const [nome, n] of m) if (n > bestN) { best = nome; bestN = n }
      globId.set(id, best)
    }
    return { byVendId, globId }
  }, [etiquetasWa])

  function resolverEtiquetas(v: Visita): { nomes: string[]; isFollowUp: boolean } {
    const vnorm = (v.vendedor_nome || '').toUpperCase()
    const nomes: string[] = []
    for (const id of v.etiquetas || []) {
      const nome = byVendId.get(`${vnorm}|${String(id)}`) || globId.get(String(id))
      if (nome && !nomes.includes(nome)) nomes.push(nome)
    }
    return { nomes, isFollowUp: nomes.some(n => FOLLOWUP_NOMES.has(n.toUpperCase())) }
  }
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const divRef = useRef<HTMLDivElement | null>(null)
  const autoGeoRef = useRef(false)
  const autoCidRef = useRef(false)

  // vendedores (dropdown) — combina visitas + orçamentos
  const vendedores = useMemo(() => {
    const s = new Set<string>()
    for (const v of visitas) s.add(v.vendedor_nome || '—')
    for (const p of orcPontos) s.add(p.vendedor || '—')
    return [...s].sort()
  }, [visitas, orcPontos])

  const comCoord = useMemo(() => visitas.filter(v => v.lat != null && v.lng != null), [visitas])
  const semCoord = visitas.length - comCoord.length
  const termo = busca.trim().toLowerCase()
  const visFiltradas = useMemo(
    () => comCoord.filter(v =>
      (!vendedorSel || (v.vendedor_nome || '—') === vendedorSel) &&
      (!termo || [v.nome, v.cidade, v.estado, v.telefone, v.vendedor_nome, v.interesse]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    [comCoord, vendedorSel, termo]
  )
  const orcFiltrados = useMemo(
    () => orcPontos.filter(p =>
      (!vendedorSel || (p.vendedor || '—') === vendedorSel) &&
      (!termo || [p.cliente, p.cidade, p.uf, p.telefone, p.fone, p.numeros, p.vendedor]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    [orcPontos, vendedorSel, termo]
  )

  // legenda visitas (follow-up por vendedor + cinza)
  const corStats = useMemo(() => {
    const porVend = new Map<string, number>()
    let semFollowup = 0
    for (const v of visFiltradas) {
      if (resolverEtiquetas(v).isFollowUp) {
        const k = v.vendedor_nome || '—'
        porVend.set(k, (porVend.get(k) || 0) + 1)
      } else semFollowup++
    }
    return { porVend, semFollowup }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visFiltradas, byVendId, globId])

  // legenda orçamentos (por idade)
  const orcStats = useMemo(() => {
    let verde = 0, amarelo = 0, vermelho = 0
    for (const p of orcFiltrados) {
      const c = corOrcamento(p.data_recente)
      if (c === VERDE) verde++; else if (c === AMARELO) amarelo++; else vermelho++
    }
    return { verde, amarelo, vermelho }
  }, [orcFiltrados])

  // init do mapa (uma vez)
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
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // redesenha marcadores (visitas e/ou orçamentos) quando dados/filtro/camada mudam
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    map.invalidateSize()
    layer.clearLayers()
    const bounds: [number, number][] = []
    if (showVis) {
      for (const v of visFiltradas) {
        const { nomes, isFollowUp } = resolverEtiquetas(v)
        const cor = isFollowUp ? corDoVendedor(v.vendedor_nome, vendedores) : CINZA
        const m = L.marker([v.lat as number, v.lng as number], { icon: pinIcon(cor), opacity: isFollowUp ? 1 : 0.85 })
        m.bindPopup(popupVisita(v, isFollowUp, nomes))
        m.addTo(layer)
        bounds.push([v.lat as number, v.lng as number])
      }
    }
    if (showOrc) {
      for (const p of orcFiltrados) {
        const m = L.marker([p.lat, p.lng], { icon: pinIcon(corOrcamento(p.data_recente)) })
        m.bindPopup(popupOrcamento(p))
        m.addTo(layer)
        bounds.push([p.lat, p.lng])
      }
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
  }, [showVis, showOrc, visFiltradas, orcFiltrados, vendedores, byVendId, globId])

  // auto-geocoda visitas pendentes ao abrir (uma vez por montagem)
  useEffect(() => {
    if (autoGeoRef.current || isLoading || semCoord === 0 || geocodar.isPending) return
    autoGeoRef.current = true
    geocodar.mutate()
  }, [isLoading, semCoord, geocodar])

  // auto-geocoda as cidades dos orçamentos faltantes (em lotes, até preencher o cache)
  useEffect(() => {
    if (autoCidRef.current) return
    autoCidRef.current = true
    let cancelado = false
    ;(async () => {
      for (let i = 0; i < 6; i++) {
        const r = await fetch('/api/geocode-cidades', { method: 'POST' })
          .then(x => (x.ok ? x.json() : null))
          .catch(() => null)
        if (cancelado || !r) break
        if (r.atualizados > 0) await refetchOrc()
        if (!r.pendentes || r.pendentes <= 0 || r.atualizados === 0) break
      }
    })()
    return () => { cancelado = true }
  }, [refetchOrc])

  const togglePill = (ativo: boolean) =>
    `h-9 px-3 rounded-md border text-[13px] font-semibold transition-colors ${ativo ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface border-border text-ink-muted hover:text-ink'}`

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Mapa de Visitas</h1>
          <p className="text-[13px] text-ink-muted">
            {showOrc && <>{orcFiltrados.length} clientes com orçamento</>}
            {showOrc && showVis && ' · '}
            {showVis && <>{visFiltradas.length} visitas{semCoord > 0 && <> · <span className="text-warning">{semCoord} sem localização</span></>}</>}
            {!showOrc && !showVis && 'Ligue uma camada pra ver os pontos'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint pointer-events-none">🔍</span>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar cliente, cidade, telefone, Nº…"
              className="h-9 w-60 pl-8 pr-7 rounded-md bg-surface border border-border text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
            />
            {busca && (
              <button
                onClick={() => setBusca('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-[13px]"
                title="Limpar busca"
              >✕</button>
            )}
          </div>
          <button className={togglePill(showOrc)} onClick={() => setShowOrc(v => !v)} title="Pontos a partir dos orçamentos (cor por idade)">💰 Orçamentos</button>
          <button className={togglePill(showVis)} onClick={() => setShowVis(v => !v)} title="Visitas anotadas no WhatsApp (cor por follow-up)">📍 Visitas WhatsApp</button>
          <select
            value={vendedorSel}
            onChange={e => setVendedorSel(e.target.value)}
            className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink"
          >
            <option value="">Todos os vendedores</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {showVis && semCoord > 0 && (
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

      {geocodar.data && showVis && (
        <div className="shrink-0 rounded-md border border-border bg-surface-2 text-[12px] text-ink-muted px-3 py-2">
          {geocodar.data.atualizados} localizado(s).
          {geocodar.data.falhas?.length ? ` Não achei: ${geocodar.data.falhas.join(', ')}.` : ''}
        </div>
      )}

      <div className="flex-1 flex gap-3 min-h-0 relative">
        <div ref={divRef} className="flex-1 rounded-xl border border-border overflow-hidden z-0" style={{ minHeight: 300 }} />
        {(isLoading || loadingOrc) && (
          <div className="absolute inset-0 flex items-center justify-center"><PageLoading /></div>
        )}
        <div className="w-48 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto">
          {showOrc && (
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Orçamentos · idade</div>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2 text-[12px] text-ink">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: VERDE }} />
                  <span className="truncate">Até 1 mês</span>
                  <span className="ml-auto tabular-nums text-ink-faint">{orcStats.verde}</span>
                </li>
                <li className="flex items-center gap-2 text-[12px] text-ink">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: AMARELO }} />
                  <span className="truncate">1 a 3 meses</span>
                  <span className="ml-auto tabular-nums text-ink-faint">{orcStats.amarelo}</span>
                </li>
                <li className="flex items-center gap-2 text-[12px] text-ink">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: VERMELHO }} />
                  <span className="truncate">+ de 3 meses</span>
                  <span className="ml-auto tabular-nums text-ink-faint">{orcStats.vermelho}</span>
                </li>
              </ul>
            </div>
          )}
          {showVis && vendedores.length > 1 && (
            <div className={showOrc ? 'pt-3 border-t border-border' : ''}>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Visitas · em follow-up</div>
              <ul className="space-y-1.5">
                {vendedores.filter(v => (corStats.porVend.get(v) || 0) > 0).map(v => (
                  <li key={v} className="flex items-center gap-2 text-[12px] text-ink">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: corDoVendedor(v, vendedores) }} />
                    <span className="truncate">{v}</span>
                    <span className="ml-auto tabular-nums text-ink-faint">{corStats.porVend.get(v)}</span>
                  </li>
                ))}
                {corStats.semFollowup > 0 && (
                  <li className="flex items-center gap-2 text-[12px] pt-1.5 mt-1 border-t border-border">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: CINZA }} />
                    <span className="truncate text-ink-muted">Sem follow-up</span>
                    <span className="ml-auto tabular-nums text-ink-faint">{corStats.semFollowup}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
