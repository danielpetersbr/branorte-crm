// /frete/mapa — mapa das cotações de frete já respondidas. Cada ponto = um destino
// com valor cotado, transportadora e data (parâmetro histórico pro vendedor). Lê da
// view frete_mapa (lances respondidos com lat/lng). Leaflet + tiles Google.
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useFreteMapa, useTiposCaminhao, useFretesFeitos, useCriarFreteFeito, UFS_BR, type FreteMapaPonto, type FreteFeito } from '@/hooks/useFrete'
import { geocodificarCidade } from '@/lib/calcFrete'
import { PageLoading } from '@/components/ui/LoadingSpinner'

const CENTRO_BR: [number, number] = [-15.78, -47.93]
const VERDE = '#22c55e', AZUL = '#3b82f6', AMBAR = '#f59e0b'

function pinIcon(cor: string, n = 1): L.DivIcon {
  // Badge com a contagem quando há mais de uma cotação no mesmo destino
  // (várias transportadoras cotam a mesma cidade → pinos empilhados).
  const badge = n > 1
    ? `<div style="position:absolute;top:-7px;right:-9px;background:#0f172a;color:#fff;font-size:10px;font-weight:700;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:9px;padding:0 3px;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</div>`
    : ''
  return L.divIcon({
    className: 'frete-pin',
    html: `<div style="position:relative;width:22px;height:22px"><div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:${cor};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>${badge}</div>`,
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

// Popup de um DESTINO: lista TODAS as cotações daquele ponto (várias
// transportadoras cotam a mesma cidade). Ordena da mais barata pra mais cara.
function popupGrupo(ps: FreteMapaPonto[], caminhaoNome: (id: number | null) => string): string {
  const ordenados = [...ps].sort((a, b) => (a.valor ?? Infinity) - (b.valor ?? Infinity))
  const first = ordenados[0]
  const linhas = ordenados.map(p => {
    const data = p.respondido_em ? new Date(p.respondido_em).toLocaleDateString('pt-BR') : '—'
    const cam = caminhaoNome(p.caminhao_recomendado_id)
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:4px 0;border-top:1px solid #f1f5f9">
        <div style="min-width:0">
          <div style="font-size:12px;color:#0f172a">${esc(p.transportadora_nome)}${p.vencedor ? ' <b style="color:#16a34a">🏆</b>' : ''}</div>
          <div style="font-size:10px;color:#94a3b8">${p.prazo_dias != null ? `${p.prazo_dias} dias · ` : ''}${data}${cam ? ` · 🚚 ${esc(cam)}` : ''} · ${esc(p.codigo)}</div>
        </div>
        <div style="font-size:14px;font-weight:700;color:#22c55e;white-space:nowrap">${brl(p.valor)}</div>
      </div>`
  }).join('')
  return `
    <div style="min-width:230px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(equipLabel(first))}</div>
      <div style="font-size:12px;color:#64748b">${esc(first.cidade_destino)}/${esc(first.uf_destino)}${first.distancia_km ? ` · ${Math.round(first.distancia_km)} km` : ''} · <b>${ps.length} cotação${ps.length > 1 ? 'ões' : ''}</b></div>
      <div style="margin-top:4px">${linhas}</div>
    </div>`
}

function popupFeito(f: FreteFeito): string {
  const data = f.data_frete ? new Date(f.data_frete + 'T00:00:00').toLocaleDateString('pt-BR') : (f.created_at ? new Date(f.created_at).toLocaleDateString('pt-BR') : '—')
  return `
    <div style="min-width:190px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(f.item_nome)}</div>
      <div style="font-size:12px;color:#64748b">${esc(f.cidade_destino)}/${esc(f.uf_destino)}</div>
      <div style="font-size:16px;font-weight:700;color:#f59e0b;margin-top:4px">${brl(f.valor)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(f.transportadora_nome)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:3px">Frete feito · ${data}</div>
    </div>`
}

const inp = 'w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent'

function RegistrarFeitoModal({ onClose }: { onClose: () => void }) {
  const criar = useCriarFreteFeito()
  const [item, setItem] = useState(''); const [cidade, setCidade] = useState(''); const [uf, setUf] = useState('')
  const [valor, setValor] = useState(''); const [transp, setTransp] = useState(''); const [data, setData] = useState(''); const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false); const [erro, setErro] = useState('')
  async function salvar() {
    setErro('')
    if (!item.trim()) { setErro('Informe o equipamento/item.'); return }
    if (!cidade.trim() || !uf) { setErro('Informe cidade e UF do destino.'); return }
    setBusy(true)
    let lat: number | null = null, lng: number | null = null
    try { const c = await geocodificarCidade(cidade.trim(), uf); if (c) { lat = c.lat; lng = c.lng } } catch { /* segue sem geo */ }
    try {
      await criar.mutateAsync({
        item_nome: item.trim(), cidade_destino: cidade.trim(), uf_destino: uf,
        destino_lat: lat, destino_lng: lng,
        valor: valor ? Number(String(valor).replace(',', '.')) : null,
        transportadora_nome: transp.trim() || null, data_frete: data || null, observacoes: obs.trim() || null,
      })
      onClose()
    } catch (e: any) { setErro('Não consegui salvar: ' + (e?.message ?? e)) }
    finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface-1 border border-border rounded-2xl p-5 w-full max-w-md">
        <h2 className="text-lg font-bold text-ink mb-3">Registrar frete feito</h2>
        <div className="space-y-2.5">
          <div><label className="text-xs text-ink-faint block mb-1">Equipamento / item *</label>
            <input value={item} onChange={e => setItem(e.target.value)} className={inp} placeholder="Ex: Compacta 02" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className="text-xs text-ink-faint block mb-1">Cidade destino *</label>
              <input value={cidade} onChange={e => setCidade(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-ink-faint block mb-1">UF *</label>
              <select value={uf} onChange={e => setUf(e.target.value)} className={inp}><option value="">—</option>{UFS_BR.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-ink-faint block mb-1">Valor (R$)</label>
              <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" className={inp} placeholder="0,00" /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Data</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)} className={inp} /></div>
          </div>
          <div><label className="text-xs text-ink-faint block mb-1">Transportadora</label>
            <input value={transp} onChange={e => setTransp(e.target.value)} className={inp} /></div>
          <div><label className="text-xs text-ink-faint block mb-1">Observação</label>
            <input value={obs} onChange={e => setObs(e.target.value)} className={inp} /></div>
          {erro && <p className="text-sm text-red-500">{erro}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={salvar} disabled={busy} className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60">{busy ? 'Salvando…' : 'Salvar no mapa'}</button>
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-ink-muted hover:text-ink">Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FreteMapa() {
  const { data: pontos = [], isLoading } = useFreteMapa()
  const feitos = useFretesFeitos()
  const [modalFeito, setModalFeito] = useState(false)
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

  // Agrupa cotações que caem no MESMO destino (mesma lat/lng arredondada) —
  // várias transportadoras cotam a mesma cidade e os pinos ficam empilhados.
  // Um pino por destino; o popup lista todas as cotações daquele ponto.
  const grupos = useMemo(() => {
    const m = new Map<string, FreteMapaPonto[]>()
    for (const p of filtrados) {
      const key = `${p.destino_lat.toFixed(4)},${p.destino_lng.toFixed(4)}`
      const arr = m.get(key)
      if (arr) arr.push(p); else m.set(key, [p])
    }
    return [...m.values()]
  }, [filtrados])

  const feitosFiltrados = useMemo(() => (feitos.data ?? []).filter(f =>
    f.destino_lat != null && f.destino_lng != null &&
    (!uf || f.uf_destino === uf) &&
    (!termo || [f.cidade_destino, f.transportadora_nome, f.item_nome].some(x => (x || '').toLowerCase().includes(termo)))
  ), [feitos.data, uf, termo])

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
    for (const grp of grupos) {
      const p0 = grp[0]
      const algumVencedor = grp.some(p => p.vencedor)
      const m = L.marker([p0.destino_lat, p0.destino_lng], { icon: pinIcon(algumVencedor ? VERDE : AZUL, grp.length) })
      m.bindPopup(popupGrupo(grp, caminhaoNome), { maxHeight: 280 })
      m.addTo(layer)
      bounds.push([p0.destino_lat, p0.destino_lng])
    }
    for (const f of feitosFiltrados) {
      const m = L.marker([f.destino_lat as number, f.destino_lng as number], { icon: pinIcon(AMBAR) })
      m.bindPopup(popupFeito(f))
      m.addTo(layer)
      bounds.push([f.destino_lat as number, f.destino_lng as number])
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, feitosFiltrados, tipos.data])

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Mapa de Fretes</h1>
          <p className="text-[13px] text-ink-muted">{filtrados.length} cotação(ões) em {grupos.length} destino(s) · parâmetro histórico por região</p>
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
          <button onClick={() => setModalFeito(true)}
            className="h-9 px-3 rounded-md border border-accent/40 bg-accent text-white text-[13px] font-semibold hover:opacity-90">+ Frete feito</button>
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
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: AMBAR }} /> Frete feito</span>
        </div>
      </div>
      {modalFeito && <RegistrarFeitoModal onClose={() => setModalFeito(false)} />}
    </div>
  )
}

export default FreteMapa
