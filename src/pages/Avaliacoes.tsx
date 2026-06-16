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
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  async function carregar() {
    setLoading(true)
    setErro('')
    const { data, error } = await supabase
      .from('atendimento_avaliacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) setErro(error.message)
    else setRows((data as AvaliacaoRow[]) || [])
    setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  const porVendedor = useMemo(() => {
    const map = new Map<string, { soma: number; n: number }>()
    for (const r of rows) {
      const nome = (r.vendedor_nome || '—').toUpperCase()
      const cur = map.get(nome) || { soma: 0, n: 0 }
      cur.soma += r.nota
      cur.n += 1
      map.set(nome, cur)
    }
    return [...map.entries()]
      .map(([nome, v]) => ({ nome, media: v.soma / v.n, n: v.n }))
      .sort((a, b) => b.media - a.media || b.n - a.n)
  }, [rows])

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

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">⭐ Avaliações de Atendimento</h1>
          <p className="text-sm text-ink-muted">O que os clientes acharam do atendimento.</p>
        </div>
        <button
          onClick={carregar}
          className="px-3 py-2 rounded-lg border border-border text-sm text-ink-muted hover:border-accent hover:text-ink"
        >
          Atualizar
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Carregando…</p>
      ) : erro ? (
        <p className="text-sm text-red-500">Erro: {erro}</p>
      ) : total === 0 ? (
        <div className="bg-surface-1 border border-border rounded-2xl p-8 text-center text-ink-muted">
          Ainda não há avaliações. Elas aparecem aqui assim que os clientes responderem o link.
        </div>
      ) : (
        <>
          {/* Topo: média geral grande + gráfico de distribuição */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-surface-1 border border-border rounded-2xl p-5 flex flex-col items-center justify-center text-center">
              <p className="text-5xl font-extrabold text-ink leading-none">{mediaGeral.toFixed(1)}</p>
              <p className="text-2xl leading-none mt-1.5" style={{ color: corNota(mediaGeral) }}>{estrelas(mediaGeral)}</p>
              <div className="flex items-center gap-3 mt-3 text-xs">
                <span className="text-ink-muted"><b className="text-ink">{total}</b> avaliações</span>
                <span className="text-emerald-400"><b>{pctPositivas}%</b> positivas</span>
                {negativas > 0 && <span className="text-red-400"><b>{negativas}</b> negativa{negativas > 1 ? 's' : ''}</span>}
              </div>
            </div>
            <div className="bg-surface-1 border border-border rounded-2xl p-4 lg:col-span-2">
              <h2 className="font-semibold text-ink text-sm mb-2">Distribuição das notas</h2>
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={distribuicao} layout="vertical" margin={{ left: 4, right: 20, top: 2, bottom: 2 }}>
                  <XAxis type="number" allowDecimals={false} stroke="#71717a" fontSize={11} />
                  <YAxis type="category" dataKey="label" stroke="#a1a1aa" fontSize={13} width={30} tickLine={false} axisLine={false} />
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
          </div>

          {/* Média por vendedor — com barra */}
          <div className="bg-surface-1 border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-ink">🏅 Média por vendedor</h2>
            </div>
            <div className="divide-y divide-border">
              {porVendedor.map((v, i) => (
                <div key={v.nome} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <span className="font-medium text-ink flex items-center gap-2 min-w-0">
                      <span className="text-ink-faint text-xs w-4">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                      <span className="truncate">{v.nome}</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-base leading-none" style={{ color: corNota(v.media) }}>{estrelas(v.media)}</span>
                      <span className="text-sm font-bold text-ink w-8 text-right">{v.media.toFixed(1)}</span>
                      <span className="text-xs text-ink-faint w-16 text-right">{v.n} aval.</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(v.media / 5) * 100}%`, background: corNota(v.media) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Lista de avaliações */}
          <div className="bg-surface-1 border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-ink">Últimas avaliações</h2>
            </div>
            <div className="divide-y divide-border">
              {rows.map(r => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base leading-none" style={{ color: corNota(r.nota) }}>{estrelas(r.nota)}</span>
                    <span className="text-xs text-ink-faint shrink-0">{fmtData(r.created_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium text-ink">{r.cliente_nome || 'Cliente'}</span>
                    {r.vendedor_nome && <span className="text-ink-muted">· {r.vendedor_nome.toUpperCase()}</span>}
                    {r.telefone && <span className="text-ink-faint">· {fmtTelefone(r.telefone)}</span>}
                    {r.motivo && <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-xs">{r.motivo}</span>}
                  </div>
                  {r.comentario && <p className="mt-1 text-sm text-ink-muted">“{r.comentario}”</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Avaliacoes
