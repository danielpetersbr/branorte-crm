// Página /consulta — Due Diligence standalone.
// Vendedor entra com CNPJ/CPF e dispara consulta SPC + Datajud + IA.
//
// Layout otimizado:
// - Full width até 1600px (max-w-[1600px] mx-auto) com paddings responsivos
// - Form inline horizontal em desktop (tipo + doc + pacote + botão numa linha)
// - Recentes vira drawer lateral (botão no header) — sem sidebar fixa
// - LGPD vira ícone <Info /> com popover/tooltip no header
// - Resultado sem bordas duplicadas; ParecerIA sticky no topo + score gigante
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, AlertCircle, History, Info, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DueDiligenceForm } from '@/components/contacts/DueDiligenceButton'
import type { DDConsulta } from '@/hooks/useDueDiligence'

export function Consulta() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [lgpdOpen, setLgpdOpen] = useState(false)
  const lgpdRef = useRef<HTMLDivElement | null>(null)

  // Fechar popover LGPD ao clicar fora
  useEffect(() => {
    if (!lgpdOpen) return
    function onClick(e: MouseEvent) {
      if (lgpdRef.current && !lgpdRef.current.contains(e.target as Node)) {
        setLgpdOpen(false)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [lgpdOpen])

  return (
    <div className="min-h-screen bg-bg tabular-nums slashed-zero">
      {/* Header denso, full width */}
      <header className="border-b border-border bg-surface-2/30 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent-bg flex items-center justify-center shrink-0">
            <Search className="h-4 w-4 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[14px] font-bold text-ink leading-tight">Consulta de Cliente</h1>
            <p className="text-[10px] text-ink-faint leading-tight">
              SPC Brasil · Datajud (CNJ) · Parecer IA · antes de fechar negócio
            </p>
          </div>

          {/* Botão LGPD com popover */}
          <div className="relative" ref={lgpdRef}>
            <button
              type="button"
              onClick={() => setLgpdOpen(o => !o)}
              title="Aviso LGPD"
              aria-label="Aviso LGPD"
              className="h-8 w-8 rounded-md border border-border bg-surface-2 text-ink-muted hover:text-ink hover:border-accent flex items-center justify-center"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            {lgpdOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 z-30 rounded-md border border-border bg-surface-2 shadow-xl p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Info className="h-3.5 w-3.5 text-accent" />
                  <p className="text-[11px] font-bold text-ink uppercase tracking-wider">Aviso LGPD</p>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  Consultas SPC/Datajud só podem ser usadas para <strong>negociação ativa</strong>.
                  Toda consulta fica registrada com responsável, data e custo.
                  Não compartilhe os dados retornados fora do CRM.
                </p>
              </div>
            )}
          </div>

          {/* Botão Recentes (abre drawer) */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-ink-muted hover:border-accent hover:text-ink flex items-center gap-1.5"
          >
            <History className="h-3.5 w-3.5" /> Recentes
          </button>

          <Link
            to="/consulta/historico"
            className="hidden md:flex text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-ink-muted hover:border-accent hover:text-ink items-center gap-1.5"
          >
            Histórico completo
          </Link>
        </div>
      </header>

      {/* Conteúdo full-width */}
      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-4 min-w-0">
        <DueDiligenceForm />
      </main>

      {/* Drawer de Recentes (overlay + painel lateral) */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="fixed right-0 top-0 bottom-0 z-40 w-[320px] max-w-[90vw] bg-surface-2 border-l border-border shadow-2xl flex flex-col"
            role="dialog"
            aria-label="Consultas recentes"
          >
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <History className="h-4 w-4 text-accent" />
              <h2 className="text-[12px] font-bold text-ink uppercase tracking-wider flex-1">
                Consultas Recentes
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-ink-faint hover:text-ink"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 tabular-nums slashed-zero">
              <HistoricoRecente />
            </div>
            <div className="px-4 py-2 border-t border-border">
              <Link
                to="/consulta/historico"
                className="text-[11px] font-semibold text-accent hover:underline"
                onClick={() => setDrawerOpen(false)}
              >
                Ver histórico completo →
              </Link>
            </div>
          </aside>
        </>
      )}
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
