import { useMemo } from 'react'
import { BarChart3, TrendingDown, Trophy, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { useEtiquetas, type WascriptEtiqueta } from '@/hooks/useEtiquetas'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts'

// ===== Definições de funil/fechamento =====

const FUNIL: { id: string; label: string; cor: string }[] = [
  { id: 'PROSPECCAO',       label: 'Prospecção',     cor: '#3b82f6' },
  { id: '2A TENTATIVA',     label: '2ª Tentativa',   cor: '#06b6d4' },
  { id: 'NOVO LEAD',        label: 'Novo Lead',      cor: '#8b5cf6' },
  { id: 'FOLLOW UP',        label: 'Follow Up',      cor: '#f59e0b' },
  { id: 'INTERESSE FUTURO', label: 'Interesse Fut.', cor: '#facc15' },
  { id: 'VENDIDO',          label: 'Vendido',        cor: '#10b981' },
]

const MOTIVOS: { id: string; label: string; cor: string }[] = [
  { id: 'NAO RESPONDEU MAIS',      label: 'Não respondeu mais', cor: '#94a3b8' },
  { id: 'NUNCA RESPONDEU',         label: 'Nunca respondeu',     cor: '#64748b' },
  { id: 'NAO TEM INTERESSE',       label: 'Sem interesse',       cor: '#a78bfa' },
  { id: 'COMPROU DO CONCORRENTE',  label: 'Concorrente',         cor: '#ef4444' },
  { id: 'SO BASE DE PRECO',        label: 'Só base de preço',    cor: '#f97316' },
  { id: 'FORA DO ORCAMENTO',       label: 'Fora do orçamento',   cor: '#fb7185' },
  { id: 'NAO FABRICAMOS',          label: 'Não fabricamos',      cor: '#0ea5e9' },
  { id: 'OUTROS ASSUNTOS',         label: 'Outros',              cor: '#71717a' },
]

const ALIASES: Record<string, string> = {
  'FALLOW UP': 'FOLLOW UP',
  'FALLOWUP': 'FOLLOW UP',
  'FOLLOWUP': 'FOLLOW UP',
  'COMPROU DO COMCORRENTE': 'COMPROU DO CONCORRENTE',
  'PROSPECCOES': 'PROSPECCAO',
  'NOVOS LEADS': 'NOVO LEAD',
  'LEAD NOVO': 'NOVO LEAD',
  'VENDIDOS': 'VENDIDO',
}

function canonicalize(nome: string): string {
  return ALIASES[nome] ?? nome
}

interface VendedorStats {
  vendedor: string
  funil: Record<string, number>      // por id de etapa
  motivos: Record<string, number>    // por id de motivo
  totalFunil: number                 // soma das 6 etapas
  totalMotivos: number               // soma dos 8 motivos
  totalGeral: number
  vendidos: number
  conversao: number                  // vendidos / totalFunil
}

function agregarPorVendedor(rows: WascriptEtiqueta[]): VendedorStats[] {
  const map = new Map<string, VendedorStats>()
  const idsFunil = new Set(FUNIL.map(f => f.id))
  const idsMotivos = new Set(MOTIVOS.map(m => m.id))

  for (const row of rows) {
    const v = row.vendedor_nome.toUpperCase().trim()
    if (!map.has(v)) {
      map.set(v, {
        vendedor: v,
        funil: Object.fromEntries(FUNIL.map(f => [f.id, 0])),
        motivos: Object.fromEntries(MOTIVOS.map(m => [m.id, 0])),
        totalFunil: 0,
        totalMotivos: 0,
        totalGeral: 0,
        vendidos: 0,
        conversao: 0,
      })
    }
    const s = map.get(v)!
    const id = canonicalize(row.etiqueta_nome_normalizado)
    const count = row.total_contatos ?? 0

    if (idsFunil.has(id)) {
      s.funil[id] += count
      s.totalFunil += count
    } else if (idsMotivos.has(id)) {
      s.motivos[id] += count
      s.totalMotivos += count
    }
    s.totalGeral += count
    if (id === 'VENDIDO') s.vendidos += count
  }

  for (const s of map.values()) {
    s.conversao = s.totalFunil > 0 ? (s.vendidos / s.totalFunil) * 100 : 0
  }

  return Array.from(map.values()).sort((a, b) => b.totalGeral - a.totalGeral)
}

// ====================================================================
// Componente: Funil horizontal de um vendedor
// ====================================================================
function FunilDoVendedor({ stats }: { stats: VendedorStats }) {
  const data = FUNIL.map(f => ({
    label: f.label,
    cor: f.cor,
    value: stats.funil[f.id] ?? 0,
  }))
  const max = Math.max(...data.map(d => d.value), 1)

  return (
    <div className="space-y-1.5">
      {data.map(d => {
        const pct = (d.value / max) * 100
        return (
          <div key={d.label} className="flex items-center gap-2">
            <span className="text-[10px] w-24 shrink-0 text-ink-muted truncate">{d.label}</span>
            <div className="flex-1 h-5 bg-surface-2 rounded-md overflow-hidden relative">
              <div
                className="h-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: d.cor, opacity: 0.85 }}
              />
              <span className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-bold text-ink tabular-nums">
                {d.value}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ====================================================================
// Componente: Barras de motivos de fechamento (vendedor)
// ====================================================================
function MotivosDoVendedor({ stats }: { stats: VendedorStats }) {
  const data = MOTIVOS.map(m => ({
    label: m.label,
    cor: m.cor,
    value: stats.motivos[m.id] ?? 0,
  })).sort((a, b) => b.value - a.value)

  if (stats.totalMotivos === 0) {
    return <p className="text-[11px] text-ink-faint italic text-center py-4">Sem motivos registrados</p>
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          dataKey="label"
          type="category"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          width={120}
        />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
          contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: '#9ca3af' }}
          formatter={(v: number) => [v, 'contatos']}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.cor} />)}
          <LabelList
            dataKey="value"
            position="right"
            style={{ fontSize: 11, fill: '#e7e9ee', fontWeight: 600 }}
            formatter={(v: number) => v > 0 ? v : ''}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ====================================================================
// Comparativo agregado entre vendedores
// ====================================================================
function ComparativoVendedores({ allStats }: { allStats: VendedorStats[] }) {
  const data = allStats.map(s => ({
    vendedor: s.vendedor.split(' ')[0], // primeiro nome só
    Vendido: s.vendidos,
    'Em funil': s.totalFunil - s.vendidos,
    Fechados: s.totalMotivos,
    conversao: s.conversao,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <XAxis dataKey="vendedor" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
          contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
        />
        <Bar dataKey="Em funil"  stackId="a" fill="#3b82f6" />
        <Bar dataKey="Vendido"   stackId="a" fill="#10b981" />
        <Bar dataKey="Fechados"  stackId="a" fill="#ef4444" />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ====================================================================
// Conversão (ranking)
// ====================================================================
function RankingConversao({ allStats }: { allStats: VendedorStats[] }) {
  const sorted = [...allStats].sort((a, b) => b.conversao - a.conversao)
  return (
    <div className="space-y-2">
      {sorted.map((s, i) => (
        <div key={s.vendedor} className="flex items-center gap-3">
          <span className="text-[14px] font-bold text-ink-faint w-5 text-center">{i + 1}</span>
          <Avatar name={s.vendedor} size="sm" />
          <span className="text-[12px] font-medium text-ink flex-1 truncate">{s.vendedor}</span>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-[14px] font-bold text-success tabular-nums">{s.conversao.toFixed(1)}%</div>
              <div className="text-[9px] text-ink-faint">{s.vendidos}/{s.totalFunil}</div>
            </div>
            {i === 0 && s.conversao > 0 && <Trophy className="h-4 w-4 text-warning" />}
          </div>
        </div>
      ))}
    </div>
  )
}

// ====================================================================
// PÁGINA
// ====================================================================
export function EtiquetasZapGraficos() {
  const { data, isLoading, error } = useEtiquetas()

  const stats = useMemo(() => agregarPorVendedor(data ?? []), [data])

  const totaisGerais = useMemo(() => {
    return stats.reduce(
      (acc, s) => ({
        funil: acc.funil + s.totalFunil,
        motivos: acc.motivos + s.totalMotivos,
        vendidos: acc.vendidos + s.vendidos,
      }),
      { funil: 0, motivos: 0, vendidos: 0 },
    )
  }, [stats])

  const conversaoGeral = totaisGerais.funil > 0
    ? (totaisGerais.vendidos / totaisGerais.funil) * 100
    : 0

  const motivosAgregados = useMemo(() => {
    const m = Object.fromEntries(MOTIVOS.map(x => [x.id, 0]))
    for (const s of stats) for (const id of Object.keys(m)) m[id] += s.motivos[id] ?? 0
    return MOTIVOS.map(x => ({ ...x, value: m[x.id] }))
      .sort((a, b) => b.value - a.value)
  }, [stats])

  if (isLoading) return <PageLoading />
  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6 border-danger/40 bg-danger-bg/10">
          <p className="text-danger font-medium">Erro ao carregar gráficos</p>
          <p className="text-[12px] text-ink-muted mt-1">{(error as Error).message}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <header>
        <h1 className="text-[18px] font-semibold text-ink flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          Gráficos de Etiquetas
        </h1>
        <p className="text-[12px] text-ink-muted mt-0.5">
          Funil de vendas e motivos de fechamento por vendedor
        </p>
      </header>

      {/* Cards de totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-accent/30 bg-accent-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-accent font-medium">Em funil</div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(totaisGerais.funil)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">contatos ativos</div>
        </Card>
        <Card className="p-4 border-success/30 bg-success-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-success font-medium">Vendidos</div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(totaisGerais.vendidos)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">fecharam</div>
        </Card>
        <Card className="p-4 border-warning/30 bg-warning-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-warning font-medium">Conversão</div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{conversaoGeral.toFixed(1)}%</div>
          <div className="text-[10px] text-ink-faint mt-0.5">vendidos / funil</div>
        </Card>
        <Card className="p-4 border-danger/30 bg-danger-bg/10">
          <div className="text-[10px] uppercase tracking-wider text-danger font-medium">Fechados</div>
          <div className="mt-1 text-[24px] font-bold tabular-nums text-ink">{formatNumber(totaisGerais.motivos)}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">não converteram</div>
        </Card>
      </div>

      {/* Ranking + comparativo lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-warning" />
            <h2 className="text-[13px] font-semibold text-ink">Ranking de conversão</h2>
          </div>
          <RankingConversao allStats={stats} />
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-accent" />
            <h2 className="text-[13px] font-semibold text-ink">Comparativo de volume</h2>
          </div>
          <ComparativoVendedores allStats={stats} />
        </Card>
      </div>

      {/* Motivos agregados */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="h-4 w-4 text-danger" />
          <h2 className="text-[13px] font-semibold text-ink">Por que estamos perdendo (todos vendedores)</h2>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={motivosAgregados} margin={{ top: 8, right: 30, left: 0, bottom: 24 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              angle={-20}
              textAnchor="end"
              height={50}
            />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
              contentStyle={{ background: '#11151c', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {motivosAgregados.map((d, i) => <Cell key={i} fill={d.cor} />)}
              <LabelList
                dataKey="value"
                position="top"
                style={{ fontSize: 10, fill: '#e7e9ee', fontWeight: 600 }}
                formatter={(v: number) => v > 0 ? v : ''}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Por vendedor: funil + motivos lado a lado */}
      <div className="space-y-4">
        <h2 className="text-[13px] font-semibold text-ink uppercase tracking-wider px-1">
          Por vendedor
        </h2>
        {stats.map(s => (
          <Card key={s.vendedor} className="p-4 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-border">
              <Avatar name={s.vendedor} size="md" />
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-semibold text-ink">{s.vendedor}</h3>
                <p className="text-[10px] text-ink-faint uppercase tracking-wider mt-0.5">
                  {formatNumber(s.totalFunil)} no funil · {s.vendidos} vendidos · {s.conversao.toFixed(1)}% conv.
                </p>
              </div>
              {s.conversao === 0 && s.totalFunil > 0 && (
                <AlertTriangle className="h-4 w-4 text-warning" titleAccess="Sem conversão" />
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-2">
                  Funil de vendas
                </div>
                <FunilDoVendedor stats={s} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-2">
                  Motivos de fechamento
                </div>
                <MotivosDoVendedor stats={s} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
