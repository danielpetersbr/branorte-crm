import { useMemo, useState } from 'react'
import {
  Copy, Check, Info, ChevronDown,
  UserPlus, MessageSquare, Phone, FileText, Handshake, Flame, Users, Target,
  type LucideIcon,
} from 'lucide-react'
import { useResumoDia, type ResumoDiaVendedor } from '@/hooks/useResumoDia'
import type { DashboardPreset } from '@/hooks/useDashboard'

// ============================================================================
// "Resumo do dia por vendedor" — card do Dashboard com os números de HOJE ao
// vivo (mesma fonte das mesas do /disparos), legenda explicando cada coluna e
// botão que copia o resumo formatado pra colar no grupo do WhatsApp.
// Negociação = Follow-up + Lead Quente. "Carteira" = clientes ainda em jogo no
// funil dele (desde 17/08/2026 — antes era o total bruto de conversas do WhatsApp).
//
// Redesign visual de 17/08/2026 — NENHUM número, fonte ou regra mudou; só a
// forma de mostrar. O que guiou:
// • FAIXA DE KPIs no topo: o gestor precisa da leitura do time em ~3s antes de
//   descer pra pessoa. Os valores são o MESMO `tot` que já alimentava o rodapé.
// • BARRA VIROU FIO DE 2px SOB O NÚMERO. A bar-in-cell de antes ocupava a
//   célula inteira e competia com o dígito; em 8 colunas isso vira listra.
//   Número primeiro, comparação depois.
// • MOBILE GANHOU CARD PRÓPRIO. A tabela tinha `min-w-[560px]`: no celular o
//   gestor arrastava lateralmente pra ler qualquer coisa. Agora são cards com
//   as 4 métricas que ele olha (atendidos, negociando, quentes, leads) e o
//   resto abre no toque.
// • LEGENDA VIROU DISCLOSURE. Sete definições sempre abertas empurravam o
//   conteúdo; agora ficam atrás de "Entenda os indicadores".
// ============================================================================

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)

// Tons: só os tokens que existem nos DOIS temas (claro e .dark). Nada de hex
// solto — `accent`/`info`/`warning` já são calibrados por contraste no
// src/index.css, e um hex fixo quebraria no tema oposto.
// A paleta é curta de propósito: verde = atividade produtiva de hoje,
// azul = pipeline, âmbar = urgência, neutro = piso/histórico.
type Tone = 'accent' | 'info' | 'warning' | 'neutro'

const TONE: Record<Tone, { num: string; fio: string; fioLider: string; icone: string; kpiNum: string }> = {
  accent:  { num: 'text-ink', fio: 'bg-accent/25',  fioLider: 'bg-accent',  icone: 'text-accent',    kpiNum: 'text-ink' },
  info:    { num: 'text-ink', fio: 'bg-info/25',    fioLider: 'bg-info',    icone: 'text-info',      kpiNum: 'text-info' },
  warning: { num: 'text-ink', fio: 'bg-warning/25', fioLider: 'bg-warning', icone: 'text-warning',   kpiNum: 'text-warning' },
  neutro:  { num: 'text-ink', fio: 'bg-ink-faint/20', fioLider: 'bg-ink-faint/50', icone: 'text-ink-faint', kpiNum: 'text-ink-muted' },
}

type ColKey = keyof Pick<ResumoDiaVendedor, 'leads' | 'atendimentos' | 'ligacoes' | 'orcamentos' | 'negociacao' | 'quente' | 'carteira' | 'score'>

type Col = {
  key: ColKey
  Icon: LucideIcon
  emoji: string          // a legenda e a mensagem do grupo falam em emoji há meses — mantido
  label: string
  curto?: string         // rótulo do card do celular: em 390px "NEGOCIANDO" trunca
  explica: string
  tone: Tone
  kpi: boolean           // entra na faixa do topo
  mobile: boolean        // aparece no card compacto do celular (sem precisar expandir)
  snapshot: boolean      // é estado AGORA (não movimento do período) → pode virar "· · ·"
  separaAntes?: boolean  // divisor: daqui pra frente não é atividade de hoje
  semFio?: boolean       // sem fio de comparação (número puro)
}

const COLS: Col[] = [
  { key: 'leads',        Icon: UserPlus,       emoji: '📥', label: 'Leads',      explica: 'leads novos que chegaram hoje',                    tone: 'accent',  kpi: true,  mobile: true,  snapshot: false },
  { key: 'atendimentos', Icon: MessageSquare,  emoji: '💬', label: 'Atendidos',  explica: 'conversas trabalhadas hoje',                       tone: 'accent',  kpi: true,  mobile: true,  snapshot: false },
  { key: 'ligacoes',     Icon: Phone,          emoji: '📲', label: 'Ligações',  curto: 'Lig.',   explica: 'chamadas que ele FEZ, do histórico do WhatsApp (cobre a carteira toda)', tone: 'neutro',  kpi: true,  mobile: false, snapshot: false },
  { key: 'orcamentos',   Icon: FileText,       emoji: '📄', label: 'Orçamentos', curto: 'Orçam.', explica: 'orçamentos montados hoje',                         tone: 'accent',  kpi: true,  mobile: false, snapshot: false },
  { key: 'negociacao',   Icon: Handshake,      emoji: '🤝', label: 'Negociando', curto: 'Negoc.', explica: 'em negociação agora (follow-up + quente)',         tone: 'info',    kpi: true,  mobile: true,  snapshot: true },
  { key: 'quente',       Icon: Flame,          emoji: '🔥', label: 'Quentes',    explica: 'leads quentes agora',                              tone: 'warning', kpi: true,  mobile: true,  snapshot: true },
  // Carteira = estoque em jogo, não corrida de hoje: número puro, sem fio, e
  // separada por um divisor. Ranquear carteira ali levaria o olho pro lugar errado —
  // carteira grande pode ser mérito ou pode ser fila parada esperando resposta.
  { key: 'carteira',     Icon: Users,          emoji: '👥', label: 'Carteira',   explica: 'clientes ainda em jogo no funil dele: as 5 etapas + orçamento enviado + interesse futuro (fora vendido e perdido)', tone: 'neutro',  kpi: false, mobile: false, snapshot: true, separaAntes: true, semFio: true },
  // SCORE é a fatia da carteira que ele trabalha HOJE: só as 5 etapas. Ganha fio
  // porque comparar score entre vendedores é exatamente o ponto dele. A distância
  // pra Carteira é o que está parado esperando resposta de orçamento.
  { key: 'score',        Icon: Target,         emoji: '🎯', label: 'Score',      explica: 'clientes vivos no funil: prospecção + novo lead + 2ª tentativa + follow-up + lead quente', tone: 'accent', kpi: false, mobile: true,  snapshot: true },
]

// Uma celula fica "· · ·" por três motivos distintos, e os três querem dizer
// "o sistema não sabe" — nunca "é zero":
//  • funil vivo fora do ar        → Negociando/Quentes/Score
//  • RPC da carteira fora do ar   → Carteira (query SEPARADA desde 17/08/2026 —
//    por isso tem flag própria: uma pode cair sem a outra)
//  • extensão sem captura de ligação → Ligações daquele vendedor
type Fora = { funil: boolean; carteira: boolean }

// Vale pra coluna inteira (KPI do topo, total do rodapé).
function semDadoCol(c: Col, fora: Fora): boolean {
  if (c.key === 'carteira') return fora.carteira
  return c.snapshot && fora.funil
}

// Vale pra célula de um vendedor (soma o caso das ligações, que é por pessoa).
function semDado(c: Col, r: ResumoDiaVendedor, fora: Fora): boolean {
  if (c.key === 'ligacoes' && !r.ligacoesCaptura) return true
  return semDadoCol(c, fora)
}

// Iniciais pro avatar. "EDILSON JR" → "EJ", "JARDEL" → "JA".
function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean)
  if (p.length === 0) return '?'
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
  return (p[0][0] + p[1][0]).toUpperCase()
}

// ---------------------------------------------------------------------------
// Número + fio de comparação.
//
// Quatro decisões que vieram de olhar a tela em produção (13/08 e 17/08):
// 1. ZERO NÃO GANHA FIO. Uma coluna zerada em todo mundo virava fileira de
//    riscos que parecia sujeira de render.
// 2. ZERO É "0", NÃO "–". O traço lê como "faltou dado". Quando o sistema sabe
//    que é zero, ele diz zero — em `text-ink-faint`, que é a cor discreta do
//    tema. `indisponivel` (· · ·) continua sendo a forma de dizer "não chegou".
// 3. DISCRIÇÃO POR PESO E COR, NUNCA POR OPACITY. `opacity` compõe o glifo com
//    o fundo e derruba contraste de verdade (medido neste tema: ink-muted com
//    opacity-60 vai de 7,40:1 pra 2,84:1).
// 4. O FIO É 2px E MORA SOB O NÚMERO. Barra atrás do dígito disputa leitura;
//    embaixo, ela só responde "esse é grande ou pequeno perto dos outros?".
// ---------------------------------------------------------------------------
function NumCell({ val, max, tone, indisponivel = false, separaAntes = false, semFio = false }:
  { val: number; max: number; tone: Tone; indisponivel?: boolean; separaAntes?: boolean; semFio?: boolean }) {
  const divisor = separaAntes ? 'border-l border-border/60 pl-4' : ''
  if (indisponivel) {
    return (
      <td className={`py-3 px-3 text-right align-middle ${divisor}`}>
        <span className="tabular-nums text-ink-faint text-[14px]" title="Não deu pra carregar este número agora">·&nbsp;·&nbsp;·</span>
      </td>
    )
  }
  const vazio = val === 0
  const pct = max > 0 ? (val / max) * 100 : 0
  const lider = val > 0 && val === max
  const t = TONE[tone]
  // O fio só existe quando há o que comparar. Nem trilho vazio: numa coluna
  // quase toda zerada (Ligações, Orçamentos) o trilho virava fileira de
  // risquinhos cinza — ruído que compete com os números que importam.
  const mostraFio = !semFio && !vazio
  return (
    <td className={`py-3 px-3 align-middle ${divisor}`}>
      <div className="flex flex-col items-end gap-1">
        <span className={`tabular-nums text-[14px] leading-none ${
          vazio ? 'text-ink-faint font-normal' : lider ? `${t.num} font-semibold` : `${t.num} font-medium`
        }`}>
          {fmt(val)}
        </span>
        {!semFio && (
          <span aria-hidden className="block h-[2px] w-full max-w-[52px] rounded-full overflow-hidden">
            {mostraFio && (
              <span
                className={`block h-full rounded-full ${lider ? t.fioLider : t.fio}`}
                style={{ width: `${Math.max(pct, 8)}%`, marginLeft: 'auto' }}
              />
            )}
          </span>
        )}
      </div>
    </td>
  )
}

// Card da faixa do topo. Mesmo `tot` do rodapé — nenhum cálculo novo.
function KpiCard({ col, valor, indisponivel, destaque }:
  { col: Col; valor: number; indisponivel: boolean; destaque: boolean }) {
  const t = TONE[col.tone]
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition-colors duration-200 ${
        destaque
          ? 'border-border-strong bg-surface-2/60 hover:border-ink-faint/40'
          : 'border-border bg-surface-2/30 hover:border-border-strong'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <col.Icon className={`h-3.5 w-3.5 shrink-0 ${t.icone}`} strokeWidth={2} />
        <span className="text-[10.5px] uppercase tracking-wide text-ink-faint truncate">{col.label}</span>
      </div>
      <div className={`tabular-nums leading-none font-semibold text-[22px] ${
        indisponivel ? 'text-ink-faint text-[16px]' : valor === 0 ? 'text-ink-faint' : t.kpiNum
      }`}>
        {indisponivel ? '· · ·' : fmt(valor)}
      </div>
    </div>
  )
}

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
  const { linhas, isLoading, isError, funilIndisponivel, carteiraIndisponivel } = useResumoDia(preset)
  const fora: Fora = { funil: funilIndisponivel, carteira: carteiraIndisponivel }
  const [copiado, setCopiado] = useState(false)
  const [legendaAberta, setLegendaAberta] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)  // card do celular

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
    score: a.score + r.score,
  }), { leads: 0, atendimentos: 0, ligacoes: 0, orcamentos: 0, negociacao: 0, quente: 0, carteira: 0, score: 0 }), [rows])

  // Maior valor por coluna — base do fio de comparação em cada célula.
  const maxByCol = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of COLS) m[c.key] = Math.max(1, ...rows.map(r => Number(r[c.key]) || 0))
    return m
  }, [rows])

  // Destaque do dia: quem lidera os atendimentos (a mesma métrica que já ordena
  // a lista e que já ganha 🥇 na mensagem do grupo). NÃO é métrica nova — é o
  // topo de uma coluna que a tela sempre mostrou.
  const topAtendimentos = rows.length > 0 && rows[0].atendimentos > 0 ? rows[0].nome : null

  // Quem está com a extensão sem captura de ligação. Some sozinho quando todo
  // mundo atualizar — o aviso do rodapé e o "· · ·" das células saem juntos.
  const semCaptura = useMemo(() => rows.filter(r => !r.ligacoesCaptura).map(r => r.nome), [rows])

  const copiar = () => {
    const periodo = !liveHoje && periodoLabel ? periodoLabel : undefined
    navigator.clipboard?.writeText(textoWhatsApp(rows, tot, { periodo, funilIndisponivel })).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    })
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 sm:p-5 transition-colors duration-200 hover:border-border-strong">
      {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink tracking-tight">
            Resumo por vendedor{!liveHoje && periodoLabel ? <span className="text-ink-muted font-medium"> · {periodoLabel}</span> : null}
          </h3>
          <p className="text-[11.5px] text-ink-faint mt-0.5">
            {liveHoje
              ? 'Visão ao vivo da atividade comercial de hoje — mesma fonte das mesas do escritório.'
              : 'Leads · orçamentos · atendidos seguem o período. Negociando/quentes/carteira = estado agora.'}
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={copiar}
            className={`shrink-0 h-9 px-3.5 inline-flex items-center gap-2 rounded-lg text-[12.5px] font-medium border transition-all duration-200 ${
              copiado
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-surface-2 text-ink-muted hover:text-ink hover:border-border-strong hover:bg-surface-2'
            }`}
            title="Copia o resumo formatado pra colar no grupo do WhatsApp"
          >
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiado ? 'Copiado! Cola no grupo' : 'Copiar pro WhatsApp'}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-[12px] text-ink-muted py-10 text-center">Carregando resumo…</p>
      ) : isError ? (
        <p className="text-[12px] text-danger py-10 text-center">Não deu pra carregar o resumo agora.</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-ink-muted py-10 text-center">Nenhum vendedor no painel.</p>
      ) : (
        <>
          {/* ── Faixa de KPIs do time ────────────────────────────────────
              Mesmos totais do rodapé da tabela, só que legíveis de longe. */}
          <div className="mt-4 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {COLS.filter(c => c.kpi).map(c => (
              <KpiCard
                key={c.key}
                col={c}
                valor={tot[c.key]}
                indisponivel={semDadoCol(c, fora)}
                destaque={c.key === 'negociacao' || c.key === 'quente'}
              />
            ))}
          </div>

          {/* ── Tabela (tablet/desktop) ──────────────────────────────── */}
          <div className="hidden md:block mt-5 overflow-x-auto -mx-1 px-1">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr className="text-ink-faint text-[10px] uppercase tracking-wider">
                  <th className="text-left font-medium pb-2.5 pr-3">Vendedor</th>
                  {COLS.map(c => (
                    <th
                      key={c.key}
                      title={c.explica}
                      className={`font-medium pb-2.5 px-3 whitespace-nowrap cursor-help ${c.separaAntes ? 'border-l border-border/60 pl-4' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1.5 justify-end w-full">
                        <c.Icon className={`h-3 w-3 shrink-0 ${TONE[c.tone].icone}`} strokeWidth={2.25} />
                        {c.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const semAtividade = r.leads === 0 && r.atendimentos === 0 && r.orcamentos === 0 && r.negociacao === 0
                  const top = r.nome === topAtendimentos
                  return (
                    <tr key={r.nome} className="border-t border-border/60 hover:bg-surface-2/50 transition-colors duration-150">
                      <td className="py-3 pr-3">
                        <span className="inline-flex items-center gap-2.5 min-w-0">
                          <span className="relative shrink-0">
                            <span className={`h-7 w-7 rounded-full inline-flex items-center justify-center text-[10.5px] font-semibold tabular-nums ${
                              semAtividade ? 'bg-surface-2 text-ink-faint' : 'bg-surface-2 text-ink-muted'
                            } ${top ? 'ring-1 ring-accent/50' : ''}`}>
                              {iniciais(r.nome)}
                            </span>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface ${r.online ? 'bg-success' : 'bg-ink-faint/50'}`}
                              title={r.online ? 'online' : 'offline'}
                            />
                          </span>
                          <span className={`text-[13px] font-medium truncate ${semAtividade ? 'text-ink-faint' : 'text-ink'}`}>
                            {r.nome}
                          </span>
                          {top && (
                            <span className="shrink-0 text-[9.5px] uppercase tracking-wide font-semibold text-accent border border-accent/30 rounded px-1.5 py-0.5" title="Mais atendimentos hoje">
                              Top do dia
                            </span>
                          )}
                        </span>
                      </td>
                      {COLS.map(c => (
                        <NumCell
                          key={c.key}
                          val={r[c.key]}
                          max={maxByCol[c.key]}
                          tone={c.tone}
                          indisponivel={semDado(c, r, fora)}
                          separaAntes={c.separaAntes}
                          semFio={c.semFio}
                        />
                      ))}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-2/40">
                  <td className="py-3 pr-3 text-ink text-[10.5px] font-semibold uppercase tracking-wider">Total do time</td>
                  {COLS.map(c => (
                    <td
                      key={c.key}
                      className={`text-right tabular-nums py-3 px-3 text-[14px] font-semibold ${
                        semDadoCol(c, fora) ? 'text-ink-faint' : TONE[c.tone].kpiNum
                      } ${c.separaAntes ? 'border-l border-border/60 pl-4' : ''}`}
                    >
                      {semDadoCol(c, fora) ? '· · ·' : fmt(tot[c.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Cards por vendedor (celular) ──────────────────────────────
              A tabela tem min-width de 720px: no celular ela vira arrastão
              horizontal. Aqui o gestor vê as 4 métricas que ele olha primeiro
              e abre o resto no toque. Mesmos dados, mesma ordenação. */}
          <div className="md:hidden mt-4 space-y-2">
            {rows.map(r => {
              const semAtividade = r.leads === 0 && r.atendimentos === 0 && r.orcamentos === 0 && r.negociacao === 0
              const top = r.nome === topAtendimentos
              const aberto = expandido === r.nome
              const principais = COLS.filter(c => c.mobile)
              const extras = COLS.filter(c => !c.mobile)
              return (
                <div key={r.nome} className="rounded-lg border border-border bg-surface-2/30">
                  <button
                    onClick={() => setExpandido(aberto ? null : r.nome)}
                    className="w-full text-left px-3 py-2.5"
                    aria-expanded={aberto}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="relative shrink-0">
                        <span className={`h-7 w-7 rounded-full inline-flex items-center justify-center text-[10.5px] font-semibold bg-surface-2 ${
                          semAtividade ? 'text-ink-faint' : 'text-ink-muted'
                        } ${top ? 'ring-1 ring-accent/50' : ''}`}>
                          {iniciais(r.nome)}
                        </span>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface ${r.online ? 'bg-success' : 'bg-ink-faint/50'}`}
                          title={r.online ? 'online' : 'offline'}
                        />
                      </span>
                      <span className={`text-[13px] font-medium truncate ${semAtividade ? 'text-ink-faint' : 'text-ink'}`}>
                        {r.nome}
                      </span>
                      {top && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wide font-semibold text-accent border border-accent/30 rounded px-1 py-0.5">
                          Top
                        </span>
                      )}
                      <ChevronDown className={`h-4 w-4 shrink-0 ml-auto text-ink-faint transition-transform duration-200 ${aberto ? 'rotate-180' : ''}`} />
                    </div>

                    {/* 5 métricas em 390px: rótulo em 9px com truncate. Medido —
                        o documento continua em 390px, sem scroll horizontal. */}
                    <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                      {principais.map(c => {
                        const ind = semDado(c, r, fora)
                        const v = r[c.key]
                        return (
                          <div key={c.key}>
                            <div className={`tabular-nums text-[15px] leading-none font-semibold ${
                              ind ? 'text-ink-faint text-[13px]' : v === 0 ? 'text-ink-faint' : TONE[c.tone].kpiNum
                            }`}>
                              {ind ? '···' : fmt(v)}
                            </div>
                            <div className="text-[9px] uppercase tracking-wide text-ink-faint mt-1 truncate">{c.curto ?? c.label}</div>
                          </div>
                        )
                      })}
                    </div>
                  </button>

                  {aberto && (
                    <div className="px-3 pb-3 pt-2 border-t border-border/60 grid grid-cols-3 gap-2">
                      {extras.map(c => {
                        const ind = semDado(c, r, fora)
                        const v = r[c.key]
                        return (
                          <div key={c.key}>
                            <div className={`tabular-nums text-[15px] leading-none font-medium ${
                              ind ? 'text-ink-faint text-[13px]' : v === 0 ? 'text-ink-faint' : TONE[c.tone].kpiNum
                            }`}>
                              {ind ? '···' : fmt(v)}
                            </div>
                            <div className="text-[9.5px] uppercase tracking-wide text-ink-faint mt-1 truncate">{c.curto ?? c.label}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Total do time também no celular */}
            <div className="rounded-lg border border-border-strong bg-surface-2/60 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink mb-2">Total do time</div>
              <div className="grid grid-cols-3 gap-2">
                {COLS.map(c => {
                  const ind = semDadoCol(c, fora)
                  return (
                    <div key={c.key}>
                      <div className={`tabular-nums text-[15px] leading-none font-semibold ${ind ? 'text-ink-faint text-[13px]' : TONE[c.tone].kpiNum}`}>
                        {ind ? '···' : fmt(tot[c.key])}
                      </div>
                      <div className="text-[9.5px] uppercase tracking-wide text-ink-faint mt-1 truncate">{c.curto ?? c.label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Aviso honesto: o número não existe, não é zero. Nomeia SÓ o que caiu —
              funil vivo e carteira são duas queries e podem falhar separadas. */}
          {(funilIndisponivel || carteiraIndisponivel) && (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11.5px] leading-relaxed text-warning flex items-start gap-2">
              <span className="shrink-0">⚠️</span>
              <span>
                <b className="font-semibold">
                  {funilIndisponivel && carteiraIndisponivel
                    ? 'Negociando, Quentes, Score e Carteira não carregaram'
                    : funilIndisponivel
                      ? 'Negociando, Quentes e Score não carregaram'
                      : 'A Carteira não carregou'}
                </b> — por isso {carteiraIndisponivel && !funilIndisponivel ? 'aparece' : 'aparecem'} como
                <span className="tabular-nums"> · · · </span>e não como zero. Os outros números estão certos.
              </span>
            </div>
          )}

          {/* ── Rodapé: ressalva das ligações + legenda em disclosure ─────
              A ressalva de ligações fica FORA do disclosure de propósito: não é
              explicação, é aviso de que falta gente na conta — e alguém ia cobrar
              em cima do número assim mesmo.

              ⚠️ Ela agora é CONDICIONAL e se apaga sozinha. Até 17/08/2026 era um
              texto fixo ("Ligações é PISO"), porque a fonte era `call_log`, que só
              via chat com etiqueta do funil. Trocada a fonte pelo histórico do
              WhatsApp, o furo que resta não é mais da régua: é de quem está com
              extensão velha (a captura entrou na 1.13.0). Quando o último vendedor
              atualizar, o aviso some sem ninguém precisar editar o código — e é
              por isso que ele NOMEIA quem falta em vez de falar em abstrato. */}
          <div className="mt-4 pt-3 border-t border-border/60 space-y-2.5">
            {semCaptura.length > 0 && (
              <p className="text-[11px] leading-relaxed text-ink-muted">
                <span className="text-warning font-semibold">
                  Ligações de {semCaptura.join(', ')} não entram na conta.
                </span>{' '}
                A extensão {semCaptura.length > 1 ? 'deles' : 'dele'} ainda não captura chamada — aparece
                <span className="tabular-nums"> · · · </span>em vez de zero, e o total do time sai por baixo.
                Atualizar a extensão resolve. Os demais vêm do histórico do WhatsApp e cobrem a carteira inteira,
                com ou sem etiqueta.
              </p>
            )}

            <div>
              <button
                onClick={() => setLegendaAberta(v => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted hover:text-ink transition-colors duration-150"
                aria-expanded={legendaAberta}
              >
                <Info className="h-3.5 w-3.5" />
                Entenda os indicadores
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${legendaAberta ? 'rotate-180' : ''}`} />
              </button>

              {legendaAberta && (
                <div className="mt-2.5 grid gap-x-5 gap-y-1.5 text-[11px] leading-relaxed text-ink-faint
                                [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
                  {COLS.map(c => (
                    <span key={c.key} className="inline-flex items-start gap-1.5">
                      <c.Icon className={`h-3.5 w-3.5 shrink-0 mt-px ${TONE[c.tone].icone}`} strokeWidth={2.25} />
                      <span><b className="text-ink-muted font-medium">{c.label}</b> = {c.explica}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
