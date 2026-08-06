import { lazy, Suspense, useMemo, useState } from 'react'
import { Users, AlertCircle, TrendingUp, MapPin, Activity } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import {
  usePodeGerirRepresentantes, useRepPainel, useRepVisitas, alertasDe,
  type RepKpi,
} from '@/hooks/useRepresentantes'
import { RESULTADO_LABEL } from '@/hooks/useVisitasCampo'

// Painel de gestão da rede de representantes.
// Quem enxerga: admin + quem tem 'representantes.gerir' em user_permissions
// (hoje, o Patrick). A checagem vale no BANCO, dentro das RPCs — este arquivo
// só evita mostrar tela vazia sem explicação.

const MIN_REPS_PRA_RANKING = 3

// Leaflet é pesado (~150 kB). Carrega só quando a aba Mapa abre — o gestor que
// só olha número não paga por ele.
const MapaGestaoVisitas = lazy(() =>
  import('@/components/mapa/MapaGestaoVisitas').then(m => ({ default: m.MapaGestaoVisitas })))

function primeiroDiaDoMes(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE')
}
function hoje(): string {
  return new Date().toLocaleDateString('sv-SE')
}
function brl(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${n}%`
}
function num(n: number | null | undefined): string {
  return n == null ? '—' : String(n)
}

// Nota ponderada: receita 40 · conversão 25 · execução 20 · qualidade 15.
// Cada dimensão é normalizada pelo melhor do período — nota é posição relativa,
// não meta absoluta (não existe meta cadastrada ainda).
function notaDe(k: RepKpi, teto: { receita: number; conv: number; exec: number; qual: number }): number {
  const r = teto.receita ? (k.receita ?? 0) / teto.receita : 0
  const c = teto.conv ? (k.proposta_para_venda ?? 0) / teto.conv : 0
  const e = teto.exec ? (k.execucao ?? 0) / teto.exec : 0
  const qBruta = k.realizadas ? 1 - k.sem_relatorio / k.realizadas : 0
  const q = teto.qual ? qBruta / teto.qual : 0
  return Math.round((r * 40 + c * 25 + e * 20 + q * 15) * 10) / 10
}

export function Representantes() {
  const { profile } = useAuth()
  const { data: podeGerir, isLoading: carregandoPermissao } = usePodeGerirRepresentantes()
  const [de, setDe] = useState(primeiroDiaDoMes())
  const [ate, setAte] = useState(hoje())
  const [rep, setRep] = useState('')
  const [aba, setAba] = useState<'painel' | 'mapa' | 'alertas' | 'visitas'>('painel')

  const painel = useRepPainel(de, ate, rep || null)
  const alertasQ = useRepVisitas(de, ate, rep || null, true)
  const visitasQ = useRepVisitas(de, ate, rep || null, false)
  const kpis = painel.data ?? []
  const alertas = alertasQ.data ?? []
  const visitas = visitasQ.data ?? []
  const isLoading = painel.isLoading
  // Query que falha deixa data undefined → o default [] renderizava "nenhuma
  // visita fora do padrão", ou seja, a tela afirmava conformidade quando na
  // verdade não tinha carregado nada.
  const erro = painel.error ?? alertasQ.error ?? visitasQ.error

  // As opções do filtro vêm da consulta SEM filtro (mesma queryKey quando não há
  // rep selecionado, então o React Query reaproveita). Derivar da lista filtrada
  // faria o Select se autodestruir: escolher um rep sumia com os outros nomes.
  const todosKpis = useRepPainel(de, ate, null).data ?? []
  const opcoesRep = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const k of todosKpis) if (!vistos.has(k.rep)) vistos.set(k.rep, k.rep_nome ?? k.rep)
    return [...vistos.entries()].sort(([, a], [, b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }))
  }, [todosKpis])

  const ranking = useMemo(() => {
    if (kpis.length < MIN_REPS_PRA_RANKING) return []
    const teto = {
      receita: Math.max(...kpis.map(k => k.receita ?? 0), 0),
      conv: Math.max(...kpis.map(k => k.proposta_para_venda ?? 0), 0),
      exec: Math.max(...kpis.map(k => k.execucao ?? 0), 0),
      qual: Math.max(...kpis.map(k => (k.realizadas ? 1 - k.sem_relatorio / k.realizadas : 0)), 0),
    }
    return [...kpis].map(k => ({ k, nota: notaDe(k, teto) })).sort((a, b) => b.nota - a.nota)
  }, [kpis])

  if (carregandoPermissao) {
    return <p className="text-[13px] text-ink-muted py-10 text-center">Carregando…</p>
  }

  if (podeGerir === false) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="h-12 w-12 text-warning mx-auto mb-2" />
        <h2 className="text-xl font-bold text-ink">Acesso restrito</h2>
        <p className="text-ink-muted text-[13px] mt-1">
          Sua conta não tem a gestão da rede de representantes.
        </p>
      </div>
    )
  }

  const totalGeral = kpis.reduce((acc, k) => ({
    planejadas: acc.planejadas + k.planejadas,
    realizadas: acc.realizadas + k.realizadas,
    receita: acc.receita + (k.receita ?? 0),
    pipeline: acc.pipeline + (k.pipeline ?? 0),
  }), { planejadas: 0, realizadas: 0, receita: 0, pipeline: 0 })

  return (
    <div className="p-3 lg:p-6 max-w-[1600px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl lg:text-3xl font-semibold text-ink tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6 text-accent" /> Rede de Representantes
        </h1>
        <p className="text-[12px] text-ink-faint mt-0.5">
          Tudo derivado das visitas, propostas e vendas. Nenhum número é digitado.
          {profile?.display_name ? ` · ${profile.display_name}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">De</p>
          <Input type="date" value={de} onChange={e => setDe(e.target.value)} className="w-[150px]" />
        </div>
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Até</p>
          <Input type="date" value={ate} onChange={e => setAte(e.target.value)} className="w-[150px]" />
        </div>
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Representante</p>
          <Select
            className="w-[190px]"
            options={opcoesRep}
            placeholder="Todos"
            value={rep}
            onChange={e => setRep(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
        <Kpi titulo="Visitas realizadas" valor={`${totalGeral.realizadas}/${totalGeral.planejadas}`}
             rodape={totalGeral.planejadas ? `${Math.round(100 * totalGeral.realizadas / totalGeral.planejadas)}% de execução` : 'sem roteiro no período'} />
        <Kpi titulo="Receita" valor={brl(totalGeral.receita)} rodape="vendas do período" />
        <Kpi titulo="Pipeline aberto" valor={brl(totalGeral.pipeline)} rodape="relatórios em negociação" />
        <Kpi titulo="Alertas" valor={String(alertas.length)}
             rodape={alertas.length ? 'visitas fora do padrão' : 'nada fora do padrão'}
             tom={alertas.length ? 'warning' : 'normal'} />
      </div>

      <div className="flex gap-1.5 mb-3 border-b border-border">
        {([['painel', 'Indicadores'], ['mapa', 'Mapa'], ['alertas', `Alertas (${alertas.length})`], ['visitas', `Visitas (${visitas.length})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)}
            className={cn(
              'px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-all',
              aba === k ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}>{label}</button>
        ))}
      </div>

      {erro ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 py-8 text-center">
          <AlertCircle className="h-7 w-7 text-danger mx-auto mb-2" />
          <p className="text-[13px] text-ink">Não consegui carregar os dados.</p>
          <p className="text-[12px] text-ink-muted mt-1">
            Nada aqui está zerado — está <strong>indisponível</strong>. Recarregue em instantes.
          </p>
        </div>
      ) : isLoading ? (
        <p className="text-[13px] text-ink-muted py-10 text-center">Carregando…</p>
      ) : aba === 'painel' ? (
        kpis.length === 0 ? (
          <Vazio texto="Nenhuma visita planejada no período." />
        ) : (
          <div className="space-y-4">
            {ranking.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-[11px] uppercase font-bold text-ink-muted mb-2 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Ranking · receita 40 · conversão 25 · execução 20 · relatório 15
                </p>
                <div className="space-y-1.5">
                  {ranking.map(({ k, nota }, i) => (
                    <div key={k.rep} className="flex items-center gap-3 text-[13px]">
                      <span className="w-5 text-ink-faint tabular-nums">{i + 1}º</span>
                      <span className="flex-1 text-ink font-medium truncate">{k.rep_nome ?? k.rep}</span>
                      <div className="hidden sm:block flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(nota, 100)}%` }} />
                      </div>
                      <span className="w-12 text-right text-ink tabular-nums font-semibold">{nota}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {kpis.length < MIN_REPS_PRA_RANKING && (
              <p className="text-[12px] text-ink-faint">
                Ranking aparece a partir de {MIN_REPS_PRA_RANKING} representantes ativos —
                com menos que isso ele só ordena quem já se sabe quem é.
              </p>
            )}
            {kpis.map(k => <CardRep key={k.rep} k={k} />)}
          </div>
        )
      ) : aba === 'mapa' ? (
        visitas.length === 0 ? (
          <Vazio texto="Nenhuma visita no período para desenhar." />
        ) : (
          <Suspense fallback={<p className="text-[13px] text-ink-muted py-10 text-center">Carregando o mapa…</p>}>
            <MapaGestaoVisitas visitas={visitas} />
          </Suspense>
        )
      ) : aba === 'alertas' ? (
        alertas.length === 0 ? (
          <Vazio texto="Nenhuma visita fora do padrão no período." />
        ) : (
          <div className="space-y-2">
            {alertas.map(v => (
              <div key={v.parada_id} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink truncate">
                      {v.rep_nome ?? v.rep} · {v.cidade ?? '—'}{v.uf ? `/${v.uf}` : ''}
                    </p>
                    <p className="text-[11px] text-ink-faint">{v.data_prevista ?? '—'}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    {alertasDe(v).map(a => (
                      <Badge key={a} className="text-warning bg-warning/10">{a}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        visitas.length === 0 ? (
          <Vazio texto="Nenhuma visita no período." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-ink-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold">Representante</th>
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 font-semibold">Cidade</th>
                    <th className="px-3 py-2 font-semibold">Chegou</th>
                    <th className="px-3 py-2 font-semibold text-right">Min</th>
                    <th className="px-3 py-2 font-semibold text-right">Dist.</th>
                    <th className="px-3 py-2 font-semibold">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {visitas.map(v => (
                    <tr key={v.parada_id} className="border-t border-border">
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{v.data_prevista ?? '—'}</td>
                      <td className="px-3 py-2 text-ink">{v.rep_nome ?? v.rep}</td>
                      <td className="px-3 py-2 text-ink max-w-[220px] truncate" title={v.cliente}>{v.cliente}</td>
                      <td className="px-3 py-2 text-ink-muted">{v.cidade ?? '—'}{v.uf ? `/${v.uf}` : ''}</td>
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                        {v.checkin_at
                          ? new Date(v.checkin_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                          : <span className="text-ink-faint">não foi</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{num(v.minutos)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {v.ponto_confiavel
                          ? (v.distancia_m != null ? `${v.distancia_m} m` : '—')
                          : <span className="text-ink-faint" title="Pino é a cidade, não o endereço — distância não vale">n/a</span>}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">
                        {v.resultado ? (RESULTADO_LABEL[v.resultado] ?? v.resultado)
                          : v.checkin_at ? <span className="text-warning">sem relatório</span> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}

function Kpi({ titulo, valor, rodape, tom = 'normal' }: {
  titulo: string; valor: string; rodape?: string; tom?: 'normal' | 'warning'
}) {
  return (
    <div className={cn('rounded-xl border p-3', tom === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-border bg-surface')}>
      <p className="text-[11px] uppercase font-bold text-ink-muted">{titulo}</p>
      <p className="text-xl font-semibold text-ink tracking-tight mt-0.5 tabular-nums">{valor}</p>
      {rodape && <p className="text-[11px] text-ink-faint mt-0.5">{rodape}</p>}
    </div>
  )
}

function CardRep({ k }: { k: RepKpi }) {
  const linhas: Array<[string, string]> = [
    ['Planejadas', num(k.planejadas)],
    ['Realizadas', num(k.realizadas)],
    ['Execução', pct(k.execucao)],
    ['Sem relatório', num(k.sem_relatorio)],
    ['Tempo médio', k.minutos_medios != null ? `${k.minutos_medios} min` : '—'],
    ['Km rodados', k.km != null ? `${k.km} km` : '—'],
    ['Custo/visita', brl(k.custo_visita)],
    ['Clientes visitados', num(k.clientes_novos)],
    ['Cobertura da carteira', pct(k.cobertura)],
    // Estes quatro são o TOTAL do vendedor no período — não só o que saiu das
    // visitas. orcamentos_gerados e vendas_mapa não têm vínculo com a parada.
    // Chamar de "visita → proposta" afirmaria uma causa que o dado não prova,
    // e o número passa de 100% sem nenhum erro (uma visita gera 2 propostas).
    ['Propostas no período', num(k.propostas)],
    ['Propostas ÷ visitas', pct(k.visita_para_proposta)],
    ['Vendas no período', num(k.vendas)],
    ['Vendas ÷ propostas', pct(k.proposta_para_venda)],
    ['Ticket médio', brl(k.ticket)],
    ['Receita no período', brl(k.receita)],
    ['Ciclo médio', k.ciclo_dias != null ? `${k.ciclo_dias} dias` : '—'],
    ['Pipeline aberto', brl(k.pipeline)],
    ['Atividades vencidas', num(k.atividades_vencidas)],
  ]
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[14px] font-semibold text-ink tracking-tight flex items-center gap-1.5 mb-1">
        <MapPin className="h-4 w-4 text-accent" /> {k.rep_nome ?? k.rep}
      </p>
      <p className="text-[11px] text-ink-faint mb-3">
        Visitas e relatório vêm do roteiro. Propostas, vendas e receita são o total
        do vendedor no período — a proposta não guarda de qual visita nasceu.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2.5">
        {linhas.map(([label, valor]) => (
          <div key={label}>
            <p className="text-[10px] uppercase font-bold text-ink-faint leading-tight">{label}</p>
            <p className="text-[13px] text-ink tabular-nums">{valor}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-14 text-center">
      <Activity className="h-8 w-8 text-ink-faint mx-auto mb-2" />
      <p className="text-[13px] text-ink-muted">{texto}</p>
    </div>
  )
}
