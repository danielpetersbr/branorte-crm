import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { supabase } from '@/lib/supabase'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, X, MousePointerClick } from 'lucide-react'

// ============================================================================
// Mapa do escritório — arraste cada vendedor pra sua mesa.
// Layout reproduzido da planta (14 mesas). Coordenadas em viewBox 644x838.
// ============================================================================

type VendedorLite = { vendedor_nome: string; online: boolean }

const VB = { w: 644, h: 838 }

// Mesas (drop zones) — centro de cada mesa verde da planta.
type Mesa = { id: string; cx: number; cy: number }
const MESAS: Mesa[] = [
  // faixa de cima (3)
  { id: 'mesa-01', cx: 114, cy: 66 },
  { id: 'mesa-02', cx: 330, cy: 58 },
  { id: 'mesa-03', cx: 573, cy: 69 },
  // bloco esquerdo 2x2 (4)
  { id: 'mesa-04', cx: 58, cy: 198 },
  { id: 'mesa-05', cx: 202, cy: 206 },
  { id: 'mesa-06', cx: 58, cy: 345 },
  { id: 'mesa-07', cx: 202, cy: 350 },
  // bloco direito (6)
  { id: 'mesa-08', cx: 430, cy: 205 },
  { id: 'mesa-09', cx: 548, cy: 200 },
  { id: 'mesa-10', cx: 430, cy: 335 },
  { id: 'mesa-11', cx: 548, cy: 322 },
  { id: 'mesa-12', cx: 548, cy: 460 },
  { id: 'mesa-13', cx: 562, cy: 535 },
  // sala inferior esquerda (1)
  { id: 'mesa-14', cx: 140, cy: 558 },
]
const DESK_W = 74
const DESK_H = 48

// Paredes / salas da planta (stroke em currentColor).
const ROOMS: Array<[number, number, number, number]> = [
  // topo: 3 salas
  [86, 28, 56, 78], [284, 32, 102, 60], [544, 36, 58, 68],
  // bloco esquerdo: 4 baias
  [16, 154, 96, 84], [150, 160, 98, 94], [16, 300, 96, 100], [150, 300, 98, 102],
  // bloco direito: 6 salas
  [378, 150, 94, 108], [514, 154, 102, 98], [380, 270, 98, 122],
  [514, 282, 102, 98], [514, 426, 102, 86], [494, 510, 122, 84],
  // sala inferior esquerda
  [110, 520, 64, 82],
  // faixa de baixo: 2 salas
  [90, 688, 72, 134], [162, 688, 96, 134],
]
const LINES: Array<[number, number, number, number]> = [
  [16, 128, 628, 128],   // divisória abaixo do topo
  [250, 128, 250, 615],  // parede direita do bloco esquerdo (corredor)
  [375, 128, 375, 615],  // parede esquerda do bloco direito (corredor)
  [16, 490, 250, 490],   // divisória da sala inferior esquerda
  [375, 490, 628, 490],  // divisória horizontal do bloco direito
  [16, 615, 628, 615],   // divisória da faixa de baixo
]

function pct(v: number, total: number) { return `${(v / total) * 100}%` }

export function EscritorioMapa({ vendedores }: { vendedores: VendedorLite[] }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [overMesa, setOverMesa] = useState<string | null>(null)

  // Atribuições salvas: mesa_id -> vendedor_nome
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

  // vendedor_nome -> mesa_id (pra mostrar quem já está sentado)
  const sentadoEm = useMemo(() => {
    const inv: Record<string, string> = {}
    for (const [mesaId, nome] of Object.entries(mapa ?? {})) inv[nome] = mesaId
    return inv
  }, [mapa])

  const onlineDe = useMemo(() => {
    const o: Record<string, boolean> = {}
    for (const v of vendedores) o[v.vendedor_nome] = v.online
    return o
  }, [vendedores])

  const atribuir = useMutation({
    mutationFn: async ({ mesaId, nome }: { mesaId: string; nome: string }) => {
      const now = new Date().toISOString()
      // tira o vendedor de qualquer outra mesa (1 mesa por vendedor)
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

  function soltarNaMesa(mesaId: string, nome: string | null) {
    if (!nome) return
    atribuir.mutate({ mesaId, nome })
    setSelected(null); setDragging(null); setOverMesa(null)
  }
  function clicarMesa(mesaId: string) {
    if (selected) soltarNaMesa(mesaId, selected)
  }

  const naoSentados = vendedores.filter(v => !sentadoEm[v.vendedor_nome])

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
            Arraste o vendedor pra mesa — ou toque no vendedor e depois na mesa. As mesas vazias ficam pontilhadas.
          </p>
        </div>
        <span className="text-[11px] text-ink-faint">
          {Object.keys(mapa ?? {}).length}/{MESAS.length} mesas ocupadas
        </span>
      </div>

      {/* Paleta de vendedores (arrastáveis) */}
      <div className="flex flex-wrap gap-1.5 mb-3 p-2 rounded-lg border border-border bg-surface-2/30">
        {vendedores.length === 0 && <span className="text-[11px] text-ink-faint">Nenhum vendedor carregado.</span>}
        {vendedores.map(v => {
          const sentado = !!sentadoEm[v.vendedor_nome]
          const isSel = selected === v.vendedor_nome
          return (
            <button
              key={v.vendedor_nome}
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/plain', v.vendedor_nome); setDragging(v.vendedor_nome) }}
              onDragEnd={() => setDragging(null)}
              onClick={() => setSelected(isSel ? null : v.vendedor_nome)}
              title={sentado ? `Já está na ${sentadoEm[v.vendedor_nome]} — arraste pra mudar` : 'Arraste pra uma mesa'}
              className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border text-[11px] font-semibold cursor-grab active:cursor-grabbing transition-all ${
                isSel ? 'border-accent bg-accent/15 text-accent ring-1 ring-accent' :
                sentado ? 'border-border bg-surface-2/60 text-ink-muted opacity-70' :
                'border-accent/40 bg-surface text-ink hover:border-accent'
              }`}
            >
              <Avatar name={v.vendedor_nome} size="xs" />
              {v.vendedor_nome}
              {sentado && <span className="text-[8px] text-emerald-400">●</span>}
            </button>
          )
        })}
        <span className="ml-auto text-[10px] text-ink-faint self-center">
          {naoSentados.length === 0 ? 'todos sentados ✓' : `${naoSentados.length} sem mesa`}
        </span>
      </div>

      {/* Planta */}
      <div
        className="relative w-full mx-auto text-ink/35 select-none"
        style={{ maxWidth: 560, aspectRatio: `${VB.w} / ${VB.h}` }}
      >
        {/* Paredes (SVG de fundo) */}
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
          <rect x={16} y={18} width={612} height={806} rx={6} fill="none" stroke="currentColor" strokeWidth={3} />
          <g fill="none" stroke="currentColor" strokeWidth={2.5}>
            {ROOMS.map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={2} />)}
            {LINES.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}
          </g>
        </svg>

        {/* Mesas (drop zones HTML) */}
        {MESAS.map((m, idx) => {
          const nome = (mapa ?? {})[m.id]
          const online = nome ? onlineDe[nome] : false
          const isOver = overMesa === m.id
          return (
            <div
              key={m.id}
              onDragOver={e => { e.preventDefault(); setOverMesa(m.id) }}
              onDragLeave={() => setOverMesa(o => (o === m.id ? null : o))}
              onDrop={e => { e.preventDefault(); soltarNaMesa(m.id, e.dataTransfer.getData('text/plain') || dragging) }}
              onClick={() => clicarMesa(m.id)}
              title={nome ? `${nome} — mesa ${idx + 1}` : `Mesa ${idx + 1} (vazia)`}
              className={`absolute flex items-center justify-center rounded-md border-2 transition-all overflow-hidden ${
                isOver ? 'border-accent bg-accent/25 scale-105 z-10' :
                nome ? 'border-emerald-500/70 bg-emerald-500/15' :
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
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
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
