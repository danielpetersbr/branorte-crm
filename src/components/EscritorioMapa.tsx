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
// Estado ao vivo do vendedor (vem do heartbeat da extensão, calculado no Disparos.tsx)
type LiveStatus = {
  status: 'ativo' | 'aguardando' | 'wa_fechado' | 'verificar_wa' | 'lento' | 'versao_antiga' | 'desconectado' | 'desligado'
  pingSec: number | null
  versao: string | null
  enviadosHoje: number
  ultimoEnvio: string | null
}
const STATUS_CFG: Record<LiveStatus['status'], { dot: string; label: string; glow?: boolean; fade?: boolean }> = {
  ativo:         { dot: 'bg-emerald-400', label: 'ativo',          glow: true },
  aguardando:    { dot: 'bg-cyan-400',    label: 'aguardando WA' },
  wa_fechado:    { dot: 'bg-orange-400',  label: 'WA fechado' },
  verificar_wa:  { dot: 'bg-orange-400',  label: 'verificar WA' },
  lento:         { dot: 'bg-amber-400',   label: 'lento' },
  versao_antiga: { dot: 'bg-amber-400',   label: 'recarregar' },
  desconectado:  { dot: 'bg-red-400',     label: 'desconectado', fade: true },
  desligado:     { dot: 'bg-slate-500',   label: 'desligado',    fade: true },
}

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

// Gradientes/filtros compartilhados (referenciados por url(#id) em todas as estações).
function WorkDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="ws-desk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bb9069" />
          <stop offset="1" stopColor="#80561f" />
        </linearGradient>
        <linearGradient id="ws-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <filter id="ws-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>
    </svg>
  )
}

function Workstation({ tipo, empty, name, ativo }: { tipo: 'vendedor' | 'outro'; empty: boolean; name: string; ativo?: boolean }) {
  const hue = hueFromName(name || 'x')
  const shirt = empty ? '#3a4456' : tipo === 'outro' ? 'hsl(270 50% 58%)' : `hsl(${hue} 60% 56%)`
  const hair = empty ? '#2c3441' : tipo === 'outro' ? 'hsl(270 35% 30%)' : `hsl(${hue} 45% 26%)`
  const skin = '#f1c7a3'
  return (
    <svg viewBox="0 0 100 96" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* sombra suave no chão */}
      <ellipse cx="50" cy="91" rx="40" ry="5" fill="#000" opacity="0.25" filter="url(#ws-soft)" />
      {/* cadeira: base giratória + haste + assento + encosto */}
      <ellipse cx="50" cy="21" rx="9" ry="2.6" fill="#222a33" opacity="0.7" />
      <rect x="48.6" y="11" width="2.8" height="9" rx="1.4" fill="#2b333f" />
      <rect x="34" y="1" width="32" height="18" rx="9" fill="#2b333f" />
      <rect x="37.5" y="3.5" width="25" height="12" rx="6.5" fill="#3c4757" />
      {!empty && (
        <>
          {/* braços + mãos sobre a mesa */}
          <rect x="30.5" y="43" width="7" height="21" rx="3.5" fill={shirt} />
          <rect x="62.5" y="43" width="7" height="21" rx="3.5" fill={shirt} />
          <circle cx="34" cy="63" r="3" fill={skin} />
          <circle cx="66" cy="63" r="3" fill={skin} />
          {/* corpo + luz de cima */}
          <ellipse cx="50" cy="42" rx="18" ry="11.5" fill={shirt} />
          <ellipse cx="50" cy="38" rx="13" ry="5.5" fill="#ffffff" opacity="0.13" />
          {/* cabeça + cabelo + brilho */}
          <circle cx="50" cy="30" r="10.5" fill={skin} />
          <path d="M39.5 30 a10.5 10.5 0 0 1 21 0 q-10.5 -7.5 -21 0 z" fill={hair} />
          <ellipse cx="46" cy="24" rx="4.5" ry="2" fill="#ffffff" opacity="0.16" />
        </>
      )}
      {/* mesa */}
      <rect x="9" y="50" width="82" height="38" rx="7" fill="url(#ws-desk)" />
      <rect x="9" y="50" width="82" height="7" rx="7" fill="#cb9d72" opacity="0.85" />
      {/* monitor + tela com gráfico */}
      <rect x="47.5" y="61.5" width="5" height="5" rx="1" fill="#0c1118" />
      <rect x="36" y="49" width="28" height="16" rx="2" fill="#0b1220" />
      <rect x="38" y="51" width="24" height="12" rx="1" fill="url(#ws-screen)" opacity={empty ? 0.25 : 0.95} />
      {!empty && <path d="M40 60 L45 55 L49 58 L54 52 L60 54.5" fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.55" strokeLinecap="round" strokeLinejoin="round" />}
      <rect x="39" y="51.5" width="6" height="9" rx="1" fill="#ffffff" opacity="0.08" />
      {/* teclado + mouse */}
      <rect x="41" y="72" width="19" height="5" rx="1.5" fill="#d3dae5" />
      <circle cx="65" cy="74" r="2" fill="#d3dae5" />
      {/* telefone */}
      <rect x="13" y="69" width="7" height="11" rx="1.5" fill="#1f2733" />
      <rect x="14" y="70.5" width="5" height="6.5" rx="0.6" fill={empty ? '#33414f' : 'hsl(150 50% 45%)'} opacity="0.85" />
      {/* caneca + vapor */}
      <circle cx="79" cy="73" r="3" fill={empty ? '#3a4456' : 'hsl(150 55% 46%)'} />
      <path d="M82 71.6 q2.6 1.4 0 2.8" stroke={empty ? '#3a4456' : 'hsl(150 55% 46%)'} strokeWidth="1" fill="none" />
      {!empty && <path d="M79 67.5 q1.6 -2 0 -4" stroke="#cbd5e1" strokeWidth="0.7" fill="none" opacity="0.4" />}
      {/* papéis */}
      <rect x="22" y="80" width="9" height="6" rx="1" fill="#e7e2d5" opacity="0.85" transform="rotate(-9 26 83)" />
      {/* plantinha */}
      <rect x="84" y="80" width="6" height="6" rx="1" fill="#7c5a3a" />
      <circle cx="87" cy="79" r="4" fill="hsl(140 45% 40%)" />
      <circle cx="85" cy="80" r="2.4" fill="hsl(140 48% 50%)" />
      {/* balão de "digitando" quando ativo */}
      {!empty && ativo && (
        <g transform="translate(67 13)">
          <rect x="-9" y="-6" width="18" height="11" rx="5" fill="#0b1220" opacity="0.9" />
          {[0, 1, 2].map(i => (
            <circle key={i} cx={-4 + i * 4} cy="-0.5" r="1.4" fill="#5eead4">
              <animate attributeName="opacity" values="0.25;1;0.25" dur="1s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      )}
    </svg>
  )
}

// Card de funil detalhado mostrado ao passar o mouse no vendedor.
type FunilCardData = {
  prospec: number; novoLead: number; tentativa: number; followup: number; quente: number; orcamento: number; vendido: number; perdidos: number
  aberto: number; atendimentos: number; totalChats: number
}
function FunilCard({ f, nome, below, open }: { f: FunilCardData; nome: string; below: boolean; open?: boolean }) {
  const stages: Array<[string, number, string]> = [
    ['Prospecção', f.prospec, 'bg-slate-400'],
    ['Novo lead', f.novoLead, 'bg-cyan-400'],
    ['2ª tentativa', f.tentativa, 'bg-blue-400'],
    ['Follow up', f.followup, 'bg-indigo-400'],
    ['Lead quente', f.quente, 'bg-orange-400'],
    ['Orçamento', f.orcamento, 'bg-sky-400'],
    ['Vendido', f.vendido, 'bg-emerald-400'],
    ['Perdidos', f.perdidos, 'bg-red-500/70'],
  ]
  const max = Math.max(1, ...stages.map(s => s[1]))
  const conv = f.vendido + f.perdidos > 0 ? Math.round((f.vendido / (f.vendido + f.perdidos)) * 100) : 0
  return (
    <div className={`absolute left-1/2 -translate-x-1/2 ${below ? 'top-full mt-2' : 'bottom-full mb-2'} z-50 w-52 rounded-lg bg-[#0b1220] ring-1 ring-white/15 shadow-xl shadow-black/70 p-2.5 transition-opacity duration-150 pointer-events-none ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
      <div className="text-[12px] font-bold text-ink mb-1.5 flex items-center justify-between">
        <span className="truncate">{nome}</span>
        <span className="text-[9px] text-ink-faint font-normal">funil ao vivo</span>
      </div>
      <div className="space-y-1">
        {stages.map(([label, n, color]) => (
          <div key={label} className="flex items-center gap-1.5 text-[10px]">
            <span className="w-[58px] text-ink-muted shrink-0">{label}</span>
            <div className="flex-1 h-2.5 rounded bg-white/5 overflow-hidden">
              <div className={`h-full ${color} rounded`} style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="w-7 text-right font-bold text-ink tabular-nums">{n}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-1.5 border-t border-white/10 space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-ink-muted">🎯 Conversão (vendido / fechados)</span>
          <span className={`font-bold tabular-nums ${conv >= 30 ? 'text-emerald-300' : conv >= 15 ? 'text-amber-300' : 'text-red-300'}`}>{conv}%</span>
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9.5px] text-ink-muted">
          <span className="text-cyan-300 font-semibold">👥 {f.aberto} aberto</span>
          <span className="text-violet-300 font-semibold">💬 {f.atendimentos} hoje</span>
          <span>👤 {f.totalChats} carteira</span>
        </div>
      </div>
    </div>
  )
}

export function EscritorioMapa({ vendedores, live }: { vendedores: VendedorLite[]; live?: Record<string, LiveStatus> }) {
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
  const [cardAberto, setCardAberto] = useState<string | null>(null) // funil fixado por clique (mobile)

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
  // Lista de paredes pra desenhar (custom do banco, ou o padrão: contorno + divisórias)
  const wallRects: Rect[] = temCustom
    ? (paredes ?? [])
    : [
        { x: 16, y: 18, w: 612, h: 606 },
        ...LINES.map(([x1, y1, x2, y2]) => x1 === x2
          ? { x: x1 - 1, y: Math.min(y1, y2), w: 2, h: Math.abs(y2 - y1) }
          : { x: Math.min(x1, x2), y: y1 - 1, w: Math.abs(x2 - x1), h: 2 }),
      ]

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

  // Orçamentos feitos hoje por vendedor (orcamentos_gerados guarda nome completo → casa por 1º nome)
  const { data: orcHoje } = useQuery<Record<string, number>>({
    queryKey: ['escritorio-orcamentos-hoje'],
    queryFn: async () => {
      const inicio = new Date(); inicio.setHours(0, 0, 0, 0)
      const { data } = await supabase.from('orcamentos_gerados').select('vendedor_nome').gte('created_at', inicio.toISOString())
      const m: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ vendedor_nome: string | null }>) {
        const k = (r.vendedor_nome ?? '').trim().split(/\s+/)[0]?.toUpperCase()
        if (k) m[k] = (m[k] ?? 0) + 1
      }
      return m
    },
    refetchInterval: 30000,
  })
  const orcDe = (nome: string) => orcHoje?.[(nome.split(/\s+/)[0] || '').toUpperCase()] ?? 0

  // Leads recebidos hoje — MESMA fonte da página Atendimentos (auditoria.atendimentos_por_cliente, created_at hoje)
  const { data: leadsHoje } = useQuery<Record<string, number>>({
    queryKey: ['escritorio-leads-hoje'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_leads_hoje')
      const m: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ vend: string; leads: number }>) m[r.vend] = r.leads
      return m
    },
    refetchInterval: 30000,
  })
  const leadsDe = (nome: string) => leadsHoje?.[(nome.split(/\s+/)[0] || '').toUpperCase()] ?? 0

  // Funil ao vivo por vendedor (etiquetas do heartbeat via RPC) — QUENTE/NOVO LEAD/etc.
  type Funil = { aberto: number; prospec: number; novoLead: number; tentativa: number; followup: number; quente: number; orcamento: number; vendido: number; perdidos: number; totalChats: number; atendimentos: number; msgs: number }
  const { data: funil } = useQuery<Record<string, Funil>>({
    queryKey: ['escritorio-funil'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_funil_vivo')
      const m: Record<string, Funil> = {}
      for (const r of (data ?? []) as Array<Record<string, any>>) {
        m[r.vendedor_nome] = { aberto: r.aberto, prospec: r.prospec, novoLead: r.novo_lead, tentativa: r.tentativa, followup: r.followup, quente: r.quente, orcamento: r.orcamento, vendido: r.vendido, perdidos: r.perdidos, totalChats: r.total_chats, atendimentos: r.atendimentos, msgs: r.msgs }
      }
      return m
    },
    refetchInterval: 20000,
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

  // ----- Painel do gestor: KPIs do dia, líder e alerta de parados -----
  const hora = new Date().getHours()
  const expediente = hora >= 7 && hora < 19
  const ALERTA_STATUS = ['wa_fechado', 'verificar_wa', 'desconectado']
  const kpis = useMemo(() => {
    let leads = 0, orc = 0, quentes = 0, ativos = 0, parados = 0, atend = 0
    for (const v of vendedores) {
      const n = v.vendedor_nome
      leads += leadsDe(n)
      orc += orcDe(n)
      quentes += funil?.[n]?.quente ?? 0
      atend += funil?.[n]?.atendimentos ?? 0
      const st = live?.[n]?.status
      if (st === 'ativo') ativos++
      if (expediente && st && ALERTA_STATUS.includes(st)) parados++
    }
    return { leads, orc, quentes, ativos, total: vendedores.length, parados, atend }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedores, live, funil, orcHoje, leadsHoje, expediente])
  const leader = useMemo(() => {
    let best: string | null = null, bo = -1, bl = -1
    for (const v of vendedores) {
      const o = orcDe(v.vendedor_nome), l = leadsDe(v.vendedor_nome)
      if (o > bo || (o === bo && l > bl)) { best = v.vendedor_nome; bo = o; bl = l }
    }
    return (bo > 0 || bl > 0) ? best : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedores, orcHoje, leadsHoje])

  // Ranking do dia: vendedores ordenados por nº de atendimentos (desempate: orçamentos, depois aberto).
  const ranking = useMemo(() => {
    return vendedores
      .map(v => {
        const n = v.vendedor_nome
        const f = funil?.[n]
        return { nome: n, online: v.online, atendimentos: f?.atendimentos ?? 0, orcamentos: orcDe(n), aberto: f?.aberto ?? 0 }
      })
      .sort((a, b) => b.atendimentos - a.atendimentos || b.orcamentos - a.orcamentos || b.aberto - a.aberto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedores, funil, orcHoje])

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
    if (selected) { soltarNaMesa(mesaId, selected); return }
    // clique no vendedor (sem ninguém selecionado) = fixa/desfixa o card de funil (pra mobile)
    const nm = assignMap[mesaId]
    if (nm && infoDe[nm]?.tipo !== 'outro') setCardAberto(c => (c === nm ? null : nm))
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
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2 flex-wrap">
            <Building2 className="h-4 w-4 text-accent" />
            Escritório — quem senta em cada mesa
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> AO VIVO
            </span>
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

      {/* Painel do gestor — KPIs do dia */}
      {modo === 'normal' && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-emerald-500/12 ring-1 ring-emerald-400/30 text-emerald-200" title="Leads recebidos hoje pelo time">📥 {kpis.leads}<span className="text-ink-faint font-normal text-[10px] ml-0.5">leads</span></span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-sky-500/12 ring-1 ring-sky-400/30 text-sky-200" title="Orçamentos feitos hoje pelo time">📄 {kpis.orc}<span className="text-ink-faint font-normal text-[10px] ml-0.5">orçam.</span></span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-violet-500/12 ring-1 ring-violet-400/30 text-violet-200" title="Atendimentos hoje — chats trabalhados pelo time">💬 {kpis.atend}<span className="text-ink-faint font-normal text-[10px] ml-0.5">atend.</span></span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-orange-500/12 ring-1 ring-orange-400/30 text-orange-200" title="Leads QUENTES no funil do time (cobre quem deixou esfriar)">🔥 {kpis.quentes}<span className="text-ink-faint font-normal text-[10px] ml-0.5">quentes</span></span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-emerald-500/12 ring-1 ring-emerald-400/30 text-emerald-200" title="Vendedores ativos agora / total">🟢 {kpis.ativos}/{kpis.total}<span className="text-ink-faint font-normal text-[10px] ml-0.5">ativos</span></span>
          {kpis.parados > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-red-500/15 ring-1 ring-red-400/40 text-red-200 animate-pulse" title="Em horário comercial com WhatsApp fechado/desconectado — liga pra eles">🚨 {kpis.parados}<span className="text-red-200/80 font-normal text-[10px] ml-0.5">parados</span></span>
          )}
          {leader && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold bg-amber-500/15 ring-1 ring-amber-400/40 text-amber-200 ml-auto" title="Líder do dia — mais orçamentos (depois leads)">👑 {leader.split(' ')[0]}</span>
          )}
        </div>
      )}

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

      {/* Planta + ranking do dia, lado a lado */}
      <div className="flex flex-col lg:flex-row gap-3 items-start">
      <div className="flex-1 min-w-0 w-full">
      {/* Planta (vista de cima) */}
      <div
        ref={plantaRef}
        onPointerDown={modo === 'paredes' ? iniciarDesenho : undefined}
        className={`relative w-full mx-auto select-none rounded-xl ${modo !== 'normal' ? 'ring-1 ring-accent/40' : ''} ${modo === 'paredes' ? 'cursor-crosshair' : ''}`}
        style={{
          maxWidth: 1000,
          aspectRatio: `${VB.w} / ${VB.h}`,
          background: 'radial-gradient(120% 120% at 50% 0%, hsl(220 22% 16%) 0%, hsl(222 26% 11%) 70%)',
          touchAction: modo === 'paredes' ? 'none' : undefined,
        }}
      >
        <WorkDefs />
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 w-full h-full pointer-events-none text-ink/30" preserveAspectRatio="none">
          <defs>
            <pattern id="floor-grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M30 0 H0 V30" fill="none" stroke="currentColor" strokeWidth="0.6" />
            </pattern>
            <radialGradient id="floor-vig" cx="50%" cy="34%" r="80%">
              <stop offset="52%" stopColor="#000" stopOpacity="0" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.4" />
            </radialGradient>
            <filter id="wall-sh" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>
          <rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#floor-grid)" opacity="0.30" />
          <rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#floor-vig)" />
          {/* PAREDES 3D: sombra + corpo grosso + brilho no topo */}
          <g transform="translate(0,2.4)" stroke="#070a0e" strokeWidth={9} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity="0.45" filter="url(#wall-sh)">
            {wallRects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />)}
          </g>
          <g stroke="#a9b1be" strokeWidth={7.5} fill="none" strokeLinejoin="round" strokeLinecap="round">
            {wallRects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />)}
          </g>
          <g transform="translate(0,-1.5)" stroke="#eaedf3" strokeWidth={2.6} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity="0.55">
            {wallRects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />)}
          </g>
          {draft && draft.w > 0 && draft.h > 0 && (
            <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} rx={2}
              fill="rgba(20,184,138,0.12)" stroke="hsl(160 70% 50%)" strokeWidth={2} strokeDasharray="6 4" />
          )}
        </svg>

        {MESAS.map((m, idx) => {
          const nome = assignMap[m.id]
          const info = nome ? infoDe[nome] : undefined
          const isOutro = info?.tipo === 'outro'
          const ls = nome && !isOutro ? live?.[nome] : undefined
          const cfg = ls ? STATUS_CFG[ls.status] : undefined
          const fade = !!cfg?.fade && modo === 'normal'
          const alerta = !isOutro && modo === 'normal' && expediente && !!ls && ALERTA_STATUS.includes(ls.status)
          const quente = !isOutro && nome ? (funil?.[nome]?.quente ?? 0) : 0
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
              title={nome
                ? (isOutro
                    ? `${nome}${info?.setor ? ' · ' + info.setor : ''} — mesa ${idx + 1}`
    : `${nome} — ${cfg?.label ?? 'sem sinal'}${ls?.pingSec != null ? ' · há ' + Math.round(ls.pingSec) + 's' : ''}${ls?.versao ? ' · v' + ls.versao : ''}`)
                : `Mesa ${idx + 1} (vazia)`}
              className={`group absolute rounded-lg transition-shadow ${
                editLayout ? `cursor-move ring-1 ${movendo === m.id ? 'ring-accent z-20 shadow-lg shadow-black/40' : 'ring-accent/40'} bg-accent/5` :
                isOver ? 'ring-2 ring-accent bg-accent/15 scale-105 z-10' :
                nome ? 'hover:bg-white/5' :
                'border border-dashed border-ink/20 hover:border-accent/60 hover:bg-accent/5 cursor-pointer'
              } ${alerta ? 'ring-2 ring-red-500/70 animate-pulse' : ''}`}
              style={{ left, top, width, height, touchAction: editLayout ? 'none' : undefined, pointerEvents: modo === 'paredes' ? 'none' : undefined }}
            >
              <div
                draggable={!!nome && !editLayout}
                onDragStart={e => { if (nome && !editLayout) { e.dataTransfer.setData('text/plain', nome); setDragging(nome) } }}
                onDragEnd={() => setDragging(null)}
                className={`w-full h-full transition-opacity ${nome && !editLayout ? 'cursor-grab active:cursor-grabbing' : ''} ${fade ? 'opacity-40 grayscale' : ''}`}
                style={{ transform: `rotate(${rotDe(m.id)}deg)`, transition: girando === m.id ? 'none' : 'transform .12s' }}
              >
                <Workstation tipo={isOutro ? 'outro' : 'vendedor'} empty={!nome} name={nome ?? m.id} ativo={ls?.status === 'ativo'} />
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
                  {!editLayout && leader === nome && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[15px] leading-none z-20" title="Líder do dia (mais orçamentos, depois leads)">👑</span>
                  )}
                  {/* status (vendedor) ou setor (outro) no topo-direito */}
                  {isOutro ? (
                    <span className="absolute -top-1.5 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/50 ring-1 ring-purple-300/40 text-purple-50 leading-none">
                      {abreviaSetor(info?.setor ?? null)}
                    </span>
                  ) : (
                    <span
                      className={`absolute top-1 right-1 h-3 w-3 rounded-full ring-2 ring-black/50 ${cfg?.dot ?? 'bg-slate-500'} ${cfg?.glow ? 'shadow-[0_0_8px_2px_rgba(16,185,129,0.8)] animate-pulse' : ''}`}
                      title={cfg?.label ?? 'sem sinal'}
                    />
                  )}
                  {/* nome + números do dia (sempre visíveis) */}
                  <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 flex flex-col items-center gap-0.5 max-w-[170%]">
                    <span className="px-2 py-0.5 rounded-md bg-black/60 ring-1 ring-white/10 text-[11px] font-bold text-white truncate leading-tight max-w-full">
                      {nome.split(' ')[0]}
                    </span>
                    {!isOutro && !editLayout && (
                      <span className="flex items-stretch rounded-md bg-black/75 ring-1 ring-white/10 overflow-hidden text-[10.5px] font-extrabold leading-none divide-x divide-white/10 shadow-md shadow-black/40">
                        <span className="px-1.5 py-1 text-cyan-300 flex items-center gap-0.5" title="clientes em atendimento aberto (negociação ativa)">👥{funil?.[nome]?.aberto ?? 0}</span>
                        <span className="px-1.5 py-1 text-violet-300 flex items-center gap-0.5" title="atendimentos hoje (chats trabalhados no dia)">💬{funil?.[nome]?.atendimentos ?? 0}</span>
                        <span className="px-1.5 py-1 text-emerald-300 flex items-center gap-0.5" title="leads que chegaram hoje (fonte: página Atendimentos)">📥{leadsDe(nome)}</span>
                        <span className="px-1.5 py-1 text-sky-300 flex items-center gap-0.5" title="orçamentos feitos hoje">📄{orcDe(nome)}</span>
                        {quente > 0 && <span className="px-1.5 py-1 text-orange-300 flex items-center gap-0.5" title="leads quentes no funil">🔥{quente}</span>}
                      </span>
                    )}
                  </div>
                  {!editLayout && (
                    <button
                      onClick={e => { e.stopPropagation(); limpar.mutate(m.id) }}
                      title="Tirar da mesa"
                      className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 text-ink-faint hover:text-red-400 bg-surface/70 rounded-full transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  {!isOutro && !editLayout && funil?.[nome] && (
                    <FunilCard f={funil[nome]} nome={nome} below={p.y < 165} open={cardAberto === nome} />
                  )}
                </>
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold text-ink/30">{idx + 1}</span>
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
      </div>{/* /flex-1 (mapa) */}

      {/* Coluna de RANKING do dia — ao lado do mapa */}
      <aside className="w-full lg:w-72 shrink-0 rounded-xl border border-border bg-surface-2/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-ink">🏆 Ranking do dia</h3>
          <span className="text-[10px] text-ink-faint">por atendimentos</span>
        </div>
        <div className="space-y-1 lg:max-h-[560px] overflow-y-auto pr-0.5">
          {ranking.length === 0 && <div className="text-[11px] text-ink-faint text-center py-4">Sem vendedores.</div>}
          {ranking.map((r, i) => (
            <div key={r.nome} className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-white/[0.03] border border-white/5">
              <span className={`w-6 shrink-0 text-center text-sm font-bold ${i === 0 ? 'text-amber-300' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-300' : 'text-ink-faint'}`}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-ink truncate flex items-center gap-1">
                  {r.nome}
                  {r.online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="online" />}
                </div>
                <div className="flex items-center gap-2.5 text-[10px] mt-0.5">
                  <span className="text-violet-300 font-semibold" title="atendimentos hoje">💬 {r.atendimentos}</span>
                  <span className="text-sky-300 font-semibold" title="orçamentos hoje">📄 {r.orcamentos}</span>
                  <span className="text-cyan-300 font-semibold" title="clientes em atendimento aberto">👥 {r.aberto}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
      </div>{/* /flex (mapa + ranking) */}

      {/* Legenda do estado ao vivo */}
      {modo === 'normal' && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-ink-muted justify-center">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_5px_1px_rgba(16,185,129,.7)]" /> ativo</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400" /> aguardando WA</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> WA fechado</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> lento</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> desconectado</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-500" /> desligado</span>
          <span className="flex items-center gap-1.5 text-ink-faint flex-wrap">por boneco: <span className="text-cyan-300 font-bold">👥atend. aberto</span> · <span className="text-violet-300 font-bold">💬atend. hoje</span> · <span className="text-emerald-300 font-bold">📥leads</span> · <span className="text-sky-300 font-bold">📄orçam.</span> · <span className="text-orange-300 font-bold">🔥quentes</span> (hoje)</span>
        </div>
      )}
    </Card>
  )
}
