import { useMemo, useState } from 'react'
import { Search, Loader2, Check, Tags, BookOpen } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  usePrecosBranorte, useUpdatePrecoBranorte,
  type PrecoBranorte,
} from '@/hooks/usePrecosBranorte'

const CATEGORIA_LABEL: Record<string, string> = {
  TRANSPORTADOR: 'Transportadores',
  MOINHO: 'Moinho Martelo',
  MISTURADOR: 'Misturadores',
  ELEVADOR: 'Elevador de Caneca',
  CAIXA: 'Caixas',
  SILO: 'Silos',
  PRE_LIMPEZA: 'Pré-Limpeza',
  PENEIRA: 'Peneiras',
  BRETE: 'Brete Casqueador',
  ELEVADOR_SACARIA: 'Elevador de Sacaria',
  ENSACADEIRA: 'Ensacadeiras',
  HELICOIDE: 'Helicóide (peças)',
  BALANCA: 'Balanças',
}

const SUBCATEGORIA_LABEL: Record<string, string> = {
  CHUPIM: 'Tipo Chupim',
  HELICOIDAL: 'Tipo Calha (TH)',
  MARTELO: 'Martelo',
  VERTICAL: 'Vertical',
  HORIZONTAL_CPULMAO: 'Horizontal C/ Pulmão',
  HORIZONTAL_SPULMAO: 'Horizontal S/ Pulmão',
  COMPLETO: 'Completo',
  COMPONENTE: 'Componente (Pé/Padrão)',
  RECEPCAO: 'Recepção',
  PICADOS: 'Picados',
  RACAO: 'Ração',
  MILHO: 'Milho',
  DIVERSOS: 'Diversos',
}

function formatBRL(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

// Editor inline de campo numerico (valor)
function ValorEditor({ id, field, valor }: { id: number; field: keyof PrecoBranorte; valor: number | null }) {
  const [editando, setEditando] = useState(false)
  const [v, setV] = useState<number | ''>(valor ?? '')
  const upd = useUpdatePrecoBranorte()

  if (!editando) {
    return (
      <button
        onClick={() => { setV(valor ?? ''); setEditando(true) }}
        className="w-full text-right tabular-nums font-semibold text-ink hover:text-accent hover:bg-surface-2 px-2 py-1 rounded transition-all"
      >
        {formatBRL(valor)}
      </button>
    )
  }

  async function salvar() {
    if (typeof v !== 'number' || v < 0) { setEditando(false); return }
    if (Math.abs(v - (valor ?? 0)) < 0.001) { setEditando(false); return }
    try {
      await upd.mutateAsync({ id, patch: { [field]: v } })
      setEditando(false)
    } catch (err: any) {
      alert('Erro: ' + (err?.message ?? 'desconhecido'))
    }
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      <Input
        type="number"
        value={v}
        onChange={e => setV(e.target.value ? Number(e.target.value) : '')}
        onKeyDown={e => {
          if (e.key === 'Enter') salvar()
          if (e.key === 'Escape') setEditando(false)
        }}
        autoFocus
        className="w-28 text-right text-[12px]"
        min="0"
        step="0.01"
      />
      <button
        onClick={salvar}
        disabled={upd.isPending}
        className="p-1 rounded bg-success hover:bg-success/90 text-white disabled:opacity-40"
      >
        {upd.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </button>
    </div>
  )
}

function TabelaPrecos({ items, mostrarMotor }: { items: PrecoBranorte[]; mostrarMotor: boolean }) {
  if (items.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 text-ink-muted sticky top-0">
          <tr>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider w-32">Código</th>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Descrição</th>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Capacidade</th>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Potência</th>
            <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Equipamento</th>
            {mostrarMotor && (
              <>
                <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">+ Trif</th>
                <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">+ Mono</th>
              </>
            )}
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Obs.</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className="px-3 py-1.5 text-ink-muted font-mono text-[11px]">
                {it.codigo || <span className="text-ink-faint italic">—</span>}
              </td>
              <td className="px-3 py-1.5 text-ink font-medium">{it.descricao}</td>
              <td className="px-3 py-1.5 text-ink-muted text-[11px]">{it.capacidade || '—'}</td>
              <td className="px-3 py-1.5 text-ink-muted text-[11px]">{it.potencia || '—'}</td>
              <td className="px-3 py-1.5"><ValorEditor id={it.id} field="valor_equipamento" valor={it.valor_equipamento} /></td>
              {mostrarMotor && (
                <>
                  <td className="px-3 py-1.5"><ValorEditor id={it.id} field="valor_com_motor_trif" valor={it.valor_com_motor_trif} /></td>
                  <td className="px-3 py-1.5"><ValorEditor id={it.id} field="valor_com_motor_mono" valor={it.valor_com_motor_mono} /></td>
                </>
              )}
              <td className="px-3 py-1.5 text-ink-faint text-[10px]">
                {[it.dimensoes, it.observacoes].filter(Boolean).join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PrecosBranorte() {
  const { data: precos, isLoading } = usePrecosBranorte()
  const [busca, setBusca] = useState('')
  const [catSelecionada, setCatSelecionada] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    if (!precos) return []
    const q = busca.trim().toLowerCase()
    return precos.filter(p => {
      if (catSelecionada && p.categoria !== catSelecionada) return false
      if (q) {
        const hay = `${p.descricao} ${p.codigo ?? ''} ${p.modelo ?? ''} ${p.capacidade ?? ''} ${p.potencia ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [precos, busca, catSelecionada])

  // Agrupa por categoria > subcategoria
  const grupos = useMemo(() => {
    const map = new Map<string, Map<string | null, PrecoBranorte[]>>()
    for (const p of filtrados) {
      if (!map.has(p.categoria)) map.set(p.categoria, new Map())
      const sub = map.get(p.categoria)!
      if (!sub.has(p.subcategoria)) sub.set(p.subcategoria, [])
      sub.get(p.subcategoria)!.push(p)
    }
    return map
  }, [filtrados])

  const categorias = useMemo(() => {
    if (!precos) return []
    const m = new Map<string, number>()
    for (const p of precos) m.set(p.categoria, (m.get(p.categoria) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [precos])

  if (isLoading) return <PageLoading />

  const totalGeral = precos?.length ?? 0
  const totalFiltrados = filtrados.length

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-5 h-5 text-accent" />
            <h1 className="text-[18px] font-semibold text-ink">Tabela de Preços Branorte</h1>
          </div>
          <p className="text-[12px] text-ink-muted">
            Banco oficial extraído da planilha 06/2025 — {totalGeral} equipamentos em {categorias.length} categorias.
            Clique em qualquer valor pra editar (Enter salva).
          </p>
        </div>

        {/* Busca + filtros */}
        <div className="bg-surface border border-border rounded-lg p-3 mb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, código (BNMM, EC, SAB, BNCX), capacidade ou potência..."
              className="pl-7"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatSelecionada(null)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-medium transition ${
                catSelecionada === null
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'
              }`}
            >
              Todas ({totalGeral})
            </button>
            {categorias.map(([cat, qtd]) => (
              <button
                key={cat}
                onClick={() => setCatSelecionada(cat === catSelecionada ? null : cat)}
                className={`text-[11px] px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1 ${
                  catSelecionada === cat
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'
                }`}
              >
                <Tags className="h-3 w-3" />
                {CATEGORIA_LABEL[cat] ?? cat} ({qtd})
              </button>
            ))}
          </div>
          {busca && (
            <div className="text-[10px] text-ink-faint">
              {totalFiltrados} resultado{totalFiltrados !== 1 ? 's' : ''} para "{busca}"
            </div>
          )}
        </div>

        {/* Grupos */}
        <div className="space-y-4">
          {[...grupos.entries()].map(([cat, subs]) => (
            <div key={cat} className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-accent/15 border-b border-accent/30 flex items-center justify-between">
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-accent">
                  {CATEGORIA_LABEL[cat] ?? cat}
                </h2>
                <span className="text-[10px] text-ink-muted">
                  {[...subs.values()].reduce((s, arr) => s + arr.length, 0)} {[...subs.values()].reduce((s, arr) => s + arr.length, 0) === 1 ? 'item' : 'itens'}
                </span>
              </div>
              {[...subs.entries()].map(([sub, items]) => {
                const mostrarMotor = items.some(it => it.valor_com_motor_trif != null || it.valor_com_motor_mono != null)
                return (
                  <div key={sub ?? '_'}>
                    {sub && (
                      <div className="px-3 py-1 bg-surface-2/50 border-b border-border/30">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-ink-muted">
                          {SUBCATEGORIA_LABEL[sub] ?? sub}
                        </span>
                        <span className="text-[10px] text-ink-faint ml-2">{items.length}</span>
                      </div>
                    )}
                    <TabelaPrecos items={items} mostrarMotor={mostrarMotor} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {filtrados.length === 0 && (
          <div className="bg-surface border border-border rounded-lg p-8 text-center text-ink-faint">
            Nenhum equipamento encontrado.
          </div>
        )}
      </div>
    </div>
  )
}
