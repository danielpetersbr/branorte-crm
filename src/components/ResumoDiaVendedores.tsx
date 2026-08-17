import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useResumoDia, type ResumoDiaVendedor } from '@/hooks/useResumoDia'
import type { DashboardPreset } from '@/hooks/useDashboard'

// ============================================================================
// "Resumo do dia por vendedor" — card do Dashboard com os números de HOJE ao
// vivo (mesma fonte das mesas do /disparos), legenda explicando cada coluna e
// botão que copia o resumo formatado pra colar no grupo do WhatsApp.
// Negociação = Follow-up + Lead Quente. "Carteira" = total de conversas.
// ============================================================================

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)

// Célula numérica com barra proporcional (bar-in-cell) — deixa a tabela escaneável:
// a barra é relativa ao maior valor da coluna; o líder da coluna fica destacado.
//
// Três decisões que vieram de olhar a tela em produção (13/08):
// 1. ZERO NÃO GANHA BARRA. O `Math.max(pct,3)` antigo desenhava um risco de 3% mesmo pra
//    val=0 — na coluna Quentes, zerada em todo mundo, virava uma fileira de "0|" que
//    parecia sujeira de render.
// 2. ZERO VIRA "–". Numa tabela de 8 colunas, uma parede de zeros esconde os números que
//    importam. O traço lê como "nada aqui" sem competir por atenção.
// 3. DISCRIÇÃO POR PESO E COR, NUNCA POR OPACITY. `opacity` compõe o glifo com o fundo e
//    derruba contraste de verdade (medido neste tema: ink-muted com opacity-60 vai de
//    7,40:1 pra 2,84:1). O zero antigo usava `text-ink-faint/50`.
// 4. `indisponivel` é diferente de zero: o dado não chegou, e a tela diz isso.
function NumCell({ val, max, warn = false, indisponivel = false }:
  { val: number; max: number; warn?: boolean; indisponivel?: boolean }) {
  if (indisponivel) {
    return (
      <td className="py-1.5 px-2 text-right">
        <span className="tabular-nums text-ink-faint" title="Não deu pra carregar este número agora">·&nbsp;·&nbsp;·</span>
      </td>
    )
  }
  const vazio = val === 0
  const pct = max > 0 ? (val / max) * 100 : 0
  const leader = val > 0 && val === max
  return (
    <td className="py-1.5 px-2">
      <div className="relative flex items-center justify-end h-5">
        {!vazio && (
          <div
            className={`absolute inset-y-[3px] right-0 rounded-sm ${warn ? 'bg-warning/20' : leader ? 'bg-accent/25' : 'bg-accent/10'}`}
            style={{ width: `${Math.max(pct, 6)}%` }}
          />
        )}
        <span className={`relative tabular-nums px-1 ${
          vazio ? 'text-ink-faint' : warn ? 'text-warning font-semibold' : leader ? 'text-ink font-semibold' : 'text-ink'
        }`}>
          {vazio ? '–' : fmt(val)}
        </span>
      </div>
    </td>
  )
}

// Colunas: ícone + rótulo curto (header) + explicação (legenda e tooltip)
const COLS: Array<{ key: keyof Pick<ResumoDiaVendedor, 'leads' | 'atendimentos' | 'ligacoes' | 'orcamentos' | 'negociacao' | 'quente' | 'carteira'>; icon: string; label: string; explica: string }> = [
  { key: 'leads',        icon: '📥', label: 'Leads',      explica: 'leads novos que chegaram hoje' },
  { key: 'atendimentos', icon: '💬', label: 'Atendidos',  explica: 'conversas trabalhadas hoje' },
  { key: 'ligacoes',     icon: '📲', label: 'Ligações*',  explica: 'PISO — só o que a captura viu (ver aviso abaixo)' },
  { key: 'orcamentos',   icon: '📄', label: 'Orçamentos', explica: 'orçamentos montados hoje' },
  { key: 'negociacao',   icon: '🤝', label: 'Negociando', explica: 'em negociação agora (follow-up + quente)' },
  { key: 'quente',       icon: '🔥', label: 'Quentes',    explica: 'leads quentes agora' },
  { key: 'carteira',     icon: '👥', label: 'Carteira',   explica: 'total de conversas do vendedor (histórico)' },
]

// Monta o texto pro WhatsApp (negrito com *asteriscos*, uma linha por vendedor).
// Sem a contagem de leads — pedido do Daniel (leads ficam só na tela).
//
// ⚠️ 17/08/2026 — LIGAÇÕES SAÍRAM DA MENSAGEM (tinham entrado em 13/08). Medido no banco
// numa segunda-feira às 11:25: o time inteiro tinha *1* ligação feita registrada. Não é que
// ninguém ligou — é que a captura só enxerga chamada que cai em conversa com etiqueta do
// funil, e o sync de mensagens cobre 22-47% da carteira de cada vendedor (PEDRO 24,7%,
// EDILSON JR 22,3%). No painel isso vira um asterisco; numa mensagem que RANQUEIA gente no
// grupo vira "só o Edilson ligou", que é falso e injusto com quem ligou pra cliente de
// ORÇAMENTO ENVIADO ou VENDIDO. Mesmo raciocínio do bloco por pessoa do placar dos times,
// que já sai suprimido.
// Pra devolver quando a captura por evento estiver rodando: reverter este commit (as 3
// linhas de `partes`, `timeParts` e `legenda`).
//
// O que mudou em 13/08, depois de olhar a mensagem colada de verdade no grupo:
// • ~~LIGAÇÕES ENTRARAM~~ (revertido em 17/08, acima).
// • MEDALHA NO TOP 3. A lista vinha achatada, 9 linhas iguais; num grupo de vendas o
//   ranking É a mensagem. As linhas já chegam ordenadas por atendimentos.
// • CADA VENDEDOR SÓ MOSTRA O QUE TEM. Antes toda linha carregava 🤝0 mesmo zerado —
//   três zeros por linha × 9 linhas é ruído que faz ninguém ler até o fim.
// • NÚMERO INDISPONÍVEL NÃO VIRA ZERO. Se o funil não carregou, a mensagem OMITE em vez
//   de anunciar "0 negociando" pro time inteiro, que seria mentira.
function textoWhatsApp(
  rows: ResumoDiaVendedor[],
  tot: Record<string, number>,
  opts: { periodo?: string; funilIndisponivel?: boolean } = {},
): string {
  const data = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const medalha = ['🥇', '🥈', '🥉']
  const semFunil = !!opts.funilIndisponivel

  const linhas = rows.map((r, i) => {
    const partes = [`💬${r.atendimentos}`]
    if (r.orcamentos > 0) partes.push(`📄${r.orcamentos}`)
    if (!semFunil && r.negociacao > 0) partes.push(`🤝${r.negociacao}`)
    if (!semFunil && r.quente > 0) partes.push(`🔥${r.quente}`)
    const marca = i < 3 ? `${medalha[i]} ` : '• '
    return `${marca}*${r.nome}* — ${partes.join('  ')}`
  })

  const timeParts = [`💬 ${fmt(tot.atendimentos)} atendidos`]
  timeParts.push(`📄 ${fmt(tot.orcamentos)} orçamentos`)
  if (!semFunil) timeParts.push(`🤝 ${fmt(tot.negociacao)} negociando`)

  const legenda = ['💬 atendidos', '📄 orçamentos']
  if (!semFunil) legenda.push('🤝 negociando', '🔥 quentes')

  return [
    `☀️ *RESUMO — ${opts.periodo || data}*`,
    '',
    `*TIME:* ${timeParts.join(' · ')}`,
    '',
    ...linhas,
    '',
    `_${legenda.join(' · ')}_`,
  ].join('\n')
}

export function ResumoDiaVendedores({ preset = '', periodoLabel }: { preset?: DashboardPreset; periodoLabel?: string }) {
  const liveHoje = preset === '' || preset === 'hoje'
  const { linhas, isLoading, isError, funilIndisponivel } = useResumoDia(preset)
  const [copiado, setCopiado] = useState(false)

  // Ordena por atendimentos do dia (quem mais trabalhou hoje no topo).
  const rows = useMemo(
    () => [...linhas].sort((a, b) => b.atendimentos - a.atendimentos || b.leads - a.leads),
    [linhas],
  )

  const tot = useMemo(() => rows.reduce((a, r) => ({
    leads: a.leads + r.leads,
    atendimentos: a.atendimentos + r.atendimentos,
    ligacoes: a.ligacoes + r.ligacoes,
    orcamentos: a.orcamentos + r.orcamentos,
    negociacao: a.negociacao + r.negociacao,
    quente: a.quente + r.quente,
    carteira: a.carteira + r.carteira,
  }), { leads: 0, atendimentos: 0, ligacoes: 0, orcamentos: 0, negociacao: 0, quente: 0, carteira: 0 }), [rows])

  // Maior valor por coluna — base das barras proporcionais em cada célula.
  const maxByCol = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of COLS) m[c.key] = Math.max(1, ...rows.map(r => Number(r[c.key]) || 0))
    return m
  }, [rows])

  const copiar = () => {
    const periodo = !liveHoje && periodoLabel ? periodoLabel : undefined
    navigator.clipboard?.writeText(textoWhatsApp(rows, tot, { periodo, funilIndisponivel })).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    })
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink tracking-tight flex items-center gap-1.5">
            <span>☀️</span> Resumo por vendedor{!liveHoje && periodoLabel ? ` · ${periodoLabel}` : ''}
          </h3>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {liveHoje
              ? 'Números de hoje, ao vivo — mesma fonte das mesas do escritório. Atualiza sozinho.'
              : 'Leads · orçamentos · atendidos seguem o período. Negociando/quentes/carteira = estado agora.'}
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
                      <NumCell val={r.leads} max={maxByCol.leads} />
                      <NumCell val={r.atendimentos} max={maxByCol.atendimentos} />
                      <NumCell val={r.ligacoes} max={maxByCol.ligacoes} />
                      <NumCell val={r.orcamentos} max={maxByCol.orcamentos} />
                      <NumCell val={r.negociacao} max={maxByCol.negociacao} indisponivel={funilIndisponivel} />
                      <NumCell val={r.quente} max={maxByCol.quente} warn indisponivel={funilIndisponivel} />
                      <NumCell val={r.carteira} max={maxByCol.carteira} indisponivel={funilIndisponivel} />
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2 pr-2 text-ink text-[11px] uppercase tracking-wide">Total do time</td>
                  <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.leads)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.atendimentos)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.ligacoes)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-ink">{fmt(tot.orcamentos)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-ink">{funilIndisponivel ? '· · ·' : fmt(tot.negociacao)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-warning">{funilIndisponivel ? '· · ·' : fmt(tot.quente)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-ink-muted">{funilIndisponivel ? '· · ·' : fmt(tot.carteira)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Aviso honesto: o número não existe, não é zero. */}
          {funilIndisponivel && (
            <p className="mt-3 text-[11px] text-warning flex items-center gap-1.5">
              <span>⚠️</span>
              <span>
                <b className="font-medium">Negociando, Quentes e Carteira não carregaram</b> — por isso aparecem como
                <span className="tabular-nums"> · · · </span>e não como zero. Os outros números estão certos.
              </span>
            </p>
          )}

          {/* Legenda — o que cada número significa.
              Era uma linha corrida com whitespace-nowrap: em tela cheia o último item saía
              pela direita e ficava ilegível (visto no print de 13/08). Grid quebra sozinho. */}
          <div className="mt-3 pt-3 border-t border-border/60 grid gap-x-4 gap-y-1 text-[11px] leading-relaxed text-ink-faint
                          [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
            {COLS.map(c => (
              <span key={c.key}>
                {c.icon} <b className="text-ink-muted font-medium">{c.label}</b> = {c.explica}
              </span>
            ))}
          </div>

          {/* Aviso da coluna de ligações. Fica FORA da legenda (que é grid de linha curta)
              porque não é explicação — é ressalva: o número é baixo demais pra cobrar e
              alguém ia cobrar em cima dele. Medido em 17/08/2026, segunda 11:25: o time
              inteiro tinha 1 ligação feita no banco. Sai quando a captura por evento
              estiver rodando na frota. */}
          <p className="mt-2 text-[11px] leading-relaxed text-warning">
            📲 <b>Ligações é PISO — não cobre ninguém por ela ainda.</b> Só entra chamada que
            cai em conversa com etiqueta do funil, e a sincronização enxerga de 22% a 47% da
            carteira de cada vendedor. Quem ligou pra cliente de <i>Orçamento enviado</i>,{' '}
            <i>Vendido</i> ou sem etiqueta aparece zerado aqui.
          </p>
        </>
      )}
    </div>
  )
}
