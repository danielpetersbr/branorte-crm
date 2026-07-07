import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useResumoDia, type ResumoDiaVendedor } from '@/hooks/useResumoDia'

// ============================================================================
// "Resumo do dia por vendedor" — card do Dashboard com os números de HOJE ao
// vivo (mesma fonte das mesas do /disparos), legenda explicando cada coluna e
// botão que copia o resumo formatado pra colar no grupo do WhatsApp.
// Negociação = Follow-up + Lead Quente. "Carteira" = total de conversas.
// ============================================================================

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)

// Colunas: ícone + rótulo curto (header) + explicação (legenda e tooltip)
const COLS: Array<{ key: keyof Pick<ResumoDiaVendedor, 'leads' | 'atendimentos' | 'orcamentos' | 'negociacao' | 'quente' | 'carteira'>; icon: string; label: string; explica: string }> = [
  { key: 'leads',        icon: '📥', label: 'Leads',      explica: 'leads novos que chegaram hoje' },
  { key: 'atendimentos', icon: '💬', label: 'Atendidos',  explica: 'conversas trabalhadas hoje' },
  { key: 'orcamentos',   icon: '📄', label: 'Orçamentos', explica: 'orçamentos montados hoje' },
  { key: 'negociacao',   icon: '🤝', label: 'Negociando', explica: 'em negociação agora (follow-up + quente)' },
  { key: 'quente',       icon: '🔥', label: 'Quentes',    explica: 'leads quentes agora' },
  { key: 'carteira',     icon: '👥', label: 'Carteira',   explica: 'total de conversas do vendedor (histórico)' },
]

// Monta o texto pro WhatsApp (negrito com *asteriscos*, uma linha por vendedor).
// Sem a contagem de leads — pedido do Daniel (leads ficam só na tela).
function textoWhatsApp(rows: ResumoDiaVendedor[], tot: Record<string, number>): string {
  const data = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const linhas = rows.map(r =>
    `*${r.nome}:* 💬${r.atendimentos} 📄${r.orcamentos} 🤝${r.negociacao}${r.quente > 0 ? ` 🔥${r.quente}` : ''}`
  )
  return [
    `☀️ *RESUMO DO DIA — ${data}*`,
    '',
    `*TIME:* 💬 ${tot.atendimentos} atendidos · 📄 ${tot.orcamentos} orçamentos · 🤝 ${tot.negociacao} negociando · 🔥 ${tot.quente} quentes`,
    '',
    ...linhas,
    '',
    '_💬 atendidos hoje · 📄 orçamentos hoje · 🤝 em negociação · 🔥 quentes_',
  ].join('\n')
}

export function ResumoDiaVendedores() {
  const { linhas, isLoading, isError } = useResumoDia()
  const [copiado, setCopiado] = useState(false)

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

  const copiar = () => {
    navigator.clipboard?.writeText(textoWhatsApp(rows, tot)).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    })
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink tracking-tight flex items-center gap-1.5">
            <span>☀️</span> Resumo do dia por vendedor
          </h3>
          <p className="text-[11px] text-ink-faint mt-0.5">
            Números de hoje, ao vivo — mesma fonte das mesas do escritório. Atualiza sozinho.
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={copiar}
            className={`shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium border transition-all ${
              copiado
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-surface-2 text-ink-muted hover:text-ink hover:border-border-strong'
            }`}
            title="Copia o resumo formatado pra colar no grupo do WhatsApp"
          >
            {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiado ? 'Copiado! Cola no grupo' : 'Copiar pro WhatsApp'}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-[12px] text-ink-muted py-6 text-center">Carregando resumo…</p>
      ) : isError ? (
        <p className="text-[12px] text-danger py-6 text-center">Não deu pra carregar o resumo agora.</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-ink-muted py-6 text-center">Nenhum vendedor no painel.</p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-[12.5px] border-collapse min-w-[560px]">
              <thead>
                <tr className="text-ink-faint text-[10.5px] uppercase tracking-wide">
                  <th className="text-left font-medium py-2 pr-2">Vendedor</th>
                  {COLS.map(c => (
                    <th key={c.key} title={c.explica} className="text-right font-medium py-2 px-2 whitespace-nowrap cursor-help">
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
                  <td className="py-2 pr-2 text-ink text-[11px] uppercase tracking-wide">Total do time</td>
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

          {/* Legenda — o que cada número significa */}
          <p className="mt-3 pt-3 border-t border-border/60 text-[11px] leading-relaxed text-ink-faint">
            {COLS.map((c, i) => (
              <span key={c.key} className="whitespace-nowrap">
                {i > 0 && <span className="mx-1.5 text-ink-faint/50">·</span>}
                {c.icon} <b className="text-ink-muted font-medium">{c.label}</b> = {c.explica}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  )
}
