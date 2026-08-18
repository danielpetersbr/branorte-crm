import { TrendingUp, AlertTriangle, CheckCircle2, RadioTower, Database } from 'lucide-react'
import { useVendasReais } from '@/hooks/useVendasReais'
import { Card } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { brl, brlFull, n, pct } from '../ui/format'

/**
 * "Bato a meta?" — a pergunta nº1 do dono, então é o bloco nº1 da tela.
 * (No dashboard antigo ela ficava depois de DOIS painéis de KPI, ~1.400px abaixo.)
 *
 * Fonte: useVendasReais → Supabase do Controle, ao vivo. O `forecast` do
 * useDashboard NÃO é usado aqui: ele lê status_real procurando "vendido" e
 * nenhum dos 11.583 atendimentos tem esse valor, então dava R$ 0 sempre.
 */
export function MetaDoMes() {
  const { data: v, isLoading } = useVendasReais()

  if (isLoading) {
    return (
      <Card>
        <div className="h-[132px] animate-pulse rounded-lg bg-surface-2" />
      </Card>
    )
  }
  if (!v) {
    return (
      <Card>
        <p className="text-body text-ink-faint">Meta do mês indisponível — não deu para falar com o Controle.</p>
      </Card>
    )
  }

  const hoje = new Date()
  const diaDoMes = hoje.getDate()
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
  const diasRestantes = Math.max(0, diasNoMes - diaDoMes)

  const vendido = v.vendidoMes
  const meta = v.meta
  const pctMeta = meta > 0 ? (vendido / meta) * 100 : 0
  const falta = Math.max(0, meta - vendido)
  const ritmoAtual = diaDoMes > 0 ? vendido / diaDoMes : 0
  const projecao = ritmoAtual * diasNoMes
  const pctProjecao = meta > 0 ? (projecao / meta) * 100 : 0
  const precisaPorDia = diasRestantes > 0 ? falta / diasRestantes : falta

  const noRitmo = pctProjecao >= 100
  const perto = pctProjecao >= 85 && pctProjecao < 100
  const Icon = noRitmo ? CheckCircle2 : perto ? TrendingUp : AlertTriangle
  const situacao = noRitmo ? 'No ritmo da meta' : perto ? 'Perto, mas abaixo do ritmo' : 'Abaixo do ritmo'
  const cor = noRitmo ? 'text-success' : perto ? 'text-warning' : 'text-danger'
  // A barra de PROGRESSO é sempre neutra (verde da marca). Quem carrega o
  // julgamento é o texto de situação, com ícone. Pintar a barra inteira de
  // vermelho fazia o bloco gritar antes do gerente ler o número.
  const corBarra = 'bg-accent'

  const mesLabel = hoje.toLocaleDateString('pt-BR', { month: 'long' })
  const degradado = v.fonte === 'mirror-fallback'

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-title text-ink">Meta do mês</h2>
          <JanelaBadge tipo="mes" label={mesLabel} />
          {/* Procedência do número: sem isso, um Controle fora do ar vira meta
              velha silenciosa (o fallback carrega R$ 2,0M contra R$ 2,5M reais). */}
          <span
            title={degradado
              ? 'O Controle não respondeu. Números vindos do espelho local: podem estar atrasados e a meta pode ser a antiga.'
              : 'Lido ao vivo do sistema de Controle.'}
            className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro ${
              degradado ? 'border-warning/40 bg-warning-bg text-warning' : 'border-border bg-surface-2 text-ink-muted'
            }`}
          >
            {degradado ? <Database className="h-3 w-3" aria-hidden="true" /> : <RadioTower className="h-3 w-3" aria-hidden="true" />}
            {degradado ? 'espelho (atrasado)' : 'ao vivo · Controle'}
          </span>
        </div>
        <span className="text-label tabular-nums text-ink-faint">
          dia {diaDoMes} de {diasNoMes} · {n(v.pedidosMes)} {v.pedidosMes === 1 ? 'pedido' : 'pedidos'}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-kpi tabular-nums text-ink">{brlFull(vendido)}</span>
        <span className="text-kpi-sm tabular-nums text-ink-muted">{pct(pctMeta, 0)}</span>
        <span className="text-label text-ink-faint">de {brl(meta)}</span>
      </div>

      {/* Barra: preenchido = vendido · marca = onde a projeção fecha */}
      <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${corBarra} transition-all`}
          style={{ width: `${Math.min(100, Math.max(pctMeta, 0.5))}%` }}
        />
        {pctProjecao > 0 && pctProjecao < 100 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-ink/60"
            style={{ left: `${Math.min(pctProjecao, 99)}%` }}
            title={`Projeção no ritmo atual: ${brlFull(projecao)}`}
          />
        )}
      </div>
      <div className="sr-only" role="status">
        {situacao}. Vendido {brlFull(vendido)} de {brlFull(meta)}, {pct(pctMeta, 0)} da meta.
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 lg:grid-cols-4">
        <div>
          <div className="text-label text-ink-faint">Falta</div>
          <div className="text-kpi-sm tabular-nums text-ink">{brl(falta)}</div>
        </div>
        <div>
          <div className="text-label text-ink-faint">Dias restantes</div>
          <div className="text-kpi-sm tabular-nums text-ink">{diasRestantes}</div>
        </div>
        <div>
          <div className="text-label text-ink-faint">Precisa por dia</div>
          <div className="text-kpi-sm tabular-nums text-ink">{brl(precisaPorDia)}</div>
          <div className="text-micro text-ink-faint">hoje o ritmo é {brl(ritmoAtual)}/dia</div>
        </div>
        <div>
          <div className="text-label text-ink-faint">No ritmo atual, fecha</div>
          <div className={`text-kpi-sm tabular-nums ${cor}`}>{brl(projecao)}</div>
          <div className={`mt-0.5 inline-flex items-center gap-1 text-micro ${cor}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {situacao} · {pct(pctProjecao, 0)}
          </div>
        </div>
      </div>
    </Card>
  )
}
