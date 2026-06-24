// /frete/historico - Lista de cotacoes salvas, com filtros simples. Tela inteira.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Truck, ArrowLeft } from 'lucide-react'
import { useCotacoes, useTiposCaminhao } from '@/hooks/useFrete'

const UFS = ['','AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function fmtData(s: string): string {
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const selCls = 'border border-border rounded-lg px-3 py-2 text-sm bg-bg text-ink outline-none focus:border-accent'

export default function FreteHistorico() {
  const [filtroUf, setFiltroUf] = useState('')
  const [filtroCaminhaoId, setFiltroCaminhaoId] = useState<number | null>(null)

  const tipos = useTiposCaminhao()
  const cotacoes = useCotacoes({
    uf: filtroUf || undefined,
    caminhao_id: filtroCaminhaoId ?? undefined,
    limit: 200,
  })

  const nomeCaminhao = (id: number | null) => {
    if (!id || !tipos.data) return '—'
    return tipos.data.find(t => t.id === id)?.nome ?? '—'
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/frete" className="text-ink-muted hover:text-ink">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Truck className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold text-ink">Histórico de Cotações</h1>
      </div>

      {/* Filtros */}
      <div className="bg-surface-1 border border-border rounded-xl p-3 mb-4 flex gap-3 items-end flex-wrap">
        <div>
          <label className="text-xs text-ink-muted block mb-1">UF destino</label>
          <select value={filtroUf} onChange={e => setFiltroUf(e.target.value)} className={selCls}>
            {UFS.map(u => <option key={u || 'todas'} value={u}>{u || 'Todas'}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-muted block mb-1">Caminhão</label>
          <select value={filtroCaminhaoId ?? ''} onChange={e => setFiltroCaminhaoId(e.target.value ? Number(e.target.value) : null)} className={selCls}>
            <option value="">Todos</option>
            {tipos.data?.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <div className="ml-auto text-xs text-ink-muted">
          {cotacoes.data?.length ?? 0} cotação(ões) encontrada(s)
        </div>
      </div>

      {cotacoes.isLoading && <div className="text-sm text-ink-muted">Carregando…</div>}

      {!cotacoes.isLoading && (cotacoes.data?.length ?? 0) === 0 && (
        <div className="border border-dashed border-border rounded-xl p-10 text-center text-ink-faint">
          Nenhuma cotação encontrada com esses filtros.
        </div>
      )}

      {/* Tabela */}
      {(cotacoes.data?.length ?? 0) > 0 && (
        <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Data</th>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">Destino</th>
                <th className="text-right px-3 py-2 font-medium">km</th>
                <th className="text-left px-3 py-2 font-medium">Caminhão</th>
                <th className="text-right px-3 py-2 font-medium">Peso</th>
                <th className="text-right px-3 py-2 font-medium">Valor final</th>
              </tr>
            </thead>
            <tbody>
              {cotacoes.data?.map(c => (
                <tr key={c.id} className="border-t border-border hover:bg-surface-2/60">
                  <td className="px-3 py-2 text-xs text-ink-muted">{fmtData(c.criado_em)}</td>
                  <td className="px-3 py-2 text-ink">{c.cliente_nome ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-ink">{c.cidade_destino}/{c.uf_destino}</td>
                  <td className="px-3 py-2 text-right text-xs text-ink">
                    {c.distancia_km != null ? c.distancia_km.toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink">{nomeCaminhao(c.caminhao_recomendado_id)}</td>
                  <td className="px-3 py-2 text-right text-xs text-ink">
                    {c.peso_total_kg != null ? `${Math.round(c.peso_total_kg).toLocaleString('pt-BR')} kg` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">{fmt(c.valor_final)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
