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
import { useConfirmarParada, useSalvarLocalizacaoCliente, useAdicionarParada, type ParadaConfirmacao } from '@/hooks/useViagens'
import { pontoLivre, montarParadas, type Confirmacao, type TipoParada, type PontoMapa } from '@/lib/viagem'
import { useOrcamentosMapa } from '@/hooks/useVisitas'

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

/** Um clique no mapa vira parada nova. `null` = modo desligado. */
type ModoAdd = null | { tipo: TipoParada; nome: string; lat: number | null; lng: number | null }

export function MapaDaViagem({
  paradas, todasDaViagem, viagemId, podeAdicionar, dia,
}: {
  /** o que aparece no mapa — pode estar filtrado por vendedor */
  paradas: ParadaConfirmacao[]
  /**
   * TODAS as paradas da viagem, sem filtro. Ordem e "já está na viagem" têm que
   * sair daqui: calculando pela lista filtrada, adicionar com um vendedor
   * selecionado dava ordem baixa demais (colidindo com parada existente) e a
   * busca oferecia cliente que já estava na viagem, só que de outro vendedor.
   */
  todasDaViagem: ParadaConfirmacao[]
  viagemId: string
  /** criador da viagem ou admin — é o que a policy viagem_paradas_ins exige */
  podeAdicionar: boolean
  /** último dia da viagem: a parada nova entra no fim dele */
  dia: number
}) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const moverLayerRef = useRef<L.LayerGroup | null>(null)
  const acoesRef = useRef({
    mover: (_id: string) => {},
    marcar: (_id: string, _c: Confirmacao) => {},
    confere: (_id: string) => {},
  })

  const confirmar = useConfirmarParada()
  const salvarLocal = useSalvarLocalizacaoCliente()
  const adicionar = useAdicionarParada()
  const [modoAdd, setModoAdd] = useState<ModoAdd>(null)
  const modoAddRef = useRef<ModoAdd>(null)
  useEffect(() => { modoAddRef.current = modoAdd }, [modoAdd])
  const [movendo, setMovendo] = useState<{ paradaId: string; nome: string; cliKeys: string[]; lat: number; lng: number } | null>(null)
  // `null` = caixa fechada. A base (2.349 clientes) só é buscada quando ABRE —
  // carregar isso junto com o quadro seria pagar caro por algo raramente usado.
  const [buscaCli, setBuscaCli] = useState<string | null>(null)
  const { data: base = [], isLoading: loadingBase } = useOrcamentosMapa({ enabled: buscaCli != null })
  const jaNaViagem = useMemo(() => new Set(todasDaViagem.flatMap(p => p.cliKeys)), [todasDaViagem])
  const achados = useMemo(() => {
    const t = (buscaCli || '').trim().toLowerCase()
    if (t.length < 2) return []
    return base
      .filter(p => !jaNaViagem.has(p.cli_key))
      .filter(p => [p.cliente, p.cidade, p.uf, p.telefone, p.fone].some(x => (x || '').toLowerCase().includes(t)))
      .slice(0, 25)
  }, [base, buscaCli, jaNaViagem])

  // Sempre da lista COMPLETA — ver o comentário do prop todasDaViagem.
  const proximaOrdem = useMemo(
    () => todasDaViagem.filter(p => p.dia === dia).length + 1,
    [todasDaViagem, dia],
  )

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
      const ok = el.querySelector('button[data-confere]') as HTMLButtonElement | null
      if (ok) ok.onclick = () => { acoesRef.current.confere(ok.dataset.id || ''); map.closePopup() }
      el.querySelectorAll('button[data-conf]').forEach(n => {
        const x = n as HTMLButtonElement
        x.onclick = () => { acoesRef.current.marcar(x.dataset.id || '', x.dataset.conf as Confirmacao); map.closePopup() }
      })
    })
    // Clique no mapa só faz algo com o modo "adicionar" LIGADO — senão qualquer
    // clique perdido no mapa viraria parada nova na viagem de alguém.
    map.on('click', e => {
      const m = modoAddRef.current
      if (!m) return
      setModoAdd({ ...m, lat: e.latlng.lat, lng: e.latlng.lng })
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
      // "Aqui está certo": grava a coordenada QUE JÁ ESTÁ, só promovendo a precisão
      // pra 'confirmada'. Muita parada cai no centro da cidade e o centro da cidade
      // É o lugar — revenda na avenida principal. Sem este botão o vendedor tinha
      // que arrastar o pino 1cm e soltar só pra tirar o aviso de "aproximada",
      // o que é pedir pra ele mentir a coordenada.
      confere: id => {
        const p = comCoord.find(x => x.id === id)
        if (!p) return
        void Promise.all(p.cliKeys.map(k => salvarLocal.mutateAsync({
          cliKey: k, lat: p.lat, lng: p.lng,
          precisao: 'confirmada', fonte: 'conferido no mapa da organização',
        }))).catch((e: Error) => window.alert(`Não consegui confirmar.\n\n${e?.message || ''}`))
      },
    }
  })

  // pinos
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current
    if (!map || !layer) return
    map.invalidateSize()
    layer.clearLayers()
    const bounds: [number, number][] = []

    // A ROTA, na ordem dia.ordem, PULANDO quem disse que não pode receber. É o
    // "vai traçando conforme confirma": cada ✕ tira a parada da linha na hora.
    // Tracejado de propósito — é a SEQUÊNCIA, não o caminho pela estrada; o
    // traçado real só existe depois de calcular a rota, e sai no PDF do roteiro.
    const naRota = comCoord
      .filter(p => p.confirmacao !== 'indisponivel')
      .sort((a, b) => a.dia - b.dia || a.ordem - b.ordem)
    for (let i = 1; i < naRota.length; i++) {
      const a = naRota[i - 1], b = naRota[i]
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: '#ffffff', weight: 6, opacity: 0.85,
      }).addTo(layer)
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: b.dia === a.dia ? '#0f172a' : '#64748b',
        weight: 2.5, opacity: 0.9, dashArray: '8 6',
      }).addTo(layer)
    }

    for (const p of comCoord) {
      const m = L.marker([p.lat, p.lng], { icon: pino(COR[p.confirmacao], `${p.dia}.${p.ordem}`, aproximada(p)) })
      m.bindPopup(() => `
        <div style="min-width:210px;font-family:inherit">
          <div style="font-weight:700;font-size:13px">${esc(p.nome)}</div>
          <div style="font-size:12px;color:#64748b">${esc([p.cidade, p.uf].filter(Boolean).join(' - '))}${p.vendedor ? ' · ' + esc(p.vendedor) : ''}</div>
          <div style="margin-top:5px;font-size:11px;font-weight:700;color:${COR[p.confirmacao]}">${ROTULO[p.confirmacao]}</div>
          ${aproximada(p) ? '<div style="margin-top:4px;font-size:11px;color:#b45309;background:#fffbeb;border-radius:6px;padding:4px 6px">⚠️ No centro da cidade — a rota sai errada assim. Arraste pro lugar certo.</div>' : ''}
          <div style="display:flex;gap:4px;margin-top:7px">
            <button data-mover data-id="${p.id}" style="flex:1;padding:6px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-weight:600;font-size:11.5px;cursor:pointer">📍 Mover</button>
            ${aproximada(p)
              ? `<button data-confere data-id="${p.id}" style="flex:1;padding:6px;border:1px solid #16a34a;border-radius:8px;background:#f0fdf4;color:#166534;font-weight:700;font-size:11.5px;cursor:pointer">✓ Aqui está certo</button>`
              : '<div style="flex:1;padding:6px;font-size:11px;color:#16a34a;font-weight:600;text-align:center">✓ localização confirmada</div>'}
          </div>
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
      {podeAdicionar && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[12px] text-ink-muted">Acrescentar à viagem:</span>
          {([['parada', '📍 Parada / cidade'], ['hotel', '🛏️ Hotel']] as [TipoParada, string][]).map(([t, rot]) => (
            <button
              key={t}
              onClick={() => setModoAdd(m => (m?.tipo === t ? null : { tipo: t, nome: '', lat: null, lng: null }))}
              className={`h-8 px-3 rounded-md border text-[12px] font-semibold ${modoAdd?.tipo === t
                ? 'bg-accent-bg border-accent/40 text-accent'
                : 'bg-surface border-border text-ink-muted hover:text-ink'}`}>
              {rot}
            </button>
          ))}
          <button
            onClick={() => { setBuscaCli(b => (b == null ? '' : null)); setModoAdd(null) }}
            className={`h-8 px-3 rounded-md border text-[12px] font-semibold ${buscaCli != null
              ? 'bg-accent-bg border-accent/40 text-accent'
              : 'bg-surface border-border text-ink-muted hover:text-ink'}`}>
            👤 Cliente da base
          </button>
          {modoAdd && (
            <span className="text-[12px] text-accent font-semibold">
              {modoAdd.lat == null ? '→ clique no mapa onde é' : '→ dê um nome e salve'}
            </span>
          )}
        </div>
      )}

      {/* Puxar cliente que está longe no mapa mas cuja propriedade é aqui do lado.
          Entra com o cli_key dele, então o vendedor pode confirmar e corrigir a
          localização como em qualquer outra parada. */}
      {podeAdicionar && buscaCli != null && (
        <div className="mb-2 border border-border rounded-lg p-2 bg-surface-2">
          <input
            autoFocus
            value={buscaCli}
            onChange={e => setBuscaCli(e.target.value)}
            placeholder="Nome do cliente, cidade ou telefone…"
            className="h-9 w-full px-2 rounded-md bg-surface border border-border text-[13px] text-ink outline-none focus:border-accent" />
          {loadingBase && <div className="text-[12px] text-ink-faint mt-1">carregando a base…</div>}
          <div className="max-h-44 overflow-auto mt-1">
            {achados.map(p => (
              <button
                key={p.cli_key}
                disabled={adicionar.isPending}
                onClick={async () => {
                  try {
                    const [parada] = montarParadas([p as unknown as PontoMapa])
                    if (!parada) return
                    await adicionar.mutateAsync({
                      viagemId, dia,
                      ordem: proximaOrdem,
                      parada,
                    })
                    setBuscaCli(null)
                  } catch (e) {
                    window.alert(`Não consegui acrescentar.\n\n${(e as Error)?.message || ''}`)
                  }
                }}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-accent-bg/50 disabled:opacity-50">
                <div className="text-[12.5px] text-ink font-medium truncate">{p.cliente || '—'}</div>
                <div className="text-[11px] text-ink-muted truncate">
                  {[p.cidade, p.uf].filter(Boolean).join(' - ')}{p.vendedor ? ` · ${p.vendedor}` : ''}
                </div>
              </button>
            ))}
            {!loadingBase && buscaCli.trim().length >= 2 && !achados.length && (
              <div className="text-[12px] text-ink-faint px-2 py-1.5">Nada encontrado.</div>
            )}
            {buscaCli.trim().length < 2 && (
              <div className="text-[12px] text-ink-faint px-2 py-1.5">Digite ao menos 2 letras.</div>
            )}
          </div>
        </div>
      )}

      <div ref={divRef} className={`w-full h-[420px] rounded-lg overflow-hidden border border-border ${modoAdd ? 'cursor-crosshair' : ''}`} />

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
        <span className="inline-flex items-center gap-1">
          <i className="inline-block w-5 border-t-2 border-dashed border-slate-900" />
          sequência da visita (quem não pode receber sai da linha)
        </span>
      </div>

      {modoAdd?.lat != null && modoAdd.lng != null && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-[1200] w-[min(520px,calc(100%-1.5rem))]
                        bg-surface border border-accent/40 rounded-xl shadow-2xl p-3 flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-ink">
            {modoAdd.tipo === 'hotel' ? '🛏️ Hotel' : '📍 Parada'} em {modoAdd.lat.toFixed(4)}, {modoAdd.lng.toFixed(4)}
          </div>
          <input
            autoFocus
            value={modoAdd.nome}
            onChange={e => setModoAdd(m => (m ? { ...m, nome: e.target.value } : m))}
            placeholder={modoAdd.tipo === 'hotel' ? 'Nome do hotel' : 'Nome do lugar (cidade, cliente, ponto)'}
            className="h-9 px-2 rounded-md bg-surface-2 border border-border text-[13px] text-ink outline-none focus:border-accent" />
          <div className="text-[11px] text-ink-faint">
            Entra no fim do dia {dia}, sem horário. Abra no planejador depois pra recalcular a rota.
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModoAdd(null)}
              className="h-9 px-3 rounded-md border border-border bg-surface text-ink-muted hover:text-ink text-[13px] font-semibold">
              Cancelar
            </button>
            <button
              disabled={!modoAdd.nome.trim() || adicionar.isPending}
              onClick={async () => {
                try {
                  await adicionar.mutateAsync({
                    viagemId, dia,
                    ordem: proximaOrdem,
                    parada: pontoLivre(modoAdd.tipo, modoAdd.nome.trim(), modoAdd.lat!, modoAdd.lng!),
                  })
                  setModoAdd(null)
                } catch (e) {
                  window.alert(`Não consegui acrescentar.\n\n${(e as Error)?.message || ''}`)
                }
              }}
              className="h-9 flex-1 rounded-md bg-accent-bg border border-accent/40 text-accent text-[13px] font-bold disabled:opacity-60">
              {adicionar.isPending ? 'Salvando…' : '＋ Acrescentar à viagem'}
            </button>
          </div>
        </div>
      )}

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
