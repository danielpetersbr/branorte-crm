/**
 * O mapa DENTRO da organização de viagem.
 *
 * Diferente do /mapa-visitas, que mostra os 2.349 clientes da base: aqui só
 * entram as paradas DAQUELA viagem. O vendedor abre, vê as dele, e resolve as
 * duas coisas que travam o roteiro sem sair do mapa — onde o cliente fica de
 * verdade, e se ele pode receber.
 *
 * A cor do pino é o ESTADO DA CONFIRMAÇÃO, não o valor: aqui o que importa é o
 * que falta resolver, e o quadro inteiro é sobre isso.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useConfirmarParada, useSalvarLocalizacaoCliente, type ParadaConfirmacao } from '@/hooks/useViagens'
import type { Confirmacao } from '@/lib/viagem'

const COR: Record<Confirmacao, string> = {
  nao_solicitado: '#64748b',
  aguardando_vendedor: '#d97706',
  aguardando_cliente: '#d97706',
  localizacao_recebida: '#2563eb',
  visita_confirmada: '#16a34a',
  indisponivel: '#dc2626',
}
const ROTULO: Record<Confirmacao, string> = {
  nao_solicitado: 'Não pedido',
  aguardando_vendedor: 'Com o vendedor',
  aguardando_cliente: 'Com o cliente',
  localizacao_recebida: 'Localização recebida',
  visita_confirmada: 'Visita confirmada',
  indisponivel: 'Não pode receber',
}

const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

/** Aproximada = centro da cidade. É o que faz a rota sair errada, então o pino avisa. */
const aproximada = (p: ParadaConfirmacao) => p.precisao === 'cidade' || p.precisao === 'estado'

function pino(cor: string, texto: string, aprox: boolean): L.DivIcon {
  const anel = aprox ? 'box-shadow:0 0 0 2px #fff,0 0 0 5px #0f172a;' : 'box-shadow:0 0 0 2px #fff;'
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${cor};${anel}`
        + `display:flex;align-items:center;justify-content:center;color:#fff;`
        + `font-size:11px;font-weight:700;line-height:1">${texto}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
  })
}

export function MapaDaViagem({ paradas }: { paradas: ParadaConfirmacao[] }) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const moverLayerRef = useRef<L.LayerGroup | null>(null)
  const acoesRef = useRef({ mover: (_id: string) => {}, marcar: (_id: string, _c: Confirmacao) => {} })

  const confirmar = useConfirmarParada()
  const salvarLocal = useSalvarLocalizacaoCliente()
  const [movendo, setMovendo] = useState<{ paradaId: string; nome: string; cliKeys: string[]; lat: number; lng: number } | null>(null)

  const comCoord = useMemo(() => paradas.filter(p => p.lat != null && p.lng != null), [paradas])

  // init (uma vez)
  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const map = L.map(divRef.current, { zoomControl: true, scrollWheelZoom: true }).setView([-15.6, -52.0], 4)
    L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20, attribution: '&copy; Google Maps',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    moverLayerRef.current = L.layerGroup().addTo(map)

    map.on('popupopen', e => {
      const el = e.popup.getElement()
      if (!el) return
      const b = el.querySelector('button[data-mover]') as HTMLButtonElement | null
      if (b) b.onclick = () => { acoesRef.current.mover(b.dataset.id || ''); map.closePopup() }
      el.querySelectorAll('button[data-conf]').forEach(n => {
        const x = n as HTMLButtonElement
        x.onclick = () => { acoesRef.current.marcar(x.dataset.id || '', x.dataset.conf as Confirmacao); map.closePopup() }
      })
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 60)
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; moverLayerRef.current = null }
  }, [])

  // ações sempre atuais (o handler de popupopen tem closure congelado)
  useEffect(() => {
    acoesRef.current = {
      mover: id => {
        const p = comCoord.find(x => x.id === id)
        if (p) setMovendo({ paradaId: p.id, nome: p.nome, cliKeys: p.cliKeys, lat: p.lat, lng: p.lng })
      },
      marcar: (id, c) => confirmar.mutate({ paradaId: id, confirmacao: c }),
    }
  })

  // pinos
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current
    if (!map || !layer) return
    map.invalidateSize()
    layer.clearLayers()
    const bounds: [number, number][] = []
    for (const p of comCoord) {
      const m = L.marker([p.lat, p.lng], { icon: pino(COR[p.confirmacao], `${p.dia}.${p.ordem}`, aproximada(p)) })
      m.bindPopup(() => `
        <div style="min-width:210px;font-family:inherit">
          <div style="font-weight:700;font-size:13px">${esc(p.nome)}</div>
          <div style="font-size:12px;color:#64748b">${esc([p.cidade, p.uf].filter(Boolean).join(' - '))}${p.vendedor ? ' · ' + esc(p.vendedor) : ''}</div>
          <div style="margin-top:5px;font-size:11px;font-weight:700;color:${COR[p.confirmacao]}">${ROTULO[p.confirmacao]}</div>
          ${aproximada(p) ? '<div style="margin-top:4px;font-size:11px;color:#b45309;background:#fffbeb;border-radius:6px;padding:4px 6px">⚠️ No centro da cidade — a rota sai errada assim. Arraste pro lugar certo.</div>' : ''}
          <button data-mover data-id="${p.id}" style="display:block;width:100%;margin-top:7px;padding:6px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-weight:600;font-size:11.5px;cursor:pointer">📍 Mover este ponto</button>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button data-id="${p.id}" data-conf="visita_confirmada" style="flex:1;padding:6px 4px;border:0;border-radius:8px;background:#16a34a;color:#fff;font-weight:700;font-size:11px;cursor:pointer">✅ Pode visitar</button>
            <button data-id="${p.id}" data-conf="aguardando_cliente" style="flex:1;padding:6px 4px;border:0;border-radius:8px;background:#d97706;color:#fff;font-weight:700;font-size:11px;cursor:pointer">⏳ Aguardando</button>
            <button data-id="${p.id}" data-conf="indisponivel" style="flex:1;padding:6px 4px;border:0;border-radius:8px;background:#dc2626;color:#fff;font-weight:700;font-size:11px;cursor:pointer">✕ Não pode</button>
          </div>
        </div>`)
      m.addTo(layer)
      bounds.push([p.lat, p.lng])
    }
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 12 })
    else if (bounds.length === 1) map.setView(bounds[0], 11)
  }, [comCoord])

  // pino arrastável — mesma trava do /mapa-visitas: só arrasta depois do clique,
  // e só grava no "Salvar aqui".
  useEffect(() => {
    const map = mapRef.current, layer = moverLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (!movendo) return
    const m = L.marker([movendo.lat, movendo.lng], {
      draggable: true, zIndexOffset: 2000,
      icon: L.divIcon({
        className: '',
        html: '<div style="width:30px;height:30px;border-radius:50%;background:#2563eb;'
            + 'box-shadow:0 0 0 3px #fff,0 0 0 6px #2563eb,0 6px 14px rgba(0,0,0,.45);'
            + 'display:flex;align-items:center;justify-content:center;font-size:15px">📍</div>',
        iconSize: [30, 30], iconAnchor: [15, 15],
      }),
    })
    m.on('dragend', () => {
      const ll = m.getLatLng()
      setMovendo(v => (v ? { ...v, lat: ll.lat, lng: ll.lng } : v))
    })
    m.addTo(layer)
    map.panTo([movendo.lat, movendo.lng])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movendo?.paradaId])

  if (!comCoord.length) {
    return (
      <div className="text-[12px] text-ink-muted px-4 py-3">
        Nenhuma parada desta viagem tem coordenada — não há o que mostrar no mapa.
      </div>
    )
  }

  return (
    <div className="relative">
      <div ref={divRef} className="w-full h-[420px] rounded-lg overflow-hidden border border-border" />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-muted">
        {(Object.keys(ROTULO) as Confirmacao[]).map(c => (
          <span key={c} className="inline-flex items-center gap-1">
            <i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COR[c] }} />
            {ROTULO[c]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <i className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400" style={{ boxShadow: '0 0 0 1px #fff, 0 0 0 3px #0f172a' }} />
          no centro da cidade
        </span>
      </div>

      {movendo && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-[1200] w-[min(520px,calc(100%-1.5rem))]
                        bg-surface border border-accent/40 rounded-xl shadow-2xl p-3 flex flex-col gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink truncate">📍 {movendo.nome}</div>
            <div className="text-[11.5px] text-ink-muted">
              Arraste o pino azul até a propriedade e clique em <b className="text-ink">Salvar aqui</b>. Nada é gravado antes.
            </div>
            <div className="text-[11px] text-ink-faint tabular-nums mt-0.5">{movendo.lat.toFixed(5)}, {movendo.lng.toFixed(5)}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setMovendo(null)}
              className="h-9 px-3 rounded-md border border-border bg-surface text-ink-muted hover:text-ink text-[13px] font-semibold">
              Cancelar
            </button>
            <button
              disabled={salvarLocal.isPending}
              onClick={async () => {
                try {
                  // A parada pode juntar VÁRIOS clientes na mesma cidade — todos
                  // eles ganham a coordenada, senão o próximo roteiro monta a
                  // parada de novo no centro do município.
                  await Promise.all(movendo.cliKeys.map(k => salvarLocal.mutateAsync({
                    cliKey: k, lat: movendo.lat, lng: movendo.lng,
                    precisao: 'confirmada', fonte: 'arrastado no mapa da organização',
                  })))
                  setMovendo(null)
                } catch (e) {
                  window.alert(`Não consegui salvar a localização.\n\n${(e as Error)?.message || ''}`)
                }
              }}
              className="h-9 flex-1 rounded-md bg-accent-bg border border-accent/40 text-accent text-[13px] font-bold disabled:opacity-60">
              {salvarLocal.isPending ? 'Salvando…' : '✅ Salvar aqui'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
