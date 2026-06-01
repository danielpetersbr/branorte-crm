// Página /consulta/historico — lista de consultas + painel de custos.
//
// Vendedor vê só as suas (RLS faz). Admin (perm admin.due_diligence) vê todas.
// Painel admin: custo mensal por vendedor + totais agregados.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, Search, TrendingUp, AlertCircle, ArrowLeft, Filter } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCan } from '@/hooks/usePermissions'
import type { DDConsulta } from '@/hooks/useDueDiligence'

interface CustoMensalRow {
  created_by: string
  mes: string
  qtd_consultas: number
  custo_total_brl: number
  sucesso: number
  falha: number
  /** display_name do vendedor (join feito client-side via user_profiles) */
  vendedor_nome?: string | null
}

export function ConsultaHistorico() {
  const can = useCan()
  const isAdmin = can('admin.due_diligence')

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Link
          to="/consulta"
          className="h-9 w-9 rounded-md bg-surface-2 border border-border flex items-center justify-center hover:border-accent"
          title="Voltar pra nova consulta"
        >
          <ArrowLeft className="h-4 w-4 text-ink-muted" />
        </Link>
        <div className="flex-1">
          <h1 className="text-[18px] font-bold text-ink">Histórico de Consultas</h1>
          <p className="text-[12px] text-ink-muted">
            {isAdmin
              ? 'Admin: você vê todas as consultas e o custo agregado por vendedor.'
              : 'Suas consultas registradas (últimos 90 dias).'}
          </p>
        </div>
      </header>

      {isAdmin && <PainelCustoMensal />}

      <ListaConsultas />
    </div>
  )
}

// ============================================================================
// PAINEL DE CUSTO MENSAL (admin)
// ============================================================================
function PainelCustoMensal() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dd', 'custo-mensal'],
    queryFn: async () => {
      // 1. Pega dados do view (agregado por created_by × mês)
      const { data: rows, error } = await supabase
        .from('v_dd_custo_mensal')
        .select('*')
        .order('mes', { ascending: false })
        .limit(50)
      if (error) throw error
      const arr = (rows ?? []) as CustoMensalRow[]

      // 2. Enriquece com display_name dos vendedores
      const userIds = Array.from(new Set(arr.map(r => r.created_by).filter(Boolean)))
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, display_name, email')
          .in('id', userIds)
        const nomePor = new Map<string, string>()
        for (const p of profiles ?? []) {
          nomePor.set(p.id, p.display_name ?? p.email ?? '—')
        }
        for (const r of arr) {
          r.vendedor_nome = nomePor.get(r.created_by) ?? '—'
        }
      }
      return arr
    },
    staleTime: 60_000,
  })

  const resumo = useMemo(() => {
    if (!data) return null
    const mesAtual = new Date().toISOString().slice(0, 7)
    const linhasMesAtual = data.filter(r => r.mes.startsWith(mesAtual))
    const totalMes = linhasMesAtual.reduce((acc, r) => acc + Number(r.custo_total_brl ?? 0), 0)
    const qtdMes = linhasMesAtual.reduce((acc, r) => acc + Number(r.qtd_consultas ?? 0), 0)
    const sucessoMes = linhasMesAtual.reduce((acc, r) => acc + Number(r.sucesso ?? 0), 0)
    const taxaSucesso = qtdMes > 0 ? (sucessoMes / qtdMes) * 100 : 100
    return { totalMes, qtdMes, sucessoMes, taxaSucesso }
  }, [data])

  if (isLoading) {
    return <p className="text-[12px] text-ink-muted">Carregando painel...</p>
  }
  if (error) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-md p-3 flex gap-2">
        <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
        <p className="text-[12px] text-danger">{(error as Error).message}</p>
      </div>
    )
  }

  return (
    <section className="border border-border bg-bg rounded-lg p-5 space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent" /> Painel Admin · Custo de Consultas
        </h2>
      </header>

      {/* Resumo do mês atual */}
      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CartaoStat
            label="Custo este mês"
            valor={`R$ ${resumo.totalMes.toFixed(2)}`}
            sub={`${resumo.qtdMes} consultas`}
            tone="accent"
          />
          <CartaoStat
            label="Consultas com sucesso"
            valor={`${resumo.sucessoMes}`}
            sub={`${resumo.taxaSucesso.toFixed(0)}% taxa`}
            tone="success"
          />
          <CartaoStat
            label="Vendedores ativos"
            valor={`${new Set((data ?? []).filter(r => r.mes.startsWith(new Date().toISOString().slice(0, 7))).map(r => r.created_by)).size}`}
            sub="este mês"
            tone="neutral"
          />
          <CartaoStat
            label="Custo médio"
            valor={`R$ ${resumo.qtdMes > 0 ? (resumo.totalMes / resumo.qtdMes).toFixed(2) : '0,00'}`}
            sub="por consulta"
            tone="neutral"
          />
        </div>
      )}

      {/* Tabela por vendedor × mês */}
      <div>
        <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
          Detalhe por vendedor × mês
        </h3>
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-surface-2/60">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-ink-muted">Vendedor</th>
                <th className="px-3 py-2 font-semibold text-ink-muted">Mês</th>
                <th className="px-3 py-2 font-semibold text-ink-muted text-right">Consultas</th>
                <th className="px-3 py-2 font-semibold text-ink-muted text-right">Sucesso</th>
                <th className="px-3 py-2 font-semibold text-ink-muted text-right">Falha</th>
                <th className="px-3 py-2 font-semibold text-ink-muted text-right">Custo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {(data ?? []).map((r, i) => (
                <tr key={i} className="hover:bg-surface-2/40">
                  <td className="px-3 py-1.5 text-ink">{r.vendedor_nome ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-ink-muted">
                    {new Date(r.mes).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.qtd_consultas}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-success">{r.sucesso}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-danger">{r.falha}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-accent">
                    R$ {Number(r.custo_total_brl).toFixed(2)}
                  </td>
                </tr>
              ))}
              {(!data || data.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-ink-faint">
                    Nenhuma consulta registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function CartaoStat({ label, valor, sub, tone }: {
  label: string
  valor: string
  sub?: string
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'
}) {
  const toneClass = {
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    neutral: 'text-ink',
  }[tone]
  return (
    <div className="border border-border bg-surface-2/40 rounded-md p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-faint mb-0.5">{label}</p>
      <p className={`text-[18px] font-bold font-mono ${toneClass}`}>{valor}</p>
      {sub && <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  )
}

// ============================================================================
// LISTA DE CONSULTAS (filtrada)
// ============================================================================
function ListaConsultas() {
  const [filtro, setFiltro] = useState<'todas' | 'success' | 'failed' | 'partial'>('todas')

  const { data, isLoading, error } = useQuery({
    queryKey: ['dd', 'historico-completo', filtro],
    queryFn: async (): Promise<DDConsulta[]> => {
      let q = supabase
        .from('due_diligence_consultas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (filtro !== 'todas') {
        q = q.eq('status', filtro)
      }
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as DDConsulta[]
    },
    staleTime: 30_000,
  })

  return (
    <section className="border border-border bg-bg rounded-lg p-5">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-2">
          <FileText className="h-4 w-4 text-ink-muted" /> Consultas
        </h2>
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-ink-faint" />
          {(['todas', 'success', 'failed', 'partial'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFiltro(s)}
              className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
                filtro === s
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-ink-muted hover:border-accent border border-border'
              }`}
            >
              {s === 'todas' ? 'Todas' : s}
            </button>
          ))}
        </div>
      </header>

      {isLoading && <p className="text-[11px] text-ink-muted">Carregando...</p>}
      {error && (
        <p className="text-[11px] text-danger">{(error as Error).message}</p>
      )}
      {data && data.length === 0 && (
        <p className="text-[11px] text-ink-faint py-4 text-center">
          Nenhuma consulta com esse filtro.
        </p>
      )}

      {data && data.length > 0 && (
        <div className="border border-border/60 rounded-md overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-surface-2/60">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-ink-muted">Data</th>
                <th className="px-3 py-2 font-semibold text-ink-muted">Documento</th>
                <th className="px-3 py-2 font-semibold text-ink-muted">Pacote</th>
                <th className="px-3 py-2 font-semibold text-ink-muted">Status</th>
                <th className="px-3 py-2 font-semibold text-ink-muted text-right">Custo</th>
                <th className="px-3 py-2 font-semibold text-ink-muted text-center">Parecer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.map(c => (
                <tr key={c.id} className="hover:bg-surface-2/40">
                  <td className="px-3 py-1.5 font-mono text-ink-muted">
                    {new Date(c.created_at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', year: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-ink">
                    {c.cnpj || c.cpf_socio || '—'}
                  </td>
                  <td className="px-3 py-1.5 uppercase text-ink-muted">{c.pacote}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                      c.status === 'success' ? 'bg-success/15 text-success' :
                      c.status === 'partial' ? 'bg-warning/15 text-warning' :
                      c.status === 'failed' ? 'bg-danger/15 text-danger' :
                      'bg-surface-2 text-ink-faint'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-accent">
                    R$ {Number(c.custo_brl).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {c.parecer_ia ? (
                      <Search className="h-3.5 w-3.5 text-success inline" />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
