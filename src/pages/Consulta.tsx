// Pagina /consulta — Due Diligence standalone.
// Vendedor entra com CNPJ + opcional CPF socio e dispara consulta SPC.
// Lista abaixo as ultimas N consultas do proprio vendedor (admin ve todas via RLS).
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, AlertCircle, FileText, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DueDiligenceForm } from '@/components/contacts/DueDiligenceButton'
import type { DDConsulta } from '@/hooks/useDueDiligence'

export function Consulta() {
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-accent-bg flex items-center justify-center">
          <Search className="h-5 w-5 text-accent" />
        </div>
        <div className="flex-1">
          <h1 className="text-[18px] font-bold text-ink">Consulta de Cliente</h1>
          <p className="text-[12px] text-ink-muted">
            SPC Brasil, processos judiciais e perfil — antes de fechar negócio.
          </p>
        </div>
        <Link
          to="/consulta/historico"
          className="text-[11px] font-semibold px-3 py-2 rounded-md bg-surface-2 border border-border text-ink-muted hover:border-accent hover:text-ink flex items-center gap-1.5"
        >
          <History className="h-3.5 w-3.5" /> Histórico
        </Link>
      </header>

      <div className="grid md:grid-cols-[1fr_320px] gap-4">
        {/* Form (esquerda) */}
        <section className="border border-border bg-bg rounded-lg p-5">
          <h2 className="text-[13px] font-semibold text-ink mb-3">Nova consulta</h2>
          <DueDiligenceForm />
        </section>

        {/* Histórico recente (direita) */}
        <aside className="border border-border bg-bg rounded-lg p-5 self-start">
          <h2 className="text-[13px] font-semibold text-ink mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-ink-muted" />
            Recentes
          </h2>
          <HistoricoRecente />
        </aside>
      </div>

      <BannerLgpd />
    </div>
  )
}

function HistoricoRecente() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dd', 'recentes'],
    queryFn: async (): Promise<DDConsulta[]> => {
      const { data, error } = await supabase
        .from('due_diligence_consultas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15)
      if (error) throw error
      return (data ?? []) as DDConsulta[]
    },
    staleTime: 15_000,
  })

  if (isLoading) return <p className="text-[11px] text-ink-muted">Carregando...</p>
  if (error) return <p className="text-[11px] text-danger">{(error as Error).message}</p>
  if (!data || data.length === 0) {
    return (
      <p className="text-[11px] text-ink-faint">
        Nenhuma consulta ainda. Comece preenchendo o formulário ao lado.
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {data.map(c => (
        <li
          key={c.id}
          className="text-[11px] px-2 py-1.5 rounded border border-border/50 bg-surface-2/30"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="font-mono text-ink-muted">{c.cnpj}</span>
            <span className={`text-[10px] font-semibold ${
              c.status === 'success' ? 'text-success' :
              c.status === 'partial' ? 'text-warning' :
              c.status === 'failed' ? 'text-danger' : 'text-ink-faint'
            }`}>
              R$ {c.custo_brl.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] text-ink-faint flex items-center justify-between">
            <span>{new Date(c.created_at).toLocaleString('pt-BR')}</span>
            <span className="uppercase">{c.pacote}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function BannerLgpd() {
  return (
    <div className="bg-surface-2/40 border border-border rounded-md px-4 py-3 flex items-start gap-2">
      <AlertCircle className="h-4 w-4 text-ink-muted shrink-0 mt-0.5" />
      <p className="text-[11px] text-ink-muted leading-relaxed">
        <strong>LGPD:</strong> consultas devem ser feitas apenas quando há
        negociação ativa com o cliente (base legal: análise de crédito /
        interesse legítimo). Não usar pra leads frios sem contato prévio.
        Toda consulta fica registrada com seu usuário e timestamp.
      </p>
    </div>
  )
}
