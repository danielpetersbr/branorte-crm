import { useEffect, useMemo, useState } from 'react'
import { Activity, MessageSquare, Users, Calendar, RefreshCw, Headset } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'

type Metrica = 'atendimentos' | 'chats_ativos' | 'msgs_estimadas'

interface AtividadeRow {
  vendedor_nome: string
  dia: string  // YYYY-MM-DD
  atendimentos: number   // conversa de mao-dupla no dia (fonte: vendedor_atend_dia)
  chats_ativos: number
  msgs_estimadas: number
}

// Rotulo / cor / emoji de cada metrica (atendimento e o foco).
const META_INFO: Record<Metrica, { label: string; emoji: string }> = {
  atendimentos: { label: 'Atendimentos', emoji: '📞' },
  chats_ativos: { label: 'Chats ativos', emoji: '👥' },
  msgs_estimadas: { label: 'Mensagens', emoji: '💬' },
}

// Vendedores ocultos do dashboard (admins/testes que distorcem ranking).
// Comparação é case-insensitive e por includes.
const VENDEDORES_OCULTOS = ['DANIEL']

const CORES_VENDEDOR: Record<string, string> = {
  EDILSON: '#3b82f6',
  'EDILSON JR': '#3b82f6',
  PEDRO: '#10b981',
  JARDEL: '#f59e0b',
  EDER: '#8b5cf6',
  ALVARO: '#ec4899',
  RAMON: '#06b6d4',
  GUSTAVO: '#f97316',
  DANIEL: '#dc2626',
}

function corDoVendedor(nome: string): string {
  const upper = nome.toUpperCase()
  for (const [k, v] of Object.entries(CORES_VENDEDOR)) {
    if (upper.includes(k)) return v
  }
  // fallback estável por hash do nome
  const h = [...nome].reduce((a, c) => a + c.charCodeAt(0), 0)
  const cores = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#dc2626']
  return cores[h % cores.length]
}

function fmtData(d: string): string {
  const [, m, dd] = d.split('-')
  return `${dd}/${m}`
}

export function AtividadeDiaria() {
  const [rows, setRows] = useState<AtividadeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState<1 | 7 | 14 | 30>(7)
  const [metrica, setMetrica] = useState<Metrica>('atendimentos')

  async function carregar() {
    setLoading(true)
    const desde = new Date()
    desde.setDate(desde.getDate() - periodo + 1)
    desde.setHours(0, 0, 0, 0)
    const desdeStr = desde.toISOString().slice(0, 10)

    // Atendimento vem de vendedor_atend_dia (mão-dupla/dia); chats+msgs de wa_daily_activity.
    // Mescla por (vendedor, dia) — ambas usam nome curto em maiúscula.
    const [atendRes, actRes] = await Promise.all([
      supabase
        .from('vendedor_atend_dia')
        .select('vendedor_nome,dia,atendimentos')
        .gte('dia', desdeStr),
      supabase
        .from('wa_daily_activity')
        .select('vendedor_nome,dia,chats_ativos,msgs_estimadas')
        .gte('dia', desdeStr),
    ])

    const merged = new Map<string, AtividadeRow>()
    const keyOf = (v: string, d: string) => `${(v || '').toUpperCase()}|${d}`
    const base = (v: string, d: string): AtividadeRow =>
      merged.get(keyOf(v, d)) ?? { vendedor_nome: v, dia: d, atendimentos: 0, chats_ativos: 0, msgs_estimadas: 0 }

    for (const r of (atendRes.data ?? []) as Array<{ vendedor_nome: string; dia: string; atendimentos: number }>) {
      const cur = base(r.vendedor_nome, r.dia)
      cur.atendimentos = r.atendimentos ?? 0
      merged.set(keyOf(r.vendedor_nome, r.dia), cur)
    }
    for (const r of (actRes.data ?? []) as Array<{ vendedor_nome: string; dia: string; chats_ativos: number; msgs_estimadas: number }>) {
      const cur = base(r.vendedor_nome, r.dia)
      cur.chats_ativos = r.chats_ativos ?? 0
      cur.msgs_estimadas = r.msgs_estimadas ?? 0
      merged.set(keyOf(r.vendedor_nome, r.dia), cur)
    }

    const filtradas = Array.from(merged.values())
      .filter(r => {
        const nome = r.vendedor_nome.toUpperCase()
        return !VENDEDORES_OCULTOS.some(oculto => nome.includes(oculto))
      })
      .sort((a, b) => a.dia.localeCompare(b.dia))
    setRows(filtradas)
    setLoading(false)
  }

  useEffect(() => { carregar() }, [periodo])

  // Agrega: pra cada dia, soma todos os vendedores (usando a métrica selecionada)
  const { dadosGrafico, vendedores, totaisHoje, totaisPeriodo } = useMemo(() => {
    const vendedoresSet = new Set<string>()
    const porDia = new Map<string, Record<string, number>>()
    for (const r of rows) {
      vendedoresSet.add(r.vendedor_nome)
      if (!porDia.has(r.dia)) porDia.set(r.dia, {})
      porDia.get(r.dia)![r.vendedor_nome] = r[metrica]
    }
    const vendedores = Array.from(vendedoresSet).sort()
    const dadosGrafico = Array.from(porDia.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, vals]) => ({ dia: fmtData(dia), diaCompleto: dia, ...vals }))

    // Totais hoje
    const hoje = new Date().toISOString().slice(0, 10)
    const dadosHoje = rows.filter(r => r.dia === hoje)
    const totaisHoje = {
      atend: dadosHoje.reduce((s, r) => s + r.atendimentos, 0),
      chats: dadosHoje.reduce((s, r) => s + r.chats_ativos, 0),
      msgs: dadosHoje.reduce((s, r) => s + r.msgs_estimadas, 0),
      vendedores_ativos: dadosHoje.length,
    }

    // Totais período
    const totaisPeriodo = {
      atend: rows.reduce((s, r) => s + r.atendimentos, 0),
      chats: rows.reduce((s, r) => s + r.chats_ativos, 0),
      msgs: rows.reduce((s, r) => s + r.msgs_estimadas, 0),
    }
    return { dadosGrafico, vendedores, totaisHoje, totaisPeriodo }
  }, [rows, metrica])

  // Ranking por vendedor (período)
  const ranking = useMemo(() => {
    const map = new Map<string, { atend: number; chats: number; msgs: number }>()
    for (const r of rows) {
      const cur = map.get(r.vendedor_nome) || { atend: 0, chats: 0, msgs: 0 }
      cur.atend += r.atendimentos
      cur.chats += r.chats_ativos
      cur.msgs += r.msgs_estimadas
      map.set(r.vendedor_nome, cur)
    }
    const val = (o: { atend: number; chats: number; msgs: number }) =>
      metrica === 'atendimentos' ? o.atend : metrica === 'chats_ativos' ? o.chats : o.msgs
    return Array.from(map.entries())
      .map(([vendedor, v]) => ({ vendedor, ...v }))
      .sort((a, b) => val(b) - val(a))
  }, [rows, metrica])

  if (loading) return <PageLoading />

  const info = META_INFO[metrica]
  const valorRanking = (r: { atend: number; chats: number; msgs: number }) =>
    metrica === 'atendimentos' ? r.atend : metrica === 'chats_ativos' ? r.chats : r.msgs
  // texto secundário do ranking: mostra atendimento quando não é a métrica ativa (msgs é irrelevante)
  const secundarioRanking = (r: { atend: number; chats: number; msgs: number }) =>
    metrica === 'atendimentos' ? `${formatNumber(r.chats)} chats` : `${formatNumber(r.atend)} atend`

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Activity className="w-7 h-7 text-emerald-500" />
            <h1 className="text-2xl font-bold">Atividade Diária</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Atendimentos (conversa de mão-dupla) por vendedor e por dia
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1 border border-zinc-800">
            {([1, 7, 14, 30] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition ${periodo === p ? 'bg-emerald-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
              >
                {p === 1 ? 'Hoje' : `${p}d`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1 border border-zinc-800">
            <button
              onClick={() => setMetrica('atendimentos')}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition ${metrica === 'atendimentos' ? 'bg-emerald-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              <Headset className="w-3 h-3 inline mr-1" /> Atendimentos
            </button>
            <button
              onClick={() => setMetrica('chats_ativos')}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition ${metrica === 'chats_ativos' ? 'bg-blue-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              <Users className="w-3 h-3 inline mr-1" /> Chats
            </button>
            <button
              onClick={() => setMetrica('msgs_estimadas')}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition ${metrica === 'msgs_estimadas' ? 'bg-purple-500 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              <MessageSquare className="w-3 h-3 inline mr-1" /> Msgs
            </button>
          </div>
          <button
            onClick={carregar}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-2">
            <Headset className="w-3.5 h-3.5" /> Atendimentos hoje
          </div>
          <div className="text-3xl font-bold text-emerald-400">{formatNumber(totaisHoje.atend)}</div>
          <div className="text-xs text-zinc-500 mt-1">mão-dupla · {totaisHoje.vendedores_ativos} vendedores ativos</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" /> {periodo === 1 ? 'Atend. hoje' : `Atend. ${periodo}d`}
          </div>
          <div className="text-3xl font-bold text-blue-400">{formatNumber(totaisPeriodo.atend)}</div>
          {periodo > 1 && (
            <div className="text-xs text-zinc-500 mt-1">~{Math.round(totaisPeriodo.atend / periodo)}/dia</div>
          )}
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> Chats hoje
          </div>
          <div className="text-3xl font-bold text-zinc-300">{formatNumber(totaisHoje.chats)}</div>
          <div className="text-xs text-zinc-500 mt-1">conversas com atividade</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5" /> Mensagens hoje
          </div>
          <div className="text-3xl font-bold text-zinc-300">{formatNumber(totaisHoje.msgs)}</div>
          <div className="text-xs text-zinc-500 mt-1">trocas estimadas</div>
        </Card>
      </div>

      {/* Gráfico empilhado */}
      <Card className="p-5">
        <div className="text-sm font-bold uppercase tracking-wide text-zinc-300 mb-4">
          {info.emoji} {info.label} por vendedor · {periodo === 1 ? 'hoje' : `últimos ${periodo} dias`}
        </div>
        {dadosGrafico.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-zinc-500 text-sm">
            Sem dados ainda. A extensão precisa estar rodando nos PCs dos vendedores e enviando syncs.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={dadosGrafico}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="dia" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {vendedores.map(v => (
                <Bar key={v} dataKey={v} stackId="a" fill={corDoVendedor(v)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Ranking */}
      <Card className="p-5">
        <div className="text-sm font-bold uppercase tracking-wide text-zinc-300 mb-4">
          🏆 Ranking · {info.label.toLowerCase()} no período
        </div>
        <div className="space-y-2">
          {ranking.map((r, i) => {
            const valor = valorRanking(r)
            const max = ranking[0] ? valorRanking(ranking[0]) : 1
            const pct = max > 0 ? (valor / max) * 100 : 0
            return (
              <div key={r.vendedor} className="flex items-center gap-3">
                <div className="text-zinc-500 font-mono text-xs w-6 text-right">{i + 1}.</div>
                <div className="w-3 h-3 rounded-full" style={{ background: corDoVendedor(r.vendedor) }} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-semibold truncate">{r.vendedor}</span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: corDoVendedor(r.vendedor) }}>
                      {formatNumber(valor)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: corDoVendedor(r.vendedor) }}
                    />
                  </div>
                </div>
                <div className="text-xs text-zinc-500 tabular-nums">
                  {secundarioRanking(r)}
                </div>
              </div>
            )
          })}
          {ranking.length === 0 && (
            <div className="text-center text-zinc-500 text-sm py-8">Sem dados no período</div>
          )}
        </div>
      </Card>

      <div className="text-xs text-zinc-500 text-center">
        Atendimento = conversa individual com mensagem dos <b>dois lados</b> no mesmo dia (mesma régua do painel do escritório).
        Atualizado pela extensão Branorte WA Sync. Mensagens são <b>estimativa</b>.
      </div>
    </div>
  )
}
