// PlanoVendaCard.tsx — renderiza os 3 cenários de venda (À Vista / 28-56-84 / Prazo Estendido)
// vindos do scoring do detetive (dd-consultar). Cada cenário é um cartão com limite,
// requisitos e prazo de aprovação interna. O cenário recomendado ganha badge destacada.
// Componente stateless, usa tokens próprios do branorte-crm (NÃO shadcn).

import { Wallet, Calendar, Shield, Check, AlertTriangle, X } from "lucide-react"

// ─── Tipos exportados (Index.tsx / DueDiligence consomem) ────────────────────

export type RequisitoTipo = "simples" | "documento"

export interface RequisitoItem {
  texto: string
  tipo?: RequisitoTipo
}

export type RequisitoEntry = string | RequisitoItem

export interface CenarioAVista {
  limite_brl: number
  desconto_pct: number
  requisitos: RequisitoEntry[]
  prazo_aprovacao_dias: number
}

export interface CenarioPrazoPadrao {
  limite_brl: number
  condicao: string
  requisitos: RequisitoEntry[]
  prazo_aprovacao_dias: number
}

export interface CenarioPrazoEstendido {
  limite_brl: number
  condicao: string
  requisitos: RequisitoEntry[]
  prazo_aprovacao_dias: number
  viavel: boolean
}

export type CenarioKey = "a_vista" | "prazo_padrao" | "prazo_estendido"

export interface PlanoVendaCardProps {
  cenarios: {
    a_vista: CenarioAVista
    prazo_padrao: CenarioPrazoPadrao
    prazo_estendido: CenarioPrazoEstendido
  }
  recomendado: CenarioKey
  /**
   * Quando true, oculta o cenário "Prazo Estendido" caso viavel=false (em vez
   * de mostrá-lo opaco/inviável). Útil para PF, onde prazo estendido com FINAME
   * geralmente não faz sentido — melhor não confundir o vendedor com card morto.
   * Default: false (comportamento PJ legado mantido).
   */
  ocultarEstendidoSeInviavel?: boolean
}

// ─── Configuração visual por cenário ─────────────────────────────────────────

interface CenarioMeta {
  key: CenarioKey
  titulo: string
  subtitulo: string
  icone: typeof Wallet
}

const CENARIOS_META: CenarioMeta[] = [
  {
    key: "a_vista",
    titulo: "À Vista",
    subtitulo: "pagamento antes da expedição",
    icone: Wallet,
  },
  {
    key: "prazo_padrao",
    titulo: "28 / 56 / 84",
    subtitulo: "prazo padrão Branorte",
    icone: Calendar,
  },
  {
    key: "prazo_estendido",
    titulo: "Prazo Estendido",
    subtitulo: "30 / 60 / 90 / 120 ou FINAME",
    icone: Shield,
  },
]

// ─── Componente principal ────────────────────────────────────────────────────

export function PlanoVendaCard({
  cenarios,
  recomendado,
  ocultarEstendidoSeInviavel = false,
}: PlanoVendaCardProps) {
  // GUARD: Se cenarios não tem o shape mínimo esperado, não renderiza nada.
  // Backend (api/dd-consultar.ts) ainda manda Cenario[] (array) em alguns casos,
  // mas frontend espera {a_vista, prazo_padrao, prazo_estendido}. Sem esse guard,
  // o acesso a cenarios.prazo_estendido.viavel quebra com "Cannot read properties
  // of undefined (reading 'viavel')".
  if (
    !cenarios ||
    typeof cenarios !== "object" ||
    !cenarios.a_vista ||
    !cenarios.prazo_padrao ||
    !cenarios.prazo_estendido
  ) {
    return (
      <section className="px-4 py-4 bg-surface-2/30">
        <header className="flex items-center gap-2 mb-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
            Plano de Venda — 3 Cenários
          </h3>
        </header>
        <p className="text-[11px] text-ink-faint italic">
          Plano de Venda não disponível para esta consulta.
        </p>
      </section>
    )
  }

  return (
    <section className="px-4 py-4 bg-surface-2/30">
      <header className="flex items-center gap-2 mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
          Plano de Venda — 3 Cenários
        </h3>
        <span className="ml-auto text-[10px] text-ink-faint">
          escolha o caminho que cabe no cliente
        </span>
      </header>

      <div
        className={`grid gap-4 grid-cols-1 ${
          // Quando ocultamos o estendido inviável, viramos grid de 2 colunas em md+
          ocultarEstendidoSeInviavel && cenarios?.prazo_estendido?.viavel === false
            ? "md:grid-cols-2"
            : "md:grid-cols-3"
        }`}
      >
        {CENARIOS_META.map((meta) => {
          const cenario = cenarios[meta.key]
          // Skip silencioso se o cenário individual não existe (defensive)
          if (!cenario) return null
          const isInviavel =
            meta.key === "prazo_estendido" &&
            (cenarios?.prazo_estendido?.viavel === false)

          // Ocultação total: pula o cenário se for estendido + inviavel + flag ligada
          if (isInviavel && ocultarEstendidoSeInviavel) return null

          const isRecomendado = recomendado === meta.key

          return (
            <CenarioCardView
              key={meta.key}
              meta={meta}
              cenario={cenario}
              recomendado={isRecomendado}
              inviavel={isInviavel}
            />
          )
        })}
      </div>
    </section>
  )
}

// ─── Card individual ─────────────────────────────────────────────────────────

interface CenarioCardViewProps {
  meta: CenarioMeta
  cenario: CenarioAVista | CenarioPrazoPadrao | CenarioPrazoEstendido
  recomendado: boolean
  inviavel: boolean
}

function CenarioCardView({
  meta,
  cenario,
  recomendado,
  inviavel,
}: CenarioCardViewProps) {
  const Icon = meta.icone

  // Card "inviável" fica opaco e sem destaque
  const wrapperClass = [
    "relative rounded-md border-2 bg-surface overflow-hidden flex flex-col",
    inviavel
      ? "border-border/40 opacity-50"
      : recomendado
        ? "border-accent"
        : "border-border",
  ].join(" ")

  // Pega condição/desconto pra subheader (varia por cenário)
  const condicaoExtra = obterCondicaoExtra(meta.key, cenario)

  return (
    <article className={wrapperClass}>
      {/* Badges no canto superior direito */}
      {recomendado && !inviavel && (
        <div className="absolute top-0 right-0 bg-accent text-[9px] font-bold uppercase tracking-wider text-bg px-2 py-0.5 rounded-bl">
          Recomendado
        </div>
      )}
      {inviavel && (
        <div className="absolute top-0 right-0 bg-ink-faint/30 text-[9px] font-bold uppercase tracking-wider text-ink-muted px-2 py-0.5 rounded-bl flex items-center gap-1">
          <X className="h-3 w-3" />
          Inviável
        </div>
      )}

      {/* Header com ícone + título */}
      <header className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
        <Icon
          className={`h-4 w-4 shrink-0 ${
            recomendado && !inviavel ? "text-accent" : "text-ink-muted"
          }`}
        />
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-ink leading-tight">
            {meta.titulo}
          </p>
          <p className="text-[10px] text-ink-muted leading-tight truncate">
            {meta.subtitulo}
          </p>
        </div>
      </header>

      {/* Limite em destaque */}
      <div className="px-3 py-3 border-b border-border/20">
        <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">
          Limite aprovado
        </p>
        <p className="text-3xl font-mono font-bold tabular-nums text-ink leading-none">
          {formatBRL(cenario?.limite_brl)}
        </p>
        {condicaoExtra && (
          <p className="text-sm text-ink-muted mt-1.5 leading-tight">
            {condicaoExtra}
          </p>
        )}
      </div>

      {/* Requisitos */}
      <div className="px-3 py-2 flex-1">
        <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-1.5">
          Requisitos antes de fechar
        </p>
        {(cenario?.requisitos ?? []).length === 0 ? (
          <p className="text-[11px] text-success italic">
            Nenhum — pode fechar direto.
          </p>
        ) : (
          <ul className="space-y-1">
            {(cenario?.requisitos ?? []).map((req, i) => {
              const item = normalizarRequisito(req)
              const isDoc = item.tipo === "documento"
              return (
                <li
                  key={i}
                  className="text-[11px] text-ink leading-tight flex items-start gap-1.5"
                >
                  {isDoc ? (
                    <AlertTriangle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                  ) : (
                    <Check className="h-3 w-3 text-success shrink-0 mt-0.5" />
                  )}
                  <span>{item.texto}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Footer: prazo de aprovação interna */}
      <footer className="px-3 py-2 border-t border-border/30 bg-surface-2/40">
        <p className="text-[10px] text-ink-muted">
          Aprovação interna:{" "}
          <span className="font-bold tabular-nums text-ink">
            {cenario?.prazo_aprovacao_dias ?? "—"}{" "}
            {cenario?.prazo_aprovacao_dias === 1 ? "dia" : "dias"}
          </span>
        </p>
      </footer>
    </article>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBRL(v: number): string {
  if (typeof v !== "number" || !isFinite(v)) return "—"
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  })
}

function normalizarRequisito(req: RequisitoEntry): RequisitoItem {
  if (typeof req === "string") {
    // heurística leve: se a string menciona doc/ATA/aval/certidão, marca como "documento"
    const lower = req.toLowerCase()
    const exigeDoc =
      lower.includes("ata") ||
      lower.includes("aval") ||
      lower.includes("certidão") ||
      lower.includes("certidao") ||
      lower.includes("contrato social") ||
      lower.includes("procuração") ||
      lower.includes("procuracao") ||
      lower.includes("documento") ||
      lower.includes("comprovante")
    return { texto: req, tipo: exigeDoc ? "documento" : "simples" }
  }
  return { texto: req.texto, tipo: req.tipo ?? "simples" }
}

function obterCondicaoExtra(
  key: CenarioKey,
  cenario: CenarioAVista | CenarioPrazoPadrao | CenarioPrazoEstendido,
): string | null {
  if (!cenario) return null
  if (key === "a_vista") {
    const c = cenario as CenarioAVista
    if ((c.desconto_pct ?? 0) > 0) {
      return `Desconto de ${c.desconto_pct}% sobre o valor de tabela`
    }
    return null
  }
  if (key === "prazo_padrao") {
    return (cenario as CenarioPrazoPadrao).condicao || null
  }
  if (key === "prazo_estendido") {
    return (cenario as CenarioPrazoEstendido).condicao || null
  }
  return null
}
