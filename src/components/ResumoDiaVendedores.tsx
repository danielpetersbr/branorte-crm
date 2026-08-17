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
  pct?: boolean          // o valor é 0-100 e sai com "%"
}

// Um número da tabela vira texto. Percentual carrega o "%" junto — sem ele,
// "16" na coluna Score seria lido como 16 clientes, que é outra coisa.
const fmtCol = (c: Col, v: number) => (c.pct ? `${v}%` : fmt(v))

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
  { key: 'carteira',     Icon: Users,          emoji: '👥', label: 'Carteira',   explica: 'clientes que ele está trabalhando: prospecção + 2ª tentativa + novo lead + follow-up + lead quente, tirando quem já foi marcado como vendido ou perdido', tone: 'neutro',  kpi: false, mobile: false, snapshot: true, separaAntes: true, semFio: true },
  // SCORE virou PERCENTUAL em 17/08/2026 (pedido do Daniel: "no máximo 100%").
  // É ATENDIDOS ÷ CARTEIRA: quanto da carteira dele ele mexeu no período.
  //
  // Antes era a contagem de clientes vivos no funil — que virou a própria coluna
  // Carteira, então a dupla mostrava o mesmo mundo duas vezes. Agora uma diz o
  // TAMANHO e a outra o ESFORÇO, e carteira pequena deixou de ser desvantagem:
  // GUSTAVO tem a menor carteira do time e o maior score, porque trabalhou ela.
  { key: 'score',        Icon: Target,         emoji: '🎯', label: 'Score',      explica: 'quanto da carteira ele mexeu no período: atendidos ÷ carteira, travado em 100%', tone: 'accent', kpi: false, mobile: true,  snapshot: true, pct: true },
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
  // Score é atendidos ÷ carteira: cai junto com QUALQUER um dos dois lados.
  if (c.key === 'score') return fora.carteira || fora.funil
  return c.snapshot && fora.funil
}

// Vale pra célula de um vendedor (soma os casos que são por pessoa).
function semDado(c: Col, r: ResumoDiaVendedor, fora: Fora): boolean {
  if (c.key === 'ligacoes' && !r.ligacoesCaptura) return true
  // Score é uma razão: sem carteira não existe denominador. Mostrar "0%" aí diria
  // "ele não mexeu em nada", quando a verdade é "não há o que mexer".
  if (c.key === 'score' && r.carteira === 0) return true
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
function NumCell({ val, max, tone, indisponivel = false, separaAntes = false, semFio = false, sufixo = '' }:
  { val: number; max: number; tone: Tone; indisponivel?: boolean; separaAntes?: boolean; semFio?: boolean; sufixo?: string }) {
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
          {fmt(val)}{sufixo}
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
        {indisponivel ? '· · ·' : fmtCol(col, valor)}
      </div>
    </div>
  )
}

// Copia texto e diz se conseguiu. Duas rotas, porque a primeira falha em situação
// banal do dia a dia.
//
// ⚠️ 17/08/2026 — "o botão não pega". O código era
// `navigator.clipboard?.writeText(...).then(...)`, SEM catch: a API rejeita com
// `NotAllowedError: Document is not focused` (DevTools aberto, janela sem foco,
// clique logo depois de um alt-tab) e a rejeição morria sem ninguém tratar. O
// botão não copiava, não avisava e não mudava de estado — indistinguível de um
// clique que não registrou.
//
// Rota 2 é o `execCommand('copy')`: obsoleto, mas roda SÍNCRONO dentro do gesto do
// clique e por isso não depende do foco do documento. É exatamente o caso que
// derruba a rota 1.
async function copiarTexto(texto: string): Promise<boolean> {
  // Medido em 17/08/2026 com a página aberta e VISÍVEL: `document.hasFocus()`
  // devolve false sempre que a JANELA do Chrome não está em primeiro plano, e aí
  // as duas rotas abaixo falham juntas. Este empurrão recupera parte desses casos.
  try { window.focus() } catch { /* alguns contextos proíbem; segue o jogo */ }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // cai pro fallback — não desiste aqui
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    // Fora da tela, mas NÃO com display:none nem visibility:hidden — elemento
    // escondido assim não é selecionável e o execCommand não copia nada.
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, texto.length)   // iOS só respeita o range explícito
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

// Monta o texto pro WhatsApp (negrito com *asteriscos*).
//
// ⚠️ ELA DERIVA DE `COLS`. Não escreva métrica na mão aqui: a mensagem sempre
// mostra exatamente as colunas da tela, na mesma ordem, com o mesmo emoji e a
// mesma formatação (o Score sai com "%"). Foi justamente por escrever à mão que
// ela ficou pra trás — a versão anterior listava 4 métricas fixas e não
// acompanhou Ligações, Carteira e Score quando essas colunas nasceram. Agora
// coluna nova entra sozinha.
//
// 17/08/2026 — O DANIEL PEDIU A MENSAGEM COMPLETA: as 8 colunas, zero incluído.
// Isso REVERTE duas decisões minhas anteriores, e vale registrar por que elas
// existiam, caso alguém queira encolher de novo:
// • "cada vendedor só mostra o que tem" (13/08) — omitia zeros pra mensagem não
//   virar parede de 🤝0. O custo escondido: quem estava zerado sumia da cobrança.
// • ligações fora (17/08) — na época a captura só via chat com etiqueta do funil
//   (22-47% da carteira), e ranquear por ela era injusto. Isso MUDOU no mesmo
//   dia: a fonte virou o histórico do WhatsApp e cobre a carteira inteira.
//
// O que continua valendo e NÃO deve ser revertido:
// • MEDALHA NO TOP 3 — num grupo de vendas o ranking é a mensagem.
// • NÚMERO INDISPONÍVEL NÃO VIRA ZERO. Se o funil não carregou, ou se a extensão
//   daquele vendedor não captura ligação, a métrica é OMITIDA da linha dele.
//   Anunciar "📲0" pra quem o sistema não consegue medir é acusação falsa no grupo.
function textoWhatsApp(
  rows: ResumoDiaVendedor[],
  tot: Record<string, number>,
  opts: { periodo?: string; fora: Fora },
): string {
  const data = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const medalha = ['🥇', '🥈', '🥉']

  // Uma régua só pros dois casos (vendedor e time): mesmo conjunto, mesma ordem,
  // pulando o que o sistema não sabe.
  const metricas = (valor: (c: Col) => number, semDadoNesta: (c: Col) => boolean) =>
    COLS.filter(c => !semDadoNesta(c)).map(c => `${c.emoji}${fmtCol(c, valor(c))}`).join(' ')

  // Nome e números em linhas separadas: com 8 métricas, tudo numa linha só vira
  // um bloco que quebra feio na largura do WhatsApp no celular.
  const linhas = rows.map((r, i) => {
    const marca = i < 3 ? medalha[i] : '•'
    return `${marca} *${r.nome}*\n${metricas(c => r[c.key], c => semDado(c, r, opts.fora))}`
  })

  return [
    `☀️ *RESUMO — ${opts.periodo || data}*`,
    '',
    `*TIME:* ${metricas(c => tot[c.key], c => semDadoCol(c, opts.fora))}`,
    '',
    linhas.join('\n\n'),
    '',
    `_${COLS.map(c => `${c.emoji}${c.label.toLowerCase()}`).join(' · ')}_`,
  ].join('\n')
}

export function ResumoDiaVendedores({ preset = '', periodoLabel }: { preset?: DashboardPreset; periodoLabel?: string }) {
  const liveHoje = preset === '' || preset === 'hoje'
  const { linhas, isLoading, isError, funilIndisponivel, carteiraIndisponivel } = useResumoDia(preset)
  const fora: Fora = { funil: funilIndisponivel, carteira: carteiraIndisponivel }
  const [copiado, setCopiado] = useState(false)
  // Texto que a cópia não conseguiu entregar: vira um painel selecionável na tela.
  // Falhar em silêncio é o bug que estamos consertando — se as duas rotas caírem,
  // o gestor ainda precisa conseguir levar o resumo pro grupo.
  const [textoPraCopiarNaMao, setTextoPraCopiarNaMao] = useState<string | null>(null)
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
    // score NÃO entra na soma: percentual não se soma. Calculado logo abaixo.
    score: 0,
  }), { leads: 0, atendimentos: 0, ligacoes: 0, orcamentos: 0, negociacao: 0, quente: 0, carteira: 0, score: 0 }), [rows])

  // Score do TIME = atendidos do time ÷ carteira do time. Somar os nove
  // percentuais daria 100+; média simples daria o mesmo peso pra quem tem 41 de
  // carteira e pra quem tem 173. As duas contas mentiriam.
  if (tot.carteira > 0) tot.score = Math.min(100, Math.round((tot.atendimentos / tot.carteira) * 100))

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

  const copiar = async () => {
    const periodo = !liveHoje && periodoLabel ? periodoLabel : undefined
    const texto = textoWhatsApp(rows, tot, { periodo, fora })
    if (await copiarTexto(texto)) {
      setTextoPraCopiarNaMao(null)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } else {
      setTextoPraCopiarNaMao(texto)
    }
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

      {/* Rede de segurança: as duas rotas de cópia falharam. Em vez de não fazer
          nada (que era o bug), entrega o texto pronto e já selecionado. */}
      {textoPraCopiarNaMao && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-[11.5px] leading-relaxed text-warning">
              <b className="font-semibold">O navegador bloqueou a cópia automática.</b>{' '}
              O texto está aqui embaixo, já selecionado — <b className="font-semibold">Ctrl+C</b> e cola no grupo.
            </p>
            <button
              onClick={() => setTextoPraCopiarNaMao(null)}
              className="shrink-0 text-[11px] text-ink-muted hover:text-ink underline underline-offset-2"
            >
              fechar
            </button>
          </div>
          <textarea
            readOnly
            value={textoPraCopiarNaMao}
            rows={Math.min(16, textoPraCopiarNaMao.split('\n').length + 1)}
            ref={el => el?.select()}
            onFocus={e => e.currentTarget.select()}
            className="w-full rounded-md border border-border bg-surface-2 p-2.5 text-[12px] leading-relaxed text-ink font-mono resize-y"
          />
        </div>
      )}

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
                          sufixo={c.pct ? '%' : ''}
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
                      {semDadoCol(c, fora) ? '· · ·' : fmtCol(c, tot[c.key])}
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
                              {ind ? '···' : fmtCol(c, v)}
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
                              {ind ? '···' : fmtCol(c, v)}
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
                        {ind ? '···' : fmtCol(c, tot[c.key])}
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
