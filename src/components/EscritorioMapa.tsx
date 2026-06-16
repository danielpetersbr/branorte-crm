import { useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { supabase } from '@/lib/supabase'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, X, MousePointerClick, UserPlus, Move, Check, RotateCw, Pencil } from 'lucide-react'

// ============================================================================
// Mapa do escritório (vista de cima) — arraste cada pessoa pra sua estação.
// Modo "Mover mesas" deixa reposicionar cada estação (salva pos_x/pos_y).
// Cada estação = mesa + monitor + cadeira + bonequinho. ViewBox 644x642.
// ============================================================================

type VendedorLite = { vendedor_nome: string; online: boolean }
type Pessoa = { nome: string; setor: string | null }
type Ocupante = { nome: string; tipo: 'vendedor' | 'outro'; online: boolean; setor: string | null }
type Pos = { x: number; y: number }

const VB = { w: 644, h: 642 }

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
const DESK_W = 86
const DESK_H = 70

// Paredes da planta. (Removidos os boxes individuais em volta de cada mesa —
// ficam só o contorno do prédio e as divisórias principais.)
const LINES: Array<[number, number, number, number]> = [
  [16, 128, 628, 128],
  [250, 128, 250, 624],
  [375, 128, 375, 624],
  [16, 490, 250, 490],
  [375, 490, 628, 490],
]
// Paredes-padrão como retângulos (outer + salas + divisórias) — usado em "partir do padrão".
type Rect = { x: number; y: number; w: number; h: number }
const DEFAULT_PAREDES: Rect[] = [
  { x: 16, y: 18, w: 612, h: 606 }, // contorno
  ...LINES.map(([x1, y1, x2, y2]) => x1 === x2
    ? { x: x1 - 1, y: Math.min(y1, y2), w: 2, h: Math.abs(y2 - y1) }   // vertical
    : { x: Math.min(x1, x2), y: y1 - 1, w: Math.abs(x2 - x1), h: 2 }), // horizontal
]

function pct(v: number, total: number) { return `${(v / total) * 100}%` }
function abreviaSetor(setor: string | null): string {
  if (!setor) return ''
  const s = setor.trim()
  if (/market/i.test(s)) return 'MKT'
  return s.length <= 4 ? s.toUpperCase() : s.slice(0, 3).toUpperCase()
}
function hueFromName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h) % 360
}

function Workstation({ tipo, empty, name }: { tipo: 'vendedor' | 'outro'; empty: boolean; name: string }) {
  const hue = hueFromName(name || 'x')
  const shirt = empty ? '#3a4456' : tipo === 'outro' ? 'hsl(270 48% 56%)' : `hsl(${hue} 58% 54%)`
  const hair = empty ? '#2c3441' : tipo === 'outro' ? 'hsl(270 35% 30%)' : `hsl(${hue} 45% 26%)`
  return (
    <svg viewBox="0 0 100 92" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <ellipse cx="50" cy="86" rx="42" ry="6" fill="#000" opacity="0.18" />
      <rect x="35" y="3" width="30" height="19" rx="9" fill="#39434f" />
      <rect x="38" y="6" width="24" height="13" rx="6.5" fill="#4d5a6b" />
      {!empty && (
        <>
          <ellipse cx="50" cy="41" rx="19" ry="11.5" fill={shirt} />
          <circle cx="50" cy="30" r="10.5" fill="#f0c9a8" />
          <path d="M39.5 30 a10.5 10.5 0 0 1 21 0 q-10.5 -7 -21 0 z" fill={hair} />
        </>
      )}
      <rect x="11" y="50" width="78" height="36" rx="6" fill="#9c6b48" />
      <rect x="11" y="50" width="78" height="8" rx="6" fill="#b07d57" />
      <rect x="39" y="51" width="22" height="13" rx="2" fill="#10151f" />
      <rect x="41.5" y="53" width="17" height="9" rx="1" fill={empty ? '#243042' : 'hsl(190 70% 55%)'} opacity={empty ? 0.7 : 0.9} />
      <rect x="40" y="70" width="20" height="5.5" rx="1.5" fill="#c3ccd9" />
      <circle cx="66" cy="73" r="2.2" fill="#c3ccd9" />
      <circle cx="22" cy="73" r="3" fill={empty ? '#3a4456' : 'hsl(150 55% 45%)'} />
    </svg>
  )
}

export function EscritorioMapa({ vendedores }: { vendedores: VendedorLite[] }) {
  const qc = useQueryClient()
  const plantaRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [overMesa, setOverMesa] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoSetor, setNovoSetor] = useState('')
  const [modo, setModo] = useState<'normal' | 'mesas' | 'paredes'>('normal')
  const editLayout = modo === 'mesas'
  const [movendo, setMovendo] = useState<string | null>(null)
  const [girando, setGirando] = useState<string | null>(null)
  const [localPos, setLocalPos] = useState<Record<string, Pos>>({})
  const [localRot, setLocalRot] = useState<Record<string, number>>({})
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const { data: dados } = useQuery<{ assign: Record<string, string>; pos: Record<string, Pos>; rot: Record<string, number> }>({
    queryKey: ['escritorio-mesas'],
    queryFn: async () => {
      const { data } = await supabase.from('escritorio_mesas').select('mesa_id, vendedor_nome, pos_x, pos_y, pos_rot')
      const assign: Record<string, string> = {}
      const pos: Record<string, Pos> = {}
      const rot: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ mesa_id: string; vendedor_nome: string | null; pos_x: number | null; pos_y: number | null; pos_rot: number | null }>) {
        if (r.vendedor_nome) assign[r.mesa_id] = r.vendedor_nome
        if (r.pos_x != null && r.pos_y != null) pos[r.mesa_id] = { x: r.pos_x, y: r.pos_y }
        if (r.pos_rot) rot[r.mesa_id] = r.pos_rot
      }
      return { assign, pos, rot }
    },
    refetchInterval: 15000,
  })
  const assignMap = dados?.assign ?? {}
  const posMap = dados?.pos ?? {}
  const rotMap = dados?.rot ?? {}

  const { data: paredes } = useQuery<Array<Rect & { id: number }>>({
    queryKey: ['escritorio-paredes'],
    queryFn: async () => {
      const { data } = await supabase.from('escritorio_paredes').select('id, x, y, w, h').order('id')
      return (data ?? []) as Array<Rect & { id: number }>
    },
  })
  const temCustom = (paredes?.length ?? 0) > 0

  const addParede = useMutation({
    mutationFn: async (r: Rect) => {
      const { error } = await supabase.from('escritorio_paredes').insert(r)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escritorio-paredes'] }),
    onError: (err: any) => alert('Não foi possível salvar a parede: ' + (err?.message || err)),
  })
  const delParede = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('escritorio_paredes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escritorio-paredes'] }),
  })
  const limparParedes = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('escritorio_paredes').delete().gte('id', 0)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escritorio-paredes'] }),
  })
  const seedPadrao = useMutation({
    mutationFn: async () => {
      await supabase.from('escritorio_paredes').delete().gte('id', 0)
      const { error } = await supabase.from('escritorio_paredes').insert(DEFAULT_PAREDES)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escritorio-paredes'] }),
  })

  const { data: pessoas } = useQuery<Pessoa[]>({
    queryKey: ['escritorio-pessoas'],
    queryFn: async () => {
      const { data } = await supabase.from('escritorio_pessoas')
        .select('nome, setor').eq('ativo', true).order('ordem')
      return (data ?? []) as Pessoa[]
    },
  })

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
    for (const [mesaId, nome] of Object.entries(assignMap)) inv[nome] = mesaId
    return inv
  }, [assignMap])

  function posDe(id: string): Pos {
    if (localPos[id]) return localPos[id]
    if (posMap[id]) return posMap[id]
    const m = MESAS.find(x => x.id === id)!
    return { x: m.cx, y: m.cy }
  }
  function rotDe(id: string): number {
    if (localRot[id] != null) return localRot[id]
    return rotMap[id] ?? 0
  }

  const atribuir = useMutation({
    mutationFn: async ({ mesaId, nome }: { mesaId: string; nome: string }) => {
      const now = new Date().toISOString()
      const { error: e1 } = await supabase.from('escritorio_mesas')
        .update({ vendedor_nome: null, updated_at: now }).eq('vendedor_nome', nome).neq('mesa_id', mesaId)
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

  const salvarPos = useMutation({
    mutationFn: async ({ mesaId, x, y }: { mesaId: string; x: number; y: number }) => {
      const { error } = await supabase.from('escritorio_mesas')
        .upsert({ mesa_id: mesaId, pos_x: x, pos_y: y }, { onConflict: 'mesa_id' })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      setLocalPos(p => { const n = { ...p }; delete n[v.mesaId]; return n })
      qc.invalidateQueries({ queryKey: ['escritorio-mesas'] })
    },
    onError: (err: any) => alert('Não foi possível salvar a posição: ' + (err?.message || err)),
  })

  const salvarRot = useMutation({
    mutationFn: async ({ mesaId, rot }: { mesaId: string; rot: number }) => {
      const { error } = await supabase.from('escritorio_mesas')
        .upsert({ mesa_id: mesaId, pos_rot: rot }, { onConflict: 'mesa_id' })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      setLocalRot(r => { const n = { ...r }; delete n[v.mesaId]; return n })
      qc.invalidateQueries({ queryKey: ['escritorio-mesas'] })
    },
    onError: (err: any) => alert('Não foi possível salvar a rotação: ' + (err?.message || err)),
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

  // Modo posicionar: arrasta a estação livremente e salva ao soltar.
  function iniciarMover(e: React.PointerEvent, id: string) {
    e.preventDefault()
    setMovendo(id)
    const onMove = (ev: PointerEvent) => {
      const rect = plantaRef.current?.getBoundingClientRect()
      if (!rect) return
      let x = ((ev.clientX - rect.left) / rect.width) * VB.w
      let y = ((ev.clientY - rect.top) / rect.height) * VB.h
      x = Math.max(DESK_W / 2 + 6, Math.min(VB.w - DESK_W / 2 - 6, x))
      y = Math.max(DESK_H / 2 + 6, Math.min(VB.h - DESK_H / 2 - 6, y))
      setLocalPos(p => ({ ...p, [id]: { x, y } }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setMovendo(null)
      setLocalPos(p => {
        const pos = p[id]
        if (pos) salvarPos.mutate({ mesaId: id, x: Math.round(pos.x), y: Math.round(pos.y) })
        return p
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Girar a estação: arrasta o handle ao redor do centro da mesa (snap 15°).
  function iniciarGirar(e: React.PointerEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    setGirando(id)
    const rect = plantaRef.current?.getBoundingClientRect()
    const p = posDe(id)
    const cx = (rect?.left ?? 0) + (p.x / VB.w) * (rect?.width ?? 1)
    const cy = (rect?.top ?? 0) + (p.y / VB.h) * (rect?.height ?? 1)
    const onMove = (ev: PointerEvent) => {
      let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90
      deg = Math.round(deg / 15) * 15
      setLocalRot(r => ({ ...r, [id]: ((deg % 360) + 360) % 360 }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGirando(null)
      setLocalRot(r => { const v = r[id]; if (v != null) salvarRot.mutate({ mesaId: id, rot: Math.round(v) }); return r })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Desenhar parede: arrasta no fundo pra criar um retângulo (sala/parede).
  function iniciarDesenho(e: React.PointerEvent) {
    if (modo !== 'paredes') return
    const rect = plantaRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = ((e.clientX - rect.left) / rect.width) * VB.w
    const sy = ((e.clientY - rect.top) / rect.height) * VB.h
    setDraft({ x: sx, y: sy, w: 0, h: 0 })
    const onMove = (ev: PointerEvent) => {
      const x2 = ((ev.clientX - rect.left) / rect.width) * VB.w
      const y2 = ((ev.clientY - rect.top) / rect.height) * VB.h
      setDraft({ x: Math.min(sx, x2), y: Math.min(sy, y2), w: Math.abs(x2 - sx), h: Math.abs(y2 - sy) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDraft(d => {
        if (d && d.w > 8 && d.h > 8) addParede.mutate({ x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h) })
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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
            {modo === 'paredes'
              ? 'Editar paredes: arraste no espaço pra desenhar uma sala/parede. Clique no × pra apagar. "partir do padrão" copia o desenho atual pra editar.'
              : editLayout
              ? 'Modo posicionar: arraste cada mesa pro lugar certo, gire pelo ⟳. Salva sozinho ao soltar.'
              : 'Arraste a pessoa pra mesa — ou toque na pessoa e depois na mesa. As mesas vazias ficam pontilhadas.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {modo === 'paredes' && (
            <>
              <button onClick={() => { if (confirm('Copiar o desenho padrão atual pra você editar (substitui o que tiver)?')) seedPadrao.mutate() }}
                className="text-[10px] px-2 py-1 rounded-full border border-border text-ink-muted hover:border-accent hover:text-accent">partir do padrão</button>
              <button onClick={() => { if (confirm('Apagar TODAS as paredes desenhadas?')) limparParedes.mutate() }}
                className="text-[10px] px-2 py-1 rounded-full border border-border text-ink-muted hover:border-red-400 hover:text-red-400">limpar tudo</button>
            </>
          )}
          <button
            onClick={() => { setModo(m => m === 'paredes' ? 'normal' : 'paredes'); setSelected(null) }}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors ${
              modo === 'paredes' ? 'border-accent bg-accent/15 text-accent' : 'border-border text-ink-muted hover:border-accent hover:text-accent'
            }`}
          >
            {modo === 'paredes' ? <><Check className="h-3 w-3" /> Concluir</> : <><Pencil className="h-3 w-3" /> Paredes</>}
          </button>
          <button
            onClick={() => { setModo(m => m === 'mesas' ? 'normal' : 'mesas'); setSelected(null) }}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors ${
              editLayout ? 'border-accent bg-accent/15 text-accent' : 'border-border text-ink-muted hover:border-accent hover:text-accent'
            }`}
          >
            {editLayout ? <><Check className="h-3 w-3" /> Concluir</> : <><Move className="h-3 w-3" /> Mover mesas</>}
          </button>
        </div>
      </div>

      {/* Paleta de pessoas (arrastáveis) — escondida no modo posicionar */}
      {!editLayout && (
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
      )}

      {/* Planta (vista de cima) */}
      <div
        ref={plantaRef}
        onPointerDown={modo === 'paredes' ? iniciarDesenho : undefined}
        className={`relative w-full mx-auto select-none rounded-xl ${modo !== 'normal' ? 'ring-1 ring-accent/40' : ''} ${modo === 'paredes' ? 'cursor-crosshair' : ''}`}
        style={{
          maxWidth: 560,
          aspectRatio: `${VB.w} / ${VB.h}`,
          background: 'radial-gradient(120% 120% at 50% 0%, hsl(220 22% 16%) 0%, hsl(222 26% 11%) 70%)',
          touchAction: modo === 'paredes' ? 'none' : undefined,
        }}
      >
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 w-full h-full pointer-events-none text-ink/25" preserveAspectRatio="none">
          {temCustom ? (
            <g fill="none" stroke="currentColor" strokeWidth={2.5}>
              {(paredes ?? []).map(p => <rect key={p.id} x={p.x} y={p.y} width={p.w} height={p.h} rx={3} />)}
            </g>
          ) : (
            <>
              <rect x={16} y={18} width={612} height={606} rx={10} fill="none" stroke="currentColor" strokeWidth={3} />
              <g fill="none" stroke="currentColor" strokeWidth={2.5}>
                {LINES.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}
              </g>
            </>
          )}
          {draft && draft.w > 0 && draft.h > 0 && (
            <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} rx={2}
              fill="rgba(20,184,138,0.12)" stroke="hsl(160 70% 50%)" strokeWidth={2} strokeDasharray="6 4" />
          )}
        </svg>

        {MESAS.map((m, idx) => {
          const nome = assignMap[m.id]
          const info = nome ? infoDe[nome] : undefined
          const isOutro = info?.tipo === 'outro'
          const online = info?.online ?? false
          const isOver = overMesa === m.id
          const p = posDe(m.id)
          const left = pct(p.x - DESK_W / 2, VB.w)
          const top = pct(p.y - DESK_H / 2, VB.h)
          const width = pct(DESK_W, VB.w)
          const height = pct(DESK_H, VB.h)
          return (
            <div
              key={m.id}
              onDragOver={editLayout ? undefined : e => { e.preventDefault(); setOverMesa(m.id) }}
              onDragLeave={editLayout ? undefined : () => setOverMesa(o => (o === m.id ? null : o))}
              onDrop={editLayout ? undefined : e => { e.preventDefault(); soltarNaMesa(m.id, e.dataTransfer.getData('text/plain') || dragging) }}
              onClick={editLayout ? undefined : () => clicarMesa(m.id)}
              onPointerDown={editLayout ? e => iniciarMover(e, m.id) : undefined}
              title={nome ? `${nome}${info?.setor ? ' · ' + info.setor : ''} — mesa ${idx + 1}` : `Mesa ${idx + 1} (vazia)`}
              className={`group absolute rounded-lg transition-shadow ${
                editLayout ? `cursor-move ring-1 ${movendo === m.id ? 'ring-accent z-20 shadow-lg shadow-black/40' : 'ring-accent/40'} bg-accent/5` :
                isOver ? 'ring-2 ring-accent bg-accent/15 scale-105 z-10' :
                nome ? 'hover:bg-white/5' :
                'border border-dashed border-ink/20 hover:border-accent/60 hover:bg-accent/5 cursor-pointer'
              }`}
              style={{ left, top, width, height, touchAction: editLayout ? 'none' : undefined, pointerEvents: modo === 'paredes' ? 'none' : undefined }}
            >
              <div
                draggable={!!nome && !editLayout}
                onDragStart={e => { if (nome && !editLayout) { e.dataTransfer.setData('text/plain', nome); setDragging(nome) } }}
                onDragEnd={() => setDragging(null)}
                className={`w-full h-full ${nome && !editLayout ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ transform: `rotate(${rotDe(m.id)}deg)`, transition: girando === m.id ? 'none' : 'transform .12s' }}
              >
                <Workstation tipo={isOutro ? 'outro' : 'vendedor'} empty={!nome} name={nome ?? m.id} />
              </div>

              {/* Handle de girar (só no modo posicionar) */}
              {editLayout && (
                <button
                  onPointerDown={e => iniciarGirar(e, m.id)}
                  title="Girar a mesa"
                  className="absolute left-1/2 -top-3 -translate-x-1/2 h-5 w-5 rounded-full bg-accent text-black flex items-center justify-center shadow ring-2 ring-black/30 cursor-grab active:cursor-grabbing z-30 touch-none"
                >
                  <RotateCw className="h-3 w-3" />
                </button>
              )}

              {nome ? (
                <>
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-0.5 max-w-full px-1 text-[8px] font-bold text-ink truncate leading-none">
                    {nome.split(' ')[0]}
                  </span>
                  {isOutro ? (
                    <span className="absolute top-0 right-0 text-[7px] font-bold px-1 py-0.5 rounded bg-purple-500/30 text-purple-200 leading-none">
                      {abreviaSetor(info?.setor ?? null)}
                    </span>
                  ) : (
                    <span className={`absolute top-0.5 right-0.5 h-2 w-2 rounded-full ring-1 ring-black/40 ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} title={online ? 'ligado' : 'desligado'} />
                  )}
                  {!editLayout && (
                    <button
                      onClick={e => { e.stopPropagation(); limpar.mutate(m.id) }}
                      title="Tirar da mesa"
                      className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 text-ink-faint hover:text-red-400 bg-surface/70 rounded-full transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </>
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-ink/30">{idx + 1}</span>
              )}
            </div>
          )
        })}

        {/* Botões de apagar parede (modo paredes, só nas customizadas) */}
        {modo === 'paredes' && temCustom && (paredes ?? []).map(p => (
          <button
            key={`del-${p.id}`}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); delParede.mutate(p.id) }}
            title="Apagar esta parede"
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] leading-none shadow ring-1 ring-black/40 z-30 hover:bg-red-600"
            style={{ left: pct(p.x, VB.w), top: pct(p.y, VB.h) }}
          >×</button>
        ))}
      </div>
    </Card>
  )
}
