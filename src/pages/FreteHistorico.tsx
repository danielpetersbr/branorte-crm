// /frete/historico - Histórico de TODAS as cotações de frete (RFQ), com filtros. Tela inteira.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Truck, ArrowLeft } from 'lucide-react'
import { useFreteHistorico, useTiposCaminhao } from '@/hooks/useFrete'

const UFS = ['','AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function fmtData(s: string): string {
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const STATUS = {
  pendente:  { label: 'Pendente',   cls: 'bg-amber-500/15 text-amber-600' },
  analisando:{ label: 'Analisando', cls: 'bg-blue-500/15 text-blue-600' },
  concluida: { label: 'Concluída',  cls: 'bg-green-500/15 text-green-600' },
  fechado:   { label: 'Fechado',    cls: 'bg-emerald-600/15 text-emerald-700' },
} as const

const selCls = 'border border-border rounded-lg px-3 py-2 text-sm bg-bg text-ink outline-none focus:border-accent'

export default function FreteHistorico() {
  const [filtroUf, setFiltroUf] = useState('')
  const [filtroCaminhaoId, setFiltroCaminhaoId] = useState<number | null>(null)

  const tipos = useTiposCaminhao()
  const hist = useFreteHistorico()

  const nomeCaminhao = (id: number | null) => {
    if (!id || !tipos.data) return '—'
    return tipos.data.find(t => t.id === id)?.nome ?? '—'
  }

  const rows = useMemo(() => {
    const all = hist.data ?? []
    return all.filter(c =>
      (!filtroUf || c.uf_destino === filtroUf) &&
      (filtroCaminhaoId == null || c.caminhao_recomendado_id === filtroCaminhaoId)
    )
  }, [hist.data, filtroUf, filtroCaminhaoId])

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/frete/cotacoes" className="text-ink-muted hover:text-ink"><ArrowLeft className="h-5 w-5" /></Link>
        <Truck className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold text-ink">Histórico de Cotações</h1>
      </div>

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
        <div className="ml-auto text-xs text-ink-muted">{rows.length} cotação(ões)</div>
      </div>

      {hist.isLoading && <div className="text-sm text-ink-muted">Carregando…</div>}

      {!hist.isLoading && rows.length === 0 && (
        <div className="border border-dashed border-border rounded-xl p-10 text-center text-ink-faint">
          Nenhuma cotação encontrada com esses filtros.
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-surface-1 border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Nº</th>
                <th className="text-left px-3 py-2 font-medium">Data</th>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">Destino</th>
                <th className="text-right px-3 py-2 font-medium">km</th>
                <th className="text-left px-3 py-2 font-medium">Caminhão</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Transportadora</th>
                <th className="text-right px-3 py-2 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const st = STATUS[c.derived_status] ?? STATUS.pendente
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className="px-3 py-2 text-xs font-mono text-ink-faint">{c.codigo}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted whitespace-nowrap">{fmtData(c.criado_em)}</td>
                    <td className="px-3 py-2 text-ink">{c.cliente_nome ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink whitespace-nowrap">{c.cidade_destino ?? '—'}/{c.uf_destino ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-xs text-ink">{c.distancia_km != null ? Math.round(c.distancia_km).toLocaleString('pt-BR') : '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink">{nomeCaminhao(c.caminhao_recomendado_id)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                      {c.tipo_cotacao === 'carregar' && <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-500">Embarque imediato</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink truncate max-w-[160px]">{c.transportadora ?? (c.n_respostas > 0 ? `${c.n_respostas} resposta(s)` : '—')}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink whitespace-nowrap">{fmt(c.valor_final)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
