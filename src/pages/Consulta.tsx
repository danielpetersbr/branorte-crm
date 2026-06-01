// Página /consulta — Due Diligence standalone.
// Vendedor entra com CNPJ/CPF e dispara consulta SPC + Datajud + IA.
//
// Layout otimizado:
// - Full width até 1600px (max-w-[1600px] mx-auto) com paddings responsivos
// - Form inline horizontal em desktop (tipo + doc + pacote + botão numa linha)
// - Recentes vira drawer lateral (botão no header) — sem sidebar fixa
// - LGPD vira ícone <Info /> com popover/tooltip no header
// - Resultado sem bordas duplicadas; ParecerIA sticky no topo + score gigante
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, AlertCircle, History, Info, X, Eye, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DueDiligenceForm } from '@/components/contacts/DueDiligenceButton'
import type { DDConsulta } from '@/hooks/useDueDiligence'

export function Consulta() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [lgpdOpen, setLgpdOpen] = useState(false)
  const lgpdRef = useRef<HTMLDivElement | null>(null)
  // Estado da consulta atualmente sendo VISUALIZADA do historico (lifting state
  // pra a pagina). Quando setado, o DueDiligenceForm renderiza este resultado
  // no lugar de `consultar.data`. F5 perde — vive na URL via ?id=XXX pra deep-link.
  const [consultaSelecionada, setConsultaSelecionada] = useState<DDConsulta | null>(null)
  const resultadoRef = useRef<HTMLDivElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

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

  // Deep-link: se vier ?id=XXX na URL, carrega a consulta uma vez no mount.
  // Defensive: valida campos esperados antes de renderizar.
  const idFromUrl = searchParams.get('id')
  useEffect(() => {
    if (!idFromUrl || consultaSelecionada?.id === idFromUrl) return
    let cancelado = false
    ;(async () => {
      const { data, error } = await supabase
        .from('due_diligence_consultas')
        .select('*')
        .eq('id', idFromUrl)
        .maybeSingle()
      if (cancelado) return
      if (error || !data || !data.id) {
        // ID invalido — limpa da URL pra evitar tentar de novo em loop
        setSearchParams(prev => {
          const next = new URLSearchParams(prev)
          next.delete('id')
          return next
        }, { replace: true })
        return
      }
      setConsultaSelecionada(data as DDConsulta)
      setTimeout(() => resultadoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    })()
    return () => { cancelado = true }
  }, [idFromUrl, consultaSelecionada?.id, setSearchParams])

  // ESC: limpa view + fecha drawer. UX teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (drawerOpen) {
        setDrawerOpen(false)
      } else if (consultaSelecionada) {
        handleClearView()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, consultaSelecionada])

  // Centraliza a logica de "carregar consulta no resultado inline".
  const handleSelectConsulta = useCallback((c: DDConsulta) => {
    setConsultaSelecionada(c)
    setDrawerOpen(false)
    // Sync URL pra deep-link sem trigger do efeito de fetch (id ja bate).
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('id', c.id)
      return next
    }, { replace: true })
    setTimeout(() => resultadoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [setSearchParams])

  const handleClearView = useCallback(() => {
    setConsultaSelecionada(null)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('id')
      return next
    }, { replace: true })
  }, [setSearchParams])

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
        {/* Indicador de "modo visualizar historico" — clareza sobre como sair */}
        {consultaSelecionada && (
          <div className="dd-no-print mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-accent/40 bg-accent-bg/30">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="h-3.5 w-3.5 text-accent shrink-0" />
              <p className="text-[11px] text-ink leading-tight min-w-0 truncate">
                Visualizando consulta do histórico —{' '}
                <span className="font-mono text-ink-muted">
                  {consultaSelecionada.cnpj || consultaSelecionada.cpf_socio || '—'}
                </span>{' '}
                de{' '}
                <span className="tabular-nums">
                  {new Date(consultaSelecionada.created_at).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearView}
              title="Voltar pro form vazio (ESC)"
              className="text-[10px] font-semibold px-2 py-1 rounded-md border border-border bg-surface-2 text-ink-muted hover:text-ink hover:border-accent flex items-center gap-1.5 shrink-0"
            >
              <ArrowLeft className="h-3 w-3" /> Nova consulta
            </button>
          </div>
        )}

        <div ref={resultadoRef}>
          <DueDiligenceForm
            viewConsulta={consultaSelecionada}
            onNewConsulta={handleClearView}
          />
        </div>
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
              <div className="flex-1 min-w-0">
                <h2 className="text-[12px] font-bold text-ink uppercase tracking-wider leading-tight">
                  Consultas Recentes
                </h2>
                <p className="text-[9px] text-ink-faint leading-tight">
                  Clique para carregar o resultado
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-ink-faint hover:text-ink"
                aria-label="Fechar"
                title="Fechar (ESC)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 tabular-nums slashed-zero">
              <HistoricoRecente
                selectedId={consultaSelecionada?.id ?? null}
                onSelect={handleSelectConsulta}
              />
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

function HistoricoRecente({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (c: DDConsulta) => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dd', 'recentes'],
    queryFn: async (): Promise<DDConsulta[]> => {
      const { data, error } = await supabase
        .from('due_diligence_consultas')
        // embed do vendedor via FK created_by → user_profiles(id). RLS:
        // admin lê todos os perfis (vê o nome de qualquer vendedor); vendedor
        // comum só vê as próprias consultas, e o próprio perfil é legível.
        .select('*, autor:created_by(display_name)')
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as DDConsulta[]
    },
    staleTime: 15_000,
  })

  // Navegação por setas ←/→ entre os itens (no INLINE não precisa fechar nada,
  // só troca o consultaSelecionada — UX super fluida).
  useEffect(() => {
    if (!data || data.length === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      // Só captura se não estiver em input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      const items = data!
      const idx = selectedId ? items.findIndex(c => c.id === selectedId) : -1
      let next: number
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1)
      else next = idx <= 0 ? 0 : idx - 1
      onSelect(items[next])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, selectedId, onSelect])

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
    <ul className="space-y-1" role="listbox" aria-label="Consultas recentes">
      {data.map(c => {
        const ativo = selectedId === c.id
        return (
          <li
            key={c.id}
            role="option"
            tabIndex={0}
            aria-selected={ativo}
            title="Clique para ver o resultado completo"
            onClick={() => onSelect(c)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(c)
              }
            }}
            className={`text-[10px] px-2 py-1.5 rounded transition-colors cursor-pointer outline-none focus:ring-1 focus:ring-accent ${
              ativo
                ? 'bg-accent-bg/40 border-l-2 border-accent pl-1.5'
                : 'bg-surface-2/40 hover:bg-surface-2/70 border-l-2 border-transparent pl-1.5'
            }`}
          >
            <div className="flex items-center justify-between mb-0.5 gap-1.5">
              <span className="font-mono text-ink truncate min-w-0">
                {c.cnpj || c.cpf_socio || '—'}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Eye className={`h-2.5 w-2.5 ${ativo ? 'text-accent' : 'text-ink-faint'}`} />
                <span className={`text-[9px] font-bold ${
                  c.status === 'success' ? 'text-success' :
                  c.status === 'partial' ? 'text-warning' :
                  c.status === 'failed' ? 'text-danger' : 'text-ink-faint'
                }`}>
                  R$ {Number(c.custo_brl).toFixed(2)}
                </span>
              </div>
            </div>
            <div className="text-[9px] text-ink-faint flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1 min-w-0 truncate">
                {new Date(c.created_at).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                })}
                {c.autor?.display_name && (
                  <span className="text-ink-muted truncate" title={`Consulta feita por ${c.autor.display_name}`}>
                    · {c.autor.display_name}
                  </span>
                )}
              </span>
              <span className="uppercase shrink-0">{c.pacote}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
