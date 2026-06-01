// Página /consulta — Due Diligence standalone.
// Vendedor entra com CNPJ/CPF e dispara consulta SPC + Datajud + IA.
//
// Layout otimizado:
// - Full width (sem max-width artificial)
// - Antes de consultar: form centralizado (compacto), sidebar Recentes 280px
// - Depois de consultar: sem bordas redundantes, parecer IA em destaque
// - Banner LGPD inline pequeno no header
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, AlertCircle, History, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DueDiligenceForm } from '@/components/contacts/DueDiligenceButton'
import type { DDConsulta } from '@/hooks/useDueDiligence'

export function Consulta() {
  return (
    <div className="min-h-screen bg-bg">
      {/* Header denso, full width */}
      <header className="border-b border-border bg-surface-2/30 px-4 md:px-6 py-3 flex items-center gap-3 sticky top-0 z-10 backdrop-blur-sm">
        <div className="h-8 w-8 rounded-md bg-accent-bg flex items-center justify-center shrink-0">
          <Search className="h-4 w-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[14px] font-bold text-ink leading-tight">Consulta de Cliente</h1>
          <p className="text-[10px] text-ink-faint leading-tight">
            SPC Brasil · Datajud (CNJ) · Parecer IA · antes de fechar negócio
          </p>
        </div>
        <button
          title="LGPD: apenas para negociação ativa. Toda consulta fica registrada."
          className="text-[10px] text-ink-faint hover:text-ink hidden md:flex items-center gap-1"
        >
          <Info className="h-3 w-3" /> LGPD
        </button>
        <Link
          to="/consulta/historico"
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-ink-muted hover:border-accent hover:text-ink flex items-center gap-1.5"
        >
          <History className="h-3.5 w-3.5" /> Histórico
        </Link>
      </header>

      {/* Grid full-bleed: form esquerda flexível + sidebar fixa estreita */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-0">
        {/* Conteúdo principal (form + resultado da consulta) */}
        <main className="px-4 md:px-6 py-4 min-w-0">
          <DueDiligenceForm />
        </main>

        {/* Sidebar Recentes — sticky no desktop, no mobile fica embaixo */}
        <aside className="lg:border-l border-border bg-surface-2/20 px-4 py-4 lg:sticky lg:top-[57px] lg:max-h-[calc(100vh-57px)] lg:overflow-y-auto">
          <h2 className="text-[10px] font-bold text-ink-faint uppercase tracking-widest mb-2">
            Consultas Recentes
          </h2>
          <HistoricoRecente />
        </aside>
      </div>
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
        .limit(20)
      if (error) throw error
      return (data ?? []) as DDConsulta[]
    },
    staleTime: 15_000,
  })

  if (isLoading) return <p className="text-[10px] text-ink-faint">Carregando...</p>
  if (error) return (
    <p className="text-[10px] text-danger flex items-start gap-1">
      <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
      {(error as Error).message}
    </p>
  )
  if (!data || data.length === 0) {
    return (
      <p className="text-[10px] text-ink-faint leading-relaxed">
        Nenhuma consulta ainda. Use o formulário ao lado pra começar.
      </p>
    )
  }

  return (
    <ul className="space-y-1">
      {data.map(c => (
        <li
          key={c.id}
          className="text-[10px] px-2 py-1.5 rounded bg-surface-2/40 hover:bg-surface-2/70 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="font-mono text-ink">{c.cnpj || c.cpf_socio || '—'}</span>
            <span className={`text-[9px] font-bold ${
              c.status === 'success' ? 'text-success' :
              c.status === 'partial' ? 'text-warning' :
              c.status === 'failed' ? 'text-danger' : 'text-ink-faint'
            }`}>
              R$ {Number(c.custo_brl).toFixed(2)}
            </span>
          </div>
          <div className="text-[9px] text-ink-faint flex items-center justify-between">
            <span>{new Date(c.created_at).toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })}</span>
            <span className="uppercase">{c.pacote}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
