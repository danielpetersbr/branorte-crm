import { useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, MapPin } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useOrcamentosMapa, useVisitas } from '@/hooks/useVisitas'
import { modoMapaVisual, selecionarMapaVisual, prepararDesenhoVisual, deslocamentoVisual, type ModoMapaVisual, type PontoVisual } from '@/lib/mapa-visual'

const CATEGORIAS = [
  { modo: 'vendidos', nome: 'Vendidos', icon: CheckCircle2, cor: '#60a5fa' },
  { modo: 'orcados', nome: 'Orçados', icon: FileText, cor: '#4ade80' },
  { modo: 'visitas', nome: 'Visitas', icon: MapPin, cor: '#fbbf24' },
] as const
const NUMERO = new Intl.NumberFormat('pt-BR')

function iconeValor(p: PontoVisual) {
  const tam = p.forma === 'diamante' ? 22 : 24
  const estrela = 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'
  const desenho = p.forma === 'estrela'
    ? `<path d="${estrela}" fill="${p.cor}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>`
    : `<path d="M5 3H19L22 9L12 22L2 9Z" fill="${p.cor}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><g stroke="#fff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".85"><path d="M2 9H22"/><path d="M5 3L12 9M19 3L12 9M12 9V22"/></g>`
  return L.divIcon({ className: 'mapa-visual-valor', iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2], popupAnchor: [0, -tam / 2],
    html: `<svg aria-hidden="true" width="${tam}" height="${tam}" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))">${desenho}</svg>` })
}

function MapaLimpo({ pontos }: { pontos: PontoVisual[] }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container.current || !pontos.length) return
    const map = L.map(container.current, { zoomControl: false, preferCanvas: true })
    L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    }).addTo(map)
    const canvas = L.canvas({ padding: 0.5 })
    const desenho = prepararDesenhoVisual(pontos)
    const marcadores: Array<{ ponto: (typeof desenho)[number]; marcador: L.CircleMarker | L.Marker }> = []
    // Primeiro os círculos; os símbolos de maior valor ficam por cima.
    for (const p of desenho.filter(p => p.forma === 'circulo')) {
      const marcador = L.circleMarker([p.lat, p.lng], { renderer: canvas, ...p.circulo,
        fillColor: p.cor, opacity: 1, interactive: false }).addTo(map)
      marcadores.push({ ponto: p, marcador })
    }
    for (const p of desenho.filter(p => p.forma !== 'circulo')) {
      const marcador = L.marker([p.lat, p.lng], { icon: iconeValor(p), interactive: false, keyboard: false }).addTo(map)
      marcadores.push({ ponto: p, marcador })
    }
    map.fitBounds(L.latLngBounds(pontos.map(p => [p.lat, p.lng] as [number, number])), {
      paddingTopLeft: [30, 70], paddingBottomRight: [30, 30], maxZoom: 12,
    })
    const atualizarPosicoes = () => {
      const zoom = map.getZoom()
      for (const { ponto, marcador } of marcadores) {
        const [dx, dy] = deslocamentoVisual(ponto, zoom)
        const centro = map.project([ponto.lat, ponto.lng], zoom)
        marcador.setLatLng(map.unproject(L.point(centro.x + dx, centro.y + dy), zoom))
      }
    }
    atualizarPosicoes()
    map.on('zoomend', atualizarPosicoes)
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(container.current)
    return () => { resize.disconnect(); map.remove() }
  }, [pontos])
  return <div ref={container} role="region" aria-label="Mapa de clientes" className="absolute inset-0" />
}

export function MapaVisual() {
  const [params, setParams] = useSearchParams()
  const modo = modoMapaVisual(params.get('modo'))
  const orcamentos = useOrcamentosMapa()
  const visitas = useVisitas()
  const categorias = useMemo(() => selecionarMapaVisual(orcamentos.data ?? [], visitas.data ?? []),
    [orcamentos.data, visitas.data])
  // A paleta de visitas usa vendedores das duas fontes, assim como no mapa completo.
  const consultas = {
    vendidos: orcamentos, orcados: orcamentos,
    visitas: {
      isPending: visitas.isPending || orcamentos.isPending,
      isError: visitas.isError || orcamentos.isError,
      refetch: () => Promise.all([visitas.refetch(), orcamentos.refetch()]),
    },
  }
  const consulta = consultas[modo ?? 'orcados']
  const aberta = modo && !consulta.isPending && !consulta.isError && categorias[modo].pontos.length > 0

  if (aberta && modo) {
    return (
      <main className="fixed inset-0 bg-[#e5e7eb]" style={{ height: '100dvh' }}>
        <MapaLimpo pontos={categorias[modo].pontos} />
        <button type="button" aria-label="Voltar às categorias" onClick={() => setParams({})}
          className="absolute left-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600"
          style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
          <ArrowLeft className="h-5 w-5" />
        </button>
      </main>
    )
  }

  function abrir(m: ModoMapaVisual) { setParams({ modo: m }) }
  return (
    <main className="min-h-[100dvh] bg-[#161c19] text-white flex flex-col items-center px-6"
      style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md flex-1 flex flex-col justify-center pb-10 sm:pb-16">
        <img src="/branorte-logo-dark.png" alt="BraNorte" className="mx-auto mb-14 w-[240px] max-w-[80%] h-auto" />
        <h1 className="sr-only">Mapa visual</h1>
        <div className="space-y-4">
          {CATEGORIAS.map(({ modo: m, nome, icon: Icon, cor }) => {
            const q = consultas[m]
            const dados = categorias[m]
            const carregando = q.isPending
            const erro = q.isError
            return (
              <div key={m}>
                <button type="button" onClick={() => abrir(m)} disabled={carregando || erro || !dados.pontos.length}
                  aria-label={`${nome}: ${carregando ? 'carregando' : erro ? 'indisponível' : NUMERO.format(dados.total)}`}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-white/15 bg-white/[.04] px-5 py-6 text-left transition hover:border-green-400/60 hover:bg-white/[.08] active:scale-[.99] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400">
                  <Icon className="h-6 w-6 shrink-0" style={{ color: cor }} />
                  <span className="text-lg font-semibold tracking-wide">{nome}</span>
                  <span className="ml-auto text-2xl font-semibold tabular-nums" aria-live="polite">
                    {carregando ? '…' : erro ? '—' : NUMERO.format(dados.total)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-green-400" />
                </button>
                {erro && <p className="px-1 pt-2 text-sm text-red-300" role="alert">
                  Não foi possível carregar. <button className="underline" onClick={() => void q.refetch()}>Tentar novamente</button>
                </p>}
                {!carregando && !erro && dados.semLocalizacao > 0 && <p className="px-1 pt-2 text-xs text-white/50">
                  {NUMERO.format(dados.pontos.length)} no mapa · {NUMERO.format(dados.semLocalizacao)} sem localização
                </p>}
              </div>
            )
          })}
        </div>
        {modo && !consulta.isPending && !consulta.isError && !categorias[modo].pontos.length && (
          <p role="status" className="mt-5 text-center text-sm text-white/60">Nenhum cliente com localização nesta categoria.</p>
        )}
        <Link to="/mapa-visitas" className="mt-10 self-center py-3 text-sm text-white/45 hover:text-white">Abrir mapa completo</Link>
      </div>
    </main>
  )
}
