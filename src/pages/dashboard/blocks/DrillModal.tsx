import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { DashboardPreset } from '@/hooks/useDashboard'
import { useDashboardVendasDetalhe, useDashboardOrcamentosDetalhe } from '@/hooks/useDashboardOrcamentos'
import { brlFull, n } from '../ui/format'

type Kind = 'orcamentos' | 'vendidos' | 'valor'

function dt(s: string | null): string {
  if (!s) return '—'
  return new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString('pt-BR')
}

/**
 * "De onde vem" — a lista por trás do KPI. Reconcilia 1:1 com o número do card.
 *
 * Este drill-down é o que substitui os parágrafos técnicos que ficavam soltos na
 * tela: em vez de explicar por escrito por que 14 ≠ 54, o gerente clica e vê as
 * linhas.
 */
export function DrillModal({ kind, preset, onClose }: { kind: Kind; preset: DashboardPreset; onClose: () => void }) {
  const isVendas = kind === 'vendidos' || kind === 'valor'
  const vendasQ = useDashboardVendasDetalhe(preset, isVendas)
  const orcQ = useDashboardOrcamentosDetalhe(preset, kind === 'orcamentos')
  const [soLead, setSoLead] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)
  const fecharRef = useRef<HTMLButtonElement>(null)

  // Devolve o foco pro elemento que abriu — sem isso quem usa teclado
  // volta pro topo da página toda vez que fecha.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    fecharRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !boxRef.current) return
      const focaveis = boxRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); anterior?.focus?.() }
  }, [onClose])

  const loading = isVendas ? vendasQ.isLoading : orcQ.isLoading
  const err = (isVendas ? vendasQ.error : orcQ.error) as Error | null

  const vendas = vendasQ.data ?? []
  const vendasView = soLead ? vendas.filter(v => v.is_lead) : vendas
  const vTot = vendasView.reduce((s, v) => s + v.valor, 0)
  const orc = orcQ.data ?? []
  const orcValTot = orc.reduce((s, o) => s + o.valor_total, 0)

  const title = kind === 'orcamentos' ? 'Propostas — de onde vêm'
    : kind === 'vendidos' ? 'Vendas — de onde vêm'
    : 'Valor vendido — de onde vem'
  const subtitle = isVendas
    ? `${n(vendasView.length)} venda(s) · ${brlFull(vTot)}${soLead ? ' — com origem comprovada até um lead' : ' — todas as vendas do período'}`
    : `${n(orc.length)} cliente(s) com proposta · ${brlFull(orcValTot)} montados`

  const thCls = 'text-left py-2 px-2 text-micro font-semibold text-ink-muted whitespace-nowrap'
  const tdCls = 'py-2 px-2 text-body text-ink-muted'

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center overflow-y-auto bg-overlay/50 p-3 sm:items-center sm:p-5"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-title text-ink">{title}</h2>
            <p className="text-label text-ink-faint">{subtitle}</p>
          </div>
          <button
            ref={fecharRef}
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:h-9 md:w-9"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto p-3">
          {loading && <div className="p-5 text-center text-body text-ink-faint">Carregando…</div>}
          {err && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-body text-danger">
              Não deu para carregar esta lista. <span className="font-mono text-micro break-all">{err.message}</span>
            </div>
          )}

          {!loading && !err && isVendas && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
                <button
                  onClick={() => setSoLead(true)}
                  aria-pressed={soLead}
                  className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-micro transition-colors md:min-h-0 ${soLead ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
                >
                  Origem comprovada ({n(vendas.filter(v => v.is_lead).length)})
                </button>
                <button
                  onClick={() => setSoLead(false)}
                  aria-pressed={!soLead}
                  className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-micro transition-colors md:min-h-0 ${!soLead ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
                >
                  Todas ({n(vendas.length)})
                </button>
                <span className="ml-auto text-title tabular-nums text-ink">{brlFull(vTot)}</span>
              </div>
              {soLead && (
                <p className="mb-3 px-2 text-micro text-ink-faint">
                  &ldquo;Origem comprovada&rdquo; é piso, não fatia de mercado: a venda só entra aqui quando dá para
                  ligar pedido → orçamento → telefone de um atendimento. Venda de cliente antigo ou de orçamento
                  feito fora do sistema fica de fora mesmo tendo vindo de um lead.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Vendas do período com cliente, vendedor, origem e valor</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={thCls}>Cliente</th>
                      <th scope="col" className={thCls}>Vendedor</th>
                      <th scope="col" className={thCls}>Origem</th>
                      <th scope="col" className={thCls}>Criativo</th>
                      <th scope="col" className={`${thCls} text-right`}>Valor</th>
                      <th scope="col" className={thCls}>Data</th>
                      <th scope="col" className={thCls}>Cidade/UF</th>
                      <th scope="col" className={thCls}>Nº orç.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendasView.map((v, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                        <td className={`${tdCls} text-ink`}>{v.cliente || '—'}</td>
                        <td className={tdCls}>{v.vendedor || '—'}</td>
                        <td className={tdCls}>{v.origem || '—'}</td>
                        <td className={`${tdCls} font-mono text-ink-faint`}>{v.criativo || '—'}</td>
                        <td className={`${tdCls} text-right font-mono tabular-nums text-ink`}>{brlFull(v.valor)}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{dt(v.data_venda)}</td>
                        <td className={tdCls}>{[v.cidade, v.estado].filter(Boolean).join('/') || '—'}</td>
                        <td className={`${tdCls} font-mono text-ink-faint`}>{v.numero || '—'}</td>
                      </tr>
                    ))}
                    {vendasView.length === 0 && (
                      <tr><td colSpan={8} className="py-5 text-center text-body text-ink-faint">Nada no período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!loading && !err && !isVendas && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">Clientes com proposta no período</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={thCls}>Cliente</th>
                    <th scope="col" className={thCls}>Telefone</th>
                    <th scope="col" className={`${thCls} text-right`}>Propostas</th>
                    <th scope="col" className={`${thCls} text-right`}>Valor total</th>
                    <th scope="col" className={thCls}>Última</th>
                    <th scope="col" className={thCls}>Vendedor</th>
                    <th scope="col" className={thCls}>Origem</th>
                    <th scope="col" className={thCls}>Criativo</th>
                  </tr>
                </thead>
                <tbody>
                  {orc.map((o, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                      <td className={`${tdCls} text-ink`}>{o.cliente || '—'}</td>
                      <td className={`${tdCls} font-mono`}>{o.fone}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{o.qtd}</td>
                      <td className={`${tdCls} text-right font-mono tabular-nums text-ink`}>{brlFull(o.valor_total)}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{dt(o.ultima_data)}</td>
                      <td className={tdCls}>{o.vendedor || '—'}</td>
                      <td className={tdCls}>{o.origem || '—'}</td>
                      <td className={`${tdCls} font-mono text-ink-faint`}>{o.criativo || '—'}</td>
                    </tr>
                  ))}
                  {orc.length === 0 && (
                    <tr><td colSpan={8} className="py-5 text-center text-body text-ink-faint">Nada no período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
