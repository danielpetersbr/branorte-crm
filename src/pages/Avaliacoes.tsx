import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { supabase } from '@/lib/supabase'

// Painel ADMIN (dentro do Layout autenticado) das avaliações de atendimento
// enviadas pelos clientes na página pública /avaliacao. RLS: só authenticated lê.

interface AvaliacaoRow {
  id: string
  vendedor_nome: string | null
  telefone: string | null
  cliente_nome: string | null
  nota: number
  comentario: string | null
  motivo: string | null
  created_at: string
}

const CORES_NOTA = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981'] // 1★..5★

function estrelas(n: number) {
  const x = Math.max(0, Math.min(5, Math.round(n)))
  return '★★★★★'.slice(0, x) + '☆☆☆☆☆'.slice(0, 5 - x)
}
function corNota(n: number) {
  return n >= 4.5 ? '#10b981' : n >= 3.5 ? '#84cc16' : n >= 2.5 ? '#f59e0b' : n >= 1.5 ? '#f97316' : '#ef4444'
}
function fmtData(s: string) {
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function fmtTelefone(t: string | null) {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  const br = d.startsWith('55') ? d.slice(2) : d
  if (br.length >= 10) {
    const ddd = br.slice(0, 2)
    const resto = br.slice(2)
    return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`
  }
  return t
}

export function Avaliacoes() {
  const [rows, setRows] = useState<AvaliacaoRow[]>([])
  const [envios, setEnvios] = useState<{ vendedor_nome: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  async function carregar() {
    setLoading(true)
    setErro('')
    const [rA, rE] = await Promise.all([
      supabase.from('atendimento_avaliacoes').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('avaliacao_envios').select('vendedor_nome').limit(20000),
    ])
    if (rA.error) setErro(rA.error.message)
    else setRows((rA.data as AvaliacaoRow[]) || [])
    if (!rE.error) setEnvios((rE.data as { vendedor_nome: string | null }[]) || [])
    setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  // Envios por vendedor (pra calcular taxa de resposta) — vem da tabela avaliacao_envios.
  const enviosPorVendedor = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of envios) {
      const nome = (e.vendedor_nome || '—').toUpperCase()
      m.set(nome, (m.get(nome) || 0) + 1)
    }
    return m
  }, [envios])

  const porVendedor = useMemo(() => {
    const map = new Map<string, { soma: number; n: number }>()
    for (const r of rows) {
      const nome = (r.vendedor_nome || '—').toUpperCase()
      const cur = map.get(nome) || { soma: 0, n: 0 }
      cur.soma += r.nota
      cur.n += 1
      map.set(nome, cur)
    }
    // Inclui vendedores que só têm ENVIOS (ainda sem resposta), pra a taxa aparecer.
    const nomes = new Set<string>([...map.keys(), ...enviosPorVendedor.keys()])
    return [...nomes].map(nome => {
      const v = map.get(nome) || { soma: 0, n: 0 }
      const enviadas = enviosPorVendedor.get(nome) || 0
      const taxa = enviadas > 0 ? Math.min(100, Math.round((v.n / enviadas) * 100)) : null
      return { nome, media: v.n ? v.soma / v.n : 0, n: v.n, enviadas, taxa }
    }).sort((a, b) => b.media - a.media || b.n - a.n || b.enviadas - a.enviadas)
  }, [rows, enviosPorVendedor])

  // Distribuição das notas (5★ no topo) — base do gráfico
  const distribuicao = useMemo(() => {
    const c = [0, 0, 0, 0, 0]
    for (const r of rows) { const k = Math.max(1, Math.min(5, Math.round(r.nota))); c[k - 1]++ }
    return [5, 4, 3, 2, 1].map(n => ({ label: `${n}★`, qtd: c[n - 1], fill: CORES_NOTA[n - 1] }))
  }, [rows])

  const total = rows.length
  const mediaGeral = total ? rows.reduce((a, r) => a + r.nota, 0) / total : 0
  const positivas = rows.filter(r => r.nota >= 4).length
  const pctPositivas = total ? Math.round((positivas / total) * 100) : 0
  const negativas = rows.filter(r => r.nota <= 2).length
  const totalEnviadas = envios.length
  const taxaGeral = totalEnviadas > 0 ? Math.min(100, Math.round((total / totalEnviadas) * 100)) : 0

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-400/15 flex items-center justify-center text-2xl shrink-0">⭐</div>
          <div>
            <h1 className="text-xl font-bold text-ink">Avaliações de Atendimento</h1>
            <p className="text-sm text-ink-muted">O que os clientes acharam do atendimento.</p>
          </div>
        </div>
        <button
          onClick={carregar}
          className="px-3 py-2 rounded-lg border border-border text-sm text-ink-muted hover:border-accent hover:text-ink shrink-0"
        >
          ↻ Atualizar
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Carregando…</p>
      ) : erro ? (
        <p className="text-sm text-red-500">Erro: {erro}</p>
      ) : total === 0 && totalEnviadas === 0 ? (
        <div className="bg-surface-1 border border-border rounded-2xl p-8 text-center text-ink-muted">
          Ainda não há avaliações nem envios. Aparecem aqui assim que a extensão mandar a pergunta e os clientes responderem.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-1 border border-border rounded-2xl p-5 flex flex-col items-center justify-center text-center">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-faint mb-1">Média geral</p>
              <p className="text-5xl font-extrabold text-ink leading-none">{mediaGeral.toFixed(1)}</p>
              <p className="text-xl leading-none mt-1.5" style={{ color: corNota(mediaGeral) }}>{estrelas(mediaGeral)}</p>
              <p className="text-xs text-ink-muted mt-2"><b className="text-ink">{total}</b> avaliações</p>
            </div>
            <div className="bg-surface-1 border border-border rounded-2xl p-5 flex flex-col items-center justify-center text-center">
              <p className="text-[10.5px] uppercase tracking-wider text-ink-faint mb-1">Satisfação</p>
              <p className="text-5xl font-extrabold leading-none" style={{ color: pctPositivas >= 80 ? '#10b981' : pctPositivas >= 50 ? '#f59e0b' : '#ef4444' }}>{pctPositivas}%</p>
              <p className="text-xs text-ink-muted mt-2">positivas (4★ ou 5★)</p>
              {negativas > 0 && <p className="text-xs text-red-400 mt-0.5">{negativas} negativa{negativas > 1 ? 's' : ''}</p>}
            </div>
            <div className="bg-surface-1 border border-border rounded-2xl p-5 flex flex-col justify-center sm:col-span-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[10.5px] uppercase tracking-wider text-ink-faint">Taxa de resposta</p>
                <p className="text-3xl font-extrabold text-cyan-300 leading-none">{taxaGeral}%</p>
              </div>
              <div className="h-2.5 rounded-full bg-white/5 overflow-hidden mt-3">
                <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${taxaGeral}%` }} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs text-ink-muted">
                <span>📤 <b className="text-ink">{totalEnviadas}</b> enviadas</span>
                <span>✅ <b className="text-ink">{total}</b> respondidas</span>
                {totalEnviadas - total > 0 && <span className="ml-auto text-ink-faint">faltam {totalEnviadas - total} responder</span>}
              </div>
            </div>
          </div>

          {/* Distribuição das notas */}
          <div className="bg-surface-1 border border-border rounded-2xl p-4">
            <h2 className="font-semibold text-ink text-sm mb-2">Distribuição das notas</h2>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={distribuicao} layout="vertical" margin={{ left: 4, right: 28, top: 2, bottom: 2 }}>
                <XAxis type="number" allowDecimals={false} stroke="#71717a" fontSize={11} />
                <YAxis type="category" dataKey="label" stroke="#a1a1aa" fontSize={13} width={32} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  formatter={(v: number) => [`${v} avaliações`, '']}
                />
                <Bar dataKey="qtd" radius={[0, 5, 5, 0]} label={{ position: 'right', fill: '#e4e4e7', fontSize: 11 }}>
                  {distribuicao.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Média por vendedor + Últimas avaliações lado a lado em telas largas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Média por vendedor — com barra */}
          <div className="bg-surface-1 border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-ink">🏅 Média por vendedor</h2>
              <span className="text-[11px] text-ink-faint">{porVendedor.length} vendedores</span>
            </div>
            <div className="p-2 space-y-1.5">
              {porVendedor.map((v, i) => {
                const podio = i < 3 && v.n > 0
                const tier = i === 0
                  ? 'bg-gradient-to-r from-amber-400/[0.12] to-transparent ring-1 ring-amber-400/25 border-l-2 border-l-amber-400'
                  : i === 1
                  ? 'bg-gradient-to-r from-slate-300/[0.10] to-transparent ring-1 ring-slate-300/20 border-l-2 border-l-slate-300'
                  : 'bg-gradient-to-r from-orange-400/[0.10] to-transparent ring-1 ring-orange-400/20 border-l-2 border-l-orange-400'
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
                return (
                  <div key={v.nome} className={`rounded-xl px-3 py-2.5 ${podio ? tier : 'bg-white/[0.02] border border-white/5'}`}>
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <span className="font-semibold text-ink flex items-center gap-2 min-w-0">
                        {podio
                          ? <span className="text-base leading-none">{medal}</span>
                          : <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/5 text-ink-faint text-[10.5px] font-bold shrink-0">{i + 1}</span>}
                        <span className="truncate">{v.nome}</span>
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[15px] leading-none" style={{ color: corNota(v.media) }}>{estrelas(v.media)}</span>
                        <span className="text-sm font-bold text-ink w-8 text-right">{v.media.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(v.media / 5) * 100}%`, background: corNota(v.media) }} />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10.5px] text-ink-faint">
                      <span>{v.n} avaliações · {v.enviadas} enviadas</span>
                      {v.taxa != null && (
                        <span className={`ml-auto px-1.5 py-0.5 rounded-full font-semibold ${v.taxa >= 50 ? 'bg-emerald-500/15 text-emerald-300' : v.taxa >= 25 ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>{v.taxa}% resposta</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Lista de avaliações */}
          <div className="bg-surface-1 border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-ink">Últimas avaliações</h2>
              <span className="text-[11px] text-ink-faint">{total}</span>
            </div>
            <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
              {rows.map(r => {
                const tel = (r.telefone || '').replace(/\D/g, '')
                const wa = tel ? (tel.startsWith('55') ? tel : '55' + tel) : ''
                return (
                  <div key={r.id} className="px-4 py-3 border-l-2" style={{ borderLeftColor: corNota(r.nota) }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base leading-none" style={{ color: corNota(r.nota) }}>{estrelas(r.nota)}</span>
                      <span className="text-xs text-ink-faint shrink-0">{fmtData(r.created_at)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium text-ink">{r.cliente_nome || 'Cliente'}</span>
                      {r.vendedor_nome && <span className="text-ink-muted">· {r.vendedor_nome.toUpperCase()}</span>}
                      {r.telefone && (wa
                        ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" className="text-emerald-400 hover:underline">· {fmtTelefone(r.telefone)}</a>
                        : <span className="text-ink-faint">· {fmtTelefone(r.telefone)}</span>)}
                      {r.motivo && <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-xs">{r.motivo}</span>}
                    </div>
                    {r.comentario && <p className="mt-1 text-sm text-ink-muted">“{r.comentario}”</p>}
                  </div>
                )
              })}
            </div>
          </div>
          </div>{/* /grid vendedor + últimas */}
        </>
      )}
    </div>
  )
}

export default Avaliacoes
