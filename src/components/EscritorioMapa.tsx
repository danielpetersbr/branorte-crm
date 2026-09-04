import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { EscritorioGestor } from '@/components/EscritorioGestor'
import { supabase } from '@/lib/supabase'
import {
  criarAlertasGestor,
  criarResumoGestor,
  escolherVendedorInicial,
  formatarMetricaGestor,
  mesaTemSuperficieClicavelGestor,
  normalizarFatorCotaGestor,
  type VendedorGestor,
} from '@/lib/escritorio-gestor'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, X, MousePointerClick, UserPlus, Move, Check, RotateCw, Pencil } from 'lucide-react'

// ============================================================================
// Mapa do escritório (vista de cima) — arraste cada pessoa pra sua estação.
// Modo "Mover mesas" deixa reposicionar cada estação (salva pos_x/pos_y).
// Cada estação = mesa + monitor + cadeira + bonequinho. ViewBox 644x642.
// ============================================================================

type VendedorLite = { vendedor_nome: string; online: boolean }
export type CotaVendedorGestor = {
  parados_topo: number
  fator_cota: number
  cortado_por_cota: boolean
}
type Pessoa = { nome: string; setor: string | null }
type Ocupante = { nome: string; tipo: 'vendedor' | 'outro'; online: boolean; setor: string | null }
type Pos = { x: number; y: number }
// Estado ao vivo do vendedor (vem do heartbeat da extensão, calculado no Disparos.tsx)
type LiveStatus = {
  status: 'ativo' | 'ocioso' | 'aguardando' | 'wa_fechado' | 'verificar_wa' | 'lento' | 'versao_antiga' | 'desconectado' | 'desligado'
  pingSec: number | null
  versao: string | null
  enviadosHoje: number
  ultimoEnvio: string | null
}
const STATUS_CFG: Record<LiveStatus['status'], { dot: string; label: string; glow?: boolean; fade?: boolean }> = {
  ativo:         { dot: 'bg-emerald-400', label: 'trabalhando',    glow: true },
  ocioso:        { dot: 'bg-yellow-300',  label: 'aberto, parado' },
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
// Nome curto pro label da mesa: 1º nome + sufixo de geração (JR/FILHO/NETO/…).
// Sem isso, "EDILSON JR" virava só "EDILSON" e parecia duplicado do EDILSON (CEO).
const SUFIXOS_NOME = new Set(['JR', 'JR.', 'JUNIOR', 'JÚNIOR', 'FILHO', 'NETO', 'SOBRINHO', 'II', 'III'])
function nomeCurto(nome: string): string {
  const parts = (nome || '').trim().split(/\s+/)
  if (parts.length <= 1) return nome
  const ult = parts[parts.length - 1]
  return SUFIXOS_NOME.has(ult.toUpperCase()) ? `${parts[0]} ${ult}` : parts[0]
}

// Janela de trabalho: seg–sex, 07:15–17:30. O contador de inatividade só conta DENTRO dela
// (pula noite e fim de semana) — daí "inteligente".
const WORK_DOW = new Set([1, 2, 3, 4, 5])
const WORK_INI_MIN = 7 * 60 + 15   // 07:15
const WORK_FIM_MIN = 17 * 60 + 30  // 17:30
// VERMELHO "inativo" = SÓ quando o navegador está REALMENTE fechado (pedido do Daniel).
// 'desconectado' = sem heartbeat há 15min+ (ou nenhum ping em 30min). Como o heartbeat pinga
// MESMO sem aba do WhatsApp aberta, ausência de ping = navegador/PC fechado de verdade.
// TIRADOS do vermelho (disparavam com ping RECENTE = navegador ABERTO, falso alarme):
//   wa_fechado/verificar_wa (aba do WA momentaneamente não-pronta, ex: logo após reload),
//   versao_antiga, e desligado (admin desligou de propósito — não é queda).
// Esses seguem com o DOT colorido próprio (laranja/âmbar/slate) no STATUS_CFG — informa sem alarmar.
const OFFLINE_STATUSES = new Set<LiveStatus['status']>(['desconectado'])
// Minutos ÚTEIS entre dois instantes (intersecção com a janela seg–sex 07:15–17:30).
function minutosUteisInativo(fromMs: number, toMs: number): number {
  if (!fromMs || toMs <= fromMs) return 0
  const ini = Math.max(fromMs, toMs - 21 * 86400_000) // teto de 21 dias
  let total = 0
  const dia = new Date(ini); dia.setHours(0, 0, 0, 0)
  const fimDia = new Date(toMs); fimDia.setHours(0, 0, 0, 0)
  for (let d = new Date(dia); d.getTime() <= fimDia.getTime(); d.setDate(d.getDate() + 1)) {
    if (!WORK_DOW.has(d.getDay())) continue
    const wi = new Date(d); wi.setHours(0, WORK_INI_MIN, 0, 0)
    const wf = new Date(d); wf.setHours(0, WORK_FIM_MIN, 0, 0)
    const a = Math.max(ini, wi.getTime())
    const b = Math.min(toMs, wf.getTime())
    if (b > a) total += (b - a) / 60000
  }
  return Math.round(total)
}
function fmtDurInativo(min: number): string {
  if (min < 1) return 'agora'
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}

// Ícone/cor por etiqueta de destino (feed de atividade ao vivo)
function etiquetaInfo(nome: string | null): { icon: string; cor: string } {
  const s = (nome || '').toUpperCase()
  if (/VENDIDO/.test(s)) return { icon: '✅', cor: 'text-green-300' }
  if (/OR.AMENTO/.test(s)) return { icon: '📄', cor: 'text-sky-300' }
  if (/QUENTE/.test(s)) return { icon: '🔥', cor: 'text-orange-300' }
  if (/NOVO LEAD/.test(s)) return { icon: '🆕', cor: 'text-cyan-300' }
  if (/FOLLOW/.test(s)) return { icon: '🔄', cor: 'text-indigo-300' }
  if (/TENTATIVA/.test(s)) return { icon: '↩️', cor: 'text-blue-300' }
  if (/PROSPEC/.test(s)) return { icon: '🔍', cor: 'text-slate-300' }
  if (/RESOLVIDO/.test(s)) return { icon: '☑️', cor: 'text-teal-300' }
  if (/INTERESSE FUTURO/.test(s)) return { icon: '⏳', cor: 'text-amber-300' }
  if (/NUNCA RESPONDEU|N[AÃ]O RESPONDEU/.test(s)) return { icon: '💤', cor: 'text-ink-faint' }
  if (/INTERESSE|FORA DO|FABRICAMOS|CONCORRENTE|BASE DE PRE/.test(s)) return { icon: '🚫', cor: 'text-red-300' }
  return { icon: '🔖', cor: 'text-ink-muted' }
}
function haRel(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min`
  return `${Math.round(m / 60)}h`
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

export function EscritorioMapa({ vendedores, live, efetivo, cotaAtiva, cotaZero }: {
  vendedores: VendedorLite[]
  live?: Record<string, LiveStatus>
  efetivo?: Record<string, CotaVendedorGestor>
  cotaAtiva: boolean
  cotaZero: number
}) {
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
  const [vendedorSelecionado, setVendedorSelecionado] = useState<string | null>(null)

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
  const { data: orcHoje, isFetched: orcHojeFetched } = useQuery<Record<string, number>>({
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
  const { data: leadsHoje, isFetched: leadsHojeFetched } = useQuery<Record<string, number>>({
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

  // Ligações ATENDIDAS e contatos puxados da prospecção, ambos do dia (pedido do Daniel 19/08).
  //
  // ⚠️ É "atendidas", NÃO "que ele fez" — e a diferença não é preciosismo: a DIREÇÃO da
  // chamada não é confiável. Medido em 18/08, das 801 chamadas presentes nas duas fontes,
  // 7% têm direção conflitante, e pros dois lados. Por isso o ranking nominal de "quem mais
  // ligou" está travado (LIGACAO_REGUA_CONFIAVEL=false). O DESFECHO é outro campo e é
  // confiável — dá pra dizer que o cliente atendeu sem saber quem discou.
  type LigProsp = { atendidas: number; ligTotal: number; puxados: number; trabalhados: number }
  const { data: ligProsp, isFetched: ligProspFetched } = useQuery<Record<string, LigProsp>>({
    queryKey: ['escritorio-lig-prospec-hoje'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_ligacoes_prospec_hoje')
      const m: Record<string, LigProsp> = {}
      for (const r of (data ?? []) as Array<Record<string, any>>) {
        m[r.vend] = { atendidas: r.lig_atendidas ?? 0, ligTotal: r.lig_total ?? 0, puxados: r.prospec_puxados ?? 0, trabalhados: r.prospec_trabalhados ?? 0 }
      }
      return m
    },
    refetchInterval: 30000,
  })
  const ligProspDe = (nome: string) => ligProsp?.[(nome.split(/\s+/)[0] || '').toUpperCase()]

  // Funil ao vivo por vendedor (etiquetas do heartbeat via RPC) — QUENTE/NOVO LEAD/etc.
  type Funil = { aberto: number; prospec: number; novoLead: number; tentativa: number; followup: number; quente: number; orcamento: number; vendido: number; perdidos: number; totalChats: number; atendimentos: number; msgs: number }
  const { data: funil, isFetched: funilFetched } = useQuery<Record<string, Funil>>({
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

  // ----- Painel do gestor: uma normalização por vendedor, preservando fonte ausente como null -----
  const hora = new Date().getHours()
  const expediente = hora >= 7 && hora < 19
  const ALERTA_STATUS = ['wa_fechado', 'verificar_wa', 'desconectado']
  const vendedoresGestor = useMemo<VendedorGestor[]>(() => vendedores
    .filter(v => infoDe[v.vendedor_nome]?.tipo !== 'outro')
    .map(v => {
      const nome = v.vendedor_nome
      const f = funil?.[nome]
      const lp = ligProspDe(nome)
      const quota = efetivo?.[nome]
      const ls = live?.[nome]
      const status = ls?.status ?? 'desligado'
      return {
        nome,
        status,
        statusLabel: STATUS_CFG[status].label,
        pingSec: ls?.pingSec ?? null,
        versao: ls?.versao ?? null,
        atendimentos: funilFetched ? (f?.atendimentos ?? 0) : null,
        leads: leadsHojeFetched ? leadsDe(nome) : null,
        orcamentos: orcHojeFetched ? orcDe(nome) : null,
        ligacoesAtendidas: ligProspFetched ? (lp?.atendidas ?? 0) : null,
        ligacoesTotal: ligProspFetched ? (lp?.ligTotal ?? 0) : null,
        followup: funilFetched ? (f?.followup ?? 0) : null,
        quentes: funilFetched ? (f?.quente ?? 0) : null,
        carteiraAberta: funilFetched ? (f?.aberto ?? 0) : null,
        carteiraTotal: funilFetched ? (f?.totalChats ?? 0) : null,
        parados: quota ? quota.parados_topo : null,
        fatorCota: normalizarFatorCotaGestor(cotaAtiva, quota?.fator_cota),
        cortadoPorCota: cotaAtiva && !!quota?.cortado_por_cota,
      }
    }), [vendedores, infoDe, live, funil, funilFetched, ligProsp, ligProspFetched, efetivo, cotaAtiva, leadsHoje, leadsHojeFetched, orcHoje, orcHojeFetched])
  const vendedorGestorDe = useMemo(() => Object.fromEntries(vendedoresGestor.map(v => [v.nome, v])), [vendedoresGestor])
  const resumoGestor = useMemo(() => criarResumoGestor(vendedoresGestor, expediente), [vendedoresGestor, expediente])
  const alertasGestor = useMemo(
    () => criarAlertasGestor(vendedoresGestor, { expediente, cotaAtiva, cotaZero }),
    [vendedoresGestor, expediente, cotaAtiva, cotaZero],
  )

  useEffect(() => {
    setVendedorSelecionado(atual => {
      if (atual && vendedoresGestor.some(vendedor => vendedor.nome === atual)) return atual
      return escolherVendedorInicial(vendedoresGestor, alertasGestor)
    })
  }, [vendedoresGestor, alertasGestor])

  // Fonte mensal — atend/leads/orçamentos agregados no mês corrente (RPC escritorio_ranking_mes).
  const { data: rankingMesRaw, isFetched: rankingMesFetched, isError: rankingMesError } = useQuery<Array<{ vend: string; atendimentos: number; leads: number; orcamentos: number }>>({
    queryKey: ['escritorio-ranking-mes'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_ranking_mes')
      return (data ?? []) as Array<{ vend: string; atendimentos: number; leads: number; orcamentos: number }>
    },
    refetchInterval: 120_000,
  })

  const rankingMes = useMemo(() => {
    const nomesGestor = new Set(vendedoresGestor.map(v => (v.nome.split(/\s+/)[0] || '').toUpperCase()))
    return (rankingMesRaw ?? [])
      .filter(r => nomesGestor.has((r.vend.split(/\s+/)[0] || '').toUpperCase()))
      .map(r => ({
        nome: r.vend,
        atendimentos: r.atendimentos,
        leads: r.leads,
        orcamentos: r.orcamentos,
      }))
  }, [rankingMesRaw, vendedoresGestor])

  // Último heartbeat (sync) de cada vendedor — pra contar há quanto tempo está inativo (vermelho).
  const { data: ultimoSync } = useQuery<Record<string, number>>({
    queryKey: ['escritorio-ultimo-sync'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_ultimo_sync')
      const m: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ vendedor_nome: string; ultimo_sync: string }>) {
        if (r.vendedor_nome && r.ultimo_sync) m[r.vendedor_nome] = new Date(r.ultimo_sync).getTime()
      }
      return m
    },
    refetchInterval: 60_000,
  })

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
    // No modo normal, a mesa controla o detalhe gerencial e mantém o FunilCard fixável no mobile.
    const nm = assignMap[mesaId]
    if (nm && infoDe[nm]?.tipo !== 'outro') {
      setVendedorSelecionado(nm)
      setCardAberto(c => (c === nm ? null : nm))
    }
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

  const mapaEscritorio: ReactNode = (
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
              <button type="button" onClick={() => { if (confirm('Copiar o desenho padrão atual pra você editar (substitui o que tiver)?')) seedPadrao.mutate() }}
                className="text-[10px] px-2 py-1 rounded-full border border-border text-ink-muted hover:border-accent hover:text-accent">partir do padrão</button>
              <button type="button" onClick={() => { if (confirm('Apagar TODAS as paredes desenhadas?')) limparParedes.mutate() }}
                className="text-[10px] px-2 py-1 rounded-full border border-border text-ink-muted hover:border-red-400 hover:text-red-400">limpar tudo</button>
            </>
          )}
          <button
            type="button"
            onClick={() => { setModo(m => m === 'paredes' ? 'normal' : 'paredes'); setSelected(null) }}
            aria-pressed={modo === 'paredes'}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors ${
              modo === 'paredes' ? 'border-accent bg-accent/15 text-accent' : 'border-border text-ink-muted hover:border-accent hover:text-accent'
            }`}
          >
            {modo === 'paredes' ? <><Check className="h-3 w-3" /> Concluir</> : <><Pencil className="h-3 w-3" /> Paredes</>}
          </button>
          <button
            type="button"
            onClick={() => { setModo(m => m === 'mesas' ? 'normal' : 'mesas'); setSelected(null) }}
            aria-pressed={editLayout}
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
                className={`group inline-flex items-center rounded-full border text-[11px] font-semibold transition-all ${
                  isSel ? 'border-accent bg-accent/15 text-accent ring-1 ring-accent' :
                  sentado ? 'border-border bg-surface-2/60 text-ink-muted opacity-70' :
                  isOutro ? 'border-purple-400/40 bg-surface text-ink hover:border-purple-400' :
                  'border-accent/40 bg-surface text-ink hover:border-accent'
                }`}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('text/plain', o.nome); setDragging(o.nome) }}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => setSelected(isSel ? null : o.nome)}
                  aria-pressed={isSel}
                  aria-label={`${isSel ? 'Desmarcar' : 'Selecionar'} ${o.nome}${sentado ? `, sentado na ${sentadoEm[o.nome]}` : ', sem mesa'}`}
                  className={`inline-flex items-center gap-1.5 py-1 pl-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${isOutro ? 'pr-1' : 'pr-2'} cursor-grab active:cursor-grabbing`}
                >
                  <Avatar name={o.nome} size="xs" />
                  {o.nome}
                  {isOutro && o.setor && (
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 leading-none">{o.setor.toUpperCase()}</span>
                  )}
                  {sentado && !isOutro && <span className="text-[8px] text-emerald-400" aria-hidden="true">●</span>}
                </button>
                {isOutro && (
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Remover ${o.nome} do escritório?`)) removerPessoa.mutate(o.nome) }}
                    aria-label={`Remover ${o.nome} do cadastro`}
                    className="mr-1 opacity-0 transition-opacity text-ink-faint hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" aria-hidden="true" />
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
                aria-label="Nome da nova pessoa"
                placeholder="Nome" className="w-20 bg-transparent text-[11px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <input
                value={novoSetor} onChange={e => setNovoSetor(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && novoNome.trim()) addPessoa.mutate({ nome: novoNome, setor: novoSetor }) }}
                aria-label="Setor da nova pessoa"
                placeholder="Setor" className="w-16 bg-transparent text-[11px] text-ink placeholder:text-ink-faint focus:outline-none border-l border-border pl-1"
              />
              <button type="button" onClick={() => addPessoa.mutate({ nome: novoNome, setor: novoSetor })} disabled={!novoNome.trim()}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent disabled:opacity-40">ok</button>
              <button type="button" onClick={() => { setAddOpen(false); setNovoNome(''); setNovoSetor('') }} aria-label="Cancelar nova pessoa" className="text-ink-faint hover:text-ink"><X className="h-3 w-3" aria-hidden="true" /></button>
            </span>
          ) : (
            <button type="button" onClick={() => setAddOpen(true)}
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
          const gestor = nome && !isOutro ? vendedorGestorDe[nome] : undefined
          const fade = !!cfg?.fade && modo === 'normal'
          const alerta = !isOutro && modo === 'normal' && (gestor?.cortadoPorCota || (expediente && !!ls && ALERTA_STATUS.includes(ls.status)))
          const selecionadoMesa = !isOutro && nome === vendedorSelecionado
          const inativoMin = (!isOutro && nome && ls?.status && OFFLINE_STATUSES.has(ls.status) && ultimoSync?.[nome])
            ? minutosUteisInativo(ultimoSync[nome], Date.now()) : null
          const isOver = overMesa === m.id
          const p = posDe(m.id)
          const left = pct(p.x - DESK_W / 2, VB.w)
          const top = pct(p.y - DESK_H / 2, VB.h)
          const width = pct(DESK_W, VB.w)
          const height = pct(DESK_H, VB.h)
          const tipoOcupante = nome ? (isOutro ? 'outro' : 'vendedor') : null
          const superficieClicavel = mesaTemSuperficieClicavelGestor(modo, tipoOcupante, !!selected)
          const rotacaoMesa = { transform: `rotate(${rotDe(m.id)}deg)`, transition: girando === m.id ? 'none' : 'transform .12s' }
          const conteudoMesa = (
            <div className="w-full h-full" style={rotacaoMesa}>
              <Workstation tipo={isOutro ? 'outro' : 'vendedor'} empty={!nome} name={nome ?? m.id} ativo={ls?.status === 'ativo'} />
            </div>
          )
          return (
            <div
              key={m.id}
              onDragOver={editLayout ? undefined : e => { e.preventDefault(); setOverMesa(m.id) }}
              onDragLeave={editLayout ? undefined : () => setOverMesa(o => (o === m.id ? null : o))}
              onDrop={editLayout ? undefined : e => { e.preventDefault(); soltarNaMesa(m.id, e.dataTransfer.getData('text/plain') || dragging) }}
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
              } ${alerta ? 'ring-2 ring-red-500/70 animate-pulse' : ''} ${selecionadoMesa ? 'outline outline-2 outline-accent outline-offset-2' : ''}`}
              style={{ left, top, width, height, touchAction: editLayout ? 'none' : undefined, pointerEvents: modo === 'paredes' ? 'none' : undefined }}
            >
              {superficieClicavel ? (
                <button
                  type="button"
                  draggable={!!nome}
                  onDragStart={e => { if (nome) { e.dataTransfer.setData('text/plain', nome); setDragging(nome) } }}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => clicarMesa(m.id)}
                  aria-pressed={nome && !isOutro ? selecionadoMesa : undefined}
                  aria-label={nome && !isOutro
                    ? `${nome}; status ${gestor?.statusLabel ?? 'desligado'}; Atendimentos hoje: ${formatarMetricaGestor(gestor?.atendimentos ?? null)}; Leads recebidos hoje: ${formatarMetricaGestor(gestor?.leads ?? null)}; Orçamentos hoje: ${formatarMetricaGestor(gestor?.orcamentos ?? null)}`
                    : nome
                      ? `Mesa ${idx + 1}, ocupada por ${nome}${info?.setor ? `, setor ${info.setor}` : ''}`
                      : `Mesa ${idx + 1}, vazia`}
                  className={`w-full h-full border-0 bg-transparent p-0 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${nome ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${fade ? 'opacity-40 grayscale' : ''}`}
                >
                  {conteudoMesa}
                </button>
              ) : (
                <div
                  draggable={!!nome && modo === 'normal'}
                  onDragStart={e => { if (nome && modo === 'normal') { e.dataTransfer.setData('text/plain', nome); setDragging(nome) } }}
                  onDragEnd={() => setDragging(null)}
                  className={`w-full h-full transition-opacity ${nome && modo === 'normal' ? 'cursor-grab active:cursor-grabbing' : ''} ${editLayout ? 'pointer-events-none' : ''} ${fade ? 'opacity-40 grayscale' : ''}`}
                >
                  {conteudoMesa}
                </div>
              )}

              {/* Handle de girar (só no modo posicionar) */}
              {editLayout && (
                <button
                  type="button"
                  onPointerDown={e => iniciarGirar(e, m.id)}
                  aria-label={`Girar mesa ${idx + 1}`}
                  /* `text-black` fixo não serve aos dois temas: o accent claro é
                     escuro (preto dá 3,95:1) e o escuro é claro (branco dá 3,20:1).
                     Invertido por tema: 5,31:1 no claro, 6,56:1 no escuro. */
                  className="absolute left-1/2 -top-3 -translate-x-1/2 h-5 w-5 rounded-full bg-accent text-white dark:text-black flex items-center justify-center shadow ring-2 ring-black/30 cursor-grab active:cursor-grabbing z-30 touch-none"
                >
                  <RotateCw className="h-3 w-3" />
                </button>
              )}

              {nome ? (
                <>
                  {/* status (vendedor) ou setor (outro) no topo-direito */}
                  {isOutro ? (
                    <span className="pointer-events-none absolute -top-1.5 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/50 ring-1 ring-purple-300/40 text-purple-50 leading-none">
                      {abreviaSetor(info?.setor ?? null)}
                    </span>
                  ) : (
                    <span
                      className={`pointer-events-none absolute top-1 right-1 h-3 w-3 rounded-full ring-2 ring-black/50 ${cfg?.dot ?? 'bg-slate-500'} ${cfg?.glow ? 'shadow-[0_0_8px_2px_rgba(16,185,129,0.8)] animate-pulse' : ''}`}
                      title={cfg?.label ?? 'sem sinal'}
                    />
                  )}
                  {/* nome + números do dia (sempre visíveis) */}
                  <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -bottom-1.5 flex flex-col items-center gap-0.5 max-w-[170%]">
                    <span className="px-2 py-0.5 rounded-md bg-black/60 ring-1 ring-white/10 text-[11px] font-bold text-white truncate leading-tight max-w-full">
                      {nomeCurto(nome)}
                    </span>
                    {!isOutro && !editLayout && (
                      <span className="flex items-stretch rounded-md bg-black/75 ring-1 ring-white/10 overflow-hidden text-[8px] font-extrabold leading-none divide-x divide-white/10 shadow-md shadow-black/40 max-w-[180%] whitespace-nowrap">
                        <span className="px-1 py-1 text-violet-300">Atend. {formatarMetricaGestor(gestor?.atendimentos ?? null)}</span>
                        <span className="px-1 py-1 text-emerald-300">Leads {formatarMetricaGestor(gestor?.leads ?? null)}</span>
                        <span className="px-1 py-1 text-sky-300">Orç. {formatarMetricaGestor(gestor?.orcamentos ?? null)}</span>
                      </span>
                    )}
                    {!isOutro && !editLayout && inativoMin != null && (
                      <span className="px-2 py-0.5 rounded-md bg-red-500/90 ring-1 ring-red-200/50 text-[9px] font-extrabold text-white leading-none whitespace-nowrap shadow-md shadow-black/50" title="tempo inativo — conta só horário útil (07:15–17:30, seg–sex)">
                        ⏱ inativo {fmtDurInativo(inativoMin)}
                      </span>
                    )}
                  </div>
                  {!editLayout && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); limpar.mutate(m.id) }}
                      aria-label={`Tirar ${nome} da mesa ${idx + 1}`}
                      className="absolute top-0 left-0 z-30 opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-faint hover:text-red-400 bg-surface/70 rounded-full transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  {!isOutro && !editLayout && funil?.[nome] && (
                    <FunilCard f={funil[nome]} nome={nome} below={p.y < 165} open={cardAberto === nome} />
                  )}
                </>
              ) : (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] font-bold text-ink/30">{idx + 1}</span>
              )}
            </div>
          )
        })}

        {/* Botões de apagar parede (modo paredes, só nas customizadas) */}
        {modo === 'paredes' && temCustom && (paredes ?? []).map(p => (
          <button
            type="button"
            key={`del-${p.id}`}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); delParede.mutate(p.id) }}
            aria-label="Apagar esta parede"
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] leading-none shadow ring-1 ring-black/40 z-30 hover:bg-red-600"
            style={{ left: pct(p.x, VB.w), top: pct(p.y, VB.h) }}
          >×</button>
        ))}
      </div>
    </Card>
  )

  return (
    <div className="space-y-3">
      <EscritorioGestor
        vendedores={vendedoresGestor}
        resumo={resumoGestor}
        alertas={alertasGestor}
        rankingMes={rankingMes}
        rankingMesDisponivel={rankingMesFetched && !rankingMesError}
        selecionado={vendedorSelecionado}
        onSelecionar={setVendedorSelecionado}
        mapa={mapaEscritorio}
      />
    </div>
  )
}
