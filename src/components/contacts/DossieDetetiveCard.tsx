// Componente que renderiza o dossiê do Detetive Branorte.
//
// Recebe um objeto DossieDetetive já processado pelo backend
// (estrutura DossieResultado + dados das fontes consultadas) e
// renderiza em layout consistente com os outros cards do DD.
//
// Suporta impressão A4 via className "dd-printable" no container raiz.
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle,
  ExternalLink,
  Globe,
  Linkedin,
  MapPin,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Star,
  XCircle,
} from 'lucide-react'

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

function formatBRL(value: number | null): string {
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
  const semaforoCfg = SEMAFORO_CONFIG[dossie.semaforo]
  const SemaforoIcon = semaforoCfg.icon

  const situacao = dossie.alvo.situacao?.toUpperCase() ?? ''
  const situacaoClass = SITUACAO_BADGE[situacao] ?? 'bg-surface-2 text-ink-muted border-border'

  const nomeExibicao =
    dossie.alvo.nome_fantasia?.trim() || dossie.alvo.razao_social?.trim() || 'Empresa sem nome'

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

      {/* ====== SEMÁFORO + SCORE ====== */}
      <div className={`px-4 py-4 border-b border-border/40 ${semaforoCfg.bg}`}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className={`flex items-center justify-center h-16 w-16 rounded-full border-2 ${semaforoCfg.border} shrink-0`}>
            <SemaforoIcon className={`h-8 w-8 ${semaforoCfg.text}`} />
          </div>

          <div className="flex-1 min-w-[180px]">
            <p className={`text-[10px] uppercase tracking-wider font-bold ${semaforoCfg.text} mb-1`}>
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

      {/* ====== RED FLAGS ====== */}
      {dossie.red_flags.length > 0 && (
        <div className="px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-danger">
              Red Flags Detectados ({dossie.red_flags.length})
            </h3>
          </div>
          <ul className="space-y-1.5">
            {dossie.red_flags.map((flag) => (
              <li
                key={flag.id}
                className="flex items-start gap-2 p-2 rounded bg-danger/10 border border-danger/20"
              >
                <span className="text-[10px] font-mono font-bold text-danger bg-danger/20 px-1.5 py-0.5 rounded shrink-0 tabular-nums">
                  -{flag.peso}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-ink">{flag.nome}</p>
                  <p className="text-[11px] text-ink-muted italic mt-0.5">{flag.descricao}</p>
                </div>
              </li>
            ))}
          </ul>
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

      {/* ====== AÇÕES SUGERIDAS ====== */}
      {dossie.acoes_sugeridas.length > 0 && (
        <div className="px-4 py-3 border-b border-border/40 bg-accent/5">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-accent mb-2">
            Ações Sugeridas
          </h3>
          <ol className="space-y-1.5">
            {dossie.acoes_sugeridas.map((acao, idx) => (
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
      {dossie.fontes_consultadas.length > 0 && (
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-1.5">
            Fontes Consultadas
          </p>
          <div className="flex flex-wrap gap-1">
            {dossie.fontes_consultadas.map((fonte) => (
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
