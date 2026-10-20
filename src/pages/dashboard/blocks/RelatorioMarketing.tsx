import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, CircleDashed, Hourglass, Info, Minus, Megaphone, PhoneOff, Scissors, ThumbsDown, ThumbsUp,
  TrendingUp, Users,
} from 'lucide-react'
import {
  AMOSTRA_MIN_MKT, DECISAO_TEXTO, JULGAVEL_CONTATOS, JULGAVEL_GASTO, MOTIVOS_MKT, SELO_AJUDA, SELO_TEXTO,
  minTxt, nomeVendedor, poucaEtiqueta, rotuloCriativo, semEspelho, situacaoCampanha, sumiuDoTime, seloProposta, sumiuDe, taxa,
  type AnuncioMkt, type DecisaoMkt, type FonteMkt, type RelatorioMkt, type SeloMkt,
} from '@/lib/marketing-relatorio'
import { Card, CardHeader } from '../ui/Card'
import { brl, n, pct } from '../ui/format'

/**
 * Aba Marketing (20/10/2026, v2). Cada cartão responde UMA pergunta de quem decide verba:
 *   o que fazer agora → quais canais → onde pôr a verba (anúncios com custo) → o que vendeu →
 *   por que fecha → vendedores.
 * O mesmo relatório sai em PDF (RelatorioMarketingImpressao, no fim do arquivo).
 */

const SELO_UI: Record<SeloMkt, { Icon: typeof ArrowUp; cls: string }> = {
  acima:    { Icon: ArrowUp,      cls: 'text-success border-success/40 bg-success-bg' },
  abaixo:   { Icon: ArrowDown,    cls: 'text-danger border-danger/40 bg-danger-bg' },
  media:    { Icon: Minus,        cls: 'text-ink-muted border-border bg-surface-2' },
  pouco:    { Icon: CircleDashed, cls: 'text-ink-faint border-border bg-surface-2' },
  sem_fone: { Icon: PhoneOff,     cls: 'text-ink-faint border-border bg-surface-2' },
}

const DECISAO_UI: Record<DecisaoMkt, { Icon: typeof ArrowUp; cls: string }> = {
  subir:   { Icon: TrendingUp, cls: 'text-success border-success/40 bg-success-bg' },
  testar:  { Icon: TrendingUp, cls: 'text-success border-success/30 bg-surface-2' },
  manter:  { Icon: Minus,      cls: 'text-ink-muted border-border bg-surface-2' },
  esperar: { Icon: Hourglass,  cls: 'text-ink-faint border-border bg-surface-2' },
  cortar:  { Icon: Scissors,   cls: 'text-danger border-danger/40 bg-danger-bg' },
  fora:    { Icon: Info,       cls: 'text-ink-faint border-border bg-surface-2' },
}

const dec1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * "Pior que a média": 25% acima da média, pelo menos 3 pontos acima (3% contra 2% é ruído) e com
 * volume (com 12 contatos, 1 contato já dá 8%).
 */
const pior = (v: number | null, media: number | null, base: number) =>
  base >= AMOSTRA_MIN_MKT && v != null && media != null && media > 0 && v >= media * 1.25 && v - media >= 3

function Pct({ v, media, base }: { v: number | null; media: number | null; base: number }) {
  const ruim = pior(v, media, base)
  return (
    <span className={ruim ? 'font-semibold text-danger' : ''} title={ruim ? 'Pior que a média' : undefined}>
      {pct(v, 0)}{ruim && <span> · pior</span>}
    </span>
  )
}

function Selo({ s }: { s: SeloMkt }) {
  const ui = SELO_UI[s]
  return (
    <span title={SELO_AJUDA[s]} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-micro ${ui.cls}`}>
      <ui.Icon className="h-3 w-3" aria-hidden="true" />{SELO_TEXTO[s]}
    </span>
  )
}

function Decisao({ d, porque }: { d: DecisaoMkt; porque: string }) {
  const ui = DECISAO_UI[d]
  return (
    <span title={porque} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-micro font-semibold ${ui.cls}`}>
      <ui.Icon className="h-3 w-3" aria-hidden="true" />{DECISAO_TEXTO[d]}
    </span>
  )
}

const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
const td = 'whitespace-nowrap border-t border-border px-2 py-2 text-body tabular-nums text-ink-muted'
const tdTot = 'border-t-2 border-border px-2 py-2 text-body tabular-nums text-ink font-semibold'

function Kpi({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-micro text-ink-faint">{rotulo}</p>
      <p className="text-title font-semibold tabular-nums text-ink">{valor}</p>
      {apoio && <p className="text-micro text-ink-muted">{apoio}</p>}
    </div>
  )
}

export function RelatorioMarketingTela({ rel, label, velho, faltou = [] }: { rel: RelatorioMkt; label: string; velho: boolean; faltou?: string[] }) {
  const { total, canais, regua, anuncios, vendasTotal, vendasGrupo, vendasOrigem, vendasCriativo, vendedores, destaques } = rel
  const media = total?.propPor100 ?? null
  const temGasto = rel.gastoTotal != null

  return (
    <div className={`space-y-5 ${velho ? 'opacity-60' : ''}`} aria-busy={velho}>
      {faltou.length > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-micro text-ink-muted">Sem {faltou.join(' e ')} agora: o relatório saiu sem essa parte.</p>
      )}

      {/* Números do período — duas caixas, de propósito: não é funil */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-ink-faint">Contatos que chegaram no período</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Kpi rotulo="Contatos" valor={n(total?.leads)} />
            <Kpi rotulo="Viraram orçamento" valor={n(total?.comProposta)} apoio={total ? `${dec1(media)} a cada 100 · ${brl(total.rsProposto)}` : undefined} />
            <Kpi
              rotulo="Verba do Meta"
              valor={temGasto ? brl(rel.gastoTotal) : '—'}
              apoio={temGasto ? (regua.custoOrcamento != null ? `${brl(regua.custoOrcamento)} por orçamento = ${brl(regua.gastoComCodigo)} ÷ ${n(regua.orcComCodigo)} orçamentos dos anúncios com &NN` : 'sem orçamento de anúncio com código') : 'gasto não carregado'}
            />
          </div>
        </Card>
        <Card>
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-ink-faint">Pedidos fechados no período · de contatos de qualquer época</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Kpi rotulo="Pedidos" valor={n(vendasTotal?.vendas)} apoio={vendasTotal ? brl(vendasTotal.valor) : undefined} />
            {vendasGrupo.filter(g => g.chave.startsWith('Internet') || g.chave.startsWith('Carteira')).map(g => (
              <Kpi key={g.chave} rotulo={g.chave.startsWith('Internet') ? 'Vindos da internet' : 'Carteira e relacionamento'}
                valor={`${n(g.vendas)} · ${pct(taxa(g.valor, vendasTotal?.valor ?? 0), 0)}`} apoio={brl(g.valor)} />
            ))}
          </div>
        </Card>
      </div>

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

      <Card id="marketing-acoes">
        <CardHeader title="O que fazer agora" subtitle="Tarefas tiradas dos números abaixo, separadas por quem resolve." />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ListaTarefas titulo="Gestor de tráfego" Icon={Megaphone} itens={rel.tarefasTrafego} vazio="Nada a mudar nos anúncios com os números deste período." />
          <ListaTarefas titulo="Time de vendas" Icon={Users} itens={rel.tarefasVendas} vazio="Nada fora do normal no atendimento deste período." />
        </div>
      </Card>

      {/* 1 · Canais */}
      <Card id="marketing-canais">
        <CardHeader
          title="1. Quais canais trazem os melhores contatos"
          subtitle="Quantos contatos de cada canal viraram orçamento. A comparação desconta a margem de erro."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>Canal</th>
                <th scope="col" className={`${th} text-right`}>Contatos</th>
                <th scope="col" className={`${th} text-right`}>Orçamentos a cada 100 contatos</th>
                <th scope="col" className={`${th} text-right`} title="Soma do último orçamento de cada contato">R$ em orçamentos</th>
                <th scope="col" className={`${th} text-right`} title="Verba da plataforma no período ÷ orçamentos do canal. Site usa a verba do Google (o site também recebe visita orgânica).">Custo por orçamento</th>
              </tr>
            </thead>
            <tbody>
              {canais.map(c => {
                const s = seloProposta(c, media)
                return (
                  <tr key={c.chave}>
                    <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{c.chave}</th>
                    <td className={`${td} text-right`}>{n(c.leads)}</td>
                    <td className={`${td} text-right`}>
                      <span className={`mr-2 font-semibold ${s === 'sem_fone' ? 'text-ink-faint' : 'text-ink'}`}>{dec1(c.propPor100)}</span>
                      <Selo s={s} />
                    </td>
                    <td className={`${td} text-right`}>{c.rsProposto > 0 ? brl(c.rsProposto) : '—'}</td>
                    <td className={`${td} text-right`}>{rel.custoCanal[c.chave] != null ? brl(rel.custoCanal[c.chave]) : '—'}</td>
                  </tr>
                )
              })}
              {total && (
                <tr>
                  <th scope="row" className={`${tdTot} text-left`}>Média da conta</th>
                  <td className={`${tdTot} text-right`}>{n(total.leads)}</td>
                  <td className={`${tdTot} text-right`}>{dec1(total.propPor100)} <span className="text-micro font-normal text-ink-faint">({n(total.comProposta)} orçamentos)</span></td>
                  <td className={`${tdTot} text-right`}>{brl(total.rsProposto)}</td>
                  <td className={`${tdTot} text-right`} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-micro text-ink-faint">
          “Site (Google e orgânico)” = chegou pelo botão do site (“vim pelo site da Branorte”); o custo usa a verba do Google Ads.
          “WhatsApp direto” = escreveu direto no WhatsApp da casa, sem anúncio. “Não identificado” = chegou sem origem.
          “Sem telefone” = Messenger e Instagram Direct quase não deixam telefone, então o orçamento não se liga ao canal.
          R$ em orçamentos é o valor orçado, não vendido.
        </p>
      </Card>

      {/* 2 · Verba por plataforma */}
      <VerbaPlataformas rel={rel} />

      {/* 3 · Anúncios do Meta */}
      <Card id="marketing-anuncios">
        <CardHeader
          title="3. Anúncios do Meta: onde pôr a verba"
          subtitle={temGasto
            ? `Cada anúncio pelo código &NN, com o gasto do período e a decisão. Média do Meta: ${dec1(regua.mediaPor100)} orçamentos a cada 100 contatos${regua.custoOrcamento != null ? `, ${brl(regua.custoOrcamento)} por orçamento` : ''}.`
            : `Cada anúncio pelo código &NN. Sem o gasto carregado não há custo nem decisão por dinheiro. Média do Meta: ${dec1(regua.mediaPor100)} orçamentos a cada 100 contatos.`}
        />
        {anuncios.length === 0 ? <p className="text-body text-ink-faint">Nenhum anúncio com 10 contatos ou R$ 100 gastos no período.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={`${th} text-left`}>Anúncio</th>
                  <th scope="col" className={`${th} text-left`}>Decisão</th>
                  <th scope="col" className={`${th} text-right`}>Gasto</th>
                  <th scope="col" className={`${th} text-right`}>Contatos</th>
                  <th scope="col" className={`${th} text-right`}>Custo por contato</th>
                  <th scope="col" className={`${th} text-right`}>Orçamentos</th>
                  <th scope="col" className={`${th} text-right`}>Custo por orçamento</th>
                  <th scope="col" className={`${th} text-right`} title="Pecuarista com 200 cabeças de gado ou mais (informou à IA)">Gado 200+ cab.</th>
                  <th scope="col" className={`${th} text-right`} title="Nunca respondeu ou parou de responder">Sumiu</th>
                  <th scope="col" className={`${th} text-right`} title="Pediu o que a Branorte não fabrica">Não fabricamos</th>
                </tr>
              </thead>
              <tbody>
                {anuncios.map(a => <LinhaAnuncio key={a.codigo} a={a} metaSumiu={regua.sumiuPct} metaNf={regua.naoFabPct} custoMedio={regua.custoOrcamento} />)}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-micro text-ink-faint">
          Passe o mouse na decisão para ver o motivo. Só julga anúncio com {JULGAVEL_CONTATOS} contatos ou R$ {JULGAVEL_GASTO.toLocaleString('pt-BR')} gastos no período (antes disso, “Esperar volume”).
          “Subir verba” = 3+ orçamentos e taxa acima da média do Meta (descontada a margem de erro) ou custo por orçamento 25% abaixo da média, sem sumir mais que a média. “Testar com mais verba” = o mesmo sinal, mas ainda sem volume.
          “Cortar ou refazer” = taxa abaixo da média, R$ {JULGAVEL_GASTO.toLocaleString('pt-BR')}+ sem nenhum orçamento, ou custo por orçamento acima do dobro da média.
          {temGasto && rel.gastoCarregadoAte && ` Gasto do Gerenciador carregado até ${rel.gastoCarregadoAte.split('-').reverse().join('/')}.`}
          {temGasto && rel.gastoSemCodigo > 0 && ` ${brl(rel.gastoSemCodigo)} foram em ${rel.anunciosSemCodigo} anúncios sem código &NN e não aparecem aqui.`}
        </p>
      </Card>

      {/* 3 · Vendas */}
      <Card id="marketing-vendas">
        <CardHeader
          title="4. Pedidos fechados e de onde veio o cliente"
          subtitle="Pedidos fechados no período, pela origem que o vendedor marca no pedido. O contato pode ter chegado meses antes — por isso não se compara com os contatos acima."
        />
        {!vendasTotal || vendasTotal.vendas === 0 ? <p className="text-body text-ink-faint">Nenhum pedido fechado no período.</p> : (
          <>
            {vendasGrupo.map(g => (
              <div key={g.chave} className="mb-4">
                <p className="mb-1 flex flex-wrap justify-between gap-2 text-body font-semibold text-ink">
                  <span>{g.chave}{g.chave.startsWith('Carteira') && <span className="ml-2 text-micro font-normal text-ink-faint">não é mídia paga</span>}{g.chave.startsWith('Internet') && <span className="ml-2 text-micro font-normal text-ink-faint">mistura anúncio e orgânico — não divida pela verba</span>}</span>
                  <span className="tabular-nums">{n(g.vendas)} · {brl(g.valor)} · {pct(taxa(g.valor, vendasTotal.valor), 0)}</span>
                </p>
                <ul className="space-y-1">
                  {vendasOrigem.filter(o => o.nome === g.chave).map(v => {
                    const share = taxa(v.valor, vendasTotal.valor) ?? 0
                    return (
                      <li key={v.chave} className="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3">
                        <span className="truncate pl-3 text-body text-ink-muted">{v.chave}</span>
                        <div className="h-2 rounded-full bg-surface-2" aria-hidden="true"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(share, 1)}%` }} /></div>
                        <span className="whitespace-nowrap text-right text-body tabular-nums text-ink-muted">{n(v.vendas)} · {brl(v.valor)}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            <p className="text-micro text-ink-muted">
              <strong className="text-ink">Pedidos com o anúncio de origem rastreado: {n(vendasCriativo.reduce((s, v) => s + v.vendas, 0))} de {n(vendasTotal.vendas)}.</strong>{' '}
              {vendasCriativo.length > 0 && `${vendasCriativo.map(v => `${rotuloCriativo(v.chave, v.nome)} (${v.vendas} · ${brl(v.valor)})`).join('; ')}. `}
              Só dá para ligar quando o cliente chegou por anúncio com código &amp;NN — por isso a verba se decide por orçamento, não por venda.
            </p>
          </>
        )}
      </Card>

      {/* 4 · Motivos */}
      {total && total.fechados > 0 && (
        <Card id="marketing-motivos">
          <CardHeader
            title="5. Por que os atendimentos fecham"
            subtitle={`${n(total.fechados)} dos ${n(total.leads)} contatos do período já foram encerrados pelo vendedor (um motivo por contato). Percentuais sobre todos os contatos, inclusive os que ficaram só com a Ana.${rel.emAndamento ? ' Período ainda aberto: os motivos vão crescer até os atendimentos fecharem.' : ''}`}
          />
          <BarraMotivos f={total} />
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {MOTIVOS_MKT.map(m => {
              const v = total[m.campo] as number
              return (
                <li key={m.rotulo} className="flex items-center gap-2 text-body text-ink-muted">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: m.cor }} aria-hidden="true" />
                  <span className="flex-1">{m.rotulo}</span>
                  <span className="tabular-nums"><strong className="text-ink">{n(v)}</strong> · {pct(taxa(v, total.leads), 0)}</span>
                </li>
              )
            })}
          </ul>
          <MotivosPorCanal canais={canais} total={total} />
        </Card>
      )}

      {/* 5 · Vendedores */}
      {vendedores.length > 0 && (
        <Card id="marketing-vendedores">
          <CardHeader
            title="6. O contato chega bem atendido?"
            subtitle="Contatos repassados no período a cada vendedor. Resposta = tempo entre o cliente escrever e o vendedor responder (a 1ª mensagem do repasse sai automática e não conta)."
          />
          <TabelaVendedores rel={rel} />
        </Card>
      )}
    </div>
  )
}

function ListaTarefas({ titulo, Icon, itens, vazio }: { titulo: string; Icon: typeof Users; itens: string[]; vazio: string }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-body font-semibold text-ink"><Icon className="h-4 w-4 text-ink-faint" aria-hidden="true" />{titulo}</p>
      {itens.length === 0 ? <p className="text-body text-ink-faint">{vazio}</p> : (
        <ol className="list-decimal space-y-1 pl-5 text-body text-ink-muted">
          {itens.map(t => <li key={t}>{t}</li>)}
        </ol>
      )}
    </div>
  )
}

function LinhaAnuncio({ a, metaSumiu, metaNf, custoMedio }: { a: AnuncioMkt; metaSumiu: number | null; metaNf: number | null; custoMedio: number | null }) {
  const f = a.fonte
  const caro = a.custoOrcamento != null && custoMedio != null && a.custoOrcamento >= 1.25 * custoMedio && a.contatos >= AMOSTRA_MIN_MKT
  return (
    <tr>
      <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{rotuloCriativo(a.codigo, a.nome)}</th>
      <td className="border-t border-border px-2 py-2"><Decisao d={a.decisao} porque={a.porque} /><span className="sr-only">{a.porque}</span></td>
      <td className={`${td} text-right`}>{a.gasto > 0 ? brl(a.gasto) : '—'}</td>
      <td className={`${td} text-right`}>{n(a.contatos)}</td>
      <td className={`${td} text-right`}>{a.custoContato != null ? brl(a.custoContato) : '—'}</td>
      <td className={`${td} text-right`}>{n(a.orcamentos)}{a.contatos > 0 && <span className="text-micro text-ink-faint"> · {dec1(a.porCem)}/100</span>}</td>
      <td className={`${td} text-right`}>
        <span className={caro ? 'font-semibold text-danger' : ''}>{a.custoOrcamento != null ? brl(a.custoOrcamento) : '—'}{caro && <span> · caro</span>}</span>
      </td>
      <td className={`${td} text-right`}>{f && f.boi200 > 0 ? n(f.boi200) : '—'}</td>
      <td className={`${td} text-right`}>{f ? <Pct v={taxa(sumiuDe(f), f.leads)} media={metaSumiu} base={f.leads} /> : '—'}</td>
      <td className={`${td} text-right`}>{f ? <Pct v={taxa(f.naoFabricamos, f.leads)} media={metaNf} base={f.leads} /> : '—'}</td>
    </tr>
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

function MotivosPorCanal({ canais, total }: { canais: FonteMkt[]; total: FonteMkt }) {
  const linhas = canais.filter(c => c.leads >= AMOSTRA_MIN_MKT && c.fechados > 0)
  if (linhas.length === 0) return null
  const col = (f: FonteMkt) => [taxa(f.fechados, f.leads), taxa(sumiuDe(f), f.leads), taxa(f.preco, f.leads), taxa(f.naoFabricamos, f.leads), taxa(f.foraEscopo, f.leads)]
  const med = col(total)
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0">
        <caption className="mb-2 text-left text-micro font-semibold text-ink-muted">Por canal — % dos contatos do canal</caption>
        <thead>
          <tr>
            {['Canal', 'Encerrados', 'Sumiu', 'Só preço', 'Não fabricamos', 'Outro assunto'].map((h, i) => (
              <th key={h} scope="col" className={`${th} ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map(c => (
            <tr key={c.chave}>
              <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{c.chave}</th>
              {col(c).map((v, i) => <td key={i} className={`${td} text-right`}>{i === 0 ? pct(v, 0) : <Pct v={v} media={med[i]} base={c.leads} />}</td>)}
            </tr>
          ))}
          <tr>
            <th scope="row" className={`${tdTot} text-left`}>Média da conta</th>
            {med.map((v, i) => <td key={i} className={`${tdTot} text-right`}>{pct(v, 0)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function TabelaVendedores({ rel }: { rel: RelatorioMkt }) {
  const v = rel.vendedores
  const tot = v.reduce((s, x) => ({ c: s.c + x.contatos, e: s.e + x.clienteEscreveu, s24: s.s24 + x.semResposta24h }), { c: 0, e: 0, s24: 0 })
  const time = sumiuDoTime(v, rel.emAndamento)
  const sumiuMed = taxa(time.s, time.c), s24Med = taxa(tot.s24, tot.e)
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0">
          <thead>
            <tr>
              {['Vendedor', 'Contatos recebidos', 'Orçamentos a cada 100', 'Sumiu', 'Resposta (mediana)', 'Respondeu em até 1 h', 'Sem resposta em 24 h'].map((h, i) => (
                <th key={h} scope="col" className={`${th} ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.map(x => {
              const cego = semEspelho(x)
              return (
                <tr key={x.vendedor}>
                  <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">{nomeVendedor(x.vendedor)}</th>
                  <td className={`${td} text-right`}>{n(x.contatos)}</td>
                  <td className={`${td} text-right`}>{dec1(taxa(x.comOrcamento, x.rastreaveis))}</td>
                  <td className={`${td} text-right`}>
                    <Pct v={taxa(x.sumiu, x.contatos)} media={sumiuMed} base={x.contatos} />
                    {!rel.emAndamento && poucaEtiqueta(x) && <span className="block text-micro text-ink-faint">quase não etiqueta</span>}
                  </td>
                  {cego ? (
                    <td colSpan={3} className={`${td} text-right text-ink-faint`}>WhatsApp não chega ao CRM — sem medida</td>
                  ) : (
                    <>
                      <td className={`${td} text-right`}><span className={(x.medianaRespostaMin ?? 0) > 120 ? 'font-semibold text-danger' : ''}>{minTxt(x.medianaRespostaMin)}</span></td>
                      <td className={`${td} text-right`}>{pct(taxa(x.ate1h, x.clienteEscreveu), 0)}</td>
                      <td className={`${td} text-right`}><Pct v={taxa(x.semResposta24h, x.clienteEscreveu)} media={s24Med} base={x.clienteEscreveu} /></td>
                    </>
                  )}
                </tr>
              )
            })}
            <tr>
              <th scope="row" className={`${tdTot} text-left`}>Média do time</th>
              <td className={`${tdTot} text-right`}>{n(tot.c)}</td>
              <td className={`${tdTot} text-right`} />
              <td className={`${tdTot} text-right`}>{pct(sumiuMed, 0)}</td>
              <td className={`${tdTot} text-right`} colSpan={2} />
              <td className={`${tdTot} text-right`}>{pct(s24Med, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-micro text-ink-faint">
        {rel.emAndamento ? 'Período ainda aberto: parte dos contatos ainda não foi encerrada, então o “sumiu” vai subir. ' : 'Média do “sumiu” só com quem etiqueta. '}Sumiu = etiqueta NUNCA RESPONDEU ou NÃO RESPONDEU MAIS em qualquer WhatsApp da casa, sobre os contatos repassados ao vendedor — por isso é maior que o “sumiu” da conta inteira, que inclui quem ficou só com a Ana. Orçamentos vêm do sistema de orçamentos, não do WhatsApp.
        “Sem resposta em 24 h” conta só quem escreveu há mais de 24 h ({n(tot.e)} de {n(tot.c)} contatos).
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// PDF — folha A4 clara, cores fixas (independe do tema escuro), sem nome nem telefone de cliente.
// ---------------------------------------------------------------------------

const P = { ink: '#111827', muted: '#4b5563', faint: '#6b7280', line: '#e5e7eb', bg2: '#f3f4f6', bom: '#047857', ruim: '#b91c1c', accent: '#2563eb' }
const tdP: CSSProperties = { borderTop: `1px solid ${P.line}`, padding: '3px 5px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: P.muted, whiteSpace: 'nowrap' }
const thP: CSSProperties = { padding: '3px 5px', textAlign: 'right', fontSize: 9.5, fontWeight: 600, color: P.muted }
const rowH: CSSProperties = { borderTop: `1px solid ${P.line}`, padding: '3px 5px', textAlign: 'left', fontWeight: 500, color: P.ink }
const totP: CSSProperties = { ...tdP, borderTop: `2px solid ${P.ink}`, color: P.ink, fontWeight: 700 }
const h2: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: P.ink, margin: '16px 0 2px' }
const sub: CSSProperties = { fontSize: 10, color: P.faint, margin: '0 0 6px' }
const tabela: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }
const corDecisao: Record<DecisaoMkt, string> = { subir: P.bom, testar: P.bom, cortar: P.ruim, manter: P.muted, esperar: P.faint, fora: P.faint }

function PctP({ v, media, base }: { v: number | null; media: number | null; base: number }) {
  const ruim = pior(v, media, base)
  return <span style={{ color: ruim ? P.ruim : undefined, fontWeight: ruim ? 700 : 400 }}>{pct(v, 0)}{ruim ? ' · pior' : ''}</span>
}

function Secao({ titulo, subtitulo, children, inteira = true }: { titulo: string; subtitulo?: string; children: ReactNode; inteira?: boolean }) {
  return (
    <div style={inteira ? { breakInside: 'avoid' } : undefined}>
      <div style={h2}>{titulo}</div>
      {subtitulo && <p style={sub}>{subtitulo}</p>}
      {children}
    </div>
  )
}

export function RelatorioMarketingImpressao({ rel, label, geradoEm }: { rel: RelatorioMkt; label: string; geradoEm: string }) {
  const { total, canais, regua, anuncios, vendasTotal, vendasGrupo, vendasOrigem, vendasCriativo, destaques } = rel
  const media = total?.propPor100 ?? null
  const temGasto = rel.gastoTotal != null
  const caixa = (titulo: string, itens: [string, string][]) => (
    <div style={{ flex: 1, border: `1px solid ${P.line}`, borderRadius: 6, padding: '6px 8px' }}>
      <div style={{ fontSize: 9, color: P.faint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{titulo}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        {itens.map(([k, v]) => (
          <div key={k} style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: P.faint }}>{k}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
  const net = vendasGrupo.find(g => g.chave.startsWith('Internet')), cart = vendasGrupo.find(g => g.chave.startsWith('Carteira'))

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: P.ink, background: '#fff', fontSize: 11, lineHeight: 1.4 }}>
      <div style={{ borderBottom: `2px solid ${P.ink}`, paddingBottom: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: P.faint, letterSpacing: 1, textTransform: 'uppercase' }}>Branorte · Relatório de marketing</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{label.charAt(0).toUpperCase() + label.slice(1)}</div>
        <div style={{ fontSize: 10, color: P.faint }}>Gerado em {geradoEm} pelo CRM Branorte{temGasto && rel.gastoCarregadoAte ? ` · gasto do Meta até ${rel.gastoCarregadoAte.split('-').reverse().join('/')}` : ''}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        {caixa('Contatos que chegaram no período', [
          ['Contatos', n(total?.leads)],
          ['Viraram orçamento', `${n(total?.comProposta)} (${dec1(media)} a cada 100)`],
          ['Verba do Meta', temGasto ? brl(rel.gastoTotal) : '—'],
          ['Custo por orçamento', regua.custoOrcamento != null ? `${brl(regua.custoOrcamento)} (${brl(regua.gastoComCodigo)} ÷ ${n(regua.orcComCodigo)} dos anúncios com &NN)` : '—'],
        ])}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        {caixa('Pedidos fechados no período · de contatos de qualquer época (não é o funil de cima)', [
          ['Pedidos', vendasTotal ? `${n(vendasTotal.vendas)} · ${brl(vendasTotal.valor)}` : '—'],
          ['Vindos da internet', net ? `${n(net.vendas)} · ${brl(net.valor)}` : '—'],
          ['Carteira e relacionamento', cart ? `${n(cart.vendas)} · ${brl(cart.valor)}` : '—'],
        ])}
      </div>

      {destaques.length > 0 && (
        <Secao titulo="Em resumo">
          <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
            {destaques.map(d => <li key={d.chave} style={{ marginBottom: 2, color: d.tom === 'bom' ? P.bom : d.tom === 'ruim' ? P.ruim : P.ink }}><span style={{ color: P.ink }}>{d.texto}</span></li>)}
          </ul>
        </Secao>
      )}

      <Secao titulo="O que fazer agora">
        <div style={{ display: 'flex', gap: 14 }}>
          {([['Gestor de tráfego', rel.tarefasTrafego], ['Time de vendas', rel.tarefasVendas]] as const).map(([t, itens]) => (
            <div key={t} style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{t}</div>
              {itens.length === 0 ? <div style={{ color: P.faint }}>Nada fora do normal.</div> : (
                <ol style={{ margin: 0, paddingLeft: 16 }}>{itens.map(i => <li key={i} style={{ marginBottom: 2 }}>{i}</li>)}</ol>
              )}
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="1. Quais canais trazem os melhores contatos" subtitulo="Quantos contatos de cada canal viraram orçamento. A comparação desconta a margem de erro (95%).">
        <table style={tabela}>
          <thead><tr><th style={{ ...thP, textAlign: 'left' }}>Canal</th><th style={thP}>Contatos</th><th style={thP}>Orçamentos a cada 100 contatos</th><th style={thP}>Comparação</th><th style={thP}>R$ em orçamentos</th><th style={thP}>Custo por orçamento</th></tr></thead>
          <tbody>
            {canais.map(c => {
              const s = seloProposta(c, media)
              return (
                <tr key={c.chave}>
                  <td style={rowH}>{c.chave}</td><td style={tdP}>{n(c.leads)}</td>
                  <td style={{ ...tdP, fontWeight: 600, color: s === 'sem_fone' ? P.faint : P.ink }}>{dec1(c.propPor100)}</td>
                  <td style={{ ...tdP, color: s === 'acima' ? P.bom : s === 'abaixo' ? P.ruim : P.faint }}>{s === 'acima' ? '▲ ' : s === 'abaixo' ? '▼ ' : ''}{SELO_TEXTO[s]}</td>
                  <td style={tdP}>{c.rsProposto > 0 ? brl(c.rsProposto) : '—'}</td>
                  <td style={tdP}>{rel.custoCanal[c.chave] != null ? brl(rel.custoCanal[c.chave]) : '—'}</td>
                </tr>
              )
            })}
            {total && <tr><td style={{ ...totP, textAlign: 'left' }}>Média da conta</td><td style={totP}>{n(total.leads)}</td><td style={totP}>{dec1(total.propPor100)}</td><td style={totP} /><td style={totP}>{brl(total.rsProposto)}</td><td style={totP} /></tr>}
          </tbody>
        </table>
      </Secao>

      <VerbaPlataformasP rel={rel} />

      <Secao
        inteira={false}
        titulo="3. Anúncios do Meta: onde pôr a verba"
        subtitulo={`Por código &NN. Média do Meta: ${dec1(regua.mediaPor100)} orçamentos a cada 100 contatos${regua.custoOrcamento != null ? `, ${brl(regua.custoOrcamento)} por orçamento` : ''}. Decisão só com ${JULGAVEL_CONTATOS} contatos ou R$ ${JULGAVEL_GASTO.toLocaleString('pt-BR')} gastos no período.`}
      >
        <table style={tabela}>
          <thead><tr>
            <th style={{ ...thP, textAlign: 'left' }}>Anúncio</th><th style={{ ...thP, textAlign: 'left' }}>Decisão</th><th style={thP}>Gasto</th><th style={thP}>Contatos</th>
            <th style={thP}>Custo por contato</th><th style={thP}>Orçamentos</th><th style={thP}>Custo por orçamento</th><th style={thP}>Gado 200+</th><th style={thP}>Sumiu</th><th style={thP}>Não fabricamos</th>
          </tr></thead>
          <tbody>
            {anuncios.map(a => {
              const f = a.fonte
              return (
                <tr key={a.codigo} style={{ breakInside: 'avoid' }}>
                  <td style={rowH}>{rotuloCriativo(a.codigo, a.nome)}</td>
                  <td style={{ ...rowH, color: corDecisao[a.decisao], fontWeight: 700, whiteSpace: 'nowrap' }}>{DECISAO_TEXTO[a.decisao]}</td>
                  <td style={tdP}>{a.gasto > 0 ? brl(a.gasto) : '—'}</td><td style={tdP}>{n(a.contatos)}</td>
                  <td style={tdP}>{a.custoContato != null ? brl(a.custoContato) : '—'}</td>
                  <td style={tdP}>{n(a.orcamentos)}</td>
                  <td style={tdP}>{a.custoOrcamento != null ? brl(a.custoOrcamento) : '—'}</td>
                  <td style={tdP}>{f && f.boi200 > 0 ? n(f.boi200) : '—'}</td>
                  <td style={tdP}>{f ? <PctP v={taxa(sumiuDe(f), f.leads)} media={regua.sumiuPct} base={f.leads} /> : '—'}</td>
                  <td style={tdP}>{f ? <PctP v={taxa(f.naoFabricamos, f.leads)} media={regua.naoFabPct} base={f.leads} /> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p style={{ ...sub, marginTop: 4 }}>
          Subir = 3+ orçamentos e taxa acima da média do Meta ou custo por orçamento 25% abaixo da média; Testar = o mesmo sinal ainda sem volume. Cortar = taxa abaixo da média, R$ {JULGAVEL_GASTO.toLocaleString('pt-BR')}+ sem orçamento, ou custo acima do dobro da média.
          {temGasto && rel.gastoSemCodigo > 0 && ` ${brl(rel.gastoSemCodigo)} foram em ${rel.anunciosSemCodigo} anúncios sem código &NN e não aparecem na tabela.`}
        </p>
      </Secao>

      <Secao titulo="4. Pedidos fechados e de onde veio o cliente" subtitulo="Origem marcada pelo vendedor no pedido. O contato pode ter chegado meses antes.">
        {!vendasTotal || vendasTotal.vendas === 0 ? <p>Nenhum pedido fechado no período.</p> : (
          <>
            <table style={tabela}>
              <thead><tr><th style={{ ...thP, textAlign: 'left' }}>Origem</th><th style={thP}>Pedidos</th><th style={thP}>Valor</th><th style={thP}>% do valor</th></tr></thead>
              <tbody>
                {vendasGrupo.map(g => [
                  <tr key={g.chave}><td style={{ ...rowH, fontWeight: 700 }}>{g.chave}{g.chave.startsWith('Carteira') ? ' (não é mídia paga)' : g.chave.startsWith('Internet') ? ' (anúncio + orgânico: não divida pela verba)' : ''}</td><td style={{ ...tdP, color: P.ink, fontWeight: 700 }}>{n(g.vendas)}</td><td style={{ ...tdP, color: P.ink, fontWeight: 700 }}>{brl(g.valor)}</td><td style={{ ...tdP, color: P.ink, fontWeight: 700 }}>{pct(taxa(g.valor, vendasTotal.valor), 0)}</td></tr>,
                  ...vendasOrigem.filter(o => o.nome === g.chave).map(o => (
                    <tr key={g.chave + o.chave}><td style={{ ...rowH, paddingLeft: 16, fontWeight: 400, color: P.muted }}>{o.chave}</td><td style={tdP}>{n(o.vendas)}</td><td style={tdP}>{brl(o.valor)}</td><td style={tdP}>{pct(taxa(o.valor, vendasTotal.valor), 0)}</td></tr>
                  )),
                ])}
                <tr><td style={{ ...totP, textAlign: 'left' }}>Total</td><td style={totP}>{n(vendasTotal.vendas)}</td><td style={totP}>{brl(vendasTotal.valor)}</td><td style={totP} /></tr>
              </tbody>
            </table>
            <p style={{ ...sub, marginTop: 4 }}>
              <strong style={{ color: P.ink }}>Pedidos com o anúncio de origem rastreado: {n(vendasCriativo.reduce((s, v) => s + v.vendas, 0))} de {n(vendasTotal.vendas)}</strong>
              {vendasCriativo.length > 0 ? ` — ${vendasCriativo.map(v => `${rotuloCriativo(v.chave, v.nome)} (${v.vendas} · ${brl(v.valor)})`).join('; ')}` : ''}. Por isso a verba se decide por orçamento, não por venda.
            </p>
          </>
        )}
      </Secao>

      {total && total.fechados > 0 && (
        <Secao titulo="5. Por que os atendimentos fecham" subtitulo={`${n(total.fechados)} dos ${n(total.leads)} contatos já foram encerrados (um motivo por contato). Percentuais sobre os contatos.`}>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: P.bg2, marginBottom: 5 }}>
            {MOTIVOS_MKT.map(m => { const v = total[m.campo] as number; return v > 0 ? <div key={m.rotulo} style={{ width: `${(100 * v) / total.fechados}%`, background: m.cor }} /> : null })}
          </div>
          <table style={tabela}>
            <thead><tr>
              <th style={{ ...thP, textAlign: 'left' }}>Canal (% dos contatos)</th><th style={thP}>Encerrados</th>
              {MOTIVOS_MKT.slice(0, 5).map(m => <th key={m.rotulo} style={thP}><span style={{ display: 'inline-block', width: 7, height: 7, background: m.cor, marginRight: 3 }} />{m.rotulo.replace(' / fora do orçamento', '').replace(' (suporte, frete, etc.)', '')}</th>)}
            </tr></thead>
            <tbody>
              {[...canais.filter(c => c.leads >= AMOSTRA_MIN_MKT && c.fechados > 0), total].map(c => {
                const ehTot = c === total
                const st = ehTot ? totP : tdP
                return (
                  <tr key={ehTot ? 'TOTAL' : c.chave}>
                    <td style={ehTot ? { ...totP, textAlign: 'left' } : rowH}>{ehTot ? 'Média da conta' : c.chave}</td>
                    <td style={st}>{pct(taxa(c.fechados, c.leads), 0)}</td>
                    {MOTIVOS_MKT.slice(0, 5).map(m => <td key={m.rotulo} style={st}>{ehTot ? pct(taxa(c[m.campo] as number, c.leads), 0) : <PctP v={taxa(c[m.campo] as number, c.leads)} media={taxa(total[m.campo] as number, total.leads)} base={c.leads} />}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Secao>
      )}

      {rel.vendedores.length > 0 && (
        <Secao titulo="6. O contato chega bem atendido?" subtitulo="Contatos repassados no período. Resposta = do cliente escrever até o vendedor responder (a 1ª mensagem do repasse é automática e não conta). O “sumiu” aqui é sobre os contatos repassados — por isso é maior que o da seção 5, que conta todos os contatos, inclusive os que ficaram só com a Ana.">
          <table style={tabela}>
            <thead><tr>{['Vendedor', 'Contatos', 'Orçamentos a cada 100', 'Sumiu', 'Resposta (mediana)', 'Até 1 h', 'Sem resposta em 24 h'].map((h, i) => <th key={h} style={{ ...thP, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
            <tbody>
              {rel.vendedores.map(x => {
                const cego = semEspelho(x)
                return (
                  <tr key={x.vendedor}>
                    <td style={rowH}>{nomeVendedor(x.vendedor)}</td><td style={tdP}>{n(x.contatos)}</td>
                    <td style={tdP}>{dec1(taxa(x.comOrcamento, x.rastreaveis))}</td><td style={tdP}>{pct(taxa(x.sumiu, x.contatos), 0)}{!rel.emAndamento && poucaEtiqueta(x) ? ' (quase não etiqueta)' : ''}</td>
                    {cego ? <td colSpan={3} style={{ ...tdP, color: P.faint }}>WhatsApp não chega ao CRM</td> : (
                      <>
                        <td style={{ ...tdP, color: (x.medianaRespostaMin ?? 0) > 120 ? P.ruim : P.muted, fontWeight: (x.medianaRespostaMin ?? 0) > 120 ? 700 : 400 }}>{minTxt(x.medianaRespostaMin)}</td>
                        <td style={tdP}>{pct(taxa(x.ate1h, x.clienteEscreveu), 0)}</td><td style={tdP}>{pct(taxa(x.semResposta24h, x.clienteEscreveu), 0)}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Secao>
      )}

      <div style={{ marginTop: 14, borderTop: `1px solid ${P.line}`, paddingTop: 5, fontSize: 9, color: P.faint, breakInside: 'avoid' }}>
        <strong style={{ color: P.muted }}>Como ler.</strong> Contatos, orçamentos, motivos, anúncios e vendedores olham quem CHEGOU no período. Pedidos olham o que FECHOU no período, de contatos de qualquer época — não são o funil dos contatos de cima.
        Orçamento = orçamento montado pelo vendedor a partir da chegada do contato; orçamento e pedido só se ligam ao contato pelo telefone.
        Gasto = Gerenciador de Anúncios da conta Branorte, ligado ao CRM pelo código &amp;NN no nome do anúncio. “Pior” = 25% acima da média, só com {AMOSTRA_MIN_MKT}+ contatos.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2 · Onde a verba está indo — Google e Meta (tela e PDF)
// ---------------------------------------------------------------------------

const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

function VerbaPlataformas({ rel }: { rel: RelatorioMkt }) {
  const tot = (p: 'Meta' | 'Google') => rel.plataformas.find(x => x.tipo === 'plataforma' && x.plataforma === p)
  const camp = rel.plataformas.filter(x => x.tipo === 'campanha').sort((a, b) => b.gasto - a.gasto)
  const meta = tot('Meta'), google = tot('Google')
  return (
    <Card id="marketing-plataformas">
      <CardHeader
        title="2. Onde a verba está indo — Google e Meta"
        subtitle="Cada campanha no ar no período, com o gasto e o que a própria plataforma conta como resultado (conversas no Meta, conversões no Google)."
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Kpi rotulo="Meta Ads" valor={meta ? brl(meta.gasto) : '—'}
          apoio={meta?.carregadoAte ? `${meta.orcamentoDia ? `${brl(meta.orcamentoDia)}/dia nas campanhas ativas · ` : ''}${n(meta.resultado)} conversas · dados até ${dataBr(meta.carregadoAte)}` : 'gasto não carregado'} />
        <Kpi rotulo="Google Ads" valor={rel.googleLigado && google ? brl(google.gasto) : 'não ligado'}
          apoio={rel.googleLigado && google ? `${n(google.cliques)} cliques · ${n(google.resultado)} conversões do Google · dados até ${dataBr(google.carregadoAte)}` : 'falta ativar o script na conta do Google Ads'} />
      </div>
      {camp.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0">
            <thead>
              <tr>
                {['Plataforma', 'Campanha', 'Situação', 'Orçamento/dia', 'Gasto', 'Cliques', 'Resultado na plataforma', 'Custo por resultado'].map((h, i) => (
                  <th key={h} scope="col" className={`${th} ${i < 3 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {camp.map(c => (
                <tr key={c.plataforma + c.campanha}>
                  <td className={`${td} text-left`}>{c.plataforma}</td>
                  <th scope="row" className="border-t border-border px-2 py-2 text-left text-body font-medium text-ink">
                    {c.campanha}
                  </th>
                  <td className={`${td} text-left ${situacaoCampanha(c.status) === 'ativa' ? 'text-success' : ''}`}>{situacaoCampanha(c.status) ?? '—'}</td>
                  <td className={`${td} text-right`}>{c.orcamentoDia != null ? brl(c.orcamentoDia) : '—'}</td>
                  <td className={`${td} text-right`}>{brl(c.gasto)}</td>
                  <td className={`${td} text-right`}>{n(c.cliques)}</td>
                  <td className={`${td} text-right`}>{n(c.resultado)} <span className="text-micro text-ink-faint">{c.resultadoTipo}</span></td>
                  <td className={`${td} text-right`}>{c.resultado > 0 ? brl(c.gasto / c.resultado) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rel.termosGoogle.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-body font-semibold text-ink">O que as pessoas pesquisaram no Google (últimos 30 dias, maiores gastos)</p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {rel.termosGoogle.map(t => (
              <li key={t.termo + t.campanha} className="flex justify-between gap-3 text-body text-ink-muted">
                <span className="truncate">“{t.termo}”</span>
                <span className="whitespace-nowrap tabular-nums">{n(t.cliques)} cliques · {brl(t.gasto)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-micro text-ink-faint">
        O “resultado” segue o objetivo de cada campanha, como no Gerenciador: mensagem = conversa iniciada; tráfego = clique no link; cadastro = cadastro ou evento do pixel da página.
        Não é igual a contato no CRM. No Google é a conversão configurada na conta
        (hoje, visualização de página — não mede quem chamou no WhatsApp). O que vira contato e orçamento está na seção 1 (canal Site e Meta) e na seção 3 (por anúncio do Meta).
      </p>
    </Card>
  )
}

function VerbaPlataformasP({ rel }: { rel: RelatorioMkt }) {
  const tot = (p: 'Meta' | 'Google') => rel.plataformas.find(x => x.tipo === 'plataforma' && x.plataforma === p)
  const camp = rel.plataformas.filter(x => x.tipo === 'campanha').sort((a, b) => b.gasto - a.gasto)
  const meta = tot('Meta'), google = tot('Google')
  return (
    <Secao titulo="2. Onde a verba está indo — Google e Meta" subtitulo="Campanhas no ar no período. Resultado = o que a própria plataforma conta (conversas no Meta, conversões no Google), não contato no CRM.">
      <p style={{ margin: '0 0 6px' }}>
        <strong>Meta Ads:</strong> {meta ? `${brl(meta.gasto)}${meta.orcamentoDia ? ` (${brl(meta.orcamentoDia)}/dia nas ativas)` : ''} · ${n(meta.resultado)} conversas` : '—'}{meta?.carregadoAte ? ` (dados até ${dataBr(meta.carregadoAte)})` : ''}
        {'   ·   '}
        <strong>Google Ads:</strong> {rel.googleLigado && google ? `${brl(google.gasto)} · ${n(google.cliques)} cliques (dados até ${dataBr(google.carregadoAte)})` : 'ainda não ligado ao CRM'}
      </p>
      {camp.length > 0 && (
        <table style={tabela}>
          <thead><tr>{['Plataforma', 'Campanha', 'Situação', 'Orçamento/dia', 'Gasto', 'Cliques', 'Resultado', 'Custo por resultado'].map((h, i) => <th key={h} style={{ ...thP, textAlign: i < 3 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>
            {camp.map(c => (
              <tr key={c.plataforma + c.campanha}>
                <td style={{ ...rowH, fontWeight: 400, color: P.muted }}>{c.plataforma}</td>
                <td style={rowH}>{c.campanha}</td>
                <td style={{ ...rowH, fontWeight: 400, color: situacaoCampanha(c.status) === 'ativa' ? P.bom : P.muted }}>{situacaoCampanha(c.status) ?? '—'}</td>
                <td style={tdP}>{c.orcamentoDia != null ? brl(c.orcamentoDia) : '—'}</td>
                <td style={tdP}>{brl(c.gasto)}</td><td style={tdP}>{n(c.cliques)}</td>
                <td style={tdP}>{n(c.resultado)} {c.resultadoTipo}</td>
                <td style={tdP}>{c.resultado > 0 ? brl(c.gasto / c.resultado) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rel.termosGoogle.length > 0 && (
        <p style={{ ...sub, marginTop: 4 }}>
          <strong style={{ color: P.ink }}>Mais pesquisado no Google (30 dias):</strong> {rel.termosGoogle.slice(0, 10).map(t => `“${t.termo}” (${t.cliques} cliques, ${brl(t.gasto)})`).join('; ')}.
        </p>
      )}
    </Secao>
  )
}
