import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp, CircleDashed, Minus, PhoneOff, ThumbsDown, ThumbsUp, Info } from 'lucide-react'
import {
  AMOSTRA_MIN_MKT, MOTIVOS_MKT, SELO_TEXTO, rotuloCriativo, seloProposta, taxa,
  type FonteMkt, type RelatorioMkt, type SeloMkt,
} from '@/lib/marketing-relatorio'
import { Card, CardHeader } from '../ui/Card'
import { brl, n, pct } from '../ui/format'

/**
 * Aba Marketing enxuta (20/10/2026). Quatro cartões, cada um responde UMA pergunta.
 * O mesmo relatório sai em PDF (RelatorioMarketingImpressao, mais abaixo) pro gestor de tráfego.
 */

const SELO_UI: Record<SeloMkt, { Icon: typeof ArrowUp; cls: string }> = {
  acima:    { Icon: ArrowUp,      cls: 'text-success border-success/40 bg-success-bg' },
  abaixo:   { Icon: ArrowDown,    cls: 'text-danger border-danger/40 bg-danger-bg' },
  media:    { Icon: Minus,        cls: 'text-ink-muted border-border bg-surface-2' },
  pouco:    { Icon: CircleDashed, cls: 'text-ink-faint border-border bg-surface-2' },
  sem_fone: { Icon: PhoneOff,     cls: 'text-ink-faint border-border bg-surface-2' },
}

const dec1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Criativo com menos leads que isto não entra na tabela (só no total). */
const CRIATIVO_MIN_TABELA = 10

/** "Bem acima da média" = 25% acima e com volume (menos de 20 leads, 1 lead já dá 8%). */
const ehAlto = (v: number | null, media: number | null, leads: number) =>
  leads >= AMOSTRA_MIN_MKT && v != null && media != null && media > 0 && v >= media * 1.25

/** Percentual "ruim" com sinal ▲, não só cor. */
function Alto({ v, media, leads }: { v: number | null; media: number | null; leads: number }) {
  const alto = ehAlto(v, media, leads)
  return (
    <span className={alto ? 'font-semibold text-danger' : ''} title={alto ? 'Bem acima da média da conta' : undefined}>
      {pct(v, 0)}{alto && <span aria-label=" (acima da média)"> ▲</span>}
    </span>
  )
}

const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
const td = 'border-t border-border px-2 py-2 text-body tabular-nums text-ink-muted'

export function RelatorioMarketingTela({ rel, label, velho }: { rel: RelatorioMkt; label: string; velho: boolean }) {
  const { total, canais, criativos, vendasTotal, vendasOrigem, vendasCriativo, destaques } = rel
  const media = total?.propPor100 ?? null
  const semRespMedia = total ? taxa(total.nunca + total.sumiu, total.leads) : null
  const nadaMedia = total ? taxa(total.nadaAVer, total.leads) : null
  const criativosTabela = criativos.filter(c => c.leads >= CRIATIVO_MIN_TABELA)
  const criativosFora = criativos.length - criativosTabela.length

  return (
    <div className={`space-y-5 ${velho ? 'opacity-60' : ''}`} aria-busy={velho}>
      {/* Em resumo */}
      {destaques.length > 0 && (
        <Card id="marketing-resumo">
          <CardHeader title="Em resumo" subtitle={`O que os números dizem em ${label}.`} />
          <ul className="space-y-2">
            {destaques.map(d => (
              <li key={d.chave} className="flex items-start gap-2 text-body text-ink">
                {d.tom === 'bom' ? <ThumbsUp className="mt-1 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  : d.tom === 'ruim' ? <ThumbsDown className="mt-1 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                    : <Info className="mt-1 h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />}
                <span>{d.texto}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 1 · Canais */}
      <Card id="marketing-canais">
        <CardHeader
          title="1. Quais canais trazem os melhores contatos"
          subtitle="Leads que chegaram no período, e quantos viraram proposta. O selo compara com a média da conta já descontando a margem de erro."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>Canal</th>
                <th scope="col" className={`${th} text-right`}>Leads</th>
                <th scope="col" className={`${th} text-right`} title="A IA qualificou OU o vendedor marcou avanço (lead quente, follow-up, agendamento, orçamento, vendido)">Qualificados</th>
                <th scope="col" className={`${th} text-right`}>Propostas a cada 100 leads</th>
                <th scope="col" className={`${th} text-right`} title="Soma da última proposta de cada lead">R$ em propostas</th>
              </tr>
            </thead>
            <tbody>
              {canais.map(c => {
                const s = seloProposta(c, media)
                const ui = SELO_UI[s]
                return (
                  <tr key={c.chave}>
                    <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{c.chave}</th>
                    <td className={`${td} text-right`}>{n(c.leads)}</td>
                    <td className={`${td} text-right`}>{pct(taxa(c.qualificados, c.leads), 0)}</td>
                    <td className={`${td} text-right`}>
                      <span className="mr-2 font-semibold text-ink">{s === 'sem_fone' ? '—' : dec1(c.propPor100)}</span>
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-micro ${ui.cls}`}>
                        <ui.Icon className="h-3 w-3" aria-hidden="true" />{SELO_TEXTO[s]}
                      </span>
                    </td>
                    <td className={`${td} text-right`}>{c.rsProposto > 0 ? brl(c.rsProposto) : '—'}</td>
                  </tr>
                )
              })}
              {total && (
                <tr className="font-semibold">
                  <th scope="row" className="border-t-2 border-border px-2 py-2 text-left text-body text-ink">Total</th>
                  <td className={`${td} border-t-2 text-right text-ink`}>{n(total.leads)}</td>
                  <td className={`${td} border-t-2 text-right text-ink`}>{pct(taxa(total.qualificados, total.leads), 0)}</td>
                  <td className={`${td} border-t-2 text-right text-ink`}>{dec1(total.propPor100)} <span className="text-micro font-normal text-ink-faint">({n(total.comProposta)} propostas)</span></td>
                  <td className={`${td} border-t-2 text-right text-ink`}>{brl(total.rsProposto)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-micro text-ink-faint">
          “WhatsApp direto” = escreveu direto no WhatsApp da casa, sem anúncio. “Não identificado” = chegou sem origem.
          “Pouco volume” = menos de {AMOSTRA_MIN_MKT} leads: a taxa ainda não diz nada.
        </p>
      </Card>

      {/* 2 · Vendas */}
      <Card id="marketing-vendas">
        <CardHeader
          title="2. O que virou venda"
          subtitle="Pedidos fechados no período, pela origem que o vendedor marcou no pedido (garantia fica fora)."
        />
        {!vendasTotal || vendasTotal.vendas === 0 ? (
          <p className="text-body text-ink-faint">Nenhuma venda fechada no período.</p>
        ) : (
          <>
            <p className="mb-3 text-body text-ink">
              <strong>{n(vendasTotal.vendas)} vendas</strong> · <strong>{brl(vendasTotal.valor)}</strong>
            </p>
            <ul className="space-y-2">
              {vendasOrigem.map(v => {
                const share = taxa(v.valor, vendasTotal.valor) ?? 0
                return (
                  <li key={v.chave} className="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3">
                    <span className="truncate text-body text-ink">{v.chave}</span>
                    <div className="h-2.5 rounded-full bg-surface-2" aria-hidden="true">
                      <div className="h-2.5 rounded-full bg-accent" style={{ width: `${Math.max(share, 1)}%` }} />
                    </div>
                    <span className="whitespace-nowrap text-right text-body tabular-nums text-ink-muted">
                      {n(v.vendas)} {v.vendas === 1 ? 'venda' : 'vendas'} · <strong className="text-ink">{brl(v.valor)}</strong> · {pct(share, 0)}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-4 text-micro text-ink-muted">
              <strong className="text-ink">Vendas ligadas a um criativo:</strong>{' '}
              {vendasCriativo.length === 0
                ? 'nenhuma no período.'
                : `${vendasCriativo.map(v => `${rotuloCriativo(v.chave, v.nome)} (${v.vendas} · ${brl(v.valor)})`).join('; ')}.`}
              {' '}Só dá para ligar quando o cliente chegou pelo anúncio com código &amp;NN — a maior parte das vendas não tem esse rastro.
            </p>
          </>
        )}
      </Card>

      {/* 3 · Criativos */}
      <Card id="marketing-criativos">
        <CardHeader
          title="3. Quais criativos trazem lead bom"
          subtitle="Leads de anúncio do Meta pelo código &NN. ▲ = bem acima da média da conta (ruim), só em criativo com 20+ leads."
        />
        {criativosTabela.length === 0 ? (
          <p className="text-body text-ink-faint">Nenhum criativo com {CRIATIVO_MIN_TABELA} leads ou mais no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={`${th} text-left`}>Criativo</th>
                  <th scope="col" className={`${th} text-right`}>Leads</th>
                  <th scope="col" className={`${th} text-right`}>Qualificados</th>
                  <th scope="col" className={`${th} text-right`} title="Leads que viraram proposta, e o R$">Propostas</th>
                  <th scope="col" className={`${th} text-right`} title="Bovinocultor com 200 cabeças ou mais (informou à IA)">Boi 200+</th>
                  <th scope="col" className={`${th} text-right`} title="Etiqueta NUNCA RESPONDEU ou NÃO RESPONDEU MAIS">Não responde</th>
                  <th scope="col" className={`${th} text-right`} title="Não fabricamos, outros assuntos, transportadora, suporte técnico">Assunto nada a ver</th>
                </tr>
              </thead>
              <tbody>
                {criativosTabela.map(c => (
                  <tr key={c.chave}>
                    <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{rotuloCriativo(c.chave, c.nome)}</th>
                    <td className={`${td} text-right`}>{n(c.leads)}</td>
                    <td className={`${td} text-right`}>{pct(taxa(c.qualificados, c.leads), 0)}</td>
                    <td className={`${td} text-right`}>
                      {n(c.comProposta)}
                      {c.rsProposto > 0 && <span className="text-micro text-ink-faint"> · {brl(c.rsProposto)}</span>}
                    </td>
                    <td className={`${td} text-right`}>{c.boi200 > 0 ? n(c.boi200) : '—'}</td>
                    <td className={`${td} text-right`}><Alto v={taxa(c.nunca + c.sumiu, c.leads)} media={semRespMedia} leads={c.leads} /></td>
                    <td className={`${td} text-right`}><Alto v={taxa(c.nadaAVer, c.leads)} media={nadaMedia} leads={c.leads} /></td>
                  </tr>
                ))}
                {total && (
                  <tr className="font-semibold">
                    <th scope="row" className="border-t-2 border-border px-2 py-2 text-left text-body text-ink">Média da conta (todos os canais)</th>
                    <td className={`${td} border-t-2 text-right text-ink`}>{n(total.leads)}</td>
                    <td className={`${td} border-t-2 text-right text-ink`}>{pct(taxa(total.qualificados, total.leads), 0)}</td>
                    <td className={`${td} border-t-2 text-right text-ink`}>{n(total.comProposta)}</td>
                    <td className={`${td} border-t-2 text-right text-ink`}>{n(total.boi200)}</td>
                    <td className={`${td} border-t-2 text-right text-ink`}>{pct(semRespMedia, 0)}</td>
                    <td className={`${td} border-t-2 text-right text-ink`}>{pct(nadaMedia, 0)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {criativosFora > 0 && (
          <p className="mt-3 text-micro text-ink-faint">Mais {n(criativosFora)} criativos com menos de {CRIATIVO_MIN_TABELA} leads ficaram de fora.</p>
        )}
      </Card>

      {/* 4 · Motivos */}
      {total && total.fechados > 0 && (
        <Card id="marketing-motivos">
          <CardHeader
            title="4. Por que os atendimentos fecham"
            subtitle={`${n(total.fechados)} dos ${n(total.leads)} leads do período já foram encerrados pelo vendedor. Um motivo por lead.`}
          />
          <BarraMotivos f={total} />
          <ListaMotivos f={total} />
          <MotivosPorCanal canais={canais} />
        </Card>
      )}
    </div>
  )
}

function BarraMotivos({ f }: { f: FonteMkt }) {
  return (
    <div className="mb-3 flex h-4 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
      {MOTIVOS_MKT.map(m => {
        const v = f[m.campo] as number
        return v > 0 ? <div key={m.rotulo} style={{ width: `${(100 * v) / f.fechados}%`, background: m.cor }} title={`${m.rotulo}: ${v}`} /> : null
      })}
    </div>
  )
}

function ListaMotivos({ f }: { f: FonteMkt }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
      {MOTIVOS_MKT.map(m => {
        const v = f[m.campo] as number
        return (
          <li key={m.rotulo} className="flex items-center gap-2 text-body text-ink-muted">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: m.cor }} aria-hidden="true" />
            <span className="flex-1">{m.rotulo}</span>
            <span className="tabular-nums"><strong className="text-ink">{n(v)}</strong> · {pct(taxa(v, f.fechados), 0)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function MotivosPorCanal({ canais }: { canais: FonteMkt[] }) {
  const linhas = canais.filter(c => c.leads >= AMOSTRA_MIN_MKT && c.fechados > 0)
  if (linhas.length === 0) return null
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[620px] border-separate border-spacing-0">
        <caption className="mb-2 text-left text-micro font-semibold text-ink-muted">Por canal — % dos leads do canal</caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} text-left`}>Canal</th>
            <th scope="col" className={`${th} text-right`}>Encerrados</th>
            <th scope="col" className={`${th} text-right`}>Não responde</th>
            <th scope="col" className={`${th} text-right`}>Preço</th>
            <th scope="col" className={`${th} text-right`}>Nada a ver</th>
            <th scope="col" className={`${th} text-right`}>Concorrente</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(c => (
            <tr key={c.chave}>
              <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{c.chave}</th>
              <td className={`${td} text-right`}>{pct(taxa(c.fechados, c.leads), 0)}</td>
              <td className={`${td} text-right`}>{pct(taxa(c.nunca + c.sumiu, c.leads), 0)}</td>
              <td className={`${td} text-right`}>{pct(taxa(c.preco, c.leads), 0)}</td>
              <td className={`${td} text-right`}>{pct(taxa(c.nadaAVer, c.leads), 0)}</td>
              <td className={`${td} text-right`}>{pct(taxa(c.concorrente, c.leads), 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PDF — folha A4 clara, cores fixas (independe do tema escuro), sem nome nem telefone de cliente.
// ---------------------------------------------------------------------------

const P = {
  ink: '#111827', muted: '#4b5563', faint: '#6b7280', line: '#e5e7eb', bg2: '#f3f4f6',
  bom: '#047857', ruim: '#b91c1c', accent: '#2563eb',
}
const tdP: CSSProperties = { borderTop: `1px solid ${P.line}`, padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: P.muted }
const thP: CSSProperties = { padding: '4px 6px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: P.muted, whiteSpace: 'nowrap' }
const rowH: CSSProperties = { borderTop: `1px solid ${P.line}`, padding: '4px 6px', textAlign: 'left', fontWeight: 500, color: P.ink }
const h2: CSSProperties = { fontSize: 14, fontWeight: 700, color: P.ink, margin: '18px 0 2px' }
const sub: CSSProperties = { fontSize: 10.5, color: P.faint, margin: '0 0 8px' }
const tabela: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 11 }

export function RelatorioMarketingImpressao({ rel, label, geradoEm }: { rel: RelatorioMkt; label: string; geradoEm: string }) {
  const { total, canais, criativos, vendasTotal, vendasOrigem, vendasCriativo, destaques } = rel
  const media = total?.propPor100 ?? null
  const semRespMedia = total ? taxa(total.nunca + total.sumiu, total.leads) : null
  const nadaMedia = total ? taxa(total.nadaAVer, total.leads) : null
  const criativosTabela = criativos.filter(c => c.leads >= CRIATIVO_MIN_TABELA)

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: P.ink, background: '#fff', fontSize: 11.5, lineHeight: 1.4 }}>
      <div style={{ borderBottom: `2px solid ${P.ink}`, paddingBottom: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: P.faint, letterSpacing: 1, textTransform: 'uppercase' }}>Branorte · Relatório de marketing</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{label.charAt(0).toUpperCase() + label.slice(1)}</div>
        <div style={{ fontSize: 10, color: P.faint }}>Gerado em {geradoEm} pelo CRM Branorte</div>
      </div>

      {total && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[
            ['Leads', n(total.leads)],
            ['Qualificados', `${n(total.qualificados)} (${pct(taxa(total.qualificados, total.leads), 0)})`],
            ['Propostas', `${n(total.comProposta)} · ${brl(total.rsProposto)}`],
            ['Vendas fechadas', vendasTotal ? `${n(vendasTotal.vendas)} · ${brl(vendasTotal.valor)}` : '—'],
          ].map(([k, v]) => (
            <div key={k} style={{ flex: 1, background: P.bg2, borderRadius: 6, padding: '6px 8px' }}>
              <div style={{ fontSize: 9.5, color: P.faint }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {destaques.length > 0 && (
        <>
          <div style={h2}>Em resumo</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {destaques.map(d => (
              <li key={d.chave} style={{ marginBottom: 3, color: d.tom === 'bom' ? P.bom : d.tom === 'ruim' ? P.ruim : P.ink }}>
                <span style={{ color: P.ink }}>{d.texto}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div style={{ breakInside: 'avoid' }}>
        <div style={h2}>1. Quais canais trazem os melhores contatos</div>
        <p style={sub}>Leads que chegaram no período e quantos viraram proposta. O selo compara com a média da conta descontando a margem de erro (95%).</p>
        <table style={tabela}>
          <thead><tr>
            <th style={{ ...thP, textAlign: 'left' }}>Canal</th><th style={thP}>Leads</th><th style={thP}>Qualificados</th>
            <th style={thP}>Propostas / 100 leads</th><th style={thP}>Sinal</th><th style={thP}>R$ em propostas</th>
          </tr></thead>
          <tbody>
            {canais.map(c => {
              const s = seloProposta(c, media)
              return (
                <tr key={c.chave}>
                  <td style={rowH}>{c.chave}</td>
                  <td style={tdP}>{n(c.leads)}</td>
                  <td style={tdP}>{pct(taxa(c.qualificados, c.leads), 0)}</td>
                  <td style={{ ...tdP, fontWeight: 600, color: P.ink }}>{s === 'sem_fone' ? '—' : dec1(c.propPor100)}</td>
                  <td style={{ ...tdP, color: s === 'acima' ? P.bom : s === 'abaixo' ? P.ruim : P.faint }}>{s === 'acima' ? '▲ ' : s === 'abaixo' ? '▼ ' : ''}{SELO_TEXTO[s]}</td>
                  <td style={tdP}>{c.rsProposto > 0 ? brl(c.rsProposto) : '—'}</td>
                </tr>
              )
            })}
            {total && (
              <tr style={{ fontWeight: 700 }}>
                <td style={{ ...rowH, borderTop: `2px solid ${P.ink}`, fontWeight: 700 }}>Total</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{n(total.leads)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{pct(taxa(total.qualificados, total.leads), 0)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{dec1(total.propPor100)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}` }} />
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{brl(total.rsProposto)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ breakInside: 'avoid' }}>
        <div style={h2}>2. O que virou venda</div>
        <p style={sub}>Pedidos fechados no período, pela origem que o vendedor marcou no pedido (garantia fica fora).</p>
        {!vendasTotal || vendasTotal.vendas === 0 ? <p>Nenhuma venda fechada no período.</p> : (
          <>
            <table style={tabela}>
              <thead><tr>
                <th style={{ ...thP, textAlign: 'left' }}>Origem</th><th style={thP}>Vendas</th><th style={thP}>Valor</th><th style={{ ...thP, width: '35%' }}>% do valor</th>
              </tr></thead>
              <tbody>
                {vendasOrigem.map(v => {
                  const share = taxa(v.valor, vendasTotal.valor) ?? 0
                  return (
                    <tr key={v.chave}>
                      <td style={rowH}>{v.chave}</td>
                      <td style={tdP}>{n(v.vendas)}</td>
                      <td style={{ ...tdP, color: P.ink, fontWeight: 600 }}>{brl(v.valor)}</td>
                      <td style={tdP}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <div style={{ flex: 1, height: 8, background: P.bg2, borderRadius: 4 }}>
                            <div style={{ width: `${Math.max(share, 1)}%`, height: 8, background: P.accent, borderRadius: 4 }} />
                          </div>
                          <span style={{ width: 32 }}>{pct(share, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td style={{ ...rowH, borderTop: `2px solid ${P.ink}`, fontWeight: 700 }}>Total</td>
                  <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink, fontWeight: 700 }}>{n(vendasTotal.vendas)}</td>
                  <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink, fontWeight: 700 }}>{brl(vendasTotal.valor)}</td>
                  <td style={{ ...tdP, borderTop: `2px solid ${P.ink}` }} />
                </tr>
              </tbody>
            </table>
            <p style={{ ...sub, marginTop: 6 }}>
              <strong style={{ color: P.ink }}>Vendas ligadas a um criativo:</strong>{' '}
              {vendasCriativo.length === 0 ? 'nenhuma no período.' : `${vendasCriativo.map(v => `${rotuloCriativo(v.chave, v.nome)} (${v.vendas} · ${brl(v.valor)})`).join('; ')}.`}
              {' '}Só dá para ligar quando o cliente chegou pelo anúncio com código &amp;NN.
            </p>
          </>
        )}
      </div>

      <div>
        <div style={h2}>3. Quais criativos trazem lead bom</div>
        <p style={sub}>Leads de anúncio do Meta pelo código &amp;NN (criativos com {CRIATIVO_MIN_TABELA}+ leads). ▲ = bem acima da média da conta (só com 20+ leads).</p>
        <table style={tabela}>
          <thead><tr>
            <th style={{ ...thP, textAlign: 'left' }}>Criativo</th><th style={thP}>Leads</th><th style={thP}>Qualificados</th><th style={thP}>Propostas</th>
            <th style={thP}>Boi 200+</th><th style={thP}>Não responde</th><th style={thP}>Assunto nada a ver</th>
          </tr></thead>
          <tbody>
            {criativosTabela.map(c => {
              const sr = taxa(c.nunca + c.sumiu, c.leads), nd = taxa(c.nadaAVer, c.leads)
              const alto = (v: number | null, m: number | null) => ehAlto(v, m, c.leads)
              return (
                <tr key={c.chave} style={{ breakInside: 'avoid' }}>
                  <td style={rowH}>{rotuloCriativo(c.chave, c.nome)}</td>
                  <td style={tdP}>{n(c.leads)}</td>
                  <td style={tdP}>{pct(taxa(c.qualificados, c.leads), 0)}</td>
                  <td style={tdP}>{n(c.comProposta)}{c.rsProposto > 0 ? ` · ${brl(c.rsProposto)}` : ''}</td>
                  <td style={tdP}>{c.boi200 > 0 ? n(c.boi200) : '—'}</td>
                  <td style={{ ...tdP, color: alto(sr, semRespMedia) ? P.ruim : P.muted, fontWeight: alto(sr, semRespMedia) ? 700 : 400 }}>{pct(sr, 0)}{alto(sr, semRespMedia) ? ' ▲' : ''}</td>
                  <td style={{ ...tdP, color: alto(nd, nadaMedia) ? P.ruim : P.muted, fontWeight: alto(nd, nadaMedia) ? 700 : 400 }}>{pct(nd, 0)}{alto(nd, nadaMedia) ? ' ▲' : ''}</td>
                </tr>
              )
            })}
            {total && (
              <tr>
                <td style={{ ...rowH, borderTop: `2px solid ${P.ink}`, fontWeight: 700 }}>Média da conta</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{n(total.leads)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{pct(taxa(total.qualificados, total.leads), 0)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{n(total.comProposta)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{n(total.boi200)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{pct(semRespMedia, 0)}</td>
                <td style={{ ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink }}>{pct(nadaMedia, 0)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total && total.fechados > 0 && (
        <div style={{ breakInside: 'avoid' }}>
          <div style={h2}>4. Por que os atendimentos fecham</div>
          <p style={sub}>{n(total.fechados)} dos {n(total.leads)} leads do período já foram encerrados pelo vendedor (um motivo por lead).</p>
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: P.bg2, marginBottom: 6 }}>
            {MOTIVOS_MKT.map(m => {
              const v = total[m.campo] as number
              return v > 0 ? <div key={m.rotulo} style={{ width: `${(100 * v) / total.fechados}%`, background: m.cor }} /> : null
            })}
          </div>
          <table style={tabela}>
            <tbody>
              {MOTIVOS_MKT.map(m => {
                const v = total[m.campo] as number
                return (
                  <tr key={m.rotulo}>
                    <td style={rowH}><span style={{ display: 'inline-block', width: 9, height: 9, background: m.cor, borderRadius: 2, marginRight: 6 }} />{m.rotulo}</td>
                    <td style={tdP}>{n(v)}</td>
                    <td style={tdP}>{pct(taxa(v, total.fechados), 0)} dos encerrados</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 18, borderTop: `1px solid ${P.line}`, paddingTop: 6, fontSize: 9.5, color: P.faint, breakInside: 'avoid' }}>
        <strong style={{ color: P.muted }}>Como ler.</strong> Leads, propostas e motivos olham quem CHEGOU no período (proposta = orçamento montado a partir da chegada).
        Vendas olham os pedidos FECHADOS no período — a venda de hoje costuma vir de lead de semanas atrás.
        Proposta e venda só se ligam ao lead pelo telefone; Messenger e Instagram Direct quase não deixam telefone.
        Qualificado = a IA qualificou ou o vendedor marcou avanço; desde 01/10/2026 a IA não grava o equipamento de quem pede “só um equipamento”, então essa taxa está subcontada.
        O custo da mídia não está no CRM: custo por proposta sai do Gerenciador de Anúncios cruzando o código &amp;NN.
      </div>
    </div>
  )
}
