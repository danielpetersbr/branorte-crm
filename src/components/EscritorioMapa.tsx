import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { supabase } from '@/lib/supabase'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, X, MousePointerClick, UserPlus } from 'lucide-react'

// ============================================================================
// Mapa do escritório — arraste cada pessoa pra sua mesa.
// Layout reproduzido da planta (14 mesas). Coordenadas em viewBox 644x838.
// Ocupantes = vendedores do rodízio + pessoas extras (CEO, RH, Marketing...).
// ============================================================================

type VendedorLite = { vendedor_nome: string; online: boolean }
type Pessoa = { nome: string; setor: string | null }
type Ocupante = { nome: string; tipo: 'vendedor' | 'outro'; online: boolean; setor: string | null }

const VB = { w: 644, h: 838 }

type Mesa = { id: string; cx: number; cy: number }
const MESAS: Mesa[] = [
  { id: 'mesa-01', cx: 114, cy: 66 },
  { id: 'mesa-02', cx: 330, cy: 58 },
  { id: 'mesa-03', cx: 573, cy: 69 },
  { id: 'mesa-04', cx: 58, cy: 198 },
  { id: 'mesa-05', cx: 202, cy: 206 },
  { id: 'mesa-06', cx: 58, cy: 345 },
  { id: 'mesa-07', cx: 202, cy: 350 },
  { id: 'mesa-08', cx: 430, cy: 205 },
  { id: 'mesa-09', cx: 548, cy: 200 },
  { id: 'mesa-10', cx: 430, cy: 335 },
  { id: 'mesa-11', cx: 548, cy: 322 },
  { id: 'mesa-12', cx: 548, cy: 460 },
  { id: 'mesa-13', cx: 562, cy: 535 },
  { id: 'mesa-14', cx: 140, cy: 558 },
]
const DESK_W = 74
const DESK_H = 48

const ROOMS: Array<[number, number, number, number]> = [
  [86, 28, 56, 78], [284, 32, 102, 60], [544, 36, 58, 68],
  [16, 154, 96, 84], [150, 160, 98, 94], [16, 300, 96, 100], [150, 300, 98, 102],
  [378, 150, 94, 108], [514, 154, 102, 98], [380, 270, 98, 122],
  [514, 282, 102, 98], [514, 426, 102, 86], [494, 510, 122, 84],
  [110, 520, 64, 82],
  [90, 688, 72, 134], [162, 688, 96, 134],
]
const LINES: Array<[number, number, number, number]> = [
  [16, 128, 628, 128],
  [250, 128, 250, 615],
  [375, 128, 375, 615],
  [16, 490, 250, 490],
  [375, 490, 628, 490],
  [16, 615, 628, 615],
]

function pct(v: number, total: number) { return `${(v / total) * 100}%` }
function abreviaSetor(setor: string | null): string {
  if (!setor) return ''
  const s = setor.trim()
  if (/market/i.test(s)) return 'MKT'
  return s.length <= 4 ? s.toUpperCase() : s.slice(0, 3).toUpperCase()
}

export function EscritorioMapa({ vendedores }: { vendedores: VendedorLite[] }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [overMesa, setOverMesa] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoSetor, setNovoSetor] = useState('')

  // Atribuições salvas: mesa_id -> nome
  const { data: mapa } = useQuery<Record<string, string>>({
    queryKey: ['escritorio-mesas'],
    queryFn: async () => {
      const { data } = await supabase.from('escritorio_mesas').select('mesa_id, vendedor_nome')
      const m: Record<string, string> = {}
      for (const r of (data ?? []) as Array<{ mesa_id: string; vendedor_nome: string | null }>) {
        if (r.vendedor_nome) m[r.mesa_id] = r.vendedor_nome
      }
      return m
    },
    refetchInterval: 15000,
  })

  // Pessoas extras (não-vendedores): CEO, RH, Marketing...
  const { data: pessoas } = useQuery<Pessoa[]>({
    queryKey: ['escritorio-pessoas'],
    queryFn: async () => {
      const { data } = await supabase.from('escritorio_pessoas')
        .select('nome, setor').eq('ativo', true).order('ordem')
      return (data ?? []) as Pessoa[]
    },
  })

  // Lista unificada de ocupantes (vendedores + pessoas extras)
  const ocupantes = useMemo<Ocupante[]>(() => {
    const vend: Ocupante[] = vendedores.map(v => ({ nome: v.vendedor_nome, tipo: 'vendedor', online: v.online, setor: null }))
    const extra: Ocupante[] = (pessoas ?? []).map(p => ({ nome: p.nome, tipo: 'outro', online: false, setor: p.setor }))
    return [...vend, ...extra]
  }, [vendedores, pessoas])

  const infoDe = useMemo(() => {
    const m: Record<string, Ocupante> = {}
    for (const o of ocupantes) m[o.nome] = o
    return m
  }, [ocupantes])

  const sentadoEm = useMemo(() => {
    const inv: Record<string, string> = {}
    for (const [mesaId, nome] of Object.entries(mapa ?? {})) inv[nome] = mesaId
    return inv
  }, [mapa])

  const atribuir = useMutation({
    mutationFn: async ({ mesaId, nome }: { mesaId: string; nome: string }) => {
      const now = new Date().toISOString()
      const { error: e1 } = await supabase.from('escritorio_mesas')
        .update({ vendedor_nome: null, updated_at: now })
        .eq('vendedor_nome', nome).neq('mesa_id', mesaId)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('escritorio_mesas')
        .upsert({ mesa_id: mesaId, vendedor_nome: nome, updated_at: now }, { onConflict: 'mesa_id' })
      if (e2) throw e2
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escritorio-mesas'] }),
    onError: (err: any) => alert('Não foi possível salvar a mesa: ' + (err?.message || err)),
  })

  const limpar = useMutation({
    mutationFn: async (mesaId: string) => {
      const { error } = await supabase.from('escritorio_mesas')
        .update({ vendedor_nome: null, updated_at: new Date().toISOString() }).eq('mesa_id', mesaId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escritorio-mesas'] }),
  })

  const addPessoa = useMutation({
    mutationFn: async ({ nome, setor }: { nome: string; setor: string }) => {
      const limpo = nome.trim().toUpperCase()
      if (!limpo) throw new Error('Informe o nome.')
      const ordem = (pessoas?.length ?? 0) + 10
      const { error } = await supabase.from('escritorio_pessoas')
        .upsert({ nome: limpo, setor: setor.trim() || null, ativo: true, ordem }, { onConflict: 'nome' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escritorio-pessoas'] })
      setNovoNome(''); setNovoSetor(''); setAddOpen(false)
    },
    onError: (err: any) => alert('Não foi possível adicionar: ' + (err?.message || err)),
  })

  const removerPessoa = useMutation({
    mutationFn: async (nome: string) => {
      // libera a mesa dela e tira do cadastro
      await supabase.from('escritorio_mesas').update({ vendedor_nome: null, updated_at: new Date().toISOString() }).eq('vendedor_nome', nome)
      const { error } = await supabase.from('escritorio_pessoas').delete().eq('nome', nome)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escritorio-pessoas'] })
      qc.invalidateQueries({ queryKey: ['escritorio-mesas'] })
    },
  })

  function soltarNaMesa(mesaId: string, nome: string | null) {
    if (!nome) return
    atribuir.mutate({ mesaId, nome })
    setSelected(null); setDragging(null); setOverMesa(null)
  }
  function clicarMesa(mesaId: string) {
    if (selected) soltarNaMesa(mesaId, selected)
  }

  const naoSentados = ocupantes.filter(o => !sentadoEm[o.nome])

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            Escritório — quem senta em cada mesa
          </h2>
          <p className="text-[10px] text-ink-muted mt-0.5 flex items-center gap-1">
            <MousePointerClick className="h-3 w-3" />
            Arraste a pessoa pra mesa — ou toque na pessoa e depois na mesa. As mesas vazias ficam pontilhadas.
          </p>
        </div>
        <span className="text-[11px] text-ink-faint">
          {Object.keys(mapa ?? {}).length}/{MESAS.length} mesas ocupadas
        </span>
      </div>

      {/* Paleta de pessoas (arrastáveis) */}
      <div className="flex flex-wrap gap-1.5 mb-3 p-2 rounded-lg border border-border bg-surface-2/30">
        {ocupantes.length === 0 && <span className="text-[11px] text-ink-faint">Ninguém carregado.</span>}
        {ocupantes.map(o => {
          const sentado = !!sentadoEm[o.nome]
          const isSel = selected === o.nome
          const isOutro = o.tipo === 'outro'
          return (
            <span
              key={o.nome}
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/plain', o.nome); setDragging(o.nome) }}
              onDragEnd={() => setDragging(null)}
              onClick={() => setSelected(isSel ? null : o.nome)}
              title={sentado ? `Já está na ${sentadoEm[o.nome]} — arraste pra mudar` : 'Arraste pra uma mesa'}
              className={`group inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border text-[11px] font-semibold cursor-grab active:cursor-grabbing transition-all ${
                isSel ? 'border-accent bg-accent/15 text-accent ring-1 ring-accent' :
                sentado ? 'border-border bg-surface-2/60 text-ink-muted opacity-70' :
                isOutro ? 'border-purple-400/40 bg-surface text-ink hover:border-purple-400' :
                'border-accent/40 bg-surface text-ink hover:border-accent'
              }`}
            >
              <Avatar name={o.nome} size="xs" />
              {o.nome}
              {isOutro && o.setor && (
                <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 leading-none">{o.setor.toUpperCase()}</span>
              )}
              {sentado && !isOutro && <span className="text-[8px] text-emerald-400">●</span>}
              {isOutro && (
                <button
                  onClick={e => { e.stopPropagation(); if (confirm(`Remover ${o.nome} do escritório?`)) removerPessoa.mutate(o.nome) }}
                  title="Remover do cadastro"
                  className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-red-400 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          )
        })}

        {/* + adicionar pessoa */}
        {addOpen ? (
          <span className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border border-accent/40 bg-surface">
            <input
              autoFocus value={novoNome} onChange={e => setNovoNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && novoNome.trim()) addPessoa.mutate({ nome: novoNome, setor: novoSetor }) }}
              placeholder="Nome" className="w-20 bg-transparent text-[11px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <input
              value={novoSetor} onChange={e => setNovoSetor(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && novoNome.trim()) addPessoa.mutate({ nome: novoNome, setor: novoSetor }) }}
              placeholder="Setor" className="w-16 bg-transparent text-[11px] text-ink placeholder:text-ink-faint focus:outline-none border-l border-border pl-1"
            />
            <button onClick={() => addPessoa.mutate({ nome: novoNome, setor: novoSetor })} disabled={!novoNome.trim()}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent disabled:opacity-40">ok</button>
            <button onClick={() => { setAddOpen(false); setNovoNome(''); setNovoSetor('') }} className="text-ink-faint hover:text-ink"><X className="h-3 w-3" /></button>
          </span>
        ) : (
          <button onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-border text-[11px] text-ink-muted hover:border-accent hover:text-accent">
            <UserPlus className="h-3 w-3" /> pessoa
          </button>
        )}

        <span className="ml-auto text-[10px] text-ink-faint self-center">
          {naoSentados.length === 0 ? 'todos sentados ✓' : `${naoSentados.length} sem mesa`}
        </span>
      </div>

      {/* Planta */}
      <div
        className="relative w-full mx-auto text-ink/35 select-none"
        style={{ maxWidth: 560, aspectRatio: `${VB.w} / ${VB.h}` }}
      >
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
          <rect x={16} y={18} width={612} height={806} rx={6} fill="none" stroke="currentColor" strokeWidth={3} />
          <g fill="none" stroke="currentColor" strokeWidth={2.5}>
            {ROOMS.map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={2} />)}
            {LINES.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}
          </g>
        </svg>

        {MESAS.map((m, idx) => {
          const nome = (mapa ?? {})[m.id]
          const info = nome ? infoDe[nome] : undefined
          const isOutro = info?.tipo === 'outro'
          const online = info?.online ?? false
          const isOver = overMesa === m.id
          return (
            <div
              key={m.id}
              onDragOver={e => { e.preventDefault(); setOverMesa(m.id) }}
              onDragLeave={() => setOverMesa(o => (o === m.id ? null : o))}
              onDrop={e => { e.preventDefault(); soltarNaMesa(m.id, e.dataTransfer.getData('text/plain') || dragging) }}
              onClick={() => clicarMesa(m.id)}
              title={nome ? `${nome}${info?.setor ? ' · ' + info.setor : ''} — mesa ${idx + 1}` : `Mesa ${idx + 1} (vazia)`}
              className={`absolute flex items-center justify-center rounded-md border-2 transition-all overflow-hidden ${
                isOver ? 'border-accent bg-accent/25 scale-105 z-10' :
                nome ? (isOutro ? 'border-purple-500/70 bg-purple-500/15' : 'border-emerald-500/70 bg-emerald-500/15') :
                'border-dashed border-accent/40 bg-surface-2/40 hover:border-accent hover:bg-accent/10'
              } ${selected && !nome ? 'cursor-pointer ring-1 ring-accent/40' : ''}`}
              style={{
                left: pct(m.cx - DESK_W / 2, VB.w),
                top: pct(m.cy - DESK_H / 2, VB.h),
                width: pct(DESK_W, VB.w),
                height: pct(DESK_H, VB.h),
              }}
            >
              {nome ? (
                <div
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('text/plain', nome); setDragging(nome) }}
                  onDragEnd={() => setDragging(null)}
                  className="flex items-center gap-1 px-1 w-full h-full justify-center cursor-grab active:cursor-grabbing"
                >
                  <Avatar name={nome} size="xs" />
                  <span className="text-[9px] font-bold text-ink truncate leading-none">{nome.split(' ')[0]}</span>
                  {isOutro ? (
                    <span className="text-[7px] font-bold text-purple-300 leading-none flex-shrink-0">{abreviaSetor(info?.setor ?? null)}</span>
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); limpar.mutate(m.id) }}
                    title="Tirar da mesa"
                    className="text-ink-faint hover:text-red-400 flex-shrink-0"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : (
                <span className="text-[8px] text-ink-faint font-medium">{idx + 1}</span>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
