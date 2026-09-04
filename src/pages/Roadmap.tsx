import { useState } from 'react'
import { Bug, Lightbulb, Sparkles, Loader2, ExternalLink, Image as ImageIcon, MessageSquarePlus } from 'lucide-react'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  useFeedbacks, useAtualizarFeedback,
  type RoadmapFeedback, type RoadmapStatus, type RoadmapPrioridade,
} from '@/hooks/useRoadmap'
import { useHeatmapSemanal } from '@/hooks/useDashboardEtiquetas'
import { useCan } from '@/hooks/usePermissions'
import { HeatmapDiaHora } from '@/components/HeatmapDiaHora'
import { JanelaBadge } from '@/pages/dashboard/ui/JanelaBadge'

const STATUS_LABEL: Record<RoadmapStatus | 'todos', string> = {
  todos: 'Todos',
  novo: 'Novo',
  analisando: 'Analisando',
  resolvido: 'Resolvido',
  rejeitado: 'Rejeitado',
}

const STATUS_STYLE: Record<RoadmapStatus, string> = {
  novo: 'bg-info/15 text-info border-info/30',
  analisando: 'bg-warning/15 text-warning border-warning/30',
  resolvido: 'bg-success-bg text-success border-success/30',
  rejeitado: 'bg-surface-2 text-ink-muted border-border',
}

const TIPO_ICON: Record<string, { Icon: typeof Bug; cor: string }> = {
  bug: { Icon: Bug, cor: 'text-rose-400' },
  sugestao: { Icon: Lightbulb, cor: 'text-amber-400' },
  melhoria: { Icon: Sparkles, cor: 'text-emerald-400' },
}

const PRIORIDADE_LABEL: Record<RoadmapPrioridade, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function Roadmap() {
  const [filtroStatus, setFiltroStatus] = useState<RoadmapStatus | 'todos'>('novo')
  const [expandido, setExpandido] = useState<number | null>(null)
  const { data: feedbacks, isLoading } = useFeedbacks(filtroStatus)
  const atualizar = useAtualizarFeedback()

  /*
   * Heatmap "quando chegam os leads" — mudou-se pra cá em 03/09/2026 (saiu do
   * /analytics e da aba Equipe do Dashboard).
   *
   * ⚠️ GATE POR `menu.dashboard`, e não por estar nesta página. O vendedor
   * ALCANÇA o /roadmap (é onde ele vê o retorno do feedback que mandou — ver o
   * guard em App.tsx), mas NÃO alcança /dashboard nem /analytics. Sem esta
   * trava, mudar o bloco de lugar publicaria o volume de leads da operação
   * inteira pro time de vendas, que hoje não enxerga esse número.
   *
   * O `enabled` do hook segura a RPC junto: sem ele o vendedor não veria o
   * bloco, mas a chamada sairia igual e o dado chegaria no navegador dele.
   * (Isso é trava de UI — quem decide de verdade é a RLS da RPC.)
   */
  const can = useCan()
  const podeVerHeatmap = can('menu.dashboard')
  const { data: heatmap30d } = useHeatmapSemanal(podeVerHeatmap)

  if (isLoading) return <PageLoading />

  const lista = feedbacks ?? []

  async function trocarStatus(id: number, status: RoadmapStatus) {
    await atualizar.mutateAsync({ id, patch: { status } })
  }
  async function trocarPrioridade(id: number, prioridade: RoadmapPrioridade) {
    await atualizar.mutateAsync({ id, patch: { prioridade } })
  }
  async function salvarNotas(id: number, notas_admin: string) {
    await atualizar.mutateAsync({ id, patch: { notas_admin } })
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <MessageSquarePlus className="w-5 h-5 text-accent mt-1" />
          <div>
            <h1 className="text-[18px] font-semibold text-ink">Roadmap & Feedback</h1>
            <p className="text-[12px] text-ink-muted">Bugs, sugestões e melhorias enviados pelos vendedores.</p>
          </div>
        </div>

        {/* Quando chegam os leads — janela fixa de 30 dias, independente de
            qualquer filtro desta página (o de status vale só pros feedbacks). */}
        {podeVerHeatmap && (
          <section id="quando-chegam" className="bg-surface border border-border rounded-lg p-4 mb-4">
            <div className="mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[13px] font-semibold text-ink">Quando chegam os leads</h2>
                <JanelaBadge tipo="fixo" label="últimos 30 dias" />
              </div>
              <p className="text-[11px] text-ink-faint mt-0.5">
                Dia da semana × hora. Serve pra escalar plantão e turno de atendimento.
              </p>
            </div>
            {heatmap30d && heatmap30d.length > 0
              ? <HeatmapDiaHora heatmap={heatmap30d} />
              : <p className="text-[12px] text-ink-faint">Sem dados no período.</p>}
          </section>
        )}

        {/* Filtros de status */}
        <div className="bg-surface border border-border rounded-lg p-2 mb-4 flex flex-wrap gap-1.5">
          {(['todos', 'novo', 'analisando', 'resolvido', 'rejeitado'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition ${
                filtroStatus === s
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'
              }`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Lista */}
        {lista.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg py-12 text-center text-ink-faint">
            <MessageSquarePlus className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-[13px]">Nenhum feedback nesse status.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lista.map(fb => {
              const { Icon, cor } = TIPO_ICON[fb.tipo] ?? TIPO_ICON.bug
              const aberto = expandido === fb.id
              return (
                <div key={fb.id} className="bg-surface border border-border rounded-lg overflow-hidden">
                  {/* Cabeçalho clicável */}
                  <button
                    onClick={() => setExpandido(aberto ? null : fb.id)}
                    className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2/40"
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-[13px] font-semibold text-ink truncate">{fb.titulo}</span>
                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${STATUS_STYLE[fb.status]}`}>
                          {STATUS_LABEL[fb.status]}
                        </span>
                      </div>
                      <div className="text-[10px] text-ink-faint flex items-center gap-1.5 flex-wrap">
                        <span>#{fb.id}</span>
                        <span>·</span>
                        <span>{fb.criado_por_nome ?? '?'}</span>
                        <span>·</span>
                        <span>{formatDate(fb.created_at)}</span>
                        {fb.url_origem && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{fb.url_origem}</span>
                          </>
                        )}
                        {fb.screenshot_url && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-0.5 text-info"><ImageIcon className="w-2.5 h-2.5" /> print</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expansão: detalhes + edição */}
                  {aberto && (
                    <FeedbackDetalhes
                      fb={fb}
                      onStatus={s => trocarStatus(fb.id, s)}
                      onPrioridade={p => trocarPrioridade(fb.id, p)}
                      onNotas={n => salvarNotas(fb.id, n)}
                      saving={atualizar.isPending}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface DetalhesProps {
  fb: RoadmapFeedback
  onStatus: (s: RoadmapStatus) => Promise<void> | void
  onPrioridade: (p: RoadmapPrioridade) => Promise<void> | void
  onNotas: (n: string) => Promise<void> | void
  saving: boolean
}

function FeedbackDetalhes({ fb, onStatus, onPrioridade, onNotas, saving }: DetalhesProps) {
  const [notas, setNotas] = useState(fb.notas_admin ?? '')
  return (
    <div className="border-t border-border bg-surface-2/30 px-4 py-3 space-y-3">
      {fb.descricao && (
        <div>
          <div className="text-[10px] uppercase font-bold text-ink-muted mb-1">Descrição</div>
          <p className="text-[12px] text-ink whitespace-pre-wrap">{fb.descricao}</p>
        </div>
      )}

      {fb.screenshot_url && (
        <div>
          <div className="text-[10px] uppercase font-bold text-ink-muted mb-1 flex items-center gap-1.5">
            Screenshot
            <a href={fb.screenshot_url} target="_blank" rel="noopener" className="text-info hover:underline flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" /> abrir
            </a>
          </div>
          <a href={fb.screenshot_url} target="_blank" rel="noopener">
            <img src={fb.screenshot_url} alt="Print" className="max-h-64 rounded border border-border" />
          </a>
        </div>
      )}

      {/* Controles admin */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase font-bold text-ink-muted mb-1">Status</div>
          <div className="flex flex-wrap gap-1">
            {(['novo', 'analisando', 'resolvido', 'rejeitado'] as const).map(s => (
              <button
                key={s}
                onClick={() => onStatus(s)}
                disabled={saving}
                className={`text-[11px] px-2 py-1 rounded border font-semibold ${
                  fb.status === s ? STATUS_STYLE[s] : 'bg-surface text-ink-muted border-border hover:bg-surface-3'
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase font-bold text-ink-muted mb-1">Prioridade</div>
          <div className="flex flex-wrap gap-1">
            {(['baixa', 'media', 'alta', 'critica'] as const).map(p => (
              <button
                key={p}
                onClick={() => onPrioridade(p)}
                disabled={saving}
                className={`text-[11px] px-2 py-1 rounded border font-semibold ${
                  fb.prioridade === p ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-muted border-border hover:bg-surface-3'
                }`}
              >
                {PRIORIDADE_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notas admin */}
      <div>
        <div className="text-[10px] uppercase font-bold text-ink-muted mb-1">Notas internas</div>
        <textarea
          value={notas}
          onChange={e => setNotas(e.target.value)}
          onBlur={() => notas !== (fb.notas_admin ?? '') && onNotas(notas)}
          rows={2}
          placeholder="Investigação, pivôs, links de commits…"
          className="w-full text-[12px] px-3 py-2 bg-surface border border-border rounded text-ink placeholder:text-ink-faint resize-none"
        />
        {saving && <div className="text-[10px] text-ink-faint flex items-center gap-1 mt-1"><Loader2 className="w-3 h-3 animate-spin" /> salvando…</div>}
      </div>
    </div>
  )
}
