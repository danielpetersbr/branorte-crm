// /frete/transportadoras - CRUD de transportadoras parceiras.
// Lista + form modal de edicao. R$/km por tipo de caminhao + UFs atendidas.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Truck, Plus, Edit, Trash2, ArrowLeft, Phone, User, Zap, MapPin } from 'lucide-react'
import {
  useTransportadoras,
  useUpsertTransportadora,
  useDeleteTransportadora,
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

export default function FreteTransportadoras() {
  const { data: lista, isLoading } = useTransportadoras()
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
    <div className="container mx-auto py-6 px-4 max-w-5xl">
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

      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 rounded-2xl border border-border bg-surface animate-pulse" />)}
        </div>
      )}

      {!isLoading && (lista?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-ink-faint">
          <Truck className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Nenhuma transportadora cadastrada ainda. Clique em <b className="text-ink-muted">"Nova"</b> pra começar.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
