// /frete/transportadoras - CRUD de transportadoras parceiras.
// Lista + form modal de edicao. R$/km por tipo de caminhao + UFs atendidas.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Truck, Plus, Edit, Trash2, ArrowLeft } from 'lucide-react'
import {
  useTransportadoras,
  useUpsertTransportadora,
  useDeleteTransportadora,
  useTranspContasAdmin,
  useAprovarTransp,
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

export default function FreteTransportadoras() {
  const { data: lista, isLoading } = useTransportadoras()
  const upsert = useUpsertTransportadora()
  const del = useDeleteTransportadora()
  const contas = useTranspContasAdmin()
  const aprovar = useAprovarTransp()
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/frete" className="text-ink-muted hover:text-ink">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Truck className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-bold">Transportadoras Parceiras</h1>
        </div>
        <button
          type="button"
          onClick={abrirNovo}
          className="px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:opacity-90 flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> Nova
        </button>
      </div>

      {/* Contas do portal de transportadoras — aprovar acesso às cotações */}
      <div className="border rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Contas do portal <span className="text-xs text-ink-muted font-normal">(/transportadora)</span></h2>
          <span className="text-xs text-ink-muted">{(contas.data ?? []).filter(c => !c.aprovado).length} aguardando aprovação</span>
        </div>
        {contas.isLoading && <div className="text-sm text-ink-muted">Carregando…</div>}
        {!contas.isLoading && (contas.data?.length ?? 0) === 0 && (
          <div className="text-sm text-ink-muted">Nenhuma transportadora cadastrada no portal ainda.</div>
        )}
        <div className="space-y-2">
          {(contas.data ?? []).map(c => (
            <div key={c.user_id} className="flex items-center justify-between gap-3 border rounded p-2.5">
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">{c.nome}
                  {c.aprovado
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600">aprovada</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600">aguardando</span>}
                </div>
                <div className="text-xs text-ink-muted truncate">{c.email}{c.cnpj ? ` · ${c.cnpj}` : ''} · atende: {c.estados.join(', ') || '—'}</div>
              </div>
              {c.aprovado
                ? <button type="button" onClick={() => aprovar.mutate({ user_id: c.user_id, aprovar: false })} disabled={aprovar.isPending} className="px-3 py-1.5 text-xs border rounded hover:bg-surface-2 shrink-0">Revogar</button>
                : <button type="button" onClick={() => aprovar.mutate({ user_id: c.user_id, aprovar: true })} disabled={aprovar.isPending} className="px-3 py-1.5 text-xs bg-accent text-white rounded font-medium hover:opacity-90 shrink-0">Aprovar</button>}
            </div>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-sm text-ink-muted">Carregando…</div>}

      {!isLoading && (lista?.length ?? 0) === 0 && (
        <div className="border border-dashed rounded p-8 text-center text-ink-muted">
          Nenhuma transportadora cadastrada ainda. Clique em "Nova" pra começar.
        </div>
      )}

      <div className="space-y-2">
        {lista?.map(t => (
          <div key={t.id} className={`border rounded p-3 ${!t.ativo ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium flex items-center gap-2">{t.nome}
                  {t.autorizado && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600">autorizada</span>}
                </div>
                <div className="text-xs text-ink-muted">
                  {t.telefone} {t.email && `· ${t.email}`}
                  {t.ufs_atende.length > 0 && <> · atende: {t.ufs_atende.join(', ')}</>}
                </div>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => abrirEdit(t)} className="p-1 text-ink-muted hover:text-accent">
                  <Edit className="h-4 w-4" />
                </button>
                {t.ativo && (
                  <button type="button" onClick={() => excluir(t.id)} className="p-1 text-ink-muted hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
              {t.rs_km_vuc != null && <div>VUC: <b>R$ {t.rs_km_vuc}/km</b></div>}
              {t.rs_km_toco != null && <div>Toco: <b>R$ {t.rs_km_toco}/km</b></div>}
              {t.rs_km_truck != null && <div>Truck: <b>R$ {t.rs_km_truck}/km</b></div>}
              {t.rs_km_carreta2 != null && <div>Carreta 2e: <b>R$ {t.rs_km_carreta2}/km</b></div>}
              {t.rs_km_carreta3 != null && <div>Carreta 3e: <b>R$ {t.rs_km_carreta3}/km</b></div>}
              {t.rs_km_bitrem != null && <div>Bitrem: <b>R$ {t.rs_km_bitrem}/km</b></div>}
              {t.rs_km_rodotrem != null && <div>Rodotrem: <b>R$ {t.rs_km_rodotrem}/km</b></div>}
              {t.taxa_minima > 0 && <div>Mín: <b>R$ {t.taxa_minima}</b></div>}
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
                  <label className="text-sm font-medium block mb-1">Nome *</label>
                  <input
                    type="text"
                    value={editando.nome ?? ''}
                    onChange={e => setEditando({ ...editando, nome: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Contato (nome)</label>
                  <input
                    type="text"
                    value={editando.contato_nome ?? ''}
                    onChange={e => setEditando({ ...editando, contato_nome: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">WhatsApp <span className="text-xs text-ink-muted font-normal">(p/ cotação)</span></label>
                  <input
                    type="text"
                    value={editando.telefone ?? ''}
                    onChange={e => setEditando({ ...editando, telefone: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">E-mail</label>
                  <input
                    type="email"
                    value={editando.email ?? ''}
                    onChange={e => setEditando({ ...editando, email: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm bg-bg"
                  />
                </div>
              </div>

              <div className="border-t pt-3">
                <label className="text-sm font-medium block mb-2">R$/km por tipo de caminhão (deixe vazio se não atende)</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['rs_km_vuc', 'VUC'],
                    ['rs_km_toco', 'Toco'],
                    ['rs_km_truck', 'Truck'],
                    ['rs_km_carreta2', 'Carreta 2e'],
                    ['rs_km_carreta3', 'Carreta 3e'],
                    ['rs_km_bitrem', 'Bitrem'],
                    ['rs_km_rodotrem', 'Rodotrem'],
                  ] as Array<[keyof TransportadoraParceira, string]>).map(([k, label]) => (
                    <div key={k as string}>
                      <label className="text-xs text-ink-muted block">{label}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={(editando[k] as number) ?? ''}
                        onChange={e => setEditando({ ...editando, [k]: e.target.value ? Number(e.target.value) : null })}
                        className="w-full border rounded px-2 py-1 text-sm bg-bg"
                        placeholder="—"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs text-ink-muted block">Taxa mínima (R$)</label>
                    <input
                      type="number"
                      value={editando.taxa_minima ?? 0}
                      onChange={e => setEditando({ ...editando, taxa_minima: Number(e.target.value) || 0 })}
                      className="w-full border rounded px-2 py-1 text-sm bg-bg"
                    />
                  </div>
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

              <div className="border-t pt-3 flex items-end justify-between gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!editando.autorizado}
                      onChange={e => setEditando({ ...editando, autorizado: e.target.checked })}
                      className="h-4 w-4 accent-accent"
                    />
                    Autorizada p/ cotação automática no WhatsApp
                  </label>
                  <p className="text-xs text-ink-muted mt-1">Só transportadoras autorizadas recebem o disparo automático de cotação por UF.</p>
                </div>
                <div className="w-28 shrink-0">
                  <label className="text-xs text-ink-muted block">Prioridade</label>
                  <input
                    type="number"
                    value={editando.prioridade ?? 100}
                    onChange={e => setEditando({ ...editando, prioridade: Number(e.target.value) || 100 })}
                    className="w-full border rounded px-2 py-1 text-sm bg-bg"
                  />
                  <p className="text-[10px] text-ink-muted mt-0.5">menor = dispara antes</p>
                </div>
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
