import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CircleDashed, Minus, PhoneOff } from 'lucide-react'
import type { DashboardPreset } from '@/hooks/useDashboard'
import { useDashboardCanais, type CanalQualidade, type JanelaCanais } from '@/hooks/useDashboardCanais'
import { Card, CardHeader, Inner } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { brl, n, pct } from '../ui/format'

/**
 * "Qual canal traz os melhores leads?" (19/10/2026)
 *
 * A régua é PROPOSTAS A CADA 100 LEADS, com a margem de erro (IC 95% de Wilson):
 *  - é o único sinal que vai até dinheiro e tem volume para comparar canal com canal
 *    (venda rastreada até o lead é pouca — 0 nos últimos 30 dias — e o custo da mídia
 *    não está no banco);
 *  - os sinais da IA enganam: "respondeu" é o toque no 1º botão, e "qualificou" ficou
 *    cego para lead de equipamento desde 01/10/2026.
 * Um canal só é dito melhor/pior que a média quando a margem de erro dele NÃO cruza a
 * média da conta. Canal com pouca amostra ou quase sem telefone ganha selo, não posição.
 */

type Sinal = 'acima' | 'abaixo' | 'media' | 'amostra' | 'sem_fone'

function sinalDe(c: CanalQualidade, media: number | null): Sinal {
  if (c.selo?.startsWith('canal sem telefone')) return 'sem_fone'
  if (c.selo) return 'amostra'
  if (media == null || c.prop_ic95_min == null || c.prop_ic95_max == null) return 'media'
  if (c.prop_ic95_min > media) return 'acima'
  if (c.prop_ic95_max < media) return 'abaixo'
  return 'media'
}

const SINAL_META: Record<Sinal, { label: string; Icon: typeof ArrowUp; cls: string; ajuda: string }> = {
  acima:    { label: 'Acima da média', Icon: ArrowUp,      cls: 'text-success border-success/40 bg-success-bg', ajuda: 'Gera mais proposta que a média da conta, mesmo no pior caso da margem de erro.' },
  abaixo:   { label: 'Abaixo da média', Icon: ArrowDown,   cls: 'text-danger border-danger/40 bg-danger-bg',    ajuda: 'Gera menos proposta que a média da conta, mesmo no melhor caso da margem de erro.' },
  media:    { label: 'Na média',        Icon: Minus,       cls: 'text-ink-muted border-border bg-surface-2',    ajuda: 'A margem de erro cruza a média da conta: não dá para dizer que é melhor nem pior.' },
  amostra:  { label: 'Amostra pequena', Icon: CircleDashed, cls: 'text-ink-faint border-border bg-surface-2',  ajuda: 'Menos de 100 leads com telefone ou menos de 5 propostas: a taxa ainda não significa nada.' },
  sem_fone: { label: 'Sem telefone',    Icon: PhoneOff,    cls: 'text-ink-faint border-border bg-surface-2',    ajuda: 'Menos da metade dos leads deixa telefone (Messenger, Instagram Direct): proposta e venda não conseguem ser ligadas ao canal.' },
}

const ORDEM_SINAL: Record<Sinal, number> = { acima: 0, media: 1, abaixo: 2, amostra: 3, sem_fone: 4 }

const dec = (v: number | null | undefined, casas = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

export function QualidadePorCanal({ preset, periodoLabel }: { preset: DashboardPreset; periodoLabel: string }) {
  const [janela, setJanela] = useState<JanelaCanais>('90d')
  const q = useDashboardCanais(janela, preset)
  const linhas = q.data?.linhas
  const total = linhas?.find(l => l.canal === 'TOTAL')
  const media = total?.prop_por_100 ?? null

  const canais = useMemo(() => {
    const rows = (linhas ?? []).filter(l => l.canal !== 'TOTAL').map(l => ({ ...l, sinal: sinalDe(l, media) }))
    return rows.sort((a, b) =>
      (ORDEM_SINAL[a.sinal] - ORDEM_SINAL[b.sinal])
      || ((b.prop_por_100 ?? -1) - (a.prop_por_100 ?? -1))
      || (b.leads - a.leads))
  }, [linhas, media])

  const escala = Math.max(1, ...canais.filter(c => c.sinal !== 'sem_fone').map(c => c.prop_ic95_max ?? 0), media ?? 0)
  const usou90 = q.data?.usou90 ?? janela === '90d'
  const rotuloJanela = usou90 ? 'últimos 90 dias' : periodoLabel
  const velho = q.isPlaceholderData

  const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
  const td = 'px-2 py-2 text-body tabular-nums text-ink-muted'

  return (
    <Card id="marketing-canais">
      <CardHeader
        title="Qual canal traz os melhores leads"
        subtitle="Propostas a cada 100 leads que chegaram por cada canal, com a margem de erro. É a prova mais firme que o CRM tem hoje: liga o canal a dinheiro e tem volume para comparar."
        janela={<JanelaBadge tipo={usou90 ? 'fixo' : 'periodo'} label={rotuloJanela} />}
        right={
          <div className="flex gap-1" role="group" aria-label="Janela da comparação">
            {([['90d', '90 dias'], ['periodo', 'Período do topo']] as const).map(([k, rot]) => (
              <button
                key={k}
                type="button"
                onClick={() => setJanela(k)}
                aria-pressed={janela === k}
                className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1 text-micro md:min-h-0 ${janela === k ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
              >
                {rot}
              </button>
            ))}
          </div>
        }
      />

      {janela === 'periodo' && usou90 && (
        <p className="mb-3 text-micro text-ink-faint">No filtro “Tudo” a comparação usa os últimos 90 dias — uma coorte da base inteira mistura canais que nem existiam.</p>
      )}

      {q.error && !linhas ? (
        <p className="rounded-lg bg-surface-2 p-4 text-body text-ink-muted">Não deu para carregar a comparação por canal agora. Use Atualizar dados.</p>
      ) : !linhas ? (
        <div className="h-[260px] animate-pulse rounded-lg bg-surface-2" aria-label="Carregando comparação por canal" />
      ) : (
        <div className={velho ? 'opacity-60' : ''} aria-busy={velho}>
          {total && media != null && (
            <p className="mb-3 text-label text-ink-muted">
              Média da conta: <strong className="text-ink">{dec(media)} propostas a cada 100 leads</strong> ({n(total.com_proposta)} de {n(total.leads_rastreaveis)} leads com telefone, {brl(total.rs_proposto_por_lead ?? 0)} proposto por lead).
              {velho && <span className="ml-2 text-ink-faint">Atualizando…</span>}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={`${th} text-left`}>Canal</th>
                  <th scope="col" className={`${th} text-right`} title="Leads que chegaram na janela (com telefone brasileiro, que dá para ligar a proposta)">Leads</th>
                  <th scope="col" className={`${th} text-left`} title="Propostas a cada 100 leads com telefone. O traço é a margem de erro (IC 95%); a linha vertical é a média da conta.">Propostas a cada 100</th>
                  <th scope="col" className={`${th} text-right`} title="R$ da última proposta de cada lead, dividido pelos leads com telefone do canal">R$ proposto / lead</th>
                  <th scope="col" className={`${th} text-right`} title="Proposta típica (mediana) — a soma é puxada por proposta gigante">Proposta típica</th>
                  <th scope="col" className={`${th} text-right`} title="Leads que compraram a partir de uma dessas propostas, e o R$. Venda demora: não decida canal por esta coluna.">Compraram</th>
                  <th scope="col" className={`${th} text-right`} title="Régua do card Qualificados: IA qualificou OU etiqueta de avanço (lead quente, follow-up, agendamento, orçamento, vendido)">Qualificaram</th>
                  <th scope="col" className={`${th} text-right`} title="Mediana de dias entre a chegada e a 1ª proposta">Dias até proposta</th>
                  <th scope="col" className={`${th} text-right`} title="Pediu o que não fabricamos, outros assuntos, transportadora ou suporte (etiqueta)">Lixo</th>
                  <th scope="col" className={`${th} text-right`} title="Bovinos com 200 cabeças ou mais (o porte que mais vira proposta). Só bovino tem corte único medido.">Boi 200+ cab.</th>
                  <th scope="col" className={`${th} text-right`}>Sinal</th>
                </tr>
              </thead>
              <tbody>
                {canais.map(c => {
                  const m = SINAL_META[c.sinal]
                  const comparavel = c.sinal !== 'sem_fone'
                  const ini = ((c.prop_ic95_min ?? 0) / escala) * 100
                  const fim = ((c.prop_ic95_max ?? 0) / escala) * 100
                  const ponto = ((c.prop_por_100 ?? 0) / escala) * 100
                  const linhaMedia = ((media ?? 0) / escala) * 100
                  return (
                    <tr key={c.canal} className="align-middle">
                      <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{c.canal}</th>
                      <td className={`${td} border-t border-border text-right`}>
                        {n(c.leads)}
                        {c.leads_rastreaveis < c.leads && <span className="block text-micro text-ink-faint">{n(c.leads_rastreaveis)} c/ tel.</span>}
                      </td>
                      <td className="border-t border-border px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-12 shrink-0 text-right text-body font-semibold tabular-nums text-ink">{comparavel ? dec(c.prop_por_100) : '—'}</span>
                          {comparavel && (
                            <div className="relative h-3 w-40 shrink-0 rounded-full bg-surface-2" aria-hidden="true">
                              <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink-faint/60" style={{ left: `${ini}%`, width: `${Math.max(fim - ini, 0.5)}%` }} />
                              <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${ponto}%` }} />
                              {media != null && <div className="absolute top-0 h-3 w-0.5 bg-ink/50" style={{ left: `${linhaMedia}%` }} />}
                            </div>
                          )}
                          {comparavel && <span className="whitespace-nowrap text-micro tabular-nums text-ink-faint">{dec(c.prop_ic95_min)}–{dec(c.prop_ic95_max)}</span>}
                        </div>
                        <span className="sr-only">{`${dec(c.prop_por_100)} propostas a cada 100 leads, margem de ${dec(c.prop_ic95_min)} a ${dec(c.prop_ic95_max)}; ${n(c.com_proposta)} propostas.`}</span>
                        <span className="block text-micro text-ink-faint">{n(c.com_proposta)} {c.com_proposta === 1 ? 'proposta' : 'propostas'}</span>
                      </td>
                      <td className={`${td} border-t border-border text-right`}>{comparavel ? brl(c.rs_proposto_por_lead ?? 0) : '—'}</td>
                      <td className={`${td} border-t border-border text-right`}>{c.mediana_proposta != null ? brl(c.mediana_proposta) : '—'}</td>
                      <td className={`${td} border-t border-border text-right`}>
                        {n(c.compraram)}
                        {c.compraram > 0 && <span className="block text-micro text-ink-faint">{brl(c.rs_vendido)}</span>}
                      </td>
                      <td className={`${td} border-t border-border text-right`}>{c.leads > 0 ? pct((c.qualificados / c.leads) * 100, 0) : '—'}</td>
                      <td className={`${td} border-t border-border text-right`}>{c.dias_ate_proposta != null ? dec(c.dias_ate_proposta) : '—'}</td>
                      <td className={`${td} border-t border-border text-right`}>{c.leads > 0 ? pct((c.lixo / c.leads) * 100, 0) : '—'}</td>
                      <td className={`${td} border-t border-border text-right`}>{n(c.bovino_200_mais)}</td>
                      <td className="border-t border-border px-2 py-2 text-right">
                        <span title={m.ajuda} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-micro ${m.cls}`}>
                          <m.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {m.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {total && (
                  <tr className="font-semibold">
                    <th scope="row" className="border-t-2 border-border px-2 py-2 text-left text-body text-ink">Total</th>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{n(total.leads)}</td>
                    <td className="border-t-2 border-border px-2 py-2 text-body tabular-nums text-ink">{dec(total.prop_por_100)} <span className="text-micro font-normal text-ink-faint">({n(total.com_proposta)} propostas)</span></td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{brl(total.rs_proposto_por_lead ?? 0)}</td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{total.mediana_proposta != null ? brl(total.mediana_proposta) : '—'}</td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{n(total.compraram)}{total.compraram > 0 && <span className="block text-micro font-normal text-ink-faint">{brl(total.rs_vendido)}</span>}</td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{total.leads > 0 ? pct((total.qualificados / total.leads) * 100, 0) : '—'}</td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{dec(total.dias_ate_proposta)}</td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{total.leads > 0 ? pct((total.lixo / total.leads) * 100, 0) : '—'}</td>
                    <td className={`${td} border-t-2 border-border text-right text-ink`}>{n(total.bovino_200_mais)}</td>
                    <td className="border-t-2 border-border" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Inner tone="atencao" className="mt-4 flex items-start gap-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <ul className="space-y-1 text-micro text-ink-muted">
              {total && (
                <li>
                  <strong className="text-ink">Proposta e venda só se ligam ao lead pelo telefone brasileiro:</strong> {n(total.leads_rastreaveis)} de {n(total.leads)} leads.
                  Messenger e Instagram Direct quase não deixam telefone — por isso ficam com o selo “Sem telefone”, não com nota baixa.
                </li>
              )}
              <li>
                <strong className="text-ink">Não decida canal por venda.</strong> Venda demora a sair e só uma parte se rastreia até o lead
                {total ? ` (${n(total.compraram)} compra${total.compraram === 1 ? '' : 's'} nesta janela)` : ''}. A proposta é o sinal com volume.
              </li>
              <li>
                <strong className="text-ink">Desde 01/10/2026 a IA não grava o equipamento</strong> de quem pede “só um equipamento”: a coluna Qualificaram subconta esses leads. A proposta não depende disso.
              </li>
              <li>
                <strong className="text-ink">O custo da mídia não está no banco.</strong> Custo por proposta (o número que decide verba) só puxando o Gerenciador de Anúncios, e só para o Meta.
              </li>
              <li>
                <strong className="text-ink">“WhatsApp direto”</strong> = lead sem origem que tem conversa no WhatsApp da casa (escreveu direto, sem anúncio). <strong className="text-ink">“Não identificado”</strong> = sem origem e sem conversa.
              </li>
            </ul>
          </Inner>
        </div>
      )}
    </Card>
  )
}
