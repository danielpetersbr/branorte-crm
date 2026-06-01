// Componente que renderiza o dossiê do Detetive Branorte.
//
// Recebe um objeto DossieDetetive já processado pelo backend
// (estrutura DossieResultado + dados das fontes consultadas) e
// renderiza em layout consistente com os outros cards do DD.
//
// Suporta impressão A4 via className "dd-printable" no container raiz.
//
// LAYOUT REORGANIZADO (2026-06):
// - TOPO destaque: Semáforo + Score | Card "Limite Sugerido"
// - SUB-SCORES por dimensão (financeiro, compliance, digital, jurídico)
// - SINAIS POSITIVOS x ALERTAS lado a lado (balança visual)
// - PLANO DE VENDA (3 cenários A/B/C via PlanoVendaCard)
// - Demais seções (pegada digital, sanções, notícias, ações, fontes) na ZONA DETALHE
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Instagram,
  Linkedin,
  Lock,
  MapPin,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Star,
  ThumbsUp,
  Wallet,
  XCircle,
} from 'lucide-react'

import { PlanoVendaCard, type PlanoVendaCardProps } from './PlanoVendaCard'

// ============================================================================
// Tipos
// ============================================================================

export interface DossieDetetive {
  cnpj: string
  alvo: {
    razao_social: string | null
    nome_fantasia?: string | null
    idade_meses: number | null
    capital_social: number | null
    situacao: string | null
  }
  score: number
  semaforo: 'verde' | 'amarelo' | 'vermelho'
  recomendacao: string
  red_flags: Array<{ id: number; peso: number; nome: string; descricao: string }>
  pegada_digital?: {
    site?: { existe: boolean; url?: string }
    linkedin?: { existe: boolean; url?: string }
    reclame_aqui?: { rating?: number; total?: number; resolucao_pct?: number }
    google_maps_url?: string
    instagram?: {
      perfil_encontrado: boolean
      handle?: string | null
      url?: string | null
      bio?: string | null
      categoria?: string | null
      seguidores?: number
      total_posts?: number
      data_ultimo_post?: string | null
      privado?: boolean
      verificado?: boolean
    }
  }
  sancoes?: {
    ceis: number
    cnep: number
    acordos_leniencia: number
    cepim: number
  }
  noticias?: {
    total: number
    alertas: Array<{ titulo: string; link: string; data?: string; fonte: string }>
  }
  acoes_sugeridas: string[]
  fontes_consultadas: string[]
  investigado_em: string
  cache_valido_ate: string
  // ── Campos novos (opcionais — fallback gracioso quando ausentes) ────────────
  sub_scores?: {
    financeiro: number
    compliance: number
    comportamento_digital: number
    juridico: number
  }
  limite_sugerido_brl?: number
  condicao_recomendada?:
    | 'vista'
    | 'prazo_curto'
    | 'prazo_padrao'
    | 'prazo_longo_com_aval'
    | 'nao_vender'
  cenarios?: PlanoVendaCardProps['cenarios']
}

interface Props {
  dossie: DossieDetetive
  onReinvestigar?: () => void
}

// ============================================================================
// Helpers
// ============================================================================

function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function formatBRL(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatIdade(meses: number | null): string {
  if (meses == null) return '—'
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`
  const anos = Math.floor(meses / 12)
  const restoMeses = meses % 12
  if (restoMeses === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`
  return `${anos}a ${restoMeses}m`
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatNumberCompact(value: number): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return String(value)
  }
}

function monthsSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return null
    const now = Date.now()
    const diffMs = now - then
    if (diffMs < 0) return 0
    const monthMs = 1000 * 60 * 60 * 24 * 30
    return Math.floor(diffMs / monthMs)
  } catch {
    return null
  }
}

// Mapeia condicao_recomendada (scoring) → CenarioKey (PlanoVendaCard)
function mapCondicaoToCenarioKey(
  c: DossieDetetive['condicao_recomendada'],
): PlanoVendaCardProps['recomendado'] {
  switch (c) {
    case 'vista':
      return 'a_vista'
    case 'prazo_curto':
    case 'prazo_padrao':
      return 'prazo_padrao'
    case 'prazo_longo_com_aval':
      return 'prazo_estendido'
    case 'nao_vender':
    default:
      return 'a_vista'
  }
}

// Tradução humana da condição recomendada (texto curto pro card de Limite)
function descCondicaoRecomendada(c: DossieDetetive['condicao_recomendada']): string {
  switch (c) {
    case 'vista':
      return 'À vista (antes da expedição)'
    case 'prazo_curto':
      return '28 / 56 / 84 com sinal 30%'
    case 'prazo_padrao':
      return '28 / 56 / 84 (prazo padrão Branorte)'
    case 'prazo_longo_com_aval':
      return 'Prazo estendido COM aval/carta-fiança'
    case 'nao_vender':
      return 'NÃO RECOMENDADO'
    default:
      return '—'
  }
}

// Deriva sinais positivos a partir do dossiê (lado verde da balança)
// Olha pra empresa antiga, capital alto, situação ATIVA, zero processos,
// IG ativo, sanções limpas, RA bom — tudo que NÃO é red flag.
export function derivarSinaisPositivos(dossie: DossieDetetive): string[] {
  const sinais: string[] = []

  // Idade da empresa
  if (dossie.alvo.idade_meses != null) {
    const anos = Math.floor(dossie.alvo.idade_meses / 12)
    if (anos >= 10) {
      sinais.push(`Empresa com ${anos} anos de mercado`)
    } else if (anos >= 5) {
      sinais.push(`${anos} anos de mercado (consolidada)`)
    } else if (anos >= 2) {
      sinais.push(`${anos} anos de mercado`)
    }
  }

  // Capital social
  if (dossie.alvo.capital_social != null) {
    if (dossie.alvo.capital_social >= 1_000_000) {
      sinais.push(`Capital social ${formatBRL(dossie.alvo.capital_social)}`)
    } else if (dossie.alvo.capital_social >= 100_000) {
      sinais.push(`Capital social ${formatBRL(dossie.alvo.capital_social)}`)
    }
  }

  // Situação cadastral
  const situacao = dossie.alvo.situacao?.toUpperCase() ?? ''
  if (situacao === 'ATIVA') {
    sinais.push('Situação cadastral ATIVA')
  }

  // Sanções limpas
  if (dossie.sancoes) {
    const total =
      dossie.sancoes.ceis +
      dossie.sancoes.cnep +
      dossie.sancoes.acordos_leniencia +
      dossie.sancoes.cepim
    if (total === 0) sinais.push('Sem sanções CGU (CEIS · CNEP · Leniência · CEPIM)')
  }

  // Notícias sem alerta
  if (dossie.noticias && dossie.noticias.alertas.length === 0) {
    sinais.push('Sem notícias negativas')
  }

  // Pegada digital
  const pd = dossie.pegada_digital
  if (pd?.site?.existe) sinais.push('Site institucional ativo')
  if (pd?.linkedin?.existe) sinais.push('Presença no LinkedIn')
  if (pd?.instagram?.perfil_encontrado) {
    const meses = monthsSince(pd.instagram.data_ultimo_post)
    if (meses != null && meses <= 6) sinais.push('Instagram ativo (posts recentes)')
    else if (pd.instagram.perfil_encontrado) sinais.push('Instagram localizado')
  }
  if (pd?.reclame_aqui?.rating != null && pd.reclame_aqui.rating >= 7) {
    sinais.push(`Reclame Aqui ${pd.reclame_aqui.rating.toFixed(1)}/10`)
  }
  if (pd?.reclame_aqui?.resolucao_pct != null && pd.reclame_aqui.resolucao_pct >= 80) {
    sinais.push(`${pd.reclame_aqui.resolucao_pct}% de resolução no RA`)
  }

  // Score alto
  if (dossie.score >= 80) sinais.push(`Score Detetive ${dossie.score}/100`)

  return sinais
}

// ============================================================================
// Configuração do semáforo
// ============================================================================

const SEMAFORO_CONFIG = {
  verde: {
    bg: 'bg-success/15',
    border: 'border-success/40',
    text: 'text-success',
    icon: ShieldCheck,
    label: 'BAIXO RISCO',
  },
  amarelo: {
    bg: 'bg-warning/15',
    border: 'border-warning/40',
    text: 'text-warning',
    icon: ShieldAlert,
    label: 'ATENÇÃO',
  },
  vermelho: {
    bg: 'bg-danger/15',
    border: 'border-danger/40',
    text: 'text-danger',
    icon: AlertTriangle,
    label: 'ALTO RISCO',
  },
} as const

const SITUACAO_BADGE: Record<string, string> = {
  ATIVA: 'bg-success/20 text-success border-success/30',
  INAPTA: 'bg-warning/20 text-warning border-warning/30',
  SUSPENSA: 'bg-warning/20 text-warning border-warning/30',
  BAIXADA: 'bg-danger/20 text-danger border-danger/30',
  NULA: 'bg-danger/20 text-danger border-danger/30',
}

// ============================================================================
// Componente principal
// ============================================================================

export function DossieDetetiveCard({ dossie, onReinvestigar }: Props) {
  // Defensive: se dossie.semaforo for valor inesperado, cai pro amarelo (atenção).
  // O guard no DueDiligenceButton já protege contra dossie vazio, mas o tipo
  // 'verde'|'amarelo'|'vermelho' pode vir como qualquer string em runtime.
  const semaforoCfg = SEMAFORO_CONFIG[dossie?.semaforo] ?? SEMAFORO_CONFIG.amarelo
  const SemaforoIcon = semaforoCfg.icon

  const situacao = dossie?.alvo?.situacao?.toUpperCase() ?? ''
  const situacaoClass = SITUACAO_BADGE[situacao] ?? 'bg-surface-2 text-ink-muted border-border'

  const nomeExibicao =
    dossie?.alvo?.nome_fantasia?.trim() || dossie?.alvo?.razao_social?.trim() || 'Empresa sem nome'

  const sinaisPositivos = derivarSinaisPositivos(dossie)
  // GUARD profundo: só considera "temCenarios" se o shape completo está presente.
  // Backend (dd-consultar.ts) às vezes manda Cenario[] (array do scoring) em vez
  // do objeto {a_vista, prazo_padrao, prazo_estendido} esperado pelo PlanoVendaCard.
  // Sem esse guard, o card renderiza e quebra em `cenarios.prazo_estendido.viavel`.
  const cenariosObj = dossie.cenarios as PlanoVendaCardProps['cenarios'] | undefined | unknown[]
  const temCenarios =
    !!cenariosObj &&
    typeof cenariosObj === 'object' &&
    !Array.isArray(cenariosObj) &&
    !!(cenariosObj as PlanoVendaCardProps['cenarios']).a_vista &&
    !!(cenariosObj as PlanoVendaCardProps['cenarios']).prazo_padrao &&
    !!(cenariosObj as PlanoVendaCardProps['cenarios']).prazo_estendido
  const temLimite = typeof dossie.limite_sugerido_brl === 'number' && dossie.limite_sugerido_brl > 0
  const temSubScores = !!dossie.sub_scores

  return (
    <div className="dd-printable border border-border rounded-lg bg-surface-2/20 overflow-hidden">
      {/* ====== HEADER ====== */}
      <div className="px-4 py-3 border-b border-border/40 bg-surface-2/40">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-accent shrink-0" />
              <h2 className="text-[15px] font-bold text-ink truncate">{nomeExibicao}</h2>
            </div>
            {dossie.alvo.nome_fantasia && dossie.alvo.razao_social && (
              <p className="text-[11px] text-ink-faint truncate">{dossie.alvo.razao_social}</p>
            )}
            <p className="text-[11px] font-mono text-ink-muted mt-1">{formatCnpj(dossie.cnpj)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {situacao && (
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${situacaoClass}`}
              >
                {situacao}
              </span>
            )}
          </div>
        </div>

        {/* Métricas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/30">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">Idade</p>
            <p className="text-[12px] font-semibold text-ink tabular-nums">
              {formatIdade(dossie.alvo.idade_meses)}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">
              Capital Social
            </p>
            <p className="text-[12px] font-semibold text-ink tabular-nums">
              {formatBRL(dossie.alvo.capital_social)}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">
              Investigado em
            </p>
            <p className="text-[12px] font-semibold text-ink tabular-nums">
              {formatDateTime(dossie.investigado_em)}
            </p>
          </div>
        </div>
      </div>

      {/* ====== TOPO DESTAQUE: SEMÁFORO + SCORE | LIMITE SUGERIDO ====== */}
      <div className={`border-b border-border/40 ${semaforoCfg.bg}`}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
          {/* Coluna A (larga): Semáforo + Score + Recomendação */}
          <div className="lg:col-span-2 px-4 py-4 border-b lg:border-b-0 lg:border-r border-border/40">
            <div className="flex items-center gap-4 flex-wrap">
              <div
                className={`flex items-center justify-center h-16 w-16 rounded-full border-2 ${semaforoCfg.border} shrink-0 bg-bg/40`}
              >
                <SemaforoIcon className={`h-8 w-8 ${semaforoCfg.text}`} />
              </div>

              <div className="flex-1 min-w-[180px]">
                <p
                  className={`text-[10px] uppercase tracking-wider font-bold ${semaforoCfg.text} mb-1`}
                >
                  {semaforoCfg.label}
                </p>
                <p className="text-[13px] text-ink leading-snug">{dossie.recomendacao}</p>
              </div>

              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">Score</p>
                <p className={`text-5xl font-bold tabular-nums leading-none ${semaforoCfg.text}`}>
                  {dossie.score}
                </p>
                <p className="text-[10px] text-ink-faint mt-0.5">/ 100</p>
              </div>
            </div>
          </div>

          {/* Coluna B (estreita): Limite Sugerido em destaque */}
          <div className="px-4 py-4 bg-bg/30 flex flex-col justify-center">
            <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-1 flex items-center gap-1.5">
              <Wallet className="h-3 w-3" />
              Limite Sugerido
            </p>
            {temLimite ? (
              <>
                <p className="text-4xl lg:text-5xl font-mono font-bold tabular-nums text-accent leading-none">
                  {formatBRL(dossie.limite_sugerido_brl)}
                </p>
                <p
                  className="text-[10px] text-ink-muted mt-2 leading-snug"
                  title="min(faturamento × 0.10 × 12, capital × 1.5, cotação)"
                >
                  Condição:{' '}
                  <span className="font-semibold text-ink">
                    {descCondicaoRecomendada(dossie.condicao_recomendada)}
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold tabular-nums text-ink-faint leading-none">—</p>
                <p className="text-[10px] text-ink-faint mt-2 italic">
                  Limite não calculado nessa consulta
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ====== SUB-SCORES POR DIMENSÃO ====== */}
      {temSubScores && dossie.sub_scores && (
        <div className="px-4 py-3 border-b border-border/40">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-ink-muted mb-3">
            Sub-Scores por Dimensão
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SubScoreItem label="Financeiro" valor={dossie.sub_scores.financeiro} />
            <SubScoreItem label="Compliance" valor={dossie.sub_scores.compliance} />
            <SubScoreItem
              label="Comp. Digital"
              valor={dossie.sub_scores.comportamento_digital}
            />
            <SubScoreItem label="Jurídico" valor={dossie.sub_scores.juridico} />
          </div>
        </div>
      )}

      {/* ====== POR QUE CONFIAR x POR QUE DESCONFIAR (balança) ====== */}
      <div className="px-4 py-3 border-b border-border/40 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Esquerda: Sinais positivos */}
        <div className="bg-success/10 border-l-2 border-success rounded-r px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            <ThumbsUp className="h-3.5 w-3.5 text-success" />
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-success">
              Por que confiar
            </h3>
            <span className="ml-auto text-[10px] font-mono tabular-nums text-success">
              {sinaisPositivos.length}{' '}
              {sinaisPositivos.length === 1 ? 'sinal' : 'sinais'}
            </span>
          </div>
          {sinaisPositivos.length > 0 ? (
            <ul className="space-y-1">
              {sinaisPositivos.map((sinal, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-1.5 text-[11px] text-ink leading-snug"
                >
                  <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                  <span>{sinal}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-faint italic">Nenhum sinal positivo identificado</p>
          )}
        </div>

        {/* Direita: Red flags */}
        <div className="bg-danger/10 border-r-2 border-danger rounded-l px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-danger" />
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-danger">
              Por que desconfiar
            </h3>
            <span className="ml-auto text-[10px] font-mono tabular-nums text-danger">
              {(dossie.red_flags ?? []).length}{' '}
              {(dossie.red_flags ?? []).length === 1 ? 'alerta' : 'alertas'}
            </span>
          </div>
          {(dossie.red_flags ?? []).length > 0 ? (
            <ul className="space-y-1.5">
              {(dossie.red_flags ?? []).map((flag) => (
                <li
                  key={flag.id}
                  className="flex items-start gap-2 p-1.5 rounded bg-danger/10 border border-danger/20"
                >
                  <span className="text-[9px] font-mono font-bold text-danger bg-danger/20 px-1.5 py-0.5 rounded shrink-0 tabular-nums">
                    -{flag.peso}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-ink leading-tight">{flag.nome}</p>
                    <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
                      {flag.descricao}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-faint italic">Nenhum red flag detectado</p>
          )}
        </div>
      </div>

      {/* ====== PLANO DE VENDA (3 CENÁRIOS) ====== */}
      {/* Só renderiza se cenários tem o shape completo (verificado em temCenarios) */}
      {temCenarios && dossie.cenarios && (
        <div className="border-b border-border/40">
          <PlanoVendaCard
            cenarios={dossie.cenarios as PlanoVendaCardProps['cenarios']}
            recomendado={mapCondicaoToCenarioKey(dossie.condicao_recomendada)}
          />
        </div>
      )}

      {/* ====== PEGADA DIGITAL ====== */}
      {dossie.pegada_digital && (
        <div className="px-4 py-3 border-b border-border/40">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-ink-muted mb-2">
            Pegada Digital
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Site */}
            <PegadaItem
              icon={Globe}
              label="Site"
              existe={dossie.pegada_digital.site?.existe}
              url={dossie.pegada_digital.site?.url}
            />
            {/* LinkedIn */}
            <PegadaItem
              icon={Linkedin}
              label="LinkedIn"
              existe={dossie.pegada_digital.linkedin?.existe}
              url={dossie.pegada_digital.linkedin?.url}
            />
            {/* Instagram */}
            <InstagramItem instagram={dossie.pegada_digital.instagram} />
            {/* Reclame Aqui */}
            {dossie.pegada_digital.reclame_aqui && (
              <div className="flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40">
                <Star className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-ink">Reclame Aqui</p>
                  <p className="text-[10px] text-ink-muted tabular-nums">
                    {dossie.pegada_digital.reclame_aqui.rating != null
                      ? `Rating ${dossie.pegada_digital.reclame_aqui.rating.toFixed(1)}/10`
                      : 'Sem rating'}
                    {dossie.pegada_digital.reclame_aqui.total != null && (
                      <> · {dossie.pegada_digital.reclame_aqui.total} reclamações</>
                    )}
                    {dossie.pegada_digital.reclame_aqui.resolucao_pct != null && (
                      <> · {dossie.pegada_digital.reclame_aqui.resolucao_pct}% resolvido</>
                    )}
                  </p>
                </div>
              </div>
            )}
            {/* Google Maps / Street View */}
            {dossie.pegada_digital.google_maps_url && (
              <a
                href={dossie.pegada_digital.google_maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="dd-no-print flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40 hover:border-accent transition-colors group"
              >
                <MapPin className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-ink group-hover:text-accent">
                    Street View
                  </p>
                  <p className="text-[10px] text-ink-muted">Ver endereço no Google Maps</p>
                </div>
                <ExternalLink className="h-3 w-3 text-ink-faint shrink-0 mt-0.5" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* ====== SANÇÕES OFICIAIS ====== */}
      {dossie.sancoes && (
        <div className="px-4 py-3 border-b border-border/40">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-ink-muted mb-2">
            Sanções Oficiais
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SancaoItem label="CEIS" count={dossie.sancoes.ceis} />
            <SancaoItem label="CNEP" count={dossie.sancoes.cnep} />
            <SancaoItem label="Leniência" count={dossie.sancoes.acordos_leniencia} />
            <SancaoItem label="CEPIM" count={dossie.sancoes.cepim} />
          </div>
        </div>
      )}

      {/* ====== NOTÍCIAS COM ALERTA ====== */}
      {dossie.noticias && dossie.noticias.alertas.length > 0 && (
        <div className="px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <Newspaper className="h-4 w-4 text-warning" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-warning">
              Notícias com Alerta ({dossie.noticias.total})
            </h3>
          </div>
          <ul className="space-y-1.5">
            {dossie.noticias.alertas.slice(0, 3).map((noticia, idx) => (
              <li
                key={idx}
                className="p-2 rounded bg-warning/10 border border-warning/20"
              >
                <a
                  href={noticia.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-no-print flex items-start gap-2 group"
                >
                  <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-ink group-hover:text-accent leading-snug">
                      {noticia.titulo}
                    </p>
                    <p className="text-[10px] text-ink-faint mt-0.5 tabular-nums">
                      {noticia.fonte}
                      {noticia.data && <> · {formatDate(noticia.data)}</>}
                    </p>
                  </div>
                  <ExternalLink className="h-3 w-3 text-ink-faint shrink-0 mt-0.5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ====== CHECKLIST DO QUE PEDIR (ex Ações Sugeridas) ====== */}
      {(dossie.acoes_sugeridas ?? []).length > 0 && (
        <div className="px-4 py-3 border-b border-border/40 bg-accent/5">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-accent mb-2">
            Checklist do que pedir
          </h3>
          <ol className="space-y-1.5">
            {(dossie.acoes_sugeridas ?? []).map((acao, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-[11px] font-bold text-accent bg-accent/15 rounded-full h-5 w-5 flex items-center justify-center shrink-0 tabular-nums">
                  {idx + 1}
                </span>
                <p className="text-[12px] text-ink leading-snug pt-0.5">{acao}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ====== FONTES CONSULTADAS ====== */}
      {(dossie.fontes_consultadas ?? []).length > 0 && (
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-1.5">
            Fontes Consultadas
          </p>
          <div className="flex flex-wrap gap-1">
            {(dossie.fontes_consultadas ?? []).map((fonte) => (
              <span
                key={fonte}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2/60 border border-border/40 text-ink-muted"
              >
                {fonte}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ====== RODAPÉ: CACHE + REINVESTIGAR ====== */}
      <div className="px-4 py-2.5 bg-surface-2/30 flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] text-ink-faint">
          Cache válido até{' '}
          <span className="font-mono text-ink-muted">{formatDateTime(dossie.cache_valido_ate)}</span>
        </p>
        {onReinvestigar && (
          <button
            type="button"
            onClick={onReinvestigar}
            className="dd-no-print text-[10px] font-semibold text-ink-muted hover:text-accent flex items-center gap-1 px-2 py-1 rounded border border-border bg-surface-2 hover:border-accent transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Reinvestigar
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Subcomponentes
// ============================================================================

interface SubScoreItemProps {
  label: string
  valor: number
}

function SubScoreItem({ label, valor }: SubScoreItemProps) {
  // 0-30 vermelho, 31-60 amarelo, 61-100 verde
  const v = Math.max(0, Math.min(100, Math.round(valor)))
  const cor =
    v <= 30
      ? { bg: 'bg-danger', text: 'text-danger', track: 'bg-danger/20' }
      : v <= 60
        ? { bg: 'bg-warning', text: 'text-warning', track: 'bg-warning/20' }
        : { bg: 'bg-success', text: 'text-success', track: 'bg-success/20' }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-muted">
          {label}
        </span>
        <span className={`text-[13px] font-bold tabular-nums ${cor.text}`}>{v}</span>
      </div>
      <div className={`h-1.5 w-full rounded-full overflow-hidden ${cor.track}`}>
        <div
          className={`h-full ${cor.bg} transition-all`}
          style={{ width: `${v}%` }}
          aria-hidden
        />
      </div>
    </div>
  )
}

interface PegadaItemProps {
  icon: typeof Globe
  label: string
  existe?: boolean
  url?: string
}

function PegadaItem({ icon: Icon, label, existe, url }: PegadaItemProps) {
  const Wrapper = url ? 'a' : 'div'
  const wrapperProps = url
    ? {
        href: url,
        target: '_blank' as const,
        rel: 'noopener noreferrer',
        className:
          'dd-no-print flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40 hover:border-accent transition-colors group',
      }
    : {
        className:
          'flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40',
      }

  return (
    <Wrapper {...wrapperProps}>
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${existe ? 'text-success' : 'text-ink-faint'}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold ${url ? 'text-ink group-hover:text-accent' : 'text-ink'}`}>
          {label}
        </p>
        <p className="text-[10px] text-ink-muted truncate">
          {existe ? (url ? 'Ver online' : 'Encontrado') : 'Não encontrado'}
        </p>
      </div>
      {url && <ExternalLink className="h-3 w-3 text-ink-faint shrink-0 mt-0.5" />}
    </Wrapper>
  )
}

interface InstagramItemProps {
  instagram?: DossieDetetive['pegada_digital'] extends infer P
    ? P extends { instagram?: infer I }
      ? I
      : never
    : never
}

function InstagramItem({ instagram }: InstagramItemProps) {
  // Não localizado
  if (!instagram || !instagram.perfil_encontrado) {
    return (
      <div className="flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40">
        <Instagram className="h-3.5 w-3.5 shrink-0 mt-0.5 text-ink-faint" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-ink">Instagram</p>
          <p className="text-[10px] text-ink-faint truncate">não localizado</p>
        </div>
      </div>
    )
  }

  const {
    handle,
    url,
    bio,
    categoria,
    seguidores,
    total_posts,
    data_ultimo_post,
    privado,
    verificado,
  } = instagram

  const mesesInativo = monthsSince(data_ultimo_post)
  const inativo = mesesInativo != null && mesesInativo > 6

  const hasMetrics = typeof seguidores === 'number' || typeof total_posts === 'number'

  const Wrapper = url ? 'a' : 'div'
  const wrapperProps = url
    ? {
        href: url,
        target: '_blank' as const,
        rel: 'noopener noreferrer',
        className:
          'dd-no-print flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40 hover:border-accent transition-colors group',
      }
    : {
        className:
          'flex items-start gap-2 p-2 rounded bg-surface-2/40 border border-border/40',
      }

  return (
    <Wrapper {...wrapperProps}>
      <Instagram className="h-3.5 w-3.5 shrink-0 mt-0.5 text-success" />
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11px] font-semibold flex items-center gap-1 flex-wrap ${
            url ? 'text-ink group-hover:text-accent' : 'text-ink'
          }`}
        >
          <span className="truncate">
            Instagram{handle ? `: @${handle}` : ''}
          </span>
          {verificado && (
            <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-success/20 text-success border border-success/30">
              ✓ verificado
            </span>
          )}
          {privado && (
            <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-warning/20 text-warning border border-warning/30 inline-flex items-center gap-0.5">
              <Lock className="h-2.5 w-2.5" /> privado
            </span>
          )}
          {inativo && (
            <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-warning/20 text-warning border border-warning/30">
              ⚠️ inativo há {mesesInativo} {mesesInativo === 1 ? 'mês' : 'meses'}
            </span>
          )}
        </p>
        {hasMetrics && (
          <p className="text-[10px] text-ink-muted tabular-nums truncate">
            {typeof seguidores === 'number' && (
              <>{formatNumberCompact(seguidores)} seguidores</>
            )}
            {typeof seguidores === 'number' && typeof total_posts === 'number' && (
              <> · </>
            )}
            {typeof total_posts === 'number' && (
              <>{formatNumberCompact(total_posts)} posts</>
            )}
          </p>
        )}
        {categoria && (
          <p className="text-[10px] text-ink-muted truncate">{categoria}</p>
        )}
        {bio && (
          <p className="text-[10px] text-ink-faint italic truncate">{bio}</p>
        )}
        {privado && (
          <p className="text-[10px] text-ink-faint italic">
            não foi possível analisar conteúdo
          </p>
        )}
      </div>
      {url && <ExternalLink className="h-3 w-3 text-ink-faint shrink-0 mt-0.5" />}
    </Wrapper>
  )
}

interface SancaoItemProps {
  label: string
  count: number
}

function SancaoItem({ label, count }: SancaoItemProps) {
  const ok = count === 0
  return (
    <div
      className={`flex items-center gap-2 p-2 rounded border ${
        ok
          ? 'bg-success/10 border-success/20'
          : 'bg-danger/10 border-danger/30'
      }`}
    >
      {ok ? (
        <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
        <p
          className={`text-[12px] font-bold tabular-nums ${
            ok ? 'text-success' : 'text-danger'
          }`}
        >
          {ok ? 'Limpo' : `${count} registro${count > 1 ? 's' : ''}`}
        </p>
      </div>
    </div>
  )
}
