import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronRight, FileText, Map, MapPin, X } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useOrcamentosMapa, useVisitas } from '@/hooks/useVisitas'
import { modoMapaVisual, selecionarMapaVisual, prepararDesenhoVisual, deslocamentoVisual, type ModoMapaVisual, type PontoVisual } from '@/lib/mapa-visual'
import { chaveCoordenadaMapa } from '@/lib/mapa-visitas-regras'

const CATEGORIAS = [
  { modo: 'vendidos', nome: 'Vendidos', icon: CheckCircle2, cor: '#01A95B', fundo: '#e1f9ed' },
  { modo: 'orcados', nome: 'Orçados', icon: FileText, cor: '#01A95B', fundo: '#edf7f1' },
  { modo: 'visitas', nome: 'Visitas', icon: MapPin, cor: '#f4b400', fundo: '#fff7e3' },
] as const
const NUMERO = new Intl.NumberFormat('pt-BR')
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

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
  const [selecionado, setSelecionado] = useState<PontoVisual | null>(null)
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
        fillColor: p.cor, opacity: 1, interactive: true }).addTo(map)
      marcador.on('click', () => setSelecionado(p))
      marcadores.push({ ponto: p, marcador })
    }
    for (const p of desenho.filter(p => p.forma !== 'circulo')) {
      const marcador = L.marker([p.lat, p.lng], { icon: iconeValor(p), interactive: true, keyboard: true,
        title: p.detalhes.cliente || 'Cliente sem nome', alt: p.detalhes.cliente || 'Cliente sem nome' }).addTo(map)
      marcador.on('click', () => setSelecionado(p))
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
  const vizinhos = selecionado ? pontos.filter(p =>
    chaveCoordenadaMapa(p.lat, p.lng) === chaveCoordenadaMapa(selecionado.lat, selecionado.lng)) : []
  return <>
    <div ref={container} role="region" aria-label="Mapa de clientes" className="absolute inset-0" />
    {selecionado && <section role="dialog" aria-label="Dados do cliente"
      className="absolute left-4 right-4 z-[1000] max-h-[65dvh] overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl sm:right-auto sm:w-[360px]"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-500">Dados do cliente</h2>
        <button type="button" aria-label="Fechar dados do cliente" onClick={() => setSelecionado(null)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600"><X className="h-5 w-5" /></button>
      </div>
      <h3 className="mt-2 break-words text-lg font-semibold">{selecionado.detalhes.cliente || 'Cliente sem nome'}</h3>
      <p className="mt-1 text-sm text-gray-500">{selecionado.detalhes.categoria} · {[selecionado.detalhes.cidade, selecionado.detalhes.uf].filter(Boolean).join(' / ') || 'Localização não informada'}</p>
      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="text-gray-500">{selecionado.detalhes.categoria === 'Orçado' || selecionado.detalhes.categoria === 'Vendido' ? 'Equipamento' : 'Interesse'}</dt>
          <dd className="break-words whitespace-pre-wrap font-medium">{selecionado.detalhes.equipamento || 'Não informado'}</dd></div>
        <div><dt className="text-gray-500">{selecionado.detalhes.categoria === 'Orçado' ? 'Valor do orçamento' : selecionado.detalhes.categoria === 'Vendido' ? 'Valor' : 'Valor negociando'}</dt>
          <dd className="break-words font-medium">{selecionado.detalhes.valor == null ? 'Não informado' : MOEDA.format(selecionado.detalhes.valor)}</dd></div>
        <div><dt className="text-gray-500">Contato</dt><dd className="break-words font-medium">{selecionado.detalhes.contato || 'Não informado'}</dd></div>
        <div><dt className="text-gray-500">Vendedor</dt><dd className="break-words font-medium">{selecionado.detalhes.vendedor || 'Não informado'}</dd></div>
      </dl>
      {/^[0-9]{10,15}$/.test(selecionado.detalhes.telefone) && <a href={`https://wa.me/${selecionado.detalhes.telefone}`} target="_blank" rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-800">Abrir WhatsApp</a>}
      {vizinhos.length > 1 && <div className="mt-4 border-t border-gray-200 pt-3">
        <p className="text-sm font-semibold">{vizinhos.length} clientes nesta localização</p>
        <ul className="mt-2 space-y-1">
          {vizinhos.map(p => <li key={p.id}><button type="button" aria-label={`Ver cliente ${p.detalhes.cliente || 'sem nome'}`} aria-pressed={p.id === selecionado.id}
            onClick={() => setSelecionado(p)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${p.id === selecionado.id ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'}`}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} /><span className="break-words">{p.detalhes.cliente || 'Cliente sem nome'}</span>
          </button></li>)}
        </ul>
      </div>}
    </section>}
  </>
}

export function MapaVisual() {
  const [params, setParams] = useSearchParams()
  const modo = modoMapaVisual(params.get('modo'))
  const orcamentos = useOrcamentosMapa()
  const visitas = useVisitas()
  const categorias = useMemo(() => selecionarMapaVisual(orcamentos.data ?? [], visitas.data ?? []),
    [orcamentos.data, visitas.data])
  const consultas = {
    vendidos: orcamentos, orcados: orcamentos,
    visitas,
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
    <main className="relative isolate flex min-h-[100dvh] flex-col items-center overflow-hidden bg-white px-5 text-[#18262e] sm:px-6"
      style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}>
      <svg aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 -z-10 h-[290px] w-[420px] max-w-full text-[#b7efd2] sm:h-[340px] sm:w-[540px]"
        viewBox="0 0 540 340" fill="none" preserveAspectRatio="xMaxYMax slice">
        <path d="M-80 340C180 340 155 105 555 15M-40 355C210 355 188 135 575 45M0 370C240 370 221 165 595 75M40 385C270 385 254 195 615 105M80 400C300 400 287 225 635 135" stroke="currentColor" strokeWidth=".8" />
      </svg>
      <div className="flex w-full max-w-md flex-1 flex-col justify-center">
        <header className="mb-9 text-center sm:mb-11">
          <img src="/branorte-logo.png" alt="BraNorte" className="mx-auto h-auto w-[240px] max-w-[80%] sm:w-[280px]" />
          <h1 className="mt-7 text-lg font-medium text-[#66727e] sm:mt-8 sm:text-xl">Selecione um mapa</h1>
        </header>
        <div className="space-y-4">
          {CATEGORIAS.map(({ modo: m, nome, icon: Icon, cor, fundo }) => {
            const q = consultas[m]
            const dados = categorias[m]
            const carregando = q.isPending
            const erro = q.isError
            return (
              <div key={m}>
                <button type="button" onClick={() => abrir(m)} disabled={carregando || erro || !dados.pontos.length}
                  aria-label={`${nome}: ${carregando ? 'carregando' : erro ? 'indisponível' : NUMERO.format(dados.total)}`}
                  className={`group flex min-h-[96px] w-full items-center gap-3 rounded-2xl border px-4 py-5 text-left transition active:scale-[.99] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#01A95B] sm:gap-4 sm:px-5 sm:py-6 ${m === 'vendidos'
                    ? 'border-[#01A95B] bg-[#f1fcf6] shadow-[0_6px_24px_rgba(1,169,91,.12)] hover:bg-[#e8f9ef]'
                    : 'border-[#e7ecef] bg-white shadow-[0_5px_20px_rgba(24,38,46,.06)] hover:border-[#b8d9c8] hover:bg-[#fcfefc]'}`}>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full sm:h-14 sm:w-14" style={{ backgroundColor: fundo }}>
                    <Icon className="h-7 w-7" style={{ color: cor }} strokeWidth={2} />
                  </span>
                  <span className="text-xl font-semibold sm:text-2xl">{nome}</span>
                  <span className={`ml-auto text-[27px] font-semibold tabular-nums sm:text-3xl ${m === 'vendidos' ? 'text-[#008e49]' : 'text-[#18262e]'}`} aria-live="polite">
                    {carregando ? '…' : erro ? '—' : NUMERO.format(dados.total)}
                  </span>
                  <ChevronRight className={`h-5 w-5 shrink-0 ${m === 'vendidos' ? 'text-[#01A95B]' : 'text-[#78838d] group-hover:text-[#01A95B]'}`} />
                </button>
                {erro && <p className="px-1 pt-2 text-sm text-red-700" role="alert">
                  Não foi possível carregar. <button className="underline" onClick={() => void q.refetch()}>Tentar novamente</button>
                </p>}
                {!carregando && !erro && dados.semLocalizacao > 0 && <p className="px-1 pt-2 text-xs text-[#66727e]">
                  {NUMERO.format(dados.pontos.length)} no mapa · {NUMERO.format(dados.semLocalizacao)} sem localização
                </p>}
              </div>
            )
          })}
        </div>
        {modo && !consulta.isPending && !consulta.isError && !categorias[modo].pontos.length && (
          <p role="status" className="mt-5 text-center text-sm text-[#66727e]">Nenhum cliente com localização nesta categoria.</p>
        )}
        <Link to="/mapa-visitas" className="mt-9 flex min-h-11 items-center gap-3 self-center rounded-lg px-3 py-3 text-base text-[#66727e] hover:text-[#01A95B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#01A95B] sm:mt-11 sm:text-lg">
          <Map className="h-5 w-5 shrink-0" strokeWidth={1.8} />Abrir mapa completo
        </Link>
      </div>
    </main>
  )
}
