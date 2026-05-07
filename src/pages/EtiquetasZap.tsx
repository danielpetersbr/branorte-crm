import { useMemo, useState } from 'react'
import { Search, Tag, RefreshCw, Users, Handshake } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Input } from '@/components/ui/Input'
import { formatNumber } from '@/lib/utils'
import { useEtiquetas, groupEtiquetasByVendedor, type WascriptEtiqueta } from '@/hooks/useEtiquetas'
import { classificarEtiquetas, CATEGORIA_META } from '@/lib/etiquetas-classify'

// Vendedores esperados na integração Wascript. Mostra card mesmo sem etiquetas.
const VENDEDORES_ESPERADOS = ['EDILSON JR', 'PEDRO', 'JARDEL', 'EDER', 'ALVARO', 'RAMON', 'GUSTAVO']

// Ordem oficial do funil de vendas Branorte. Etiquetas fora dessa lista vão no final.
const ORDEM_FUNIL: string[] = [
  // FUNIL DE VENDAS
  'PROSPECCAO',
  '2A TENTATIVA',
  'NOVO LEAD',
  'FOLLOW UP',
  'INTERESSE FUTURO',
  'VENDIDO',
  // MOTIVO DE FECHAMENTO
  'NAO RESPONDEU MAIS',
  'NUNCA RESPONDEU',
  'NAO TEM INTERESSE',
  'COMPROU DO CONCORRENTE',
  'SO BASE DE PRECO',
  'FORA DO ORCAMENTO',
  'NAO FABRICAMOS',
  'OUTROS ASSUNTOS',
  // EXTRAS
  'ORCAMENTO ENVIADO',
  'LEAD QUENTE',
]

// Aliases conhecidos pra mapear typos/variantes ao nome canônico
const ALIASES: Record<string, string> = {
  'FALLOW UP': 'FOLLOW UP',
  'FALLOWUP': 'FOLLOW UP',
  'FOLLOWUP': 'FOLLOW UP',
  'COMPROU DO COMCORRENTE': 'COMPROU DO CONCORRENTE',
  'PROSPECCOES': 'PROSPECCAO',
  'PROSPECCAO ': 'PROSPECCAO',
  'NOVOS LEADS': 'NOVO LEAD',
  'LEAD NOVO': 'NOVO LEAD',
  'VENDIDOS': 'VENDIDO',
  'RESOLVIDOS': 'RESOLVIDO',
}

function ordemDe(etiqueta: { etiqueta_nome_normalizado: string }): number {
  const nome = ALIASES[etiqueta.etiqueta_nome_normalizado] ?? etiqueta.etiqueta_nome_normalizado
  const idx = ORDEM_FUNIL.indexOf(nome)
  return idx === -1 ? 999 : idx  // não-canônicas vão pro final
}

// Corrige typos visualmente sem alterar dado salvo
function nomeExibicao(etiqueta: { etiqueta_nome: string; etiqueta_nome_normalizado: string }): string {
  return ALIASES[etiqueta.etiqueta_nome_normalizado] ?? etiqueta.etiqueta_nome
}

function fmtSyncedAt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  const diffD = Math.round(diffH / 24)
  return `há ${diffD}d`
}

interface DashboardProps {
  data: WascriptEtiqueta[] | undefined
}

// Variantes de cada etapa após normalização (UPPER + sem acento + trim)
const FOLLOW_UP_NOMES = new Set(['FOLLOW UP', 'FOLLOWUP', 'FALLOW UP', 'FOLLOW-UP'])
const NOVO_LEAD_NOMES = new Set(['NOVO LEAD', 'NOVOS LEADS', 'LEAD NOVO'])
const PROSPECCAO_NOMES = new Set(['PROSPECCAO', 'PROSPECCOES'])
const SEGUNDA_TENTATIVA_NOMES = new Set(['2A TENTATIVA', '2 TENTATIVA', '2ª TENTATIVA'])
const INTERESSE_FUTURO_NOMES = new Set(['INTERESSE FUTURO', 'INTERESSE FUTURA'])

interface FunilStage {
  label: string
  emoji: string
  total: number
  porVendedor: { vendedor: string; count: number }[]
  colorClass: string
  textClass: string
}

function calcularFunil(data: WascriptEtiqueta[] | undefined): FunilStage[] {
  const items = data ?? []
  const sumBy = (predicate: (e: WascriptEtiqueta) => boolean) => {
    const porVendedor = new Map<string, number>()
    let total = 0
    for (const e of items) {
      if (!predicate(e)) continue
      total += e.total_contatos
      porVendedor.set(e.vendedor_nome, (porVendedor.get(e.vendedor_nome) ?? 0) + e.total_contatos)
    }
    return {
      total,
      porVendedor: Array.from(porVendedor.entries())
        .map(([vendedor, count]) => ({ vendedor, count }))
        .sort((a, b) => b.count - a.count),
    }
  }

  const prosp = sumBy(e => PROSPECCAO_NOMES.has(e.etiqueta_nome_normalizado))
  const tent2 = sumBy(e => SEGUNDA_TENTATIVA_NOMES.has(e.etiqueta_nome_normalizado))
  const novo  = sumBy(e => NOVO_LEAD_NOMES.has(e.etiqueta_nome_normalizado))
  const foll  = sumBy(e => FOLLOW_UP_NOMES.has(e.etiqueta_nome_normalizado))
  const futuro = sumBy(e => INTERESSE_FUTURO_NOMES.has(e.etiqueta_nome_normalizado))

  // Ordem oficial do funil de vendas Branorte
  return [
    { label: 'Prospecção',       emoji: '🎯', ...prosp,  colorClass: 'bg-info',     textClass: 'text-info' },
    { label: '2ª Tentativa',     emoji: '🔁', ...tent2,  colorClass: 'bg-cyan',     textClass: 'text-cyan' },
    { label: 'Novo Lead',        emoji: '🆕', ...novo,   colorClass: 'bg-warning',  textClass: 'text-warning' },
    { label: 'Follow Up',        emoji: '🤝', ...foll,   colorClass: 'bg-accent',   textClass: 'text-accent' },
    { label: 'Interesse Futuro', emoji: '💭', ...futuro, colorClass: 'bg-purple',   textClass: 'text-purple' },
  ]
}

// Mapping de classes -> hex (gradiente de duas tonalidades pra cada etapa)
const COLOR_GRAD: Record<string, { from: string; to: string; ring: string }> = {
  'bg-info':    { from: '#60a5fa', to: '#2563eb', ring: 'rgba(59,130,246,0.35)' },
  'bg-cyan':    { from: '#22d3ee', to: '#0891b2', ring: 'rgba(34,211,238,0.35)' },
  'bg-warning': { from: '#fbbf24', to: '#d97706', ring: 'rgba(245,158,11,0.35)' },
  'bg-accent':  { from: '#34d399', to: '#059669', ring: 'rgba(16,185,129,0.40)' },
  'bg-purple':  { from: '#a78bfa', to: '#7c3aed', ring: 'rgba(167,139,250,0.35)' },
}

function FunilStages({ data }: { data: WascriptEtiqueta[] | undefined }) {
  const stages = useMemo(() => calcularFunil(data), [data])
  const max = stages.reduce((m, s) => Math.max(m, s.total), 1)

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-ink uppercase tracking-wider">
          Funil de etiquetas
        </h3>
        <span className="text-[11px] text-ink-faint">
          {stages.map(s => s.label).join(' → ')}
        </span>
      </div>

      {/* Funil moderno: pills com gradiente + conectores */}
      <div className="space-y-2">
        {stages.map((stage, idx) => {
          const widthPct = Math.max(20, (stage.total / max) * 100)
          const grad = COLOR_GRAD[stage.colorClass] ?? COLOR_GRAD['bg-info']
          const prev = idx > 0 ? stages[idx - 1].total : null
          const conv = prev && prev > 0 ? (stage.total / prev) * 100 : null
          const isUp = conv !== null && conv > 100

          return (
            <div key={stage.label}>
              {/* Conector + badge de conversão entre etapas */}
              {conv !== null && (
                <div className="flex items-center justify-center -my-1 relative z-10">
                  <div
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums backdrop-blur-sm border ${
                      isUp
                        ? 'bg-success-bg/80 text-success border-success/30'
                        : 'bg-danger-bg/80 text-danger border-danger/30'
                    }`}
                  >
                    {isUp ? '↑' : '↓'} {conv.toFixed(1)}%
                  </div>
                </div>
              )}

              {/* Pill da etapa */}
              <div className="flex justify-center">
                <div
                  className="relative h-[72px] rounded-2xl overflow-hidden transition-all duration-500 ease-out"
                  style={{
                    width: `${widthPct}%`,
                    minWidth: '240px',
                    background: `linear-gradient(135deg, ${grad.from} 0%, ${grad.to} 100%)`,
                    boxShadow: `0 8px 24px -8px ${grad.ring}, inset 0 1px 0 rgba(255,255,255,0.2)`,
                  }}
                >
                  {/* Brilho sutil topo */}
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />

                  {/* Conteúdo */}
                  <div className="absolute inset-0 flex items-center justify-between px-5 text-white">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-[18px] shrink-0">
                        {stage.emoji}
                      </div>
                      <div className="leading-tight min-w-0">
                        <div className="text-[14px] font-semibold tracking-tight truncate">{stage.label}</div>
                        <div className="text-[10px] opacity-80 uppercase tracking-wider">
                          {stage.porVendedor.length} vendedor{stage.porVendedor.length === 1 ? '' : 'es'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className="text-[28px] font-bold tabular-nums leading-none"
                        style={{ textShadow: '0 1px 8px rgba(0,0,0,0.25)' }}
                      >
                        {formatNumber(stage.total)}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider opacity-80 mt-0.5">contatos</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Breakdown por vendedor (chips) */}
              {stage.porVendedor.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 justify-center">
                  {stage.porVendedor.slice(0, 8).map(v => (
                    <span
                      key={v.vendedor}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-2 border border-border text-[10px]"
                    >
                      <span className="text-ink-muted">{v.vendedor}</span>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: grad.to }}
                      >
                        {v.count}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function DashboardEtiquetas({ data }: DashboardProps) {
  const resumo = useMemo(() => classificarEtiquetas(data), [data])

  // "Em negociação" = só FOLLOW UP (e variantes de grafia) — somatório de todos os vendedores
  const negociacao = (data ?? [])
    .filter(e => FOLLOW_UP_NOMES.has(e.etiqueta_nome_normalizado))
    .reduce((s, e) => s + e.total_contatos, 0)
  const total = resumo.totalContatos

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Big card: Em negociação */}
        <Card className="p-4 border-accent/30 bg-accent-bg/20">
          <div className="flex items-center gap-2 text-accent text-[11px] uppercase tracking-wider font-medium">
            <Handshake className="h-3.5 w-3.5" />
            <span>Em negociação</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[28px] font-bold text-ink tabular-nums">{formatNumber(negociacao)}</span>
            <span className="text-[12px] text-ink-muted">contatos</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1">
            Etiqueta FOLLOW UP em todos os vendedores
          </p>
          {total > 0 && (
            <div className="mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${(negociacao / total) * 100}%` }}
              />
            </div>
          )}
          <p className="text-[10px] text-ink-faint mt-1 tabular-nums">
            {total > 0 ? `${Math.round((negociacao / total) * 100)}% de ${formatNumber(total)} totais` : '—'}
          </p>
        </Card>

        {/* Vendidos destaque */}
        <Card className="p-4 border-success/30 bg-success-bg/10">
          <div className="flex items-center gap-2 text-success text-[11px] uppercase tracking-wider font-medium">
            <span>{CATEGORIA_META.vendido.emoji}</span>
            <span>Vendidos</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[28px] font-bold text-ink tabular-nums">{formatNumber(resumo.porCategoria.vendido)}</span>
            <span className="text-[12px] text-ink-muted">contatos</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1">
            Fecharam — somatório de todos os vendedores
          </p>
          {total > 0 && (
            <div className="mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{ width: `${(resumo.porCategoria.vendido / total) * 100}%` }}
              />
            </div>
          )}
          <p className="text-[10px] text-ink-faint mt-1 tabular-nums">
            {total > 0 ? `${Math.round((resumo.porCategoria.vendido / total) * 100)}% de conversão` : '—'}
          </p>
        </Card>
      </div>

    </div>
  )
}

interface VendedorBlockProps {
  vendedor: string
  etiquetas: WascriptEtiqueta[]
  filterTerm: string
}

function VendedorBlock({ vendedor, etiquetas, filterTerm }: VendedorBlockProps) {
  // Extrai stats especiais (markers de inbox e total chats)
  const semEtiquetaRow = etiquetas.find(e => e.etiqueta_nome === '(SEM ETIQUETA)')
  const totalChatsRow = etiquetas.find(e => e.etiqueta_nome === '(TOTAL CHATS)')
  const semEtiqueta = semEtiquetaRow?.total_contatos ?? null
  const totalChats = totalChatsRow?.total_contatos ?? null
  // Etiquetas reais (sem os markers)
  const etiquetasReais = etiquetas.filter(e =>
    !['(SEM ETIQUETA)', '(TOTAL CHATS)'].includes(e.etiqueta_nome)
  )

  const total = etiquetasReais.reduce((s, e) => s + e.total_contatos, 0)
  const lastSync = etiquetas.reduce(
    (max, e) => (e.synced_at > max ? e.synced_at : max),
    etiquetas[0]?.synced_at ?? '',
  )

  const term = filterTerm.trim().toLowerCase()
  const filteredRaw = term
    ? etiquetasReais.filter(e =>
        e.etiqueta_nome.toLowerCase().includes(term) ||
        e.etiqueta_nome_normalizado.toLowerCase().includes(term),
      )
    : etiquetasReais
  // Ordenação: pelo funil oficial; etiquetas fora do funil vão no final, ordenadas por contagem
  const filtered = [...filteredRaw].sort((a, b) => {
    const oa = ordemDe(a)
    const ob = ordemDe(b)
    if (oa !== ob) return oa - ob
    return b.total_contatos - a.total_contatos
  })

  const max = filtered.reduce((m, e) => Math.max(m, e.total_contatos), 0) || 1

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={vendedor} size="md" />
          <div className="leading-tight min-w-0">
            <h3 className="text-[14px] font-semibold text-ink truncate">{vendedor}</h3>
            <p className="text-[10px] text-ink-faint uppercase tracking-wider mt-0.5">
              {etiquetasReais.length} etiquetas · {formatNumber(total)} contatos
              {totalChats !== null && (
                <span> · {formatNumber(totalChats)} chats</span>
              )}
            </p>
          </div>
        </div>
        {lastSync && (
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1 text-ink-faint text-[10px]">
              <RefreshCw className="h-3 w-3" />
              <span>{fmtSyncedAt(lastSync)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Alerta inbox: chats sem etiqueta */}
      {semEtiqueta !== null && semEtiqueta > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-warning-bg/20 border border-warning/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14px]">📥</span>
            <div className="leading-tight">
              <div className="text-[11px] font-semibold text-warning">Inbox sem triagem</div>
              <div className="text-[9px] text-ink-faint uppercase tracking-wider">chats sem etiqueta aplicada</div>
            </div>
          </div>
          <span className="text-[18px] font-bold tabular-nums text-warning shrink-0">
            {formatNumber(semEtiqueta)}
          </span>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-[12px] text-ink-faint italic py-2">
          {term
            ? 'Nenhuma etiqueta corresponde ao filtro.'
            : etiquetas.length === 0
              ? 'Sem etiquetas configuradas no WhatsApp ou token desconectado.'
              : 'Sem etiquetas.'}
        </p>
      )}

      <div className="space-y-1.5">
        {filtered.map(e => {
          const pct = (e.total_contatos / max) * 100
          return (
            <div key={e.id} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <div className="flex items-center gap-1.5 text-ink min-w-0">
                  <Tag className="h-3 w-3 text-ink-faint shrink-0" />
                  <span className="truncate" title={`${e.etiqueta_nome} (no WhatsApp)`}>
                    {nomeExibicao(e)}
                  </span>
                </div>
                <span className="text-[12px] font-semibold tabular-nums text-ink shrink-0">
                  {formatNumber(e.total_contatos)}
                </span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent/70 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function EtiquetasZap() {
  const { data, isLoading, error } = useEtiquetas()
  const [filterTerm, setFilterTerm] = useState('')

  const grupos = useMemo(() => {
    const map = data ? groupEtiquetasByVendedor(data) : new Map<string, WascriptEtiqueta[]>()
    // Une vendedores que vieram da query com a lista esperada (garante que GUSTAVO/DANIEL apareçam)
    const nomes = new Set<string>([...map.keys(), ...VENDEDORES_ESPERADOS.map(v => v.toUpperCase())])
    return Array.from(nomes)
      .map(vendedor => ({ vendedor, etiquetas: map.get(vendedor) ?? [] }))
      .sort((a, b) => {
        const totalA = a.etiquetas.reduce((s, e) => s + e.total_contatos, 0)
        const totalB = b.etiquetas.reduce((s, e) => s + e.total_contatos, 0)
        return totalB - totalA
      })
  }, [data])

  const totals = useMemo(() => {
    return {
      vendedores: grupos.length,
      etiquetas: grupos.reduce((s, g) => s + g.etiquetas.length, 0),
      contatos: grupos.reduce((s, g) => s + g.etiquetas.reduce((ss, e) => ss + e.total_contatos, 0), 0),
    }
  }, [grupos])

  if (isLoading) return <PageLoading />

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6 border-danger/40 bg-danger-bg/10">
          <p className="text-danger font-medium">Erro ao carregar etiquetas</p>
          <p className="text-[12px] text-ink-muted mt-1">{(error as Error).message}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink flex items-center gap-2">
            <Tag className="h-4 w-4 text-accent" />
            Etiquetas Zap
          </h1>
          <p className="text-[12px] text-ink-muted mt-0.5">
            Etiquetas do WhatsApp de cada vendedor (sincronizadas via Wascript)
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-faint">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>{totals.vendedores} vendedores</span>
          </div>
          <span className="text-border">·</span>
          <div className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            <span>{totals.etiquetas} etiquetas</span>
          </div>
          <span className="text-border">·</span>
          <span className="tabular-nums">{formatNumber(totals.contatos)} contatos</span>
        </div>
      </header>

      <DashboardEtiquetas data={data} />

      <FunilStages data={data} />

      <div className="max-w-md pt-2">
        <Input
          leftIcon={<Search className="h-3.5 w-3.5" />}
          placeholder="Filtrar por nome de etiqueta…"
          value={filterTerm}
          onChange={e => setFilterTerm(e.target.value)}
        />
      </div>

      {grupos.length === 0 ? (
        <Card className="p-6">
          <p className="text-ink-muted">Nenhuma etiqueta sincronizada ainda.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {grupos.map(g => (
            <VendedorBlock
              key={g.vendedor}
              vendedor={g.vendedor}
              etiquetas={g.etiquetas}
              filterTerm={filterTerm}
            />
          ))}
        </div>
      )}
    </div>
  )
}
