import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useListaOrcamentos } from '@/hooks/useVisitas'
import { useTerritorios, useSalvarTerritorios, type MapaTerritorio } from '@/hooks/useTerritorios'
import { useAuth } from '@/hooks/useAuth'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  REPRESENTANTES, UF_NOME, TODAS_UFS, COR_SEM_DONO, type Representante,
} from '@/lib/representantes'

// Mapa de Representantes — território comercial por estado (tela de admin).
// Diferente do /mapa-visitas (1 pino por cliente), aqui o BRASIL é pintado: cada UF
// recebe a cor do representante dono. Sem tiles — é mapa de território, não de rua.
// Os números por estado saem do mesmo RPC do mapa de visitas (lista_orcamentos_mapa),
// 1 linha por orçamento: vendido / em aberto / R$ em aberto.
//
// MODO EDIÇÃO: escolhe um representante (pincel) e clica nos estados pra passar a
// região pra ele. Os números do painel recalculam a cada clique — dá pra simular a
// divisão ANTES de salvar. Salvar grava em public.representante_territorios.

type Metrica = 'carteira' | 'abertos' | 'vendidos' | 'pipeline'

const METRICAS: { id: Metrica; label: string; curto: string; dinheiro?: boolean }[] = [
  { id: 'carteira', label: 'Carteira (registros)', curto: 'Carteira' },
  { id: 'abertos', label: 'Orçamentos em aberto', curto: 'Em aberto' },
  { id: 'vendidos', label: 'Vendas fechadas', curto: 'Vendidos' },
  { id: 'pipeline', label: 'R$ em aberto', curto: 'Pipeline R$', dinheiro: true },
]

interface StatUf { carteira: number; abertos: number; vendidos: number; pipeline: number }
const ZERO: StatUf = { carteira: 0, abertos: 0, vendidos: 0, pipeline: 0 }

const brlCurto = (v: number) => {
  if (!v) return 'R$ 0'
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (v >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
const num = (v: number) => v.toLocaleString('pt-BR')
const fmt = (v: number, m: Metrica) => (m === 'pipeline' ? brlCurto(v) : num(v))

// Parte dos dados foi digitada/importada com letras CIRÍLICAS que parecem latinas
// (ex.: "AМ" com М cirílico caía fora do Amazonas e sumia da conta). Converte antes de casar a UF.
const CIRILICO_P_LATINO: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
}
const normUf = (uf: string | null) =>
  (uf || '').trim().toUpperCase().replace(/[АВЕКМНОРСТХ]/g, c => CIRILICO_P_LATINO[c] ?? c)

const REP_POR_ID: Record<string, Representante> = Object.fromEntries(REPRESENTANTES.map(r => [r.id, r]))

export function MapaRepresentantes() {
  const { data: linhas, isLoading } = useListaOrcamentos()
  const { data: territorioSalvo } = useTerritorios()
  const salvar = useSalvarTerritorios()
  const { profile } = useAuth()

  const [metrica, setMetrica] = useState<Metrica>('carteira')
  const [selecionado, setSelecionado] = useState<string | null>(null) // rep destacado
  const [rascunho, setRascunho] = useState<MapaTerritorio | null>(null) // null = fora do modo edição
  const [pincel, setPincel] = useState<string | null>(null) // rep que recebe o próximo clique

  const editando = rascunho !== null
  const territorio = rascunho ?? territorioSalvo ?? {}

  const mudancas = useMemo(() => {
    if (!rascunho || !territorioSalvo) return []
    return TODAS_UFS
      .filter(uf => rascunho[uf] !== territorioSalvo[uf])
      .map(uf => ({ uf, de: territorioSalvo[uf], para: rascunho[uf] }))
  }, [rascunho, territorioSalvo])

  const semDono = useMemo(() => TODAS_UFS.filter(uf => !territorio[uf]), [territorio])

  // ── Agregado por UF (1 passada nas ~4 mil linhas) ────────────────────────
  const porUf = useMemo(() => {
    const m: Record<string, StatUf> = {}
    for (const uf of TODAS_UFS) m[uf] = { ...ZERO }
    for (const l of linhas ?? []) {
      const s = m[normUf(l.uf)]
      if (!s) continue // UF fora do Brasil (exterior) fica de fora do mapa
      s.carteira++
      if (l.vendido) s.vendidos++
      else { s.abertos++; s.pipeline += Number(l.total) || 0 }
    }
    return m
  }, [linhas])

  // ── Agregado por representante + comparação com a média ──────────────────
  // Recalcula a cada pincelada: é o que mostra se a divisão nova ficou justa.
  const carteiras = useMemo(() => {
    const porRep: Record<string, StatUf> = {}
    for (const r of REPRESENTANTES) porRep[r.id] = { ...ZERO }
    for (const uf of TODAS_UFS) {
      const alvo = porRep[territorio[uf]]
      if (!alvo) continue
      const s = porUf[uf] ?? ZERO
      alvo.carteira += s.carteira; alvo.abertos += s.abertos
      alvo.vendidos += s.vendidos; alvo.pipeline += s.pipeline
    }
    const lista = REPRESENTANTES.map(r => ({
      rep: r,
      ufs: TODAS_UFS.filter(uf => territorio[uf] === r.id),
      ...porRep[r.id],
    }))
    const total = lista.reduce((a, c) => a + c[metrica], 0)
    const media = lista.length ? total / lista.length : 0
    return {
      total, media,
      max: Math.max(...lista.map(l => l[metrica]), 1),
      itens: lista
        .map(l => ({ ...l, valor: l[metrica], desvio: media ? (l[metrica] - media) / media : 0 }))
        .sort((a, b) => b.valor - a.valor),
    }
  }, [porUf, territorio, metrica])

  // ── Mapa ─────────────────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GeoJSON | null>(null)
  const [erroGeo, setErroGeo] = useState(false)
  // o handler de clique do Leaflet é ligado uma vez — lê o estado atual por ref
  const estadoRef = useRef({ porUf, territorio, selecionado, editando, pincel })
  estadoRef.current = { porUf, territorio, selecionado, editando, pincel }

  function clicarUf(uf: string) {
    const { editando: ed, pincel: p } = estadoRef.current
    if (ed) {
      if (!p) return // sem pincel escolhido, clique no mapa não faz nada
      setRascunho(r => (r ? { ...r, [uf]: p } : r))
      return
    }
    const dono = REP_POR_ID[estadoRef.current.territorio[uf]]
    setSelecionado(s => (dono && s !== dono.id ? dono.id : null))
  }

  // cria o mapa + carrega o GeoJSON uma vez
  useEffect(() => {
    const el = divRef.current
    if (!el) return
    const map = L.map(el, {
      zoomControl: true, attributionControl: false, zoomSnap: 0.1,
      scrollWheelZoom: true, maxZoom: 8, minZoom: 2,
    })
    mapRef.current = map
    el.style.background = 'transparent'
    let cancelado = false

    fetch('/brasil-estados.geojson')
      .then(r => { if (!r.ok) throw new Error('geojson'); return r.json() })
      .then((geo: GeoJSON.FeatureCollection) => {
        if (cancelado) return
        const layer = L.geoJSON(geo, {
          style: () => ({ fillColor: COR_SEM_DONO, weight: 1, color: '#0f172a', fillOpacity: 0.9 }),
          onEachFeature: (f, lyr) => {
            const uf = (f.properties as { sigla?: string })?.sigla ?? ''
            lyr.on('click', () => clicarUf(uf))
          },
        }).addTo(map)
        layerRef.current = layer

        // sigla no centro de cada estado (marcador separado — o polígono já usa o
        // tooltip do hover e um layer só aceita um tooltip por vez)
        for (const lyr of layer.getLayers()) {
          const f = (lyr as L.GeoJSON).feature as GeoJSON.Feature | undefined
          const uf = (f?.properties as { sigla?: string })?.sigla ?? ''
          if (!uf) continue
          L.marker((lyr as L.Polygon).getBounds().getCenter(), {
            interactive: false,
            icon: L.divIcon({ className: 'uf-sigla', html: uf, iconSize: [26, 14], iconAnchor: [13, 7] }),
          }).addTo(map)
        }

        try { map.fitBounds(layer.getBounds(), { padding: [10, 10] }) } catch { /* noop */ }
        pintar()
      })
      .catch(() => { if (!cancelado) setErroGeo(true) })

    return () => { cancelado = true; layerRef.current = null; mapRef.current = null; map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // repinta quando muda dado / território / seleção / modo
  function pintar() {
    const layer = layerRef.current
    if (!layer) return
    const { porUf: dados, territorio: terr, selecionado: sel, editando: ed } = estadoRef.current
    layer.eachLayer(l => {
      const lyr = l as L.Path & { feature?: GeoJSON.Feature }
      const uf = (lyr.feature?.properties as { sigla?: string })?.sigla ?? ''
      const dono = REP_POR_ID[terr[uf]]
      const s = dados[uf] ?? ZERO
      const apagado = !ed && !!sel && dono?.id !== sel
      lyr.setStyle({
        fillColor: dono?.cor ?? COR_SEM_DONO,
        fillOpacity: apagado ? 0.16 : 0.92,
        weight: dono ? 1.2 : 1,
        color: apagado ? '#334155' : '#f8fafc',
        opacity: apagado ? 0.35 : 0.9,
      })
      lyr.bindTooltip(
        `<b>${UF_NOME[uf] ?? uf}</b><br>`
        + `<span style="color:${dono?.cor ?? '#94a3b8'};font-weight:700">${dono?.nome ?? 'SEM DONO'}</span><br>`
        + `${num(s.carteira)} na carteira · ${num(s.abertos)} em aberto<br>`
        + `${num(s.vendidos)} vendidos · ${brlCurto(s.pipeline)} em aberto`
        + (ed ? '<br><i style="color:#38bdf8">clique pra passar pro pincel</i>' : ''),
        { sticky: true, direction: 'top', opacity: 1 },
      )
    })
  }
  useEffect(pintar, [porUf, territorio, selecionado, editando])

  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [selecionado, editando])

  const metricaAtual = METRICAS.find(m => m.id === metrica)!
  const selRep = REP_POR_ID[selecionado ?? '']
  const pincelRep = REP_POR_ID[pincel ?? '']

  async function onSalvar() {
    if (!mudancas.length) return
    await salvar.mutateAsync(
      mudancas.map(m => ({ uf: m.uf, rep_id: m.para, autor: profile?.display_name ?? profile?.email ?? null })),
    )
    setRascunho(null); setPincel(null)
  }

  // Conta 'mapa' (Patrick) abre em TELA CHEIA, sem o cabeçalho/padding do Layout —
  // aí a página é dona da altura inteira e precisa do próprio respiro nas bordas.
  const telaCheia = profile?.role === 'mapa'

  return (
    /* O pb-16 saiu junto com a pill flutuante (03/08/2026): a navegação do papel
       'mapa' virou menu lateral, então o rodapé não é mais coberto por nada. */
    <div className={`flex flex-col gap-3 min-h-0 ${telaCheia ? 'h-[100dvh] p-3' : 'h-[calc(100dvh-7rem)]'}`}>
      <style>{`
        .uf-sigla{font:700 10px/14px ui-sans-serif,system-ui;color:#fff;text-align:center;
          text-shadow:0 1px 2px rgba(0,0,0,.85);pointer-events:none;background:none;border:0}
      `}</style>

      {/* cabeçalho */}
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Mapa de Representantes</h1>
          <p className="text-[13px] text-ink-muted">
            {REPRESENTANTES.length} representantes · {TODAS_UFS.length - semDono.length} de {TODAS_UFS.length} estados com dono ·{' '}
            {fmt(carteiras.total, metrica)} em {metricaAtual.curto.toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface text-[12px] font-semibold">
            {METRICAS.map(m => (
              <button
                key={m.id}
                onClick={() => setMetrica(m.id)}
                title={m.label}
                className={`px-3 ${metrica === m.id ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-2'}`}
              >
                {m.curto}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (editando) { setRascunho(null); setPincel(null) }
              else { setRascunho({ ...(territorioSalvo ?? {}) }); setSelecionado(null) }
            }}
            className={`h-9 px-3 rounded-lg border text-[12px] font-semibold ${editando ? 'bg-accent text-white border-accent' : 'bg-surface border-border text-ink-muted hover:bg-surface-2'}`}
          >
            {editando ? '✕ Sair da edição' : '✏️ Editar regiões'}
          </button>
        </div>
      </div>

      {/* barra do modo edição */}
      {editando && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-[12px]">
          <span className="text-ink">
            {pincelRep
              ? <>Pincel: <b style={{ color: pincelRep.cor }}>{pincelRep.nome}</b> — clique nos estados do mapa.</>
              : <>Escolha um representante na lista ao lado, depois clique nos estados.</>}
          </span>
          <span className="text-ink-faint">
            {mudancas.length
              ? `${mudancas.length} estado(s) alterado(s): ${mudancas.map(m => m.uf).join(', ')}`
              : 'nenhuma alteração'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setRascunho({ ...(territorioSalvo ?? {}) })}
              disabled={!mudancas.length}
              className="h-8 px-3 rounded-lg border border-border bg-surface text-ink-muted disabled:opacity-40"
            >
              Descartar
            </button>
            <button
              onClick={onSalvar}
              disabled={!mudancas.length || salvar.isPending}
              className="h-8 px-3 rounded-lg bg-accent text-white font-semibold disabled:opacity-40"
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar divisão'}
            </button>
          </div>
          {salvar.isError && <span className="w-full text-red-400">Não consegui salvar. Tente de novo.</span>}
        </div>
      )}

      {semDono.length > 0 && (
        <div className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
          <b>{semDono.length} estado(s) sem representante:</b>{' '}
          {semDono.map(uf => `${uf} (${UF_NOME[uf]})`).join(', ')} — pintados de cinza no mapa.
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex flex-col md:flex-row md:gap-3">
        {/* mapa */}
        <div className="relative flex-1 min-h-[45vh] md:min-h-0 rounded-xl border border-border overflow-hidden bg-surface">
          <div ref={divRef} className="absolute inset-0 z-0" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-[400]"><PageLoading /></div>
          )}
          {erroGeo && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-muted">
              Não consegui carregar o desenho dos estados.
            </div>
          )}
          {selRep && !editando && (
            <button
              onClick={() => setSelecionado(null)}
              className="absolute top-2 right-2 z-[1000] h-8 px-3 rounded-lg border border-border bg-surface/95 backdrop-blur text-[12px] font-semibold text-ink-muted shadow"
            >
              ✕ {selRep.nome}
            </button>
          )}
        </div>

        {/* painel de carteiras */}
        <div className="md:w-80 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto max-h-[38vh] md:max-h-none">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wide text-ink-faint">
              {editando ? 'Clique = escolher pincel' : 'Carteira por representante'}
            </span>
            <span className="text-[11px] text-ink-faint tabular-nums">
              média {fmt(Math.round(carteiras.media), metrica)}
            </span>
          </div>

          <ul className="space-y-1.5">
            {carteiras.itens.map(({ rep, ufs, valor, desvio, carteira, abertos, vendidos, pipeline }) => {
              const ativo = editando ? pincel === rep.id : selecionado === rep.id
              const pct = Math.round((valor / carteiras.max) * 100)
              const acima = desvio >= 0
              return (
                <li key={rep.id}>
                  <button
                    onClick={() => (editando
                      ? setPincel(p => (p === rep.id ? null : rep.id))
                      : setSelecionado(s => (s === rep.id ? null : rep.id)))}
                    className={`w-full text-left rounded-lg px-2 py-2 transition-colors ${ativo ? 'bg-surface-2 ring-1 ring-accent' : 'hover:bg-surface-2'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: rep.cor }} />
                      <span className="text-[13px] font-semibold text-ink flex-1 truncate">
                        {editando && ativo ? '✏️ ' : ''}{rep.nome}
                      </span>
                      <span className="text-[13px] font-bold tabular-nums text-ink">{fmt(valor, metrica)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: rep.cor }} />
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
                      <span className="truncate flex-1">{ufs.length ? ufs.join(' · ') : 'sem estado'}</span>
                      <span
                        className={`tabular-nums font-semibold shrink-0 ${Math.abs(desvio) < 0.15 ? 'text-ink-faint' : acima ? 'text-emerald-400' : 'text-amber-400'}`}
                        title="Diferença pra média dos representantes"
                      >
                        {acima ? '+' : '−'}{Math.round(Math.abs(desvio) * 100)}%
                      </span>
                    </div>
                    {ativo && !editando && (
                      <div className="mt-2 pt-2 border-t border-border grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                        <span className="text-ink-faint">Carteira</span><span className="text-ink tabular-nums text-right">{num(carteira)}</span>
                        <span className="text-ink-faint">Em aberto</span><span className="text-ink tabular-nums text-right">{num(abertos)}</span>
                        <span className="text-ink-faint">Vendidos</span><span className="text-ink tabular-nums text-right">{num(vendidos)}</span>
                        <span className="text-ink-faint">R$ em aberto</span><span className="text-ink tabular-nums text-right">{brlCurto(pipeline)}</span>
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="mt-3 pt-2 border-t border-border text-[11px] leading-relaxed text-ink-faint">
            Base: mesmos orçamentos/vendas do Mapa de Visitas (1 linha por orçamento).
            “Carteira” = tudo que já passou pelo estado; “em aberto” = ainda não virou venda.
            O % compara com a média dos {REPRESENTANTES.length} representantes na métrica escolhida —
            no modo edição ele recalcula a cada estado que você move.
          </p>
        </div>
      </div>
    </div>
  )
}
