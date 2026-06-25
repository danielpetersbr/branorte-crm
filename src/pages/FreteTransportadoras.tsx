// /frete/transportadoras - CRUD de transportadoras parceiras.
// Lista + form modal de edicao. R$/km por tipo de caminhao + UFs atendidas.

import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Truck, Plus, Edit, Trash2, ArrowLeft, Phone, User, Zap, MapPin } from 'lucide-react'
import {
  useTransportadoras,
  useUpsertTransportadora,
  useDeleteTransportadora,
  useFreteMelhorPorUf,
  type MelhorPorUf,
} from '@/hooks/useFrete'
import type { TransportadoraParceira } from '@/lib/calcFrete'

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

function formNova(): Partial<TransportadoraParceira> {
  return {
    nome: '',
    contato_nome: '',
    telefone: '',
    email: '',
    rs_km_vuc: undefined,
    rs_km_toco: undefined,
    rs_km_truck: undefined,
    rs_km_carreta2: undefined,
    rs_km_carreta3: undefined,
    rs_km_bitrem: undefined,
    rs_km_rodotrem: undefined,
    taxa_minima: 0,
    ufs_atende: [],
    observacoes: '',
    ativo: true,
    autorizado: false,
    prioridade: 100,
  }
}

function iniciais(nome: string): string {
  const parts = (nome || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function fmtTel(t: string): string {
  const d = (t || '').replace(/\D/g, '')
  const n = d.startsWith('55') ? d.slice(2) : d
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return t
}

const UF_CENTRO: Record<string, [number, number]> = {
  AC:[-8.77,-70.55],AL:[-9.62,-36.82],AM:[-3.47,-65.10],AP:[1.41,-51.77],BA:[-12.96,-41.70],
  CE:[-5.20,-39.53],DF:[-15.78,-47.93],ES:[-19.19,-40.34],GO:[-15.98,-49.86],MA:[-5.42,-45.44],
  MG:[-18.10,-44.38],MS:[-20.51,-54.54],MT:[-12.64,-55.42],PA:[-3.79,-52.48],PB:[-7.28,-36.72],
  PE:[-8.38,-37.86],PI:[-6.60,-42.28],PR:[-24.89,-51.55],RJ:[-22.25,-42.66],RN:[-5.81,-36.59],
  RO:[-10.83,-63.34],RR:[1.99,-61.33],RS:[-30.17,-53.50],SC:[-27.45,-50.95],SE:[-10.57,-37.45],
  SP:[-22.19,-48.79],TO:[-10.17,-48.30],
}
const escMap = (s: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

const fmtKm = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type MelhorPreco = { nome: string; rs_km: number; fonte: 'real' | 'tabela'; n: number }

// Mapa de cobertura: 1 marcador por UF com o nº de transportadoras que atendem
// (inclui as que atendem "todas as UFs") + o MELHOR PREÇO (menor R$/km).
// Prioriza cotação REAL; sem cotação ainda, cai no menor R$/km de truck da tabela.
function CoberturaMapa({ transportadoras, melhorPorUf }: {
  transportadoras: TransportadoraParceira[]
  melhorPorUf: Record<string, MelhorPorUf>
}) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  const porUf = useMemo(() => {
    const ativos = transportadoras.filter(t => t.ativo)
    const todas = ativos.filter(t => !t.ufs_atende?.length)
    const out: Record<string, {
      especificas: TransportadoraParceira[]
      todas: TransportadoraParceira[]
      best: MelhorPreco | null
    }> = {}
    for (const uf of Object.keys(UF_CENTRO)) {
      const esp = ativos.filter(t => t.ufs_atende?.includes(uf))
      const atendem = [...esp, ...todas]
      if (!atendem.length) continue
      // Melhor preço: 1º cotação REAL (menor R$/km histórico); senão menor R$/km de truck da tabela.
      let best: MelhorPreco | null = null
      const real = melhorPorUf[uf]
      if (real && real.rs_km > 0) {
        best = { nome: real.transportadora_nome, rs_km: real.rs_km, fonte: 'real', n: real.n_cotacoes }
      } else {
        const comTruck = atendem.filter(t => (t.rs_km_truck ?? 0) > 0)
        if (comTruck.length) {
          const min = comTruck.reduce((a, b) => ((b.rs_km_truck ?? Infinity) < (a.rs_km_truck ?? Infinity) ? b : a))
          best = { nome: min.nome, rs_km: min.rs_km_truck as number, fonte: 'tabela', n: 0 }
        }
      }
      out[uf] = { especificas: esp, todas, best }
    }
    return out
  }, [transportadoras, melhorPorUf])

  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const map = L.map(divRef.current, { center: [-15.0, -50.5], zoom: 4, scrollWheelZoom: false, zoomControl: true })
    L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20 }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 120)
    return () => { map.remove(); mapRef.current = null; layerRef.current = null }
  }, [])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const [uf, info] of Object.entries(porUf)) {
      const total = info.especificas.length + info.todas.length
      if (!total) continue
      const [lat, lng] = UF_CENTRO[uf]
      const cor = total >= 5 ? '#15803d' : total >= 2 ? '#22c55e' : '#86efac'
      const icon = L.divIcon({
        className: 'cob-uf',
        html: `<div style="background:${cor};color:#06281a;font-weight:800;border:2px solid #fff;border-radius:999px;min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 1px 5px rgba(0,0,0,.45)">${total}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14],
      })
      const esp = info.especificas.map(t => `• ${escMap(t.nome)}`).join('<br>')
      const tds = info.todas.map(t => `• ${escMap(t.nome)} <i style="opacity:.55">(atende todas)</i>`).join('<br>')
      const b = info.best
      const bestLine = b
        ? `<div style="font-size:12px;margin-top:7px;padding-top:6px;border-top:1px solid #e2e8f0">`
          + `💰 <b>Melhor preço:</b> ${escMap(b.nome)} · <b>R$ ${fmtKm(b.rs_km)}/km</b> `
          + `<span style="font-size:10px;color:${b.fonte === 'real' ? '#15803d' : '#94a3b8'}">`
          + (b.fonte === 'real' ? `(real · ${b.n} cot.)` : '(estimado · tabela)')
          + `</span></div>`
        : ''
      const popup = `<div style="font-family:inherit;min-width:185px"><div style="font-weight:700;font-size:13px">${uf} — ${total} transportadora${total === 1 ? '' : 's'}</div>`
        + (esp ? `<div style="font-size:12px;margin-top:5px">${esp}</div>` : '')
        + (tds ? `<div style="font-size:11px;color:#64748b;margin-top:5px">${tds}</div>` : '')
        + bestLine
        + `</div>`
      L.marker([lat, lng], { icon }).bindPopup(popup).addTo(layer)
    }
  }, [porUf])

  return <div ref={divRef} className="h-[420px] w-full rounded-2xl border border-border overflow-hidden z-0" style={{ minHeight: 420 }} />
}

export default function FreteTransportadoras() {
  const { data: lista, isLoading } = useTransportadoras()
  const { data: melhorPorUf } = useFreteMelhorPorUf()
  const upsert = useUpsertTransportadora()
  const del = useDeleteTransportadora()
  const [editando, setEditando] = useState<Partial<TransportadoraParceira> | null>(null)

  function abrirNovo() {
    setEditando(formNova())
  }

  function abrirEdit(t: TransportadoraParceira) {
    setEditando({ ...t })
  }

  async function salvar() {
    if (!editando) return
    if (!editando.nome?.trim()) {
      alert('Nome é obrigatório')
      return
    }
    try {
      await upsert.mutateAsync(editando)
      setEditando(null)
    } catch (e: any) {
      alert(`Erro: ${e?.message ?? e}`)
    }
  }

  async function excluir(id: number) {
    if (!confirm('Inativar essa transportadora? (não apaga histórico)')) return
    try {
      await del.mutateAsync(id)
    } catch (e: any) {
      alert(`Erro: ${e?.message ?? e}`)
    }
  }

  function toggleUF(uf: string) {
    if (!editando) return
    const ufs = editando.ufs_atende ?? []
    const novo = ufs.includes(uf) ? ufs.filter(x => x !== uf) : [...ufs, uf]
    setEditando({ ...editando, ufs_atende: novo })
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/frete" className="text-ink-muted hover:text-ink shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="h-10 w-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink leading-tight">Transportadoras Parceiras</h1>
            <p className="text-xs text-ink-muted">{lista?.length ?? 0} cadastrada{(lista?.length ?? 0) === 1 ? '' : 's'} · {(lista ?? []).filter(t => t.autorizado && t.ativo).length} na auto-cotação</p>
          </div>
        </div>
        <button
          type="button"
          onClick={abrirNovo}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 flex items-center gap-2 shadow-sm"
        >
          <Plus className="h-4 w-4" /> Nova
        </button>
      </div>

      {!isLoading && (lista?.length ?? 0) > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-ink"><MapPin className="h-4 w-4 text-accent" /> Cobertura por estado</div>
          <CoberturaMapa transportadoras={lista ?? []} melhorPorUf={melhorPorUf ?? {}} />
          <p className="text-xs text-ink-muted mt-2">Número no estado = transportadoras que atendem ele (já contando as "todas as UFs"). Clique pra ver quais e o <b className="text-ink-muted">melhor preço</b> (menor R$/km das cotações recebidas).</p>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 rounded-2xl border border-border bg-surface animate-pulse" />)}
        </div>
      )}

      {!isLoading && (lista?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-ink-faint">
          <Truck className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Nenhuma transportadora cadastrada ainda. Clique em <b className="text-ink-muted">"Nova"</b> pra começar.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {lista?.map(t => (
          <div key={t.id} className={`group rounded-2xl border p-4 transition-all ${t.ativo ? 'border-border bg-surface hover:border-accent/40 hover:shadow-sm' : 'border-border/60 bg-surface/40 opacity-60'}`}>
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-sm font-bold ${t.autorizado && t.ativo ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-ink-muted'}`}>
                {iniciais(t.nome)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-ink truncate">{t.nome}</h3>
                  {t.autorizado
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 font-medium inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> auto-cotação</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-ink-faint font-medium">só manual</span>}
                  {!t.ativo && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium">inativa</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
                  {t.telefone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" />{fmtTel(t.telefone)}</span>}
                  {t.contato_nome && <span className="inline-flex items-center gap-1"><User className="h-3 w-3 shrink-0" />{t.contato_nome}</span>}
                  {t.autorizado && <span className="inline-flex items-center gap-1" title="ordem de envio na auto-cotação"><Zap className="h-3 w-3 shrink-0" />ordem {t.prioridade ?? 100}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.ufs_atende.length === 0
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/10 text-accent font-medium inline-flex items-center gap-1"><MapPin className="h-2.5 w-2.5" /> atende todas as UFs</span>
                    : t.ufs_atende.map(uf => <span key={uf} className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-2 text-ink-muted font-medium">{uf}</span>)}
                </div>
              </div>
              <div className="flex gap-0.5 shrink-0">
                <button type="button" onClick={() => abrirEdit(t)} title="Editar" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-surface-2">
                  <Edit className="h-4 w-4" />
                </button>
                {t.ativo && (
                  <button type="button" onClick={() => excluir(t.id)} title="Inativar" className="p-1.5 rounded-lg text-ink-faint hover:text-red-500 hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de edicao */}
      {editando && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-surface border border-border rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">
              {editando.id ? 'Editar' : 'Nova'} transportadora
            </h2>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium block mb-1">Nome da transportadora *</label>
                  <input
                    type="text"
                    value={editando.nome ?? ''}
                    onChange={e => setEditando({ ...editando, nome: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Nome do responsável</label>
                  <input
                    type="text"
                    value={editando.contato_nome ?? ''}
                    onChange={e => setEditando({ ...editando, contato_nome: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium block mb-1">WhatsApp <span className="text-xs text-ink-muted font-normal">(pra receber as cotações)</span></label>
                  <input
                    type="text"
                    value={editando.telefone ?? ''}
                    onChange={e => setEditando({ ...editando, telefone: e.target.value })}
                    placeholder="(00) 00000-0000"
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
              </div>

              <div className="border-t pt-3">
                <label className="text-sm font-medium block mb-2">UFs atendidas (vazio = atende todas)</label>
                <div className="flex flex-wrap gap-1">
                  {UFS.map(uf => (
                    <button
                      key={uf}
                      type="button"
                      onClick={() => toggleUF(uf)}
                      className={`px-2 py-1 text-xs border rounded ${
                        editando.ufs_atende?.includes(uf)
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg hover:bg-surface-2'
                      }`}
                    >
                      {uf}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t pt-3">
                <label className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editando.autorizado}
                    onChange={e => setEditando({ ...editando, autorizado: e.target.checked })}
                    className="h-4 w-4 accent-accent"
                  />
                  Enviar cotação automática no WhatsApp
                </label>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  <b>Ligado:</b> quando um vendedor abrir um frete pra uma UF que essa transportadora atende, o sistema manda a cotação direto no WhatsApp dela — sem ninguém precisar avisar.<br />
                  <b>Desligado:</b> ela não recebe nada automático (só aparece se você mandar o link manual ou ela entrar no portal).
                </p>
                {editando.autorizado && (
                  <div className="mt-3 bg-surface-2/50 border border-border rounded-lg p-3 flex items-start gap-3">
                    <div className="w-24 shrink-0">
                      <label className="text-xs font-medium block mb-1">Ordem de envio</label>
                      <input
                        type="number"
                        value={editando.prioridade ?? 100}
                        onChange={e => setEditando({ ...editando, prioridade: Number(e.target.value) || 100 })}
                        className="w-full border rounded px-2 py-1 text-sm bg-bg"
                      />
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed flex-1">
                      Quando <b>várias</b> transportadoras atendem a mesma UF, o número <b>menor</b> recebe a cotação primeiro. Padrão <b>100</b> — ex.: quem está em 10 recebe antes de quem está em 100. Deixe 100 se tanto faz.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Observações</label>
                <textarea
                  value={editando.observacoes ?? ''}
                  onChange={e => setEditando({ ...editando, observacoes: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setEditando(null)} className="px-4 py-2 text-sm border rounded hover:bg-surface-2">
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={upsert.isPending}
                className="px-4 py-2 text-sm bg-accent text-white rounded font-medium hover:opacity-90 disabled:opacity-50"
              >
                {upsert.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
