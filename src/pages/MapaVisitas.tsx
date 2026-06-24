import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  useVisitas, useGeocodarVisitas, useOrcamentosMapa, useListaOrcamentos, useVendasMapaCount,
  type Visita, type OrcamentoPonto, type OrcamentoLinha,
} from '@/hooks/useVisitas'
import { useEtiquetas } from '@/hooks/useEtiquetas'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Mapa de visitas — camadas (liga/desliga):
//  • Orçamentos: 1 pino por cliente. Cor pela IDADE do orçamento mais recente
//    (≤1 mês verde · 1–3 meses vermelho · >3 meses cinza). VENDIDO = azul (já comprou).
//  • Visitas WhatsApp: pinos dos "Dados pra visita" salvos pela extensão.
// Filtro vendido/orçado, lista completa (tabela) e filtro por RAIO a partir de um ponto.
// Geocoding por cidade/UF (Nominatim) com cache compartilhado.

const CENTRO_BR: [number, number] = [-15.78, -47.93]

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4']
const CINZA = '#9ca3af'
const FOLLOWUP_NOMES = new Set(['FOLLOW UP', 'FALLOW UP'])
function corDoVendedor(vendedor: string | null, ordem: string[]): string {
  const i = Math.max(0, ordem.indexOf(vendedor || '—'))
  return CORES[i % CORES.length]
}

// Cor do pino de ORÇAMENTO: vendido=azul; senão pela idade (verde ≤1m, vermelho 1–3m, cinza >3m)
const VERDE = '#22c55e', VERMELHO = '#ef4444', CINZA_VELHO = '#9ca3af', AZUL_VENDIDO = '#2563eb'
function diasDesde(dataISO: string | null): number | null {
  if (!dataISO) return null
  const t = new Date(dataISO.length <= 10 ? dataISO + 'T00:00:00' : dataISO).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}
function corIdade(dataRecente: string | null): string {
  const d = diasDesde(dataRecente)
  if (d == null) return CINZA
  if (d <= 30) return VERDE
  if (d <= 90) return VERMELHO
  return CINZA_VELHO
}
function corOrcamento(p: { data_recente: string | null; vendido: boolean }): string {
  return p.vendido ? AZUL_VENDIDO : corIdade(p.data_recente)
}
function idadeLabel(dataRecente: string | null): string {
  const d = diasDesde(dataRecente)
  if (d == null) return '—'
  if (d <= 30) return `há ${d} dia${d === 1 ? '' : 's'}`
  const m = Math.floor(d / 30)
  return `há ${m} ${m === 1 ? 'mês' : 'meses'}`
}

// distância em km (haversine)
function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
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
function pinCentro(): L.DivIcon {
  return L.divIcon({
    className: 'raio-centro',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#0ea5e9;border:3px solid #fff;box-shadow:0 0 0 3px rgba(14,165,233,.4)"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  })
}

const brl = (v: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
const dataBR = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—')

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

function popupOrcamento(p: OrcamentoPonto, dist?: number): string {
  const tel = (p.telefone || '').replace(/\D/g, '')
  const foneFmt = p.fone || p.telefone || ''
  const loc = [esc(p.cidade), esc(p.uf)].filter(Boolean).join(' - ')
  const compras = p.vendido && p.n_vendas > 0 ? ` · ${p.n_vendas} compra${p.n_vendas > 1 ? 's' : ''}` : ''
  const vendBadge = p.vendido
    ? `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#dbeafe;color:#1e40af;font-weight:700">✓ VENDIDO${compras}</span>`
    : `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#fef9c3;color:#854d0e;font-weight:600">Orçado</span>`
  return `
    <div style="min-width:190px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(p.cliente) || 'Sem nome'}</div>
      ${loc ? `<div style="font-size:12px;color:#64748b">${loc}${dist != null ? ` · <b>${dist.toFixed(0)} km</b>` : ''}</div>` : ''}
      <div style="margin-top:4px">${vendBadge}</div>
      ${p.numeros ? `<div style="font-size:11px;color:#475569;margin-top:3px">🧾 Nº ${esc(p.numeros)}</div>` : ''}
      <div style="font-size:14px;font-weight:700;color:#10b981;margin-top:3px">${brl(p.total)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">${p.n_orcamentos} orçamento${p.n_orcamentos === 1 ? '' : 's'} · último ${dataBR(p.data_recente)} <b>(${idadeLabel(p.data_recente)})</b></div>
      <div style="font-size:11px;color:#64748b;margin-top:3px">Vendedor: ${esc(p.vendedor) || '—'}</div>
      ${foneFmt ? `<div style="font-size:12px;color:#0f172a;margin-top:4px">📱 ${esc(foneFmt)}</div>` : ''}
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
    </div>`
}

type VendFiltro = 'todos' | 'orcados' | 'vendidos'

export function MapaVisitas() {
  const { data: visitas = [], isLoading } = useVisitas()
  const { data: orcPontos = [], isLoading: loadingOrc, refetch: refetchOrc } = useOrcamentosMapa()
  const { data: lista = [] } = useListaOrcamentos()
  const { data: vendasCount = 0 } = useVendasMapaCount()
  const { data: etiquetasWa = [] } = useEtiquetas()
  const geocodar = useGeocodarVisitas()
  const [vendedorSel, setVendedorSel] = useState<string>('')
  const [showOrc, setShowOrc] = useState(true)
  const [showVis, setShowVis] = useState(false)
  const [busca, setBusca] = useState('')
  const [vendFiltro, setVendFiltro] = useState<VendFiltro>('todos')
  const [showLista, setShowLista] = useState(false)
  const [sortKey, setSortKey] = useState<'numero' | 'data' | 'cliente' | 'cidade' | 'total' | 'vendido'>('data')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // raio
  const [modoRaio, setModoRaio] = useState(false)
  const [centro, setCentro] = useState<{ lat: number; lng: number } | null>(null)
  const [raioKm, setRaioKm] = useState(100)
  const modoRaioRef = useRef(false)
  useEffect(() => { modoRaioRef.current = modoRaio }, [modoRaio])

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
  const raioLayerRef = useRef<L.LayerGroup | null>(null)
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
  const passaVend = (vendido: boolean) =>
    vendFiltro === 'todos' || (vendFiltro === 'vendidos' ? vendido : !vendido)

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
      passaVend(p.vendido) &&
      (!termo || [p.cliente, p.cidade, p.uf, p.telefone, p.fone, p.numeros, p.vendedor]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    [orcPontos, vendedorSel, termo, vendFiltro]
  )

  // pontos dentro do raio (a partir do centro), ordenados por distância
  const noRaio = useMemo(() => {
    if (!centro) return [] as Array<OrcamentoPonto & { dist: number }>
    return orcFiltrados
      .map(p => ({ ...p, dist: distKm(centro.lat, centro.lng, p.lat, p.lng) }))
      .filter(p => p.dist <= raioKm)
      .sort((a, b) => a.dist - b.dist)
  }, [centro, raioKm, orcFiltrados])

  // legenda orçamentos (por idade + vendido)
  const orcStats = useMemo(() => {
    let verde = 0, vermelho = 0, cinza = 0, vendido = 0
    for (const p of orcFiltrados) {
      if (p.vendido) { vendido++; continue }
      const c = corIdade(p.data_recente)
      if (c === VERDE) verde++; else if (c === VERMELHO) vermelho++; else cinza++
    }
    return { verde, vermelho, cinza, vendido }
  }, [orcFiltrados])

  // lista (tabela) filtrada
  const listaFiltrada = useMemo(() => {
    return lista.filter(r =>
      passaVend(r.vendido) &&
      (!termo || [r.numero, r.cliente, r.equipamento, r.cidade, r.uf]
        .some(x => (x || '').toLowerCase().includes(termo)))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, termo, vendFiltro])

  // lista ordenada (clique no header)
  const sortedLista = useMemo(() => {
    const arr = [...listaFiltrada]
    const dir = sortDir === 'asc' ? 1 : -1
    const txt = (s: string | null) => (s || '').toLowerCase()
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'total': return ((a.total ?? -1) - (b.total ?? -1)) * dir
        case 'data': return txt(a.data_emissao) < txt(b.data_emissao) ? -dir : txt(a.data_emissao) > txt(b.data_emissao) ? dir : 0
        case 'numero': return txt(a.numero).localeCompare(txt(b.numero)) * dir
        case 'cidade': return (txt(a.cidade) + a.uf).localeCompare(txt(b.cidade) + b.uf) * dir
        case 'vendido': return ((a.vendido ? 1 : 0) - (b.vendido ? 1 : 0)) * dir
        default: return txt(a.cliente).localeCompare(txt(b.cliente)) * dir
      }
    })
    return arr
  }, [listaFiltrada, sortKey, sortDir])

  const somaTotal = useMemo(() => sortedLista.reduce((s, r) => s + (r.total || 0), 0), [sortedLista])

  function ordenarPor(k: typeof sortKey) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'data' || k === 'total' ? 'desc' : 'asc') }
  }

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
    raioLayerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (modoRaioRef.current) setCentro({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    setTimeout(() => map.invalidateSize(), 250)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      raioLayerRef.current = null
    }
  }, [])

  // Celular: revalida o tamanho do mapa em resize/rotação (senão fica cinza/cortado).
  useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // redesenha marcadores quando dados/filtro/camada mudam
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
        const m = L.marker([p.lat, p.lng], { icon: pinIcon(corOrcamento(p)) })
        m.bindPopup(popupOrcamento(p))
        m.addTo(layer)
        bounds.push([p.lat, p.lng])
      }
    }
    if (bounds.length && !centro) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
  }, [showVis, showOrc, visFiltradas, orcFiltrados, vendedores, byVendId, globId])

  // desenha círculo do raio
  useEffect(() => {
    const map = mapRef.current
    const rl = raioLayerRef.current
    if (!map || !rl) return
    rl.clearLayers()
    if (centro) {
      L.circle([centro.lat, centro.lng], {
        radius: raioKm * 1000, color: '#0ea5e9', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.08,
      }).addTo(rl)
      L.marker([centro.lat, centro.lng], { icon: pinCentro() }).addTo(rl)
      map.setView([centro.lat, centro.lng], map.getZoom() < 6 ? 6 : map.getZoom())
    }
  }, [centro, raioKm])

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
      for (let i = 0; i < 10; i++) {
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

  function focarPonto(p: OrcamentoPonto) {
    const map = mapRef.current
    if (!map) return
    map.setView([p.lat, p.lng], 11)
    L.popup().setLatLng([p.lat, p.lng]).setContent(popupOrcamento(p)).openOn(map)
  }

  function focarLinha(r: OrcamentoLinha) {
    if (r.lat == null || r.lng == null) return
    setShowLista(false)
    const map = mapRef.current
    if (!map) return
    map.setView([r.lat, r.lng], 11)
    const vb = r.vendido ? '✓ VENDIDO' : 'Orçado'
    L.popup().setLatLng([r.lat, r.lng]).setContent(
      `<div style="min-width:180px;font-family:inherit"><div style="font-weight:600;font-size:13px">${esc(r.cliente) || 'Sem nome'}</div>`
      + `<div style="font-size:12px;color:#64748b">${[esc(r.cidade), esc(r.uf)].filter(Boolean).join(' - ')}</div>`
      + `<div style="font-size:11px;color:#475569;margin-top:3px">🧾 ${esc(r.numero)} · ${dataBR(r.data_emissao)} · ${vb}</div>`
      + `<div style="font-size:12px;margin-top:3px">${esc(r.equipamento)}</div>`
      + `<div style="font-size:14px;font-weight:700;color:#10b981;margin-top:3px">${brl(r.total)}</div></div>`
    ).openOn(map)
  }

  function baixarCSV() {
    const head = ['Numero', 'Data', 'Cliente', 'Equipamento', 'Cidade', 'UF', 'Total', 'Status']
    const linhas = sortedLista.map(r => [
      r.numero || '', r.data_emissao || '', r.cliente || '', (r.equipamento || '').replace(/[\r\n]+/g, ' '),
      r.cidade || '', r.uf || '', r.total ?? '', r.vendido ? 'VENDIDO' : 'Orçado',
    ].map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    const csv = '﻿' + [head.join(';'), ...linhas].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `orcamentos-mapa-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const togglePill = (ativo: boolean) =>
    `h-9 px-3 rounded-md border text-[13px] font-semibold transition-colors ${ativo ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface border-border text-ink-muted hover:text-ink'}`

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3 shrink-0 pr-11 md:pr-0">
        <div>
          <h1 className="text-[18px] md:text-[22px] font-semibold text-ink tracking-tight">Mapa de Visitas</h1>
          <p className="text-[13px] text-ink-muted">
            {showOrc && <>{orcFiltrados.length} clientes com orçamento{orcStats.vendido > 0 && <> · <span className="text-blue-600 font-semibold">{orcStats.vendido} vendidos</span></>}</>}
            {showOrc && showVis && ' · '}
            {showVis && <>{visFiltradas.length} visitas{semCoord > 0 && <> · <span className="text-warning">{semCoord} sem localização</span></>}</>}
            {!showOrc && !showVis && 'Ligue uma camada pra ver os pontos'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative w-full sm:w-auto">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint pointer-events-none">🔍</span>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar cliente, cidade, telefone, Nº…"
              className="h-9 w-full sm:w-56 pl-8 pr-7 rounded-md bg-surface border border-border text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
            />
            {busca && (
              <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-[13px]" title="Limpar busca">✕</button>
            )}
          </div>
          {/* filtro vendido / orçado */}
          <div className="flex h-9 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
            {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos']] as [VendFiltro, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setVendFiltro(v)}
                className={`px-2.5 transition-colors ${vendFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          <button className={togglePill(showOrc)} onClick={() => setShowOrc(v => !v)} title="Pinos a partir dos orçamentos">💰 Orçamentos</button>
          <button className={togglePill(showVis)} onClick={() => setShowVis(v => !v)} title="Visitas anotadas no WhatsApp">📍 Visitas</button>
          <button className={togglePill(modoRaio)} onClick={() => { setModoRaio(v => !v); if (modoRaio) setCentro(null) }} title="Filtrar clientes a partir de um ponto no mapa">🎯 Raio</button>
          <button className={togglePill(showLista)} onClick={() => setShowLista(true)} title="Lista de todos os orçamentos cadastrados">📋 Lista</button>
          <select value={vendedorSel} onChange={e => setVendedorSel(e.target.value)} className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink">
            <option value="">Todos os vendedores</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* barra do modo raio */}
      {modoRaio && (
        <div className="shrink-0 rounded-md border border-sky-300 bg-sky-50 text-[12px] text-sky-900 px-3 py-2 flex flex-wrap items-center gap-3">
          <span className="font-semibold">🎯 Modo raio:</span>
          {!centro ? <span>clique no mapa pra definir o ponto central (ex: Goiânia).</span>
            : <span>Centro definido · <b>{noRaio.length}</b> clientes em até {raioKm} km.</span>}
          <label className="flex items-center gap-1.5 ml-auto">
            Raio
            <input type="range" min={10} max={1000} step={10} value={raioKm} onChange={e => setRaioKm(Number(e.target.value))} className="w-32" />
            <input type="number" min={1} value={raioKm} onChange={e => setRaioKm(Math.max(1, Number(e.target.value) || 1))} className="h-7 w-16 px-1 rounded border border-border bg-surface text-ink" /> km
          </label>
          {centro && <button onClick={() => setCentro(null)} className="text-sky-700 underline">limpar ponto</button>}
        </div>
      )}

      {geocodar.data && showVis && (
        <div className="shrink-0 rounded-md border border-border bg-surface-2 text-[12px] text-ink-muted px-3 py-2">
          {geocodar.data.atualizados} localizado(s).
          {geocodar.data.falhas?.length ? ` Não achei: ${geocodar.data.falhas.join(', ')}.` : ''}
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row gap-2 md:gap-3 min-h-0 relative">
        <div ref={divRef} className="flex-1 rounded-xl border border-border overflow-hidden z-0" style={{ minHeight: 300 }} />
        {(isLoading || loadingOrc) && (
          <div className="absolute inset-0 flex items-center justify-center"><PageLoading /></div>
        )}
        {/* sidebar: lista do raio OU legenda. No celular vira um painel abaixo do mapa (altura limitada). */}
        <div className="w-full md:w-56 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto max-h-[34vh] md:max-h-none">
          {modoRaio && centro ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">{noRaio.length} clientes em {raioKm} km</div>
              <ul className="space-y-1">
                {noRaio.map((p, i) => (
                  <li key={i}>
                    <button onClick={() => focarPonto(p)} className="w-full text-left rounded-md px-2 py-1.5 hover:bg-surface-2 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: corOrcamento(p) }} />
                        <span className="text-[12px] text-ink truncate flex-1">{p.cliente || '—'}</span>
                        <span className="text-[11px] tabular-nums text-ink-faint">{p.dist.toFixed(0)}km</span>
                      </div>
                      <div className="text-[11px] text-ink-muted pl-4 truncate">{[p.cidade, p.uf].filter(Boolean).join(' - ')}{p.vendido && ' · ✓ vendido'}</div>
                    </button>
                  </li>
                ))}
                {noRaio.length === 0 && <li className="text-[12px] text-ink-muted">Nenhum cliente nesse raio.</li>}
              </ul>
            </div>
          ) : (
            <>
              {showOrc && (
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Orçamentos · idade</div>
                  <ul className="space-y-1.5">
                    <li className="flex items-center gap-2 text-[12px] text-ink"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: VERDE }} /><span className="truncate">Até 1 mês</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.verde}</span></li>
                    <li className="flex items-center gap-2 text-[12px] text-ink"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: VERMELHO }} /><span className="truncate">1 a 3 meses</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.vermelho}</span></li>
                    <li className="flex items-center gap-2 text-[12px] text-ink"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: CINZA_VELHO }} /><span className="truncate">+ de 3 meses</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.cinza}</span></li>
                    <li className="flex items-center gap-2 text-[12px] text-ink pt-1.5 mt-1 border-t border-border"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: AZUL_VENDIDO }} /><span className="truncate font-semibold">✓ Vendido</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.vendido}</span></li>
                  </ul>
                  {vendasCount > 0 && (
                    <div className="text-[10px] text-ink-faint mt-1.5 leading-snug">
                      {orcStats.vendido} clientes vendidos · {vendasCount.toLocaleString('pt-BR')} vendas no total
                      <br />(1 pino por cliente — quem comprou +1x conta como 1)
                    </div>
                  )}
                </div>
              )}
              {showVis && vendedores.length > 1 && (
                <div className={showOrc ? 'pt-3 border-t border-border' : ''}>
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Visitas · em follow-up</div>
                  <ul className="space-y-1.5">
                    {vendedores.filter(v => visFiltradas.some(x => resolverEtiquetas(x).isFollowUp && (x.vendedor_nome || '—') === v)).map(v => (
                      <li key={v} className="flex items-center gap-2 text-[12px] text-ink">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: corDoVendedor(v, vendedores) }} />
                        <span className="truncate">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Overlay: lista (tabela) */}
      {showLista && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowLista(false)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-[1200px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2 md:gap-3 p-3 border-b border-border shrink-0">
              <h2 className="text-[16px] font-semibold text-ink">Orçamentos cadastrados</h2>
              <span className="text-[12px] text-ink-muted">{sortedLista.length} de {lista.length}</span>
              <div className="relative ml-2">
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…" className="h-8 w-52 px-2 rounded-md bg-surface-2 border border-border text-[13px] text-ink outline-none focus:border-accent" />
              </div>
              <div className="flex h-8 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
                {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos']] as [VendFiltro, string][]).map(([v, label]) => (
                  <button key={v} onClick={() => setVendFiltro(v)} className={`px-2.5 ${vendFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              <button onClick={baixarCSV} className="h-8 px-3 rounded-md bg-accent-bg border border-accent/30 text-accent text-[12px] font-semibold ml-auto">⬇ CSV</button>
              <button onClick={() => setShowLista(false)} className="h-8 w-8 rounded-md hover:bg-surface-2 text-ink-muted">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-[12px] table-fixed">
                <colgroup>
                  <col style={{ width: '92px' }} /><col style={{ width: '88px' }} /><col style={{ width: '190px' }} />
                  <col /><col style={{ width: '150px' }} /><col style={{ width: '108px' }} /><col style={{ width: '92px' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-surface-2 text-ink-muted">
                  <tr className="text-left">
                    {([['numero', 'Nº', ''], ['data', 'Data', ''], ['cliente', 'Cliente', ''], [null, 'Equipamento', ''], ['cidade', 'Cidade', ''], ['total', 'Total', 'text-right'], ['vendido', 'Status', '']] as [typeof sortKey | null, string, string][]).map(([k, label, cls]) => (
                      <th key={label} className={`px-3 py-2 font-semibold ${cls} ${k ? 'cursor-pointer select-none hover:text-ink' : ''}`} onClick={() => k && ordenarPor(k)}>
                        {label}{k && sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedLista.map((r, i) => (
                    <tr key={i} onClick={() => focarLinha(r)}
                        className={`border-t border-border hover:bg-accent-bg/40 ${r.lat != null ? 'cursor-pointer' : ''}`}
                        title={r.lat != null ? 'Ver no mapa' : 'Sem localização'}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-muted">{r.numero}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-muted">{dataBR(r.data_emissao)}</td>
                      <td className="px-3 py-1.5 text-ink font-medium truncate" title={r.cliente || ''}>{r.cliente || '—'}</td>
                      <td className={`px-3 py-1.5 truncate ${r.equipamento === '(venda sem orçamento)' ? 'text-ink-faint italic' : 'text-ink-muted'}`} title={r.equipamento || ''}>{r.equipamento || '—'}</td>
                      <td className="px-3 py-1.5 truncate text-ink-muted" title={[r.cidade, r.uf].filter(Boolean).join(' - ')}>{[r.cidade, r.uf].filter(Boolean).join(' - ') || '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-right tabular-nums text-ink">{brl(r.total)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {r.vendido
                          ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">✓ Vendido</span>
                          : <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">Orçado</span>}
                      </td>
                    </tr>
                  ))}
                  {sortedLista.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">Nada encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-4 px-3 py-2 border-t border-border shrink-0 text-[12px] text-ink-muted bg-surface-2 rounded-b-xl">
              <span><b className="text-ink">{sortedLista.length}</b> orçamentos</span>
              <span>Soma: <b className="text-ink tabular-nums">{brl(somaTotal)}</b></span>
              <span className="ml-auto text-ink-faint">Clique numa linha pra ver no mapa · clique no cabeçalho pra ordenar</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
