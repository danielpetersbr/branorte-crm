import type { ReactNode } from 'react'

// ============================================================================
// "Quando chegam os leads" — heatmap dia da semana × hora.
//
// Morava em DOIS lugares: a versão boa dentro do TabEquipe do Dashboard e uma
// segunda, mais pobre (cores hsl() fixas, cega no dark mode), no /analytics.
// Em 03/09/2026 as duas saíram e o bloco passou a viver SÓ no /roadmap.
// Virou componente próprio pra não ficar preso a uma página de novo.
//
// Autocontido de propósito — mesmo padrão do ResumoDiaVendedores: nada de
// importar `Inner`/`format` de `pages/dashboard/ui`. As classes de tom estão
// inline e entregam o mesmo visual, sem componente amarrado a outra página.
//
// ⚠️ `dow` chega 1..7 (seg..dom) da RPC `dashboard_heatmap_semanal`. Qualquer
// valor fora dessa faixa cai em domingo, que é o que o código antigo já fazia.
// ============================================================================

const DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// 4 níveis discretos, todos tokenizados (a versão do /analytics usava hsl()
// fixo, que não respondia ao dark mode). Alpha ≤ 60% mantém `text-ink` legível
// por cima.
const NIVEL_CLS = ['bg-surface-2', 'bg-success/15', 'bg-success/35', 'bg-success/60'] as const
const NIVEL_LABEL = ['Vazio', 'Baixo', 'Médio', 'Pico'] as const

const TONE_CLS = {
  neutro: 'bg-surface-2 border-border/60',
  atencao: 'bg-warning-bg border-warning/30',
  perigo: 'bg-danger-bg border-danger/30',
  positivo: 'bg-success-bg border-success/30',
} as const

const NF = new Intl.NumberFormat('pt-BR')
/** Inteiro com separador de milhar: 3509 → "3.509" */
function n(v: number): string {
  return NF.format(Math.round(v))
}

function Tile({ tone = 'neutro', children }: { tone?: keyof typeof TONE_CLS; children: ReactNode }) {
  return <div className={`rounded-lg border p-3 ${TONE_CLS[tone]}`}>{children}</div>
}

export function HeatmapDiaHora({ heatmap }: { heatmap: { dow: number; hour: number; total: number }[] }) {
  const matriz: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxVal = 0
  let pico = { dia: 0, hora: 0, val: 0 }
  for (const h of heatmap) {
    const di = h.dow >= 1 && h.dow <= 7 ? h.dow - 1 : 6
    if (h.hour >= 0 && h.hour < 24) {
      matriz[di][h.hour] = h.total
      if (h.total > maxVal) maxVal = h.total
      if (h.total > pico.val) pico = { dia: di, hora: h.hour, val: h.total }
    }
  }
  const totalPorDia = matriz.map(row => row.reduce((s, v) => s + v, 0))
  const totalPorHora = Array.from({ length: 24 }, (_, h) => matriz.reduce((s, row) => s + row[h], 0))
  const totalGeral = totalPorDia.reduce((s, v) => s + v, 0)
  const maxHora = Math.max(...totalPorHora, 1)
  const diaForte = totalPorDia.indexOf(Math.max(...totalPorDia))
  // Janela comercial padrão: seg-sex, 8h às 18h
  const dentroComercial = matriz.reduce((s, row, di) =>
    s + row.slice(8, 19).reduce((a, b) => a + b, 0) * (di < 5 ? 1 : 0), 0)
  const pctComercial = totalGeral > 0 ? Math.round((dentroComercial / totalGeral) * 100) : 0

  if (totalGeral === 0) {
    return <p className="text-body text-ink-faint">Sem dados no período.</p>
  }

  const nivel = (v: number): 0 | 1 | 2 | 3 => {
    if (v === 0) return 0
    const r = v / (maxVal || 1)
    if (r >= 0.66) return 3
    if (r >= 0.33) return 2
    return 1
  }

  return (
    <div className="space-y-5">
      {/* Leitura rápida: pico, dia mais forte, % no horário comercial */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile tone="positivo">
          <div className="text-micro uppercase tracking-wide text-ink-faint">Pico</div>
          <div className="mt-1 text-label text-ink">{DOW[pico.dia]} {pico.hora}h</div>
          <div className="text-micro tabular-nums text-ink-muted">{n(pico.val)} leads</div>
        </Tile>
        <Tile>
          <div className="text-micro uppercase tracking-wide text-ink-faint">Dia mais movimentado</div>
          <div className="mt-1 text-label text-ink">{DOW[diaForte]}</div>
          <div className="text-micro tabular-nums text-ink-muted">{n(totalPorDia[diaForte])} leads</div>
        </Tile>
        <Tile tone={pctComercial >= 70 ? 'positivo' : pctComercial >= 50 ? 'atencao' : 'perigo'}>
          <div className="text-micro uppercase tracking-wide text-ink-faint">No horário comercial</div>
          <div className="mt-1 text-label text-ink tabular-nums">{pctComercial}%</div>
          <div className="text-micro text-ink-muted">seg a sex · 8h às 18h</div>
        </Tile>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <caption className="sr-only">Leads por dia da semana e hora, últimos 30 dias, fuso de Brasília.</caption>
          <thead>
            <tr>
              <th className="w-12" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="w-8 text-center text-micro font-normal text-ink-faint">{h}</th>
              ))}
              <th scope="col" className="w-10 pl-2 text-center text-micro font-normal text-ink-faint" title="Total do dia">Total</th>
            </tr>
          </thead>
          <tbody>
            {DOW.map((d, di) => (
              <tr key={d}>
                <th scope="row" className="pr-2 text-right text-micro font-medium text-ink-muted">{d}</th>
                {matriz[di].map((v, h) => {
                  const nv = nivel(v)
                  return (
                    <td
                      key={h}
                      className={`h-8 w-8 rounded-sm text-center ${NIVEL_CLS[nv]}`}
                      title={`${d} ${h}h — ${n(v)} ${v === 1 ? 'lead' : 'leads'} (${NIVEL_LABEL[nv]})`}
                    >
                      <span className="text-micro tabular-nums text-ink">{nv >= 2 ? n(v) : ''}</span>
                    </td>
                  )
                })}
                <td className="pl-2 text-right text-micro tabular-nums text-ink-muted">{n(totalPorDia[di])}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="pr-2 text-right text-micro font-normal text-ink-faint">Hora</th>
              {totalPorHora.map((t, h) => (
                <td key={h} className="align-middle" title={`${h}h — ${n(t)} leads na semana toda`}>
                  <div className="h-3 overflow-hidden rounded-sm bg-surface-2">
                    <div className="h-full bg-info" style={{ width: `${(t / maxHora) * 100}%` }} />
                  </div>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-micro text-ink-faint">
        <span>Intensidade:</span>
        {NIVEL_LABEL.map((label, i) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-sm ${NIVEL_CLS[i]}`} aria-hidden="true" />
            {label}
          </span>
        ))}
        <span className="sm:ml-auto">Fuso de Brasília</span>
      </div>
    </div>
  )
}
