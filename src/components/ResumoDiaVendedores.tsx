import { useMemo } from 'react'
import { useResumoDia, type ResumoDiaVendedor } from '@/hooks/useResumoDia'

// ============================================================================
// "Resumo do dia por vendedor" — card do Dashboard com os números de HOJE ao
// vivo (mesma fonte das mesas do /disparos). Colunas: Leads que chegaram,
// Atendimentos, Orçamentos, Negociação (Follow-up + Quente), Quente, Total.
// ============================================================================

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)

// Cabeçalho de cada coluna numérica: ícone + rótulo + tooltip (bate com /disparos)
const COLS: Array<{ key: keyof Pick<ResumoDiaVendedor, 'leads' | 'atendimentos' | 'orcamentos' | 'negociacao' | 'quente' | 'carteira'>; icon: string; label: string; hint: string }> = [
  { key: 'leads',        icon: '📥', label: 'Leads',   hint: 'Leads que chegaram hoje (fonte: Atendimentos)' },
  { key: 'atendimentos', icon: '💬', label: 'Atend.',  hint: 'Atendimentos hoje (chats trabalhados no dia)' },
  { key: 'orcamentos',   icon: '📄', label: 'Orçam.',  hint: 'Orçamentos montados hoje no builder' },
  { key: 'negociacao',   icon: '🤝', label: 'Negoc.',  hint: 'Em negociação = Follow-up + Lead Quente' },
  { key: 'quente',       icon: '🔥', label: 'Quente',  hint: 'Leads quentes no funil agora' },
  { key: 'carteira',     icon: '👥', label: 'Total',   hint: 'Total de conversas do vendedor (carteira)' },
]

export function ResumoDiaVendedores() {
  const { linhas, isLoading, isError } = useResumoDia()

  // Ordena por atendimentos do dia (quem mais trabalhou hoje no topo).
  const rows = useMemo(
    () => [...linhas].sort((a, b) => b.atendimentos - a.atendimentos || b.leads - a.leads),
    [linhas],
  )

  const tot = useMemo(() => rows.reduce((a, r) => ({
    leads: a.leads + r.leads,
    atendimentos: a.atendimentos + r.atendimentos,
    orcamentos: a.orcamentos + r.orcamentos,
    negociacao: a.negociacao + r.negociacao,
    quente: a.quente + r.quente,
    carteira: a.carteira + r.carteira,
  }), { leads: 0, atendimentos: 0, orcamentos: 0, negociacao: 0, quente: 0, carteira: 0 }), [rows])

  return (
    <div className="bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink tracking-tight flex items-center gap-1.5">
            <span>☀️</span> Resumo do dia por vendedor
          </h3>
          <p className="text-[11px] text-ink-faint mt-0.5">
            Números de hoje, ao vivo — mesma fonte das mesas do escritório. Atualiza sozinho.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[12px] text-ink-muted py-6 text-center">Carregando resumo…</p>
      ) : isError ? (
        <p className="text-[12px] text-danger py-6 text-center">Não deu pra carregar o resumo agora.</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-ink-muted py-6 text-center">Nenhum vendedor no painel.</p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-[12.5px] border-collapse min-w-[520px]">
            <thead>
              <tr className="text-ink-faint text-[10.5px] uppercase tracking-wide">
                <th className="text-left font-medium py-2 pr-2">Vendedor</th>
                {COLS.map(c => (
                  <th key={c.key} title={c.hint} className="text-right font-medium py-2 px-2 whitespace-nowrap cursor-help">
                    <span className="mr-0.5">{c.icon}</span>{c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const semAtividade = r.leads === 0 && r.atendimentos === 0 && r.orcamentos === 0 && r.negociacao === 0
                return (
                  <tr key={r.nome} className="border-t border-border/60 hover:bg-surface-2/40 transition-colors">
                    <td className="py-2 pr-2">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${r.online ? 'bg-success' : 'bg-ink-faint/40'}`} title={r.online ? 'online' : 'offline'} />
                        <span className={`font-medium truncate ${semAtividade ? 'text-ink-faint' : 'text-ink'}`}>{r.nome}</span>
                      </span>
                    </td>
                    <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(r.leads)}</td>
                    <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(r.atendimentos)}</td>
                    <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(r.orcamentos)}</td>
                    <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(r.negociacao)}</td>
                    <td className={`text-right tabular-nums py-2 px-2 ${r.quente > 0 ? 'text-orange-300 font-semibold' : 'text-ink-muted'}`}>{fmt(r.quente)}</td>
                    <td className="text-right tabular-nums py-2 px-2 text-ink-muted">{fmt(r.carteira)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 pr-2 text-ink text-[11px] uppercase tracking-wide">Total</td>
                <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.leads)}</td>
                <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.atendimentos)}</td>
                <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.orcamentos)}</td>
                <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.negociacao)}</td>
                <td className="text-right tabular-nums py-2 px-2 text-orange-300">{fmt(tot.quente)}</td>
                <td className="text-right tabular-nums py-2 px-2 text-ink-muted">{fmt(tot.carteira)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
