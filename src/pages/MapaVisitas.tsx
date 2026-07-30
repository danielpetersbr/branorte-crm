import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  useVisitas, useGeocodarVisitas, useOrcamentosMapa, useListaOrcamentos, useVendasMapaCount,
  useMapaMarcacoes, useSalvarMarcacao,
  type Visita, type OrcamentoPonto, type OrcamentoLinha, type Marcacao,
} from '@/hooks/useVisitas'
import { useEtiquetas } from '@/hooks/useEtiquetas'
import { useAuth } from '@/hooks/useAuth'
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

// Destaque de valor no mapa (só ORÇADOS, não vendidos):
//  • total ≥ 300 mil → 💎 diamante   • total ≥ 100 mil → ⭐ estrela
// A COR continua sendo a da idade (verde/vermelho/cinza); só a FORMA muda.
const LIMITE_ESTRELA = 100_000
const LIMITE_DIAMANTE = 300_000
function formaValor(total: number | null, vendido: boolean): 'diamante' | 'estrela' | null {
  if (vendido || total == null) return null
  if (total >= LIMITE_DIAMANTE) return 'diamante'
  if (total >= LIMITE_ESTRELA) return 'estrela'
  return null
}
// SVG puro (sem lib) da forma, preenchido com a cor da idade + contorno branco.
//  • estrela: geometria Lucide (pontas levemente arredondadas — visual mais limpo)
//  • diamante: gema lapidada = silhueta preenchida + facetas brancas por cima
function svgForma(forma: 'diamante' | 'estrela', cor: string, tam = 24): string {
  const open = `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))">`
  if (forma === 'estrela') {
    const p = 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'
    return `${open}<path d="${p}" fill="${cor}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`
  }
  return `${open}`
    + `<path d="M5 3H19L22 9L12 22L2 9Z" fill="${cor}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>`
    + `<g stroke="#fff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".85">`
    + `<path d="M2 9H22"/><path d="M5 3L12 9M19 3L12 9M12 9V22"/></g></svg>`
}
function iconeForma(forma: 'diamante' | 'estrela', cor: string): L.DivIcon {
  const tam = forma === 'diamante' ? 22 : 24
  return L.divIcon({
    className: 'orc-forma-valor',
    html: svgForma(forma, cor, tam),
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
    popupAnchor: [0, -tam / 2],
  })
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
// Valor curto pro painel por estado (a coluna é estreita): R$ 6,7 mi · R$ 904 mil
const brlCurto = (v: number) => {
  if (!v) return 'R$ 0'
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (v >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`
  return brl(v)
}
// UF normalizada. Sem estado vira '—' (bucket próprio) pra não colidir com ''=“todos”.
const ufKey = (uf: string | null) => (uf || '').trim().toUpperCase() || '—'
const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
const dataBR = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—')
const dataHoraBR = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
// Normaliza texto pra busca: sem acento, minúsculo (ex "Ji-Paraná" casa "ji parana")
const normTxt = (s: string | null) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Chave estável de um cliente pra marcação (telefone só-dígitos; senão nome normalizado).
function chaveMarc(telefone: string | null, fone: string | null, cliente: string | null): string {
  const tel = (telefone || fone || '').replace(/\D/g, '')
  return tel || ('nome:' + normTxt(cliente))
}
// Pino VISITADO (caso comum): um único ponto com o ✓ dentro, na cor da idade.
// Um blob só (sem bolinha extra colada) e é o próprio marcador clicável.
function iconeVisitado(cor: string): L.DivIcon {
  return L.divIcon({
    className: 'pin-visitado',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${cor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -9],
  })
}
// Selo ✓ pequeno no canto — usado só quando o pino já é estrela/diamante
// (aí não dá pra trocar a forma, então marca no cantinho). Não captura clique.
function checkIcon(): L.DivIcon {
  return L.divIcon({
    className: 'marc-check',
    html: `<div style="pointer-events:none;width:13px;height:13px;border-radius:50%;background:#16a34a;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.4)"><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>`,
    iconSize: [13, 13],
    iconAnchor: [-1, 15], // grudado no canto sup-direito da estrela/diamante
  })
}

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

function popupOrcamento(p: OrcamentoPonto, marc?: Marcacao | null, dist?: number): string {
  const tel = (p.telefone || '').replace(/\D/g, '')
  const foneFmt = p.fone || p.telefone || ''
  const loc = [esc(p.cidade), esc(p.uf)].filter(Boolean).join(' - ')
  const compras = p.vendido && p.n_vendas > 0 ? ` · ${p.n_vendas} compra${p.n_vendas > 1 ? 's' : ''}` : ''
  const vendBadge = p.vendido
    ? `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#dbeafe;color:#1e40af;font-weight:700">✓ VENDIDO${compras}</span>`
    : `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#fef9c3;color:#854d0e;font-weight:600">Orçado</span>`
  const feito = marc?.visitado
  const chave = chaveMarc(p.telefone, p.fone, p.cliente)
  const visitaLinha = feito
    ? `<div style="font-size:12px;color:#166534;font-weight:600;margin-top:6px">✅ Visita feita${marc?.visitado_em ? ' · ' + dataHoraBR(marc.visitado_em) : ''}${marc?.autor ? ' · ' + esc(marc.autor) : ''}</div>`
    : ''
  const notaLinha = marc?.nota
    ? `<div style="font-size:12px;color:#334155;margin-top:4px;white-space:pre-wrap;background:#f1f5f9;border-radius:6px;padding:5px 7px">📝 ${esc(marc.nota)}</div>`
    : ''
  const btn = `<button data-marcar data-chave="${encodeURIComponent(chave)}" style="margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:${feito ? '#e2e8f0' : '#16a34a'};color:${feito ? '#0f172a' : '#fff'};font-weight:700;font-size:12px;cursor:pointer">${feito ? '✏️ Editar visita / nota' : '✅ Marcar visita / anotar'}</button>`
  return `
    <div style="min-width:200px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(p.cliente) || 'Sem nome'}</div>
      ${loc ? `<div style="font-size:12px;color:#64748b">${loc}${dist != null ? ` · <b>${dist.toFixed(0)} km</b>` : ''}</div>` : ''}
      <div style="margin-top:4px">${vendBadge}</div>
      ${p.numeros ? `<div style="font-size:11px;color:#475569;margin-top:3px">🧾 Nº ${esc(p.numeros)}</div>` : ''}
      <div style="font-size:14px;font-weight:700;color:#10b981;margin-top:3px">${brl(p.total)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">${p.n_orcamentos} orçamento${p.n_orcamentos === 1 ? '' : 's'} · último ${dataBR(p.data_recente)} <b>(${idadeLabel(p.data_recente)})</b></div>
      <div style="font-size:11px;color:#64748b;margin-top:3px">Vendedor: ${esc(p.vendedor) || '—'}</div>
      ${foneFmt ? `<div style="font-size:12px;color:#0f172a;margin-top:4px">📱 ${esc(foneFmt)}</div>` : ''}
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
      ${visitaLinha}
      ${notaLinha}
      ${btn}
    </div>`
}

type VendFiltro = 'todos' | 'orcados' | 'vendidos' | 'alto' | 'diamante'
type VisitaFiltro = 'todos' | 'visitados' | 'pendentes'

export function MapaVisitas() {
  const { data: visitas = [], isLoading } = useVisitas()
  const { data: orcPontos = [], isLoading: loadingOrc, refetch: refetchOrc } = useOrcamentosMapa()
  const { data: lista = [] } = useListaOrcamentos()
  const { data: vendasCount = 0 } = useVendasMapaCount()
  const { data: etiquetasWa = [] } = useEtiquetas()
  const { data: marc = {} } = useMapaMarcacoes()
  const salvarMarc = useSalvarMarcacao()
  const { profile } = useAuth()
  const geocodar = useGeocodarVisitas()
  const [vendedorSel, setVendedorSel] = useState<string>('')
  const [showOrc, setShowOrc] = useState(true)
  const [showVis, setShowVis] = useState(false)
  const [busca, setBusca] = useState('')
  const [sugAberta, setSugAberta] = useState(false)
  const [vendFiltro, setVendFiltro] = useState<VendFiltro>('todos')
  const [visitaFiltro, setVisitaFiltro] = useState<VisitaFiltro>('todos')
  const [ufSel, setUfSel] = useState<string>('')   // '' = todos os estados
  const [ufSheet, setUfSheet] = useState(false)    // painel por estado no celular
  const [showLista, setShowLista] = useState(false)
  // modal de marcação (visita feita + anotação)
  const [marcarAlvo, setMarcarAlvo] = useState<{ chave: string; cliente: string | null; telefone: string | null } | null>(null)
  const [formVisitado, setFormVisitado] = useState(true)
  const [formNota, setFormNota] = useState('')
  // lookup chave -> dados do cliente (pro clique no botão do popup abrir o modal)
  const pontoInfoRef = useRef<Map<string, { cliente: string | null; telefone: string | null }>>(new Map())
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
  const canvasRef = useRef<L.Canvas | null>(null) // renderer canvas (pontos rápidos)
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
  // filtro por status/valor. 'alto' = orçado ≥100 mil (estrela+diamante);
  // 'diamante' = orçado ≥300 mil. Ambos só valem pra NÃO vendidos.
  const passaFiltro = (vendido: boolean, total: number | null) => {
    switch (vendFiltro) {
      case 'vendidos': return vendido
      case 'orcados': return !vendido
      case 'alto': return !vendido && (total ?? 0) >= LIMITE_ESTRELA
      case 'diamante': return !vendido && (total ?? 0) >= LIMITE_DIAMANTE
      default: return true // 'todos'
    }
  }
  // filtro de visita (só na camada de orçamentos do mapa)
  const passaVisita = (p: OrcamentoPonto) => {
    if (visitaFiltro === 'todos') return true
    const feito = !!marc[chaveMarc(p.telefone, p.fone, p.cliente)]?.visitado
    return visitaFiltro === 'visitados' ? feito : !feito
  }

  const visFiltradas = useMemo(
    () => comCoord.filter(v =>
      (!vendedorSel || (v.vendedor_nome || '—') === vendedorSel) &&
      (!ufSel || ufKey(v.estado) === ufSel) &&
      (!termo || [v.nome, v.cidade, v.estado, v.telefone, v.vendedor_nome, v.interesse]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    [comCoord, vendedorSel, termo, ufSel]
  )
  // Base = todos os filtros MENOS o de estado. É dela que sai o painel "por estado"
  // (se saísse de orcFiltrados, ao escolher um estado os outros sumiriam da lista).
  const orcBase = useMemo(
    () => orcPontos.filter(p =>
      (!vendedorSel || (p.vendedor || '—') === vendedorSel) &&
      passaFiltro(p.vendido, p.total) &&
      passaVisita(p) &&
      (!termo || [p.cliente, p.cidade, p.uf, p.telefone, p.fone, p.numeros, p.vendedor]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orcPontos, vendedorSel, termo, vendFiltro, visitaFiltro, marc]
  )
  const orcFiltrados = useMemo(
    () => (ufSel ? orcBase.filter(p => ufKey(p.uf) === ufSel) : orcBase),
    [orcBase, ufSel]
  )

  // Soma por ESTADO do que está no mapa. 1 valor por cliente: orçamento mais recente
  // (ou, se já comprou, a soma das vendas dele) — mesmo valor que decide ⭐/💎 no pino.
  const porUF = useMemo(() => {
    const m = new Map<string, { uf: string; n: number; total: number }>()
    for (const p of orcBase) {
      const k = ufKey(p.uf)
      const e = m.get(k) ?? { uf: k, n: 0, total: 0 }
      e.n++
      e.total += p.total || 0
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.n - a.n)
  }, [orcBase])
  const ufMaior = porUF[0]?.total || 1
  const ufSomaGeral = useMemo(() => porUF.reduce((s, u) => s + u.total, 0), [porUF])

  // Autocomplete de CIDADES: índice de cidades distintas (dos orçamentos) + contagem.
  const cidadesIndex = useMemo(() => {
    const m = new Map<string, { cidade: string; uf: string; n: number }>()
    for (const p of orcPontos) {
      if (!p.cidade) continue
      const key = (p.cidade + '|' + (p.uf || '')).toLowerCase()
      const e = m.get(key)
      if (e) e.n++
      else m.set(key, { cidade: p.cidade, uf: p.uf || '', n: 1 })
    }
    return [...m.values()]
  }, [orcPontos])

  // Sugestões conforme digita: "começa com" primeiro, depois mais clientes. Top 8.
  const sugestoesCidade = useMemo(() => {
    const q = normTxt(busca)
    if (q.length < 2) return []
    return cidadesIndex
      .filter(c => normTxt(c.cidade + ' ' + c.uf).includes(q))
      .sort((a, b) => {
        const sa = normTxt(a.cidade).startsWith(q) ? 0 : 1
        const sb = normTxt(b.cidade).startsWith(q) ? 0 : 1
        return sa - sb || b.n - a.n
      })
      .slice(0, 8)
  }, [busca, cidadesIndex])

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
    let verde = 0, vermelho = 0, cinza = 0, vendido = 0, estrela = 0, diamante = 0
    for (const p of orcFiltrados) {
      if (p.vendido) { vendido++; continue }
      const f = formaValor(p.total, p.vendido)
      if (f === 'diamante') diamante++; else if (f === 'estrela') estrela++
      const c = corIdade(p.data_recente)
      if (c === VERDE) verde++; else if (c === VERMELHO) vermelho++; else cinza++
    }
    return { verde, vermelho, cinza, vendido, estrela, diamante }
  }, [orcFiltrados])

  // lista (tabela) filtrada
  const listaFiltrada = useMemo(() => {
    return lista.filter(r =>
      passaFiltro(r.vendido, r.total) &&
      (!ufSel || ufKey(r.uf) === ufSel) &&
      (!termo || [r.numero, r.cliente, r.equipamento, r.cidade, r.uf]
        .some(x => (x || '').toLowerCase().includes(termo)))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, termo, vendFiltro, ufSel])

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

  // lookup chave -> {cliente, telefone} (o clique no botão do popup usa isso)
  useEffect(() => {
    const m = new Map<string, { cliente: string | null; telefone: string | null }>()
    for (const p of orcPontos) m.set(chaveMarc(p.telefone, p.fone, p.cliente), { cliente: p.cliente, telefone: p.telefone || p.fone })
    pontoInfoRef.current = m
  }, [orcPontos])

  // ao abrir o modal, preenche o form com a marcação existente (se houver)
  useEffect(() => {
    if (!marcarAlvo) return
    const ex = marc[marcarAlvo.chave]
    setFormVisitado(ex?.visitado ?? true)
    setFormNota(ex?.nota ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcarAlvo])

  function salvarMarcacao() {
    if (!marcarAlvo) return
    const ex = marc[marcarAlvo.chave]
    salvarMarc.mutate({
      chave: marcarAlvo.chave,
      telefone: marcarAlvo.telefone,
      cliente: marcarAlvo.cliente,
      visitado: formVisitado,
      // mantém a data original se já estava visitado; senão o hook carimba agora
      visitado_em: formVisitado && ex?.visitado ? ex.visitado_em : null,
      nota: formNota.trim() || null,
      autor: profile?.display_name || profile?.email || null,
    }, { onSuccess: () => setMarcarAlvo(null) })
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
    L.control.layers({ 'Mapa': mapa, 'Satélite': satelite }, {}, { collapsed: false, position: 'bottomleft' }).addTo(map)
    // Pontos individuais em CANVAS: pinta milhares de círculos coloridos num único
    // canvas (rápido no celular, sem milhares de elementos no DOM). 1 ponto = 1 cliente,
    // cor pela idade/vendido. Sem cluster (o usuário quer ver os pontos, não as bolas).
    canvasRef.current = L.canvas({ padding: 0.5 })
    layerRef.current = L.layerGroup().addTo(map)
    raioLayerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (modoRaioRef.current) setCentro({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    // botão "marcar visita" dentro do popup abre o modal (React)
    map.on('popupopen', (e: L.PopupEvent) => {
      const btn = e.popup.getElement()?.querySelector('button[data-marcar]') as HTMLButtonElement | null
      if (!btn) return
      btn.onclick = () => {
        const chave = decodeURIComponent(btn.dataset.chave || '')
        const info = pontoInfoRef.current.get(chave)
        setMarcarAlvo({ chave, cliente: info?.cliente ?? null, telefone: info?.telefone ?? null })
        map.closePopup()
      }
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
    const renderer = canvasRef.current ?? undefined
    const bounds: [number, number][] = []
    if (showVis) {
      for (const v of visFiltradas) {
        const { nomes, isFollowUp } = resolverEtiquetas(v)
        const cor = isFollowUp ? corDoVendedor(v.vendedor_nome, vendedores) : CINZA
        const m = L.circleMarker([v.lat as number, v.lng as number], {
          renderer, radius: isFollowUp ? 6 : 5, fillColor: cor, color: '#fff', weight: 1, fillOpacity: isFollowUp ? 0.95 : 0.7,
        })
        // popup lazy: só monta o HTML quando abre
        m.bindPopup(() => popupVisita(v, isFollowUp, nomes))
        m.addTo(layer)
        bounds.push([v.lat as number, v.lng as number])
      }
    }
    if (showOrc) {
      for (const p of orcFiltrados) {
        const mk = marc[chaveMarc(p.telefone, p.fone, p.cliente)]
        const visitado = !!mk?.visitado
        const forma = formaValor(p.total, p.vendido)
        const m = forma
          // orçado de alto valor → estrela/diamante (marcador DOM, cor pela idade)
          ? L.marker([p.lat, p.lng], { icon: iconeForma(forma, corOrcamento(p)) })
          : visitado
            // visitado (comum) → ponto único com ✓ dentro
            ? L.marker([p.lat, p.lng], { icon: iconeVisitado(corOrcamento(p)) })
            // demais → círculo no canvas (rápido pra milhares de pontos)
            : L.circleMarker([p.lat, p.lng], {
                renderer, radius: 5, fillColor: corOrcamento(p), color: '#fff', weight: 1, fillOpacity: 0.92,
              })
        m.bindPopup(() => popupOrcamento(p, mk))
        m.addTo(layer)
        // estrela/diamante visitado mantém a forma; ✓ vai num selinho no canto
        if (visitado && forma) L.marker([p.lat, p.lng], { icon: checkIcon(), interactive: false, zIndexOffset: 1000 }).addTo(layer)
        bounds.push([p.lat, p.lng])
      }
    }
    if (bounds.length && !centro) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVis, showOrc, visFiltradas, orcFiltrados, vendedores, byVendId, globId, marc])

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
    L.popup().setLatLng([p.lat, p.lng]).setContent(popupOrcamento(p, marc[chaveMarc(p.telefone, p.fone, p.cliente)])).openOn(map)
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

  // Com 'todos' a soma mistura orçado em aberto + vendido, então o rótulo não pode dizer "Orçado".
  const rotuloValor = vendFiltro === 'vendidos' ? 'Vendido' : vendFiltro === 'todos' ? 'Valor' : 'Orçado'

  // Lista "por estado" — barra proporcional ao valor; clicar filtra o mapa naquele estado.
  const listaUF = (cls: string, aoEscolher?: () => void) => (
    <ul className={`space-y-0.5 ${cls}`}>
      {porUF.map(u => (
        <li key={u.uf}>
          <button
            onClick={() => { setUfSel(s => (s === u.uf ? '' : u.uf)); aoEscolher?.() }}
            title={`${u.uf === '—' ? 'Sem estado no cadastro' : u.uf} · ${u.n} cliente${u.n === 1 ? '' : 's'} · ${brl(u.total)}`}
            className={`relative w-full overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors ${ufSel === u.uf ? 'bg-accent-bg ring-1 ring-accent/40' : 'hover:bg-surface-2 active:bg-surface-2'}`}
          >
            <span className="absolute inset-y-0 left-0 bg-accent/15 pointer-events-none"
                  style={{ width: `${Math.max(2, (u.total / ufMaior) * 100)}%` }} />
            <span className="relative flex items-center gap-2">
              <span className="w-7 shrink-0 text-[12px] font-bold text-ink">{u.uf}</span>
              <span className="text-[10px] tabular-nums text-ink-faint">{u.n}</span>
              <span className="ml-auto text-[12px] font-semibold tabular-nums text-ink">{brlCurto(u.total)}</span>
            </span>
          </button>
        </li>
      ))}
      {porUF.length === 0 && <li className="text-[12px] text-ink-muted px-2 py-1.5">Nenhum cliente no filtro atual.</li>}
    </ul>
  )

  return (
    <div className="relative flex flex-col overflow-hidden md:p-4 md:gap-3 h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
      {/* selo ✓ não pode capturar clique — senão não dá pra abrir o popup do pino visitado */}
      <style>{`.leaflet-marker-icon.marc-check{pointer-events:none!important}`}</style>
      {/* HEADER + TOOLBAR — só no desktop. No celular o mapa é tela cheia com filtros flutuantes. */}
      <div className="hidden md:flex flex-wrap items-center justify-between gap-2 md:gap-3 shrink-0">
        <div>
          <h1 className="text-[18px] md:text-[22px] font-semibold text-ink tracking-tight">Mapa de Visitas</h1>
          <p className="text-[13px] text-ink-muted">
            {showOrc && <>{orcFiltrados.length} clientes com orçamento{orcStats.vendido > 0 && <> · <span className="text-blue-600 font-semibold">{orcStats.vendido} vendidos</span></>}</>}
            {showOrc && showVis && ' · '}
            {showVis && <>{visFiltradas.length} visitas{semCoord > 0 && <> · <span className="text-warning">{semCoord} sem localização</span></>}</>}
            {!showOrc && !showVis && 'Ligue uma camada pra ver os pontos'}
            {ufSel && (
              <> · <button onClick={() => setUfSel('')} className="text-accent font-semibold hover:underline" title="Mostrar o Brasil todo">
                {ufSel === '—' ? 'sem estado' : ufSel} ✕
              </button></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative w-full sm:w-auto">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint pointer-events-none">🔍</span>
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); setSugAberta(true) }}
              onFocus={() => setSugAberta(true)}
              onBlur={() => window.setTimeout(() => setSugAberta(false), 150)}
              onKeyDown={e => { if (e.key === 'Escape') setSugAberta(false) }}
              placeholder="Buscar cidade, cliente, telefone, Nº…"
              autoComplete="off"
              className="h-9 w-full sm:w-56 pl-8 pr-7 rounded-md bg-surface border border-border text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
            />
            {busca && (
              <button onClick={() => { setBusca(''); setSugAberta(false) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-[13px]" title="Limpar busca">✕</button>
            )}
            {/* Autocomplete de cidades — aparece ao digitar; toca pra filtrar+zoom naquela cidade */}
            {sugAberta && sugestoesCidade.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-[1200] max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
                <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-faint select-none">Cidades</li>
                {sugestoesCidade.map((c, i) => (
                  <li key={i}>
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setBusca(c.cidade); setSugAberta(false) }}
                      className="w-full text-left px-3 py-2.5 hover:bg-surface-2 active:bg-surface-2 flex items-center gap-2"
                    >
                      <span className="text-[13px] shrink-0">📍</span>
                      <span className="flex-1 truncate text-[13px] text-ink">{c.cidade}{c.uf ? ` - ${c.uf}` : ''}</span>
                      <span className="text-[11px] tabular-nums text-ink-faint shrink-0">{c.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* No celular os controles ficam numa faixa que ROLA na horizontal (não empilham
              comendo a tela). md:contents remove o wrapper no desktop → volta ao flex-wrap original. */}
          <div className="flex items-center gap-2 w-full overflow-x-auto flex-nowrap md:contents pb-1 [&>*]:shrink-0">
          {/* filtro vendido / orçado */}
          <div className="flex h-9 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
            {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos'], ['alto', '⭐ Alto valor'], ['diamante', '💎 ≥300 mil']] as [VendFiltro, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setVendFiltro(v)}
                className={`px-2.5 transition-colors ${vendFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* filtro de visita */}
          <div className="flex h-9 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
            {([['todos', 'Todas'], ['visitados', '✅ Visitadas'], ['pendentes', '⏳ A visitar']] as [VisitaFiltro, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setVisitaFiltro(v)}
                className={`px-2.5 transition-colors ${visitaFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>
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
      </div>

      {/* barra do modo raio */}
      {modoRaio && (
        <div className="shrink-0 rounded-md border border-sky-300 bg-sky-50 text-[12px] text-sky-900 px-3 py-2 hidden md:flex flex-wrap items-center gap-3">
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
        <div className="hidden md:block shrink-0 rounded-md border border-border bg-surface-2 text-[12px] text-ink-muted px-3 py-2">
          {geocodar.data.atualizados} localizado(s).
          {geocodar.data.falhas?.length ? ` Não achei: ${geocodar.data.falhas.join(', ')}.` : ''}
        </div>
      )}

      <div className="relative flex-1 min-h-0 md:flex md:gap-3">
        <div ref={divRef} className="absolute inset-0 md:static md:flex-1 md:rounded-xl md:border md:border-border overflow-hidden z-0" />
        {(isLoading || loadingOrc) && (
          <div className="absolute inset-0 flex items-center justify-center z-[400]"><PageLoading /></div>
        )}

        {/* ===== MOBILE: filtros flutuando SOBRE o mapa (tela cheia) ===== */}
        <div className="md:hidden absolute top-2 left-2 right-2 z-[1000] flex flex-col gap-2 pointer-events-none">
          <div className="relative pointer-events-auto">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-faint pointer-events-none">🔍</span>
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); setSugAberta(true) }}
              onFocus={() => setSugAberta(true)}
              onBlur={() => window.setTimeout(() => setSugAberta(false), 150)}
              onKeyDown={e => { if (e.key === 'Escape') setSugAberta(false) }}
              placeholder="Buscar cidade, cliente…"
              autoComplete="off"
              className="h-11 w-full pl-9 pr-9 rounded-xl bg-surface/95 backdrop-blur border border-border text-[15px] text-ink placeholder:text-ink-faint outline-none focus:border-accent shadow"
            />
            {busca && (
              <button onClick={() => { setBusca(''); setSugAberta(false) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint text-[16px]" title="Limpar">✕</button>
            )}
            {sugAberta && sugestoesCidade.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-[1200] max-h-[50vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-lg py-1">
                <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-faint select-none">Cidades</li>
                {sugestoesCidade.map((c, i) => (
                  <li key={i}>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setBusca(c.cidade); setSugAberta(false) }} className="w-full text-left px-3 py-3 active:bg-surface-2 flex items-center gap-2">
                      <span className="text-[14px] shrink-0">📍</span>
                      <span className="flex-1 truncate text-[14px] text-ink">{c.cidade}{c.uf ? ` - ${c.uf}` : ''}</span>
                      <span className="text-[12px] tabular-nums text-ink-faint shrink-0">{c.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto flex-nowrap [&>*]:shrink-0">
            <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface/95 backdrop-blur text-[12px] font-semibold shadow">
              {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos'], ['alto', '⭐ Alto valor'], ['diamante', '💎 ≥300 mil']] as [VendFiltro, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setVendFiltro(v)} className={`px-3 ${vendFiltro === v ? 'bg-accent text-white' : 'text-ink-muted'}`}>{label}</button>
              ))}
            </div>
            <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface/95 backdrop-blur text-[12px] font-semibold shadow">
              {([['todos', 'Todas'], ['visitados', '✅'], ['pendentes', '⏳']] as [VisitaFiltro, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setVisitaFiltro(v)} className={`px-3 ${visitaFiltro === v ? 'bg-accent text-white' : 'text-ink-muted'}`} title={v === 'visitados' ? 'Visitadas' : v === 'pendentes' ? 'A visitar' : 'Todas'}>{label}</button>
              ))}
            </div>
            <button onClick={() => { setModoRaio(v => !v); if (modoRaio) setCentro(null) }} className={`h-9 px-3 rounded-lg border text-[12px] font-semibold shadow ${modoRaio ? 'bg-accent text-white border-accent' : 'bg-surface/95 backdrop-blur border-border text-ink-muted'}`}>🎯 Raio</button>
            <button onClick={() => setShowVis(v => !v)} className={`h-9 px-3 rounded-lg border text-[12px] font-semibold shadow ${showVis ? 'bg-accent text-white border-accent' : 'bg-surface/95 backdrop-blur border-border text-ink-muted'}`}>📍 Visitas</button>
            <button onClick={() => setUfSheet(true)} className={`h-9 px-3 rounded-lg border text-[12px] font-semibold shadow ${ufSel ? 'bg-accent text-white border-accent' : 'bg-surface/95 backdrop-blur border-border text-ink-muted'}`}>🗺️ {ufSel || 'Estados'}</button>
          </div>
          {modoRaio && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface/95 backdrop-blur border border-border px-3 py-2 text-[12px] text-ink shadow">
              {!centro ? <span className="text-ink-muted">Toque no mapa pra centrar</span> : <span className="shrink-0"><b>{noRaio.length}</b> em {raioKm}km</span>}
              <input type="range" min={10} max={1000} step={10} value={raioKm} onChange={e => setRaioKm(Number(e.target.value))} className="flex-1 min-w-0" />
              {centro && <button onClick={() => setCentro(null)} className="text-accent shrink-0">limpar</button>}
            </div>
          )}
        </div>

        {/* ===== MOBILE: legenda flutuante (canto inferior esquerdo) ===== */}
        <div className="md:hidden absolute left-2 bottom-2 z-[1000] bg-surface/90 backdrop-blur rounded-lg border border-border px-2.5 py-2 text-[11px] shadow pointer-events-none">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VERDE }} /><span className="text-ink-muted">Até 1 mês</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.verde}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VERMELHO }} /><span className="text-ink-muted">1–3 meses</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.vermelho}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CINZA_VELHO }} /><span className="text-ink-muted">+3 meses</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.cinza}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AZUL_VENDIDO }} /><span className="text-ink-muted font-semibold">Vendido</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.vendido}</span></div>
            {(orcStats.estrela > 0 || orcStats.diamante > 0) && (
              <div className="mt-1 pt-1 border-t border-border flex flex-col gap-1">
                <div className="flex items-center gap-1.5"><span className="w-3 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('estrela', '#64748b', 13) }} /><span className="text-ink-muted">⭐ ≥ 100 mil</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.estrela}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('diamante', '#64748b', 12) }} /><span className="text-ink-muted">💎 ≥ 300 mil</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.diamante}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* sidebar (legenda / lista do raio) — só no desktop */}
        <div className="hidden md:block w-56 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto">
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
                  {(orcStats.estrela > 0 || orcStats.diamante > 0) && (
                    <>
                      <div className="text-[11px] uppercase tracking-wide text-ink-faint mt-3 mb-2">Orçado · por valor</div>
                      <ul className="space-y-1.5">
                        <li className="flex items-center gap-2 text-[12px] text-ink"><span className="shrink-0 w-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('estrela', '#64748b', 16) }} /><span className="truncate">⭐ ≥ 100 mil</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.estrela}</span></li>
                        <li className="flex items-center gap-2 text-[12px] text-ink"><span className="shrink-0 w-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('diamante', '#64748b', 15) }} /><span className="truncate">💎 ≥ 300 mil</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.diamante}</span></li>
                      </ul>
                    </>
                  )}
                  {vendasCount > 0 && (
                    <div className="text-[10px] text-ink-faint mt-1.5 leading-snug">
                      {orcStats.vendido} clientes vendidos · {vendasCount.toLocaleString('pt-BR')} vendas no total
                      <br />(1 pino por cliente — quem comprou +1x conta como 1)
                    </div>
                  )}

                  {/* ===== Soma por ESTADO (clique filtra o mapa) ===== */}
                  {porUF.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                          {rotuloValor} · por estado
                        </span>
                        {ufSel && (
                          <button onClick={() => setUfSel('')} className="ml-auto text-[10px] font-semibold text-accent hover:underline">
                            limpar
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] text-ink-faint mb-2 leading-snug"
                           title="Soma dos pinos exibidos: 1 valor por cliente — o orçamento mais recente dele (ou a soma das vendas, se já comprou).">
                        Total <b className="text-ink-muted tabular-nums">{brl(ufSomaGeral)}</b> · 1 valor por cliente
                      </div>
                      {listaUF('max-h-[42vh] overflow-y-auto -mx-1 px-1')}
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

      {/* Celular: folha "por estado" (mesma soma da sidebar do desktop) */}
      {ufSheet && (
        <div className="md:hidden fixed inset-0 z-[1300] bg-black/40 flex items-end" onClick={() => setUfSheet(false)}>
          <div className="bg-surface w-full rounded-t-2xl border-t border-border p-4 pb-safe max-h-[78vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold text-ink">{rotuloValor} por estado</div>
              {ufSel && <button onClick={() => { setUfSel(''); setUfSheet(false) }} className="ml-auto text-[13px] font-semibold text-accent">Brasil todo</button>}
              <button onClick={() => setUfSheet(false)} className={`h-8 w-8 rounded-md text-ink-muted ${ufSel ? '' : 'ml-auto'}`}>✕</button>
            </div>
            <div className="text-[11px] text-ink-faint mt-1 mb-2 leading-snug">
              Total <b className="text-ink-muted tabular-nums">{brl(ufSomaGeral)}</b> · 1 valor por cliente · toque num estado pra filtrar o mapa
            </div>
            {listaUF('flex-1 overflow-y-auto -mx-1 px-1', () => setUfSheet(false))}
          </div>
        </div>
      )}

      {/* Overlay: lista (tabela) */}
      {showLista && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowLista(false)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-[1200px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2 md:gap-3 p-3 border-b border-border shrink-0">
              <h2 className="text-[16px] font-semibold text-ink">Orçamentos cadastrados</h2>
              <span className="text-[12px] text-ink-muted">{sortedLista.length} de {lista.length}</span>
              {ufSel && (
                <button onClick={() => setUfSel('')} className="text-[12px] font-semibold text-accent hover:underline" title="Tirar o filtro de estado">
                  {ufSel === '—' ? 'sem estado' : ufSel} ✕
                </button>
              )}
              <div className="relative ml-2">
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…" className="h-8 w-52 px-2 rounded-md bg-surface-2 border border-border text-[13px] text-ink outline-none focus:border-accent" />
              </div>
              <div className="flex h-8 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
                {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos'], ['alto', '⭐ Alto valor'], ['diamante', '💎 ≥300 mil']] as [VendFiltro, string][]).map(([v, label]) => (
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

      {/* Modal: marcar visita + anotação */}
      {marcarAlvo && (
        <div className="fixed inset-0 z-[1300] bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setMarcarAlvo(null)}>
          <div className="bg-surface w-full md:max-w-md rounded-t-2xl md:rounded-2xl border border-border p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-ink truncate">{marcarAlvo.cliente || 'Cliente'}</div>
                {marcarAlvo.telefone && <div className="text-[12px] text-ink-muted">📱 {marcarAlvo.telefone}</div>}
              </div>
              <button onClick={() => setMarcarAlvo(null)} className="h-8 w-8 shrink-0 rounded-md hover:bg-surface-2 text-ink-muted">✕</button>
            </div>
            <label className="flex items-center gap-2 text-[14px] text-ink cursor-pointer select-none">
              <input type="checkbox" checked={formVisitado} onChange={e => setFormVisitado(e.target.checked)} className="h-4 w-4 accent-green-600" />
              <span className="font-medium">✅ Visita já realizada</span>
            </label>
            <div>
              <div className="text-[12px] text-ink-muted mb-1">Anotação</div>
              <textarea
                value={formNota}
                onChange={e => setFormNota(e.target.value)}
                rows={4}
                placeholder="Ex: cliente pediu retorno em 15 dias · tem interesse na Compacta 02 · achou o preço alto…"
                className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-[14px] text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-none"
              />
            </div>
            {marc[marcarAlvo.chave]?.updated_at && (
              <div className="text-[11px] text-ink-faint">
                Última atualização{marc[marcarAlvo.chave]?.autor ? ` por ${marc[marcarAlvo.chave]?.autor}` : ''} · {dataHoraBR(marc[marcarAlvo.chave]?.updated_at ?? null)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={salvarMarcacao} disabled={salvarMarc.isPending}
                className="flex-1 h-11 rounded-lg bg-accent text-white font-semibold text-[14px] disabled:opacity-60">
                {salvarMarc.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            {salvarMarc.isError && <div className="text-[12px] text-red-600">Não consegui salvar. Tenta de novo.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
