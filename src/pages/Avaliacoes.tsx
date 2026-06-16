import { useEffect, useMemo, useState } from 'react'
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

function estrelas(n: number) {
  const x = Math.max(0, Math.min(5, Math.round(n)))
  return '★★★★★'.slice(0, x) + '☆☆☆☆☆'.slice(0, 5 - x)
}

function fmtData(s: string) {
  const d = new Date(s)
  return (
    d.toLocaleDateString('pt-BR') +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  )
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

  useEffect(() => {
    carregar()
  }, [])

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

  const total = rows.length
  const mediaGeral = total ? rows.reduce((a, r) => a + r.nota, 0) / total : 0
  const positivas = rows.filter(r => r.nota >= 4).length
  const pctPositivas = total ? Math.round((positivas / total) * 100) : 0

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Avaliações de Atendimento</h1>
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
          {/* Resumo */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-1 border border-border rounded-2xl p-4">
              <p className="text-xs text-ink-faint mb-1">Média geral</p>
              <p className="text-2xl font-bold text-ink">{mediaGeral.toFixed(1)}</p>
              <p className="text-accent text-lg leading-none">{estrelas(mediaGeral)}</p>
            </div>
            <div className="bg-surface-1 border border-border rounded-2xl p-4">
              <p className="text-xs text-ink-faint mb-1">Avaliações</p>
              <p className="text-2xl font-bold text-ink">{total}</p>
            </div>
            <div className="bg-surface-1 border border-border rounded-2xl p-4">
              <p className="text-xs text-ink-faint mb-1">Positivas (4-5★)</p>
              <p className="text-2xl font-bold text-ink">{pctPositivas}%</p>
            </div>
          </div>

          {/* Média por vendedor */}
          <div className="bg-surface-1 border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-ink">Média por vendedor</h2>
            </div>
            <div className="divide-y divide-border">
              {porVendedor.map(v => (
                <div key={v.nome} className="flex items-center justify-between px-4 py-3">
                  <span className="font-medium text-ink">{v.nome}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-accent text-lg leading-none">{estrelas(v.media)}</span>
                    <span className="text-sm font-semibold text-ink w-8 text-right">{v.media.toFixed(1)}</span>
                    <span className="text-xs text-ink-faint w-16 text-right">{v.n} aval.</span>
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
                    <span className="text-accent text-base leading-none">{estrelas(r.nota)}</span>
                    <span className="text-xs text-ink-faint shrink-0">{fmtData(r.created_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium text-ink">{r.cliente_nome || 'Cliente'}</span>
                    {r.vendedor_nome && (
                      <span className="text-ink-muted">· {r.vendedor_nome.toUpperCase()}</span>
                    )}
                    {r.telefone && <span className="text-ink-faint">· {fmtTelefone(r.telefone)}</span>}
                    {r.motivo && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs">{r.motivo}</span>
                    )}
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
