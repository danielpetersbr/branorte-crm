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
export function MetaDoMes({ compacto = false }: {
  /** (21/10/2026) coluna estreita ao lado de Operação agora: os 4 números ficam 2 × 2. Entre xl e 2xl tem altura
   *  natural (o ranking "Quem está entregando" vem logo abaixo e é ele que estica); a partir de 2xl os três ficam na
   *  mesma linha e a meta estica junto (2xl:h-full). */
  compacto?: boolean
} = {}) {
  const { data: v, isLoading, dataUpdatedAt } = useVendasReais()

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

  // O calendário sai do DIA EM QUE O DADO FOI LIDO (Brasília), não do relógio da tela:
  // aberta de 31/10 para 01/11, a tela mostrava "novembro · dia 1" com o vendido de
  // outubro e uma projeção de R$ 22 mi até o próximo refetch.
  const [anoRef, mesRef, diaRef] = v.hojeSP.split('-').map(Number)
  const hoje = new Date(anoRef, mesRef - 1, diaRef)
  const diaDoMes = diaRef
  const diasNoMes = new Date(anoRef, mesRef, 0).getDate()
  const diasRestantes = Math.max(0, diasNoMes - diaDoMes)

  const vendido = v.vendidoMes
  const meta = v.meta
  const pctMeta = meta > 0 ? (vendido / meta) * 100 : 0
  const falta = Math.max(0, meta - vendido)
  const ritmoAtual = diaDoMes > 0 ? vendido / diaDoMes : 0
  const projecao = ritmoAtual * diasNoMes
  const pctProjecao = meta > 0 ? (projecao / meta) * 100 : 0
  // (21/10/2026, auditoria) por DIA ÚTIL: em 2026 só 7 de 506 pedidos caíram em sábado ou domingo. Dividir pelos dias
  // corridos (24, 25 e 31/10 incluídos) dava R$ 161 mil por dia quando o esforço real era R$ 230 mil por dia útil.
  // Feriado não entra na conta (seg a sex).
  let diasUteisRestantes = 0
  for (let d = diaDoMes + 1; d <= diasNoMes; d++) {
    const sem = new Date(anoRef, mesRef - 1, d).getDay()
    if (sem !== 0 && sem !== 6) diasUteisRestantes++
  }
  const precisaPorDiaUtil = diasUteisRestantes > 0 ? falta / diasUteisRestantes : falta

  // Projeção com poucos dias ou poucos pedidos é ruído: em 02/10 um pedido grande dava
  // "No ritmo da meta · 154%" e no dia 04 já era vermelho. Até lá, não projeta.
  const cedo = diaDoMes < 7 || v.pedidosMes < 10
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
  const metaPadrao = v.metaFonte === 'padrao'
  const lidoAs = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <Card className={compacto ? '2xl:h-full 2xl:p-4' : ''}>
      <div className={`mb-4 flex flex-wrap items-start justify-between gap-3${compacto ? ' 2xl:mb-2' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-title text-ink">Meta do mês</h3>
          <JanelaBadge tipo="mes" label={mesLabel} />
          {/* Procedência do número: sem isso, um Controle fora do ar vira meta
              velha silenciosa (o fallback carrega R$ 2,0M contra R$ 2,5M reais). */}
          <span
            title={degradado
              ? 'O Controle não respondeu. Números vindos do espelho local: podem estar atrasados e a meta pode ser a antiga.'
              : metaPadrao
                ? 'Vendas lidas ao vivo do Controle, mas a META não veio (system_settings não respondeu): está sendo usada a meta padrão do código.'
                : 'Lido ao vivo do sistema de Controle. Relê a cada 3 minutos.'}
            className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-micro ${
              degradado || metaPadrao ? 'border-warning/40 bg-warning-bg text-warning' : 'border-border bg-surface-2 text-ink-muted'
            }`}
          >
            {degradado ? <Database className="h-3 w-3" aria-hidden="true" /> : <RadioTower className="h-3 w-3" aria-hidden="true" />}
            {degradado ? 'espelho (atrasado)' : metaPadrao ? 'meta padrão' : 'ao vivo · Controle'}{lidoAs ? ` · ${lidoAs}` : ''}
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
      <div className={`relative mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2${compacto ? ' 2xl:mt-2.5' : ''}`}>
        <div
          className={`h-full rounded-full ${corBarra} transition-all`}
          style={{ width: `${Math.min(100, Math.max(pctMeta, 0.5))}%` }}
        />
        {!cedo && pctProjecao > 0 && pctProjecao < 100 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-ink/60"
            style={{ left: `${Math.min(pctProjecao, 99)}%` }}
            title={`Projeção no ritmo atual: ${brlFull(projecao)}`}
          />
        )}
      </div>
      <div className="sr-only" role="status">
        {cedo ? 'Cedo para projetar' : situacao}. Vendido {brlFull(vendido)} de {brlFull(meta)}, {pct(pctMeta, 0)} da meta.
      </div>

      <div className={`mt-4 grid grid-cols-2 gap-3 border-t border-border pt-5 ${compacto ? 'gap-y-5 2xl:mt-3 2xl:gap-y-2.5 2xl:pt-3' : 'lg:grid-cols-4'}`}>
        <div>
          <div className="text-label text-ink-faint">Falta</div>
          <div className="text-kpi-sm tabular-nums text-ink">{brl(falta)}</div>
        </div>
        <div>
          <div className="text-label text-ink-faint" title="Dias corridos depois de hoje, e quantos deles são dias úteis (segunda a sexta; feriado não entra na conta). Hoje entra na média do mês, não aqui.">Dias restantes</div>
          <div className="text-kpi-sm tabular-nums text-ink">{diasRestantes}</div>
          <div className="text-micro text-ink-faint">{diasUteisRestantes} {diasUteisRestantes === 1 ? 'dia útil' : 'dias úteis'}</div>
        </div>
        <div>
          <div className="text-label text-ink-faint" title="O que falta para a meta dividido pelos dias úteis que sobram no mês (segunda a sexta). Embaixo, a média do mês até hoje por dia corrido, que é a base da projeção ao lado.">Precisa por dia útil</div>
          <div className="text-kpi-sm tabular-nums text-ink">{brl(precisaPorDiaUtil)}</div>
          <div className="text-micro text-ink-faint">média do mês: {brl(ritmoAtual)} por dia</div>
        </div>
        <div>
          <div className="text-label text-ink-faint">No ritmo atual, fecha</div>
          {cedo ? (
            <>
              <div className="text-kpi-sm tabular-nums text-ink-faint">—</div>
              <div className="mt-0.5 text-micro text-ink-faint">
                cedo para projetar (dia {diaDoMes}, {n(v.pedidosMes)} {v.pedidosMes === 1 ? 'pedido' : 'pedidos'})
              </div>
            </>
          ) : (
            <>
              <div className={`text-kpi-sm tabular-nums ${cor}`}>{brl(projecao)}</div>
              <div className={`mt-0.5 inline-flex items-center gap-1 text-micro ${cor}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {situacao} · {pct(pctProjecao, 0)}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
