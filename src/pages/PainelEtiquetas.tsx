import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { Activity, AlertCircle, Clock, Flame, BarChart3, Reply } from 'lucide-react'
import { usePainelEtiquetas, type AggregacaoEtiqueta } from '@/hooks/useChatsPorEtiqueta'
import { useVendedorXEtiqueta } from '@/hooks/useVendedorXEtiqueta'
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
  PieChart, Pie, Legend,
} from 'recharts'

const STATUS_COLORS = {
  fresco:  '#10b981',  // verde — ativo
  recente: '#f59e0b',  // amarelo — atenção
  parado:  '#ef4444',  // vermelho — perdido
  semDado: '#6b7280',  // cinza — sem dado
}

const STATUS_LABELS = {
  fresco:  'Fresco (<24h)',
  recente: 'Recente (1-3d)',
  parado:  'Parado (>3d)',
  semDado: 'Sem dado',
}

// Cor por etiqueta canônica (alinhada com EtiquetasZapGraficos)
const ETIQUETA_COR: Record<string, string> = {
  'PROSPECCAO':       '#3b82f6',
  '2A TENTATIVA':     '#06b6d4',
  'NOVO LEAD':        '#8b5cf6',
  'FOLLOW UP':        '#f59e0b',
  'INTERESSE FUTURO': '#facc15',
  'VENDIDO':          '#10b981',
  'LEAD QUENTE':      '#ec4899',
  'ORCAMENTO ENVIADO':'#22d3ee',
  'RESOLVIDO':        '#84cc16',
  'NAO RESPONDEU MAIS':'#94a3b8',
  'NUNCA RESPONDEU':  '#64748b',
  'NAO TEM INTERESSE':'#a78bfa',
  'COMPROU DO CONCORRENTE':'#ef4444',
  'SO BASE DE PRECO': '#f97316',
  'FORA DO ORCAMENTO':'#fb7185',
  'NAO FABRICAMOS':   '#0ea5e9',
  'OUTROS ASSUNTOS':  '#71717a',
  'PENDENCIA':        '#dc2626',
}

function corDaEtiqueta(nome: string): string {
  return ETIQUETA_COR[nome] ?? '#9ca3af'
}

function StatusBadge({ status }: { status: 'fresco' | 'recente' | 'parado' | 'semDado' }) {
  const cor = STATUS_COLORS[status]
  const label = STATUS_LABELS[status]
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ backgroundColor: `${cor}22`, color: cor }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cor }} />
      {label}
    </span>
  )
}

export function PainelEtiquetas() {
  const { data, isLoading, error } = usePainelEtiquetas()
  // Fonte alternativa pra Matriz Vendedor × Etiqueta: usa tabela `cards`
  // (todos vendedores com cards reais, não só os que populam wa_chat_labels)
  const { data: dataVE } = useVendedorXEtiqueta()
  const [filtroEtiqueta, setFiltroEtiqueta] = useState<string | null>(null)

  const dadosBarras = useMemo(() => {
    if (!data) return []
    return data.porEtiqueta
      .slice(0, 12)
      .map(e => ({
        nome: e.nomeCanonico,
        Fresco: e.fresco,
        Recente: e.recente,
        Parado: e.parado,
        SemDado: e.semDado,
        total: e.total,
      }))
  }, [data])

  // 🎯 Funil de vendas isolado — 5 estágios ATIVOS da jornada
  // Agrega de dataVE (todos os 7 vendedores via tabela cards), não de
  // wa_chat_labels que só tem 3 vendedores.
  const ORDEM_FUNIL = [
    'PROSPECCAO', '2a TENTATIVA', 'NOVO LEAD',
    'FOLLOW UP', 'LEAD QUENTE',
  ]
  const dadosFunil = useMemo(() => {
    if (!dataVE) return []
    return ORDEM_FUNIL
      .map(nome => {
        // Soma a etiqueta em todos os vendedores
        let fresco = 0, recente = 0, parado = 0, semDado = 0, total = 0
        for (const linha of dataVE.linhas) {
          const c = linha.celulas[nome]
          if (!c) continue
          fresco += c.fresco
          recente += c.recente
          parado += c.parado
          semDado += c.sem_dado
          total += c.total
        }
        return { nome, Fresco: fresco, Recente: recente, Parado: parado, SemDado: semDado, total }
      })
      .filter(d => d.total > 0)
  }, [dataVE])

  const dadosPie = useMemo(() => {
    if (!data) return []
    return [
      { name: 'Fresco', value: data.totaisGerais.fresco, fill: STATUS_COLORS.fresco },
      { name: 'Recente', value: data.totaisGerais.recente, fill: STATUS_COLORS.recente },
      { name: 'Parado', value: data.totaisGerais.parado, fill: STATUS_COLORS.parado },
      { name: 'Sem dado', value: data.totaisGerais.semDado, fill: STATUS_COLORS.semDado },
    ].filter(d => d.value > 0)
  }, [data])

  const matriz = useMemo(() => {
    if (!data) return null
    // Mostra só top 10 etiquetas
    const topEtiquetas = data.porEtiqueta.slice(0, 10)
    return { etiquetas: topEtiquetas, vendedores: data.vendedores }
  }, [data])

  const detalhesEtiqueta: AggregacaoEtiqueta | undefined = useMemo(() => {
    if (!filtroEtiqueta || !data) return undefined
    return data.porEtiqueta.find(e => e.nomeCanonico === filtroEtiqueta)
  }, [filtroEtiqueta, data])

  if (isLoading) return <PageLoading />
  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6 border-danger/40 bg-danger-bg/10">
          <p className="text-danger font-medium">Erro ao carregar painel</p>
          <p className="text-[12px] text-ink-muted mt-1">{(error as Error).message}</p>
        </Card>
      </div>
    )
  }
  if (!data) return null

  const t = data.totaisGerais
  const pctParado = t.chats > 0 ? (t.parado / t.chats) * 100 : 0
  // Detecta se ainda não chegou dado temporal (extensão antiga em todos vendedores)
  const semDadoTemporal = t.chats > 0 && t.semDado === t.chats

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <header>
        <h1 className="text-[18px] font-semibold text-ink flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          Painel de Etiquetas WA
        </h1>
        <p className="text-[12px] text-ink-muted mt-0.5">
          Distribuição real dos chats por etiqueta + status temporal (última mensagem)
        </p>
      </header>

      {/* Banner: extensão antiga (sem dado temporal) */}
      {semDadoTemporal && (
        <Card className="p-3 border-warning/40 bg-warning-bg/15">
          <p className="text-[12px] text-warning font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Status temporal indisponível
          </p>
          <p className="text-[11px] text-ink-muted mt-1">
            Os vendedores precisam atualizar a extensão Branorte WA Sync para a versão mais recente (≥ 0.57.0).
            Após atualizar, em ~30s os dados de "fresco/parado/aguardando" começam a aparecer aqui.
          </p>
        </Card>
      )}

      {/* Kanban-style: cada etiqueta com contagem de parados + aguardando em destaque
          Ordem: jornada do funil (PROSPECCAO → LEAD QUENTE → ORCAMENTO → INTERESSE → VENDIDO),
          depois o resto (NUNCA RESPONDEU, NAO TEM INTERESSE, etc) por total descendente */}
      <div className="overflow-x-auto -mx-4 md:-mx-6 px-4 md:px-6 pb-2">
        <div className="flex gap-2 min-w-max">
          {(() => {
            const ORDEM_JORNADA = [
              'PROSPECCAO', '2A TENTATIVA', '2a TENTATIVA', 'NOVO LEAD',
              'FOLLOW UP', 'LEAD QUENTE',
              'ORCAMENTO ENVIADO', 'INTERESSE FUTURO', 'VENDIDO',
            ]
            const arr = [...data.porEtiqueta]
            arr.sort((a, b) => {
              const ia = ORDEM_JORNADA.indexOf(a.nomeCanonico)
              const ib = ORDEM_JORNADA.indexOf(b.nomeCanonico)
              // Ambos no funil → segue ordem da jornada
              if (ia !== -1 && ib !== -1) return ia - ib
              // Só a no funil → a vem antes
              if (ia !== -1) return -1
              // Só b no funil → b vem antes
              if (ib !== -1) return 1
              // Nenhum no funil → ordena por total desc
              return b.total - a.total
            })
            return arr.slice(0, 12)
          })().map(e => {
            const cor = corDaEtiqueta(e.nomeCanonico)
            const pctParado = e.total > 0 ? (e.parado / e.total) * 100 : 0
            const isAlerta = e.parado > 0 && pctParado >= 50
            const semTemporal = e.fresco === 0 && e.recente === 0 && e.parado === 0
            return (
              <button
                key={e.nomeCanonico}
                onClick={() => setFiltroEtiqueta(e.nomeCanonico)}
                className="text-left rounded-lg border bg-bg hover:bg-surface-2/50 transition-all p-3 min-w-[200px] shrink-0"
                style={{ borderColor: cor + '55', borderTopWidth: '3px', borderTopColor: cor }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider truncate flex-1" style={{ color: cor }}>
                    {e.nomeCanonico}
                  </div>
                </div>
                {/* Total grande — sempre */}
                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className="text-[28px] font-bold tabular-nums leading-none text-ink">
                    {e.total}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                    chats
                  </span>
                </div>
                {/* Aguardando resposta — destaque máximo (cliente esperando) */}
                {e.aguardando > 0 && (
                  <div className="flex items-baseline gap-1.5 mb-1.5 px-2 py-1 rounded bg-warning-bg/30 border border-warning/30">
                    <Reply className="h-3 w-3 text-warning shrink-0" />
                    <span className="text-[16px] font-bold tabular-nums leading-none text-warning">
                      {e.aguardando}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-warning font-bold">
                      aguardando
                    </span>
                  </div>
                )}
                {/* Parados (apenas se houver dado temporal) */}
                {!semTemporal && (
                  <>
                    <div className="flex items-baseline gap-1.5 mb-2">
                      <span className={`text-[18px] font-bold tabular-nums leading-none ${isAlerta ? 'text-danger' : 'text-ink'}`}>
                        {e.parado}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                        parados ({pctParado.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-2">
                      {e.fresco > 0 && (
                        <div style={{ flex: e.fresco, backgroundColor: STATUS_COLORS.fresco }} title={`${e.fresco} frescos`} />
                      )}
                      {e.recente > 0 && (
                        <div style={{ flex: e.recente, backgroundColor: STATUS_COLORS.recente }} title={`${e.recente} recentes`} />
                      )}
                      {e.parado > 0 && (
                        <div style={{ flex: e.parado, backgroundColor: STATUS_COLORS.parado }} title={`${e.parado} parados`} />
                      )}
                      {e.semDado > 0 && (
                        <div style={{ flex: e.semDado, backgroundColor: STATUS_COLORS.semDado }} title={`${e.semDado} sem dado`} />
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[9px] text-ink-faint tabular-nums">
                      <span>🟢 {e.fresco}</span>
                      <span>🟡 {e.recente}</span>
                      <span className={isAlerta ? 'text-danger font-bold' : ''}>🔴 {e.parado}</span>
                      {e.semDado > 0 && <span>⚫ {e.semDado}</span>}
                    </div>
                  </>
                )}
                {/* Por vendedor (sempre visível) */}
                <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
                  {Object.entries(e.porVendedor)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([vend, count]) => (
                      <div key={vend} className="flex items-center justify-between text-[10px] text-ink-faint">
                        <span className="truncate">{vend.split(' ')[0]}</span>
                        <span className="tabular-nums font-bold text-ink-muted">{count}</span>
                      </div>
                    ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* KPIs (só com dado temporal) */}
      {!semDadoTemporal && (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Total de chats
          </div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(t.chats)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">com etiqueta</div>
        </Card>
        <Card className="p-4 border-success/30 bg-success-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-success font-medium flex items-center gap-1">
            <Flame className="h-3 w-3" />
            Frescos
          </div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(t.fresco)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">&lt;24h</div>
        </Card>
        <Card className="p-4 border-warning/30 bg-warning-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-warning font-medium flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Recentes
          </div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(t.recente)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">1-3 dias</div>
        </Card>
        <Card className="p-4 border-danger/30 bg-danger-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-danger font-medium flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Parados
          </div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(t.parado)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">&gt;3 dias · {pctParado.toFixed(1)}%</div>
        </Card>
        <Card className="p-4 border-warning/40 bg-warning-bg/15">
          <div className="text-[10px] uppercase tracking-wider text-warning font-medium flex items-center gap-1">
            <Reply className="h-3 w-3" />
            Aguardando você
          </div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(t.aguardando)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">cliente foi o último</div>
        </Card>
      </div>
      )}

      {/* KPIs simplificados quando sem dado temporal */}
      {semDadoTemporal && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium flex items-center gap-1">
              <Activity className="h-3 w-3" />
              Total de chats
            </div>
            <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(t.chats)}</div>
            <div className="text-[10px] text-ink-faint mt-0.5">com etiqueta</div>
          </Card>
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium">
              Etiquetas no funil
            </div>
            <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{data.porEtiqueta.length}</div>
            <div className="text-[10px] text-ink-faint mt-0.5">categorias usadas</div>
          </Card>
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium">
              Vendedores ativos
            </div>
            <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{data.vendedores.length}</div>
            <div className="text-[10px] text-ink-faint mt-0.5">sincronizando</div>
          </Card>
        </div>
      )}

      {/* 🎯 FUNIL DE VENDAS ISOLADO — só etiquetas ativas do funil, em ordem da jornada */}
      {dadosFunil.length > 0 && (
        <Card className="p-4 border-accent/30 bg-gradient-to-br from-bg to-surface-2/30">
          <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
            <h2 className="text-[13px] font-semibold text-ink flex items-center gap-2">
              <Flame className="h-4 w-4 text-accent" />
              Funil de vendas <span className="text-ink-faint font-normal text-[11px]">(jornada do lead)</span>
            </h2>
            <div className="flex gap-3 text-[10px] text-ink-muted">
              <span><span className="font-bold text-ink">{dadosFunil.reduce((a,b)=>a+b.total,0)}</span> no funil</span>
              <span>· <span className="text-danger font-bold">{dadosFunil.reduce((a,b)=>a+b.Parado,0)}</span> parados</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(280, dadosFunil.length * 38)}>
            <BarChart data={dadosFunil} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis
                dataKey="nome"
                type="category"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#e7e9ee', fontWeight: 600 }}
                width={160}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
                formatter={(v: number, name: string) => [v, name]}
              />
              {/* Só Parados — Fresco/Recente/SemDado escondidos pra focar no que precisa ação */}
              <Bar
                dataKey="Parado"
                fill={STATUS_COLORS.parado}
                onClick={(d: any) => setFiltroEtiqueta(d.nome)}
                cursor="pointer"
              >
                <LabelList
                  dataKey="Parado"
                  position="right"
                  style={{ fontSize: 11, fill: '#fca5a5', fontWeight: 700 }}
                  formatter={(v: number) => v > 0 ? v : ''}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* 🚨 PARADOS POR VENDEDOR — só etapas do funil ativo, só Parados (3-30d) */}
      {dataVE && dataVE.linhas.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold text-ink mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-danger" />
            Parados no funil por vendedor
            <span className="text-[10px] font-normal text-ink-muted ml-1">
              · só clientes parados &gt;3d nas 5 etapas ativas
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {dataVE.linhas.map(linha => {
              const ETAPAS = ['PROSPECCAO', '2a TENTATIVA', 'NOVO LEAD', 'FOLLOW UP', 'LEAD QUENTE']
              const dadosVendor = ETAPAS.map(et => ({
                nome: et,
                Parado: linha.celulas[et]?.parado || 0,
                total: linha.celulas[et]?.total || 0,
              }))
              const totalParados = dadosVendor.reduce((a, b) => a + b.Parado, 0)
              const totalFunil = dadosVendor.reduce((a, b) => a + b.total, 0)
              const pctParado = totalFunil > 0 ? Math.round((totalParados / totalFunil) * 100) : 0
              return (
                <div key={linha.vendedor_id} className="border border-border rounded-lg p-3 bg-surface-2/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={linha.vendedor} size="sm" />
                      <span className="text-[12px] font-semibold text-ink">{linha.vendedor}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-[16px] font-bold tabular-nums text-danger">{totalParados}</div>
                      <div className="text-[9px] text-ink-faint uppercase tracking-wider">parados</div>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={dadosVendor} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} hide />
                      <YAxis
                        dataKey="nome"
                        type="category"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 9, fill: '#cbd5e1', fontWeight: 500 }}
                        width={92}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10 }}
                        formatter={(v: number) => [v, 'Parados']}
                      />
                      <Bar dataKey="Parado" fill={STATUS_COLORS.parado}>
                        <LabelList dataKey="Parado" position="right" style={{ fontSize: 10, fill: '#fca5a5', fontWeight: 700 }} formatter={(v: number) => v > 0 ? v : ''} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-between mt-1 pt-2 border-t border-border/50">
                    <span className="text-[9px] text-ink-faint uppercase tracking-wider">
                      {totalFunil} no funil
                      {linha.sem_etiqueta && linha.sem_etiqueta.total > 0 && (
                        <span className="ml-2 text-warning">
                          · <span className="font-bold">{linha.sem_etiqueta.total}</span> sem etiqueta
                        </span>
                      )}
                    </span>
                    <span className="text-[9px] text-ink-faint">
                      <span className="text-danger font-bold">{pctParado}%</span> parado
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Resumo geral no rodapé */}
          {dataVE.total_sem_etiqueta > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
              <span className="text-warning font-medium">
                {dataVE.total_sem_etiqueta} chats sem etiqueta
              </span>
              <span className="text-ink-muted">
                · precisam de classificação inicial
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Stacked bar: chats por etiqueta */}
      <div className={`grid grid-cols-1 ${semDadoTemporal ? '' : 'lg:grid-cols-3'} gap-4`}>
        <Card className={`p-4 ${semDadoTemporal ? '' : 'lg:col-span-2'}`}>
          <h2 className="text-[13px] font-semibold text-ink mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-accent" />
            Chats por etiqueta {semDadoTemporal ? '' : '(status temporal)'}
          </h2>
          <ResponsiveContainer width="100%" height={Math.max(360, dadosBarras.length * 32)}>
            <BarChart data={dadosBarras} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis
                dataKey="nome"
                type="category"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#e7e9ee', fontWeight: 500 }}
                width={150}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
                formatter={(v: number, name: string) => [v, name]}
              />
              {semDadoTemporal ? (
                // Sem dado temporal: barra única com cor da etiqueta
                <Bar dataKey="total" onClick={(d: any) => setFiltroEtiqueta(d.nome)} cursor="pointer">
                  {dadosBarras.map((d, i) => <Cell key={i} fill={corDaEtiqueta(d.nome)} />)}
                  <LabelList dataKey="total" position="right" style={{ fontSize: 11, fill: '#e7e9ee', fontWeight: 700 }} />
                </Bar>
              ) : (
                <>
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                  <Bar dataKey="Fresco" stackId="a" fill={STATUS_COLORS.fresco} onClick={(d: any) => setFiltroEtiqueta(d.nome)} cursor="pointer" />
                  <Bar dataKey="Recente" stackId="a" fill={STATUS_COLORS.recente} onClick={(d: any) => setFiltroEtiqueta(d.nome)} cursor="pointer" />
                  <Bar dataKey="Parado" stackId="a" fill={STATUS_COLORS.parado} onClick={(d: any) => setFiltroEtiqueta(d.nome)} cursor="pointer" />
                  <Bar dataKey="SemDado" stackId="a" fill={STATUS_COLORS.semDado} onClick={(d: any) => setFiltroEtiqueta(d.nome)} cursor="pointer">
                    <LabelList dataKey="total" position="right" style={{ fontSize: 11, fill: '#e7e9ee', fontWeight: 700 }} />
                  </Bar>
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {!semDadoTemporal && (
          <Card className="p-4">
            <h2 className="text-[13px] font-semibold text-ink mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" />
              Distribuição geral
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={dadosPie}
                  dataKey="value"
                  nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={90}
                  paddingAngle={2}
                  label={(d: any) => `${d.value}`}
                  labelLine={false}
                >
                  {dadosPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Detalhe quando clica numa etiqueta */}
      {detalhesEtiqueta && (
        <Card className="p-4 border-accent/40 bg-accent-bg/5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-ink flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: corDaEtiqueta(detalhesEtiqueta.nomeCanonico) }} />
                {detalhesEtiqueta.nomeCanonico}
              </h2>
              <p className="text-[11px] text-ink-muted mt-0.5">
                {detalhesEtiqueta.total} chats · <span className="text-warning font-semibold">{detalhesEtiqueta.aguardando} aguardando você</span> · {detalhesEtiqueta.parado} parados · {detalhesEtiqueta.fresco} frescos
              </p>
            </div>
            <button
              onClick={() => setFiltroEtiqueta(null)}
              className="text-[11px] px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink"
            >
              fechar
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(detalhesEtiqueta.porVendedor)
              .sort((a, b) => b[1] - a[1])
              .map(([vend, count]) => (
                <div key={vend} className="flex items-center gap-2 p-2 rounded-md bg-surface-2">
                  <Avatar name={vend} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-ink truncate">{vend}</div>
                    <div className="text-[10px] text-ink-faint">{count} chats</div>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Matriz vendedor x etiqueta — fonte: `cards` via endpoint vendedor-x-etiqueta
          (todos vendedores com cards reais, não só os que usaram extensão antiga) */}
      {dataVE && dataVE.linhas.length > 0 && (() => {
        // Top 10 etiquetas por total
        const topCols = dataVE.colunas.slice(0, 10)
        return (
          <Card className="p-4 overflow-x-auto">
            <h2 className="text-[13px] font-semibold text-ink mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-accent" />
              Vendedor × Etiqueta
              <span className="text-[10px] font-normal text-ink-muted ml-1">
                · {dataVE.linhas.length} vendedores · {formatNumber(dataVE.total_geral)} cards
              </span>
            </h2>
            <table className="w-full border-collapse min-w-[600px]">
              <thead>
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-wider text-ink-faint font-medium px-2 py-2 sticky left-0 bg-bg">Vendedor</th>
                  {topCols.map(col => (
                    <th
                      key={col.stage_id}
                      className="text-center text-[10px] uppercase tracking-wider font-medium px-2 py-2 cursor-pointer hover:bg-surface-2"
                      style={{ color: corDaEtiqueta(col.etiqueta) }}
                      onClick={() => setFiltroEtiqueta(col.etiqueta)}
                      title="Clique para detalhes"
                    >
                      {col.etiqueta.length > 14 ? col.etiqueta.slice(0, 12) + '…' : col.etiqueta}
                    </th>
                  ))}
                  <th className="text-center text-[10px] uppercase tracking-wider text-ink-faint font-medium px-2 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {dataVE.linhas.map(linha => (
                  <tr key={linha.vendedor_id} className="border-t border-border hover:bg-surface-2/50">
                    <td className="px-2 py-2 sticky left-0 bg-bg">
                      <div className="flex items-center gap-2">
                        <Avatar name={linha.vendedor} size="sm" />
                        <span className="text-[12px] font-medium text-ink">{linha.vendedor}</span>
                      </div>
                    </td>
                    {topCols.map(col => {
                      const cell = linha.celulas[col.etiqueta]
                      const count = cell?.total || 0
                      const intensity = col.total > 0 ? Math.min(1, count / Math.max(1, col.total / dataVE.linhas.length * 2)) : 0
                      return (
                        <td key={col.stage_id} className="px-2 py-1 text-center text-[12px] font-medium tabular-nums">
                          {count > 0 ? (
                            <span
                              className="inline-block px-2 py-0.5 rounded text-ink"
                              style={{
                                backgroundColor: `${corDaEtiqueta(col.etiqueta)}${Math.round(intensity * 60 + 10).toString(16).padStart(2, '0')}`,
                              }}
                              title={`${count} total · 🔥 ${cell?.fresco||0} fresco · ⚡ ${cell?.recente||0} recente · 🔴 ${cell?.parado||0} parado`}
                            >
                              {count}
                            </span>
                          ) : (
                            <span className="text-ink-faint">·</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-center text-[12px] font-bold tabular-nums text-ink">{linha.total}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-surface-2/30">
                  <td className="px-2 py-2 sticky left-0 bg-surface-2/50 text-[10px] uppercase tracking-wider text-ink-muted font-medium">Total</td>
                  {topCols.map(col => (
                    <td key={col.stage_id} className="px-2 py-2 text-center text-[12px] font-bold tabular-nums text-ink">{col.total}</td>
                  ))}
                  <td className="px-2 py-2 text-center text-[12px] font-bold tabular-nums text-ink">
                    {dataVE.total_geral}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        )
      })()}

      {/* Footer com legenda */}
      {!semDadoTemporal && (
        <Card className="p-3 bg-surface-2/30">
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="text-ink-muted font-medium">Status temporal (última mensagem):</span>
            <StatusBadge status="fresco" />
            <StatusBadge status="recente" />
            <StatusBadge status="parado" />
            <StatusBadge status="semDado" />
          </div>
        </Card>
      )}
    </div>
  )
}
