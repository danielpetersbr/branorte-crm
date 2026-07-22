import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from 'reactflow'
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  NodeProps,
  NodeTypes,
  OnSelectionChangeParams,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  Workflow, Plus, Trash2, Save, Loader2, ArrowLeft, AlertTriangle,
  Play, Diamond, Clock, Zap, Flag, Pencil,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// ============================================================================
// Fluxos do Funil (admin) — editor visual drag-and-drop (React Flow) que grava
// o CONTRATO jsonb em funil_fluxos.definicao pra engine executar/alertar.
// Contrato: { nodes: [{id, tipo, label, config, pos}], edges: [{from, to, quando?}] }
// ============================================================================

// ─── Toast mínimo local (padrão do repo — não há provider global) ───────────
interface ToastMsg { id: number; texto: string; tone: 'success' | 'danger' | 'info' }

function useToast(): [ToastMsg[], (texto: string, tone?: ToastMsg['tone']) => void] {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const push = (texto: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }
  return [toasts, push]
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[1100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border backdrop-blur bg-surface/95 max-w-[90vw]',
          t.tone === 'success' && 'border-success/30 text-success',
          t.tone === 'danger' && 'border-danger/30 text-danger',
          t.tone === 'info' && 'border-border text-ink',
        )}>
          {t.texto}
        </div>
      ))}
    </div>
  )
}

// ─── Toggle simples com design tokens do CRM ────────────────────────────────
function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      disabled={disabled}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors shrink-0 disabled:opacity-40',
        on ? 'bg-accent' : 'bg-border',
      )}
      title={on ? 'Ativo — clique pra desativar' : 'Inativo — clique pra ativar'}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
        on && 'translate-x-4',
      )} />
    </button>
  )
}

// ─── Tipos do CONTRATO (engine lê esse formato — não mudar) ─────────────────
type TipoNo = 'inicio' | 'decisao' | 'espera' | 'acao' | 'fim'
type ModoFluxo = 'desativado' | 'alertar' | 'automatico'
type TipoAcao = 'mover_etiqueta' | 'enviar_msg' | 'avisar_vendedor'

interface NoConfig {
  etiqueta?: string
  cond?: string
  janela_h?: number
  horas?: number
  acao?: TipoAcao
  se_ainda_em?: string
  mensagem?: string
}

interface DefNode {
  id: string
  tipo: TipoNo
  label: string
  config: NoConfig
  pos: { x: number; y: number }
}

interface DefEdge { from: string; to: string; quando?: 'sim' | 'nao' }

interface Definicao { nodes: DefNode[]; edges: DefEdge[] }

interface FluxoRow {
  id: number
  nome: string
  ativo: boolean
  modo: ModoFluxo
  escopo_vendedor: string | null
  definicao: Definicao
  criado_em: string
  atualizado_em: string
}

interface FlowNodeData { label: string; config: NoConfig }
type NoFlow = Node<FlowNodeData>

// ─── Metadados visuais por tipo de nó ───────────────────────────────────────
const NO_META: Record<TipoNo, {
  titulo: string
  header: string     // cor da faixa do topo do card
  borda: string      // cor da borda do card
  chip: string       // cor do botão na paleta
  Icone: typeof Play
  hint: string
}> = {
  inicio: {
    titulo: 'Início', header: 'bg-violet-500', borda: 'border-violet-500', chip: 'bg-violet-500',
    Icone: Play, hint: 'Captura os chats que estão na etiqueta escolhida (1 por fluxo)',
  },
  decisao: {
    titulo: 'Decisão', header: 'bg-amber-500', borda: 'border-amber-500', chip: 'bg-amber-500',
    Icone: Diamond, hint: 'O cliente respondeu na janela? Tem 2 saídas: SIM e NÃO',
  },
  espera: {
    titulo: 'Espera', header: 'bg-sky-500', borda: 'border-sky-500', chip: 'bg-sky-500',
    Icone: Clock, hint: 'Espera X horas antes de seguir',
  },
  acao: {
    titulo: 'Ação', header: 'bg-emerald-500', borda: 'border-emerald-500', chip: 'bg-emerald-500',
    Icone: Zap, hint: 'Move etiqueta, envia mensagem ou avisa o vendedor',
  },
  fim: {
    titulo: 'Fim', header: 'bg-purple-900', borda: 'border-purple-900', chip: 'bg-purple-900',
    Icone: Flag, hint: 'Encerra o fluxo pra esse chat',
  },
}

const ORDEM_PALETA: TipoNo[] = ['inicio', 'decisao', 'espera', 'acao', 'fim']

const LABEL_DEFAULT: Record<TipoNo, string> = {
  inicio: 'Início',
  decisao: 'Respondeu?',
  espera: 'Espera',
  acao: 'Ação',
  fim: 'Fim',
}

const CONFIG_DEFAULT: Record<TipoNo, NoConfig> = {
  inicio: { etiqueta: '' },
  decisao: { cond: 'respondeu', janela_h: 24 },
  espera: { horas: 48 },
  acao: { acao: 'enviar_msg', mensagem: '' },
  fim: {},
}

function truncar(s: string | undefined, max = 40): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function resumoNo(tipo: TipoNo, c: NoConfig): string {
  switch (tipo) {
    case 'inicio':
      return c.etiqueta ? `🏷️ ${c.etiqueta}` : '⚠️ escolha a etiqueta'
    case 'decisao':
      return `❓ respondeu em ${c.janela_h ?? '?'}h?`
    case 'espera':
      return `⏱️ ${c.horas ?? '?'}h`
    case 'acao':
      if (c.acao === 'mover_etiqueta') {
        return `🏷️ → ${c.etiqueta || '?'}${c.se_ainda_em ? ` (se ainda em ${c.se_ainda_em})` : ''}`
      }
      if (c.acao === 'enviar_msg') return c.mensagem ? `✉️ ${truncar(c.mensagem)}` : '✉️ ⚠️ escreva a mensagem'
      if (c.acao === 'avisar_vendedor') return c.mensagem ? `🔔 ${truncar(c.mensagem)}` : '🔔 ⚠️ escreva o aviso'
      return '⚠️ configure a ação'
    case 'fim':
      return '🏁 encerra o fluxo'
  }
}

// ─── Card visual dos nós no canvas ──────────────────────────────────────────
function CardNo({ tipo, data, selected }: { tipo: TipoNo; data: FlowNodeData; selected: boolean }) {
  const meta = NO_META[tipo]
  const Icone = meta.Icone
  return (
    <div className={cn(
      'rounded-lg border-2 bg-surface shadow-sm min-w-[160px] max-w-[230px]',
      meta.borda,
      selected && 'ring-2 ring-accent/60',
    )}>
      <div className={cn(
        'px-2.5 py-1 rounded-t-[5px] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 text-white',
        meta.header,
      )}>
        <Icone className="h-3 w-3" /> {meta.titulo}
      </div>
      <div className="px-2.5 py-2">
        <div className="text-[12px] font-semibold text-ink leading-tight break-words">
          {data.label || meta.titulo}
        </div>
        <div className="text-[11px] text-ink-muted mt-0.5 break-words">{resumoNo(tipo, data.config)}</div>
      </div>
      {tipo === 'decisao' && (
        <div className="flex justify-between px-3 pb-1 text-[9px] font-bold">
          <span className="text-emerald-500">SIM</span>
          <span className="text-red-500">NÃO</span>
        </div>
      )}
      {tipo !== 'inicio' && (
        <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2.5 !h-2.5 !border-2 !border-white" />
      )}
      {tipo === 'decisao' ? (
        <>
          <Handle
            id="sim" type="source" position={Position.Bottom} style={{ left: '22%' }}
            className="!bg-emerald-500 !w-2.5 !h-2.5 !border-2 !border-white"
          />
          <Handle
            id="nao" type="source" position={Position.Bottom} style={{ left: '78%' }}
            className="!bg-red-500 !w-2.5 !h-2.5 !border-2 !border-white"
          />
        </>
      ) : tipo !== 'fim' ? (
        <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2.5 !h-2.5 !border-2 !border-white" />
      ) : null}
    </div>
  )
}

// nodeTypes precisa ser referência ESTÁVEL (fora do componente) pro React Flow
const nodeTypes: NodeTypes = {
  inicio: (p: NodeProps<FlowNodeData>) => <CardNo tipo="inicio" data={p.data} selected={p.selected} />,
  decisao: (p: NodeProps<FlowNodeData>) => <CardNo tipo="decisao" data={p.data} selected={p.selected} />,
  espera: (p: NodeProps<FlowNodeData>) => <CardNo tipo="espera" data={p.data} selected={p.selected} />,
  acao: (p: NodeProps<FlowNodeData>) => <CardNo tipo="acao" data={p.data} selected={p.selected} />,
  fim: (p: NodeProps<FlowNodeData>) => <CardNo tipo="fim" data={p.data} selected={p.selected} />,
}

// ─── Conversão contrato ↔ React Flow ────────────────────────────────────────
function corAresta(quando?: 'sim' | 'nao'): string {
  if (quando === 'sim') return '#10b981'
  if (quando === 'nao') return '#ef4444'
  return '#94a3b8'
}

function makeEdge(from: string, to: string, quando?: 'sim' | 'nao'): Edge {
  const cor = corAresta(quando)
  return {
    id: `e-${from}-${quando ?? 'out'}-${to}`,
    source: from,
    target: to,
    sourceHandle: quando,
    type: 'smoothstep',
    label: quando === 'sim' ? 'SIM' : quando === 'nao' ? 'NÃO' : undefined,
    style: { stroke: cor, strokeWidth: 2 },
    labelStyle: { fill: '#fff', fontWeight: 700, fontSize: 10 },
    labelBgStyle: { fill: cor },
    labelBgPadding: [5, 2],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color: cor },
  }
}

function paraReactFlow(def: Definicao | null | undefined): { nodes: NoFlow[]; edges: Edge[] } {
  const dnodes = Array.isArray(def?.nodes) ? def!.nodes : []
  const dedges = Array.isArray(def?.edges) ? def!.edges : []
  const nodes: NoFlow[] = dnodes.map(n => ({
    id: n.id,
    type: n.tipo,
    position: { x: n.pos?.x ?? 0, y: n.pos?.y ?? 0 },
    data: { label: n.label ?? '', config: n.config ?? {} },
  }))
  const edges: Edge[] = dedges.map(e => makeEdge(e.from, e.to, e.quando))
  return { nodes, edges }
}

function paraContrato(nodes: NoFlow[], edges: Edge[]): Definicao {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      tipo: (n.type ?? 'acao') as TipoNo,
      label: n.data.label,
      config: n.data.config,
      pos: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map(e => {
      const quando = e.sourceHandle === 'sim' || e.sourceHandle === 'nao' ? e.sourceHandle : undefined
      return quando ? { from: e.source, to: e.target, quando } : { from: e.source, to: e.target }
    }),
  }
}

// Validação leve — retorna avisos (salva mesmo assim como rascunho)
function validarDefinicao(def: Definicao): string[] {
  const avisos: string[] = []
  const inicios = def.nodes.filter(n => n.tipo === 'inicio')
  if (inicios.length === 0) avisos.push('Falta o nó Início (a engine não sabe onde o fluxo começa)')
  if (inicios.length > 1) avisos.push('Só pode ter 1 nó Início por fluxo')
  if (inicios.length === 1 && !inicios[0].config.etiqueta) avisos.push('O nó Início está sem etiqueta')
  for (const d of def.nodes.filter(n => n.tipo === 'decisao')) {
    const temSim = def.edges.some(e => e.from === d.id && e.quando === 'sim')
    const temNao = def.edges.some(e => e.from === d.id && e.quando === 'nao')
    if (!temSim || !temNao) avisos.push(`A decisão "${d.label || 'sem nome'}" precisa das 2 saídas (SIM e NÃO)`)
  }
  return avisos
}

function proximoId(nodes: NoFlow[]): string {
  let max = 0
  for (const n of nodes) {
    const m = /^n(\d+)$/.exec(n.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `n${max + 1}`
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ─── Queries ────────────────────────────────────────────────────────────────
function useFluxos() {
  return useQuery({
    queryKey: ['funil-fluxos'],
    queryFn: async (): Promise<FluxoRow[]> => {
      const { data, error } = await supabase
        .from('funil_fluxos')
        .select('id, nome, ativo, modo, escopo_vendedor, definicao, criado_em, atualizado_em')
        .order('id', { ascending: true })
      if (error) throw error
      return (data ?? []) as FluxoRow[]
    },
    staleTime: 30 * 1000,
  })
}

// Etiquetas + vendedores REAIS do WhatsApp (distinct client-side, uppercase)
function useEtiquetasEVendedores() {
  return useQuery({
    queryKey: ['fluxos-etiquetas-vendedores'],
    queryFn: async (): Promise<{ etiquetas: string[]; vendedores: string[] }> => {
      const { data, error } = await supabase
        .from('wascript_etiquetas')
        .select('etiqueta_nome, vendedor_nome')
      if (error) throw error
      const etiquetas = new Set<string>()
      const vendedores = new Set<string>()
      for (const row of (data ?? []) as Array<{ etiqueta_nome: string | null; vendedor_nome: string | null }>) {
        if (row.etiqueta_nome?.trim()) etiquetas.add(row.etiqueta_nome.trim().toUpperCase())
        if (row.vendedor_nome?.trim()) vendedores.add(row.vendedor_nome.trim())
      }
      return {
        etiquetas: [...etiquetas].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        vendedores: [...vendedores].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Select de etiqueta (lista real + valor atual preservado) ───────────────
function SelectEtiqueta({ value, onChange, etiquetas, vazioLabel }: {
  value: string
  onChange: (v: string) => void
  etiquetas: string[]
  vazioLabel?: string
}) {
  const opcoes = useMemo(() => {
    const base = [...etiquetas]
    if (value && !base.includes(value)) base.unshift(value)
    return base
  }, [etiquetas, value])
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-surface border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
    >
      <option value="">{vazioLabel ?? '— selecione a etiqueta —'}</option>
      {opcoes.map(et => <option key={et} value={et}>{et}</option>)}
    </select>
  )
}

// ─── Badge do modo ──────────────────────────────────────────────────────────
function BadgeModo({ modo }: { modo: ModoFluxo }) {
  if (modo === 'automatico') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success/10 border border-success/30 text-success text-[10px] font-semibold uppercase tracking-wide">
        Automático · executa
      </span>
    )
  }
  if (modo === 'alertar') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-warning/10 border border-warning/30 text-warning text-[10px] font-semibold uppercase tracking-wide">
        Só avisa
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-2 border border-border text-ink-muted text-[10px] font-semibold uppercase tracking-wide">
      Desativado
    </span>
  )
}

// ============================================================================
// Lista de fluxos
// ============================================================================
function ListaFluxos({ push, onAbrir }: {
  push: (t: string, tone?: ToastMsg['tone']) => void
  onAbrir: (fluxo: FluxoRow) => void
}) {
  const qc = useQueryClient()
  const fluxos = useFluxos()

  const criar = useMutation({
    mutationFn: async (): Promise<FluxoRow> => {
      const definicaoInicial: Definicao = {
        nodes: [{ id: 'n1', tipo: 'inicio', label: 'Início', config: { etiqueta: '' }, pos: { x: 0, y: 0 } }],
        edges: [],
      }
      const { data, error } = await supabase
        .from('funil_fluxos')
        .insert({ nome: 'Novo fluxo', modo: 'desativado', ativo: false, definicao: definicaoInicial })
        .select('id, nome, ativo, modo, escopo_vendedor, definicao, criado_em, atualizado_em')
        .single()
      if (error) throw error
      return data as FluxoRow
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['funil-fluxos'] })
      push('Fluxo criado — monte o desenho e salve', 'success')
      onAbrir(row)
    },
    onError: (err: Error) => push('Erro ao criar fluxo: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: number; ativo: boolean }) => {
      const { error } = await supabase
        .from('funil_fluxos')
        .update({ ativo, atualizado_em: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funil-fluxos'] }),
    onError: (err: Error) => push('Erro: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const excluir = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('funil_fluxos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funil-fluxos'] })
      push('Fluxo excluído', 'success')
    },
    onError: (err: Error) => push('Erro ao excluir: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  if (fluxos.isLoading) return <PageLoading />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-ink-muted">
          Desenhe fluxos de acompanhamento do funil: a engine captura os chats da etiqueta do nó Início e segue o desenho.
        </p>
        <button
          onClick={() => criar.mutate()}
          disabled={criar.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-60 shrink-0"
        >
          {criar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Novo fluxo
        </button>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {(fluxos.data?.length ?? 0) === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-ink-faint">
            Nenhum fluxo ainda. Clique em "+ Novo fluxo" pra desenhar o primeiro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2/50 text-ink-muted">
                <tr>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Fluxo</th>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Modo</th>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Escopo</th>
                  <th className="text-center px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Ativo</th>
                  <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Atualizado</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {fluxos.data!.map(f => {
                  const nNos = Array.isArray(f.definicao?.nodes) ? f.definicao.nodes.length : 0
                  return (
                    <tr key={f.id} className="border-t border-border/40 hover:bg-surface-2/30">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => onAbrir(f)}
                          className="font-semibold text-ink hover:text-accent transition-colors text-left"
                          title="Abrir no editor visual"
                        >
                          {f.nome}
                        </button>
                        <div className="text-[10px] text-ink-faint">{nNos} {nNos === 1 ? 'nó' : 'nós'}</div>
                      </td>
                      <td className="px-3 py-2"><BadgeModo modo={f.modo} /></td>
                      <td className="px-3 py-2 text-ink-muted">{f.escopo_vendedor ?? 'Todos os vendedores'}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex">
                          <Toggle
                            on={f.ativo}
                            onChange={v => toggleAtivo.mutate({ id: f.id, ativo: v })}
                            disabled={toggleAtivo.isPending}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-faint tabular-nums">{formatDataHora(f.atualizado_em)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => onAbrir(f)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-ink hover:bg-surface-2 transition-colors mr-1.5"
                        >
                          <Pencil className="h-3 w-3" /> Editar
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Excluir o fluxo "${f.nome}"? Essa ação não tem volta.`)) excluir.mutate(f.id)
                          }}
                          disabled={excluir.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-danger/40 text-danger text-[11px] font-medium hover:bg-danger/10 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Excluir
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Painel de propriedades (nó selecionado)
// ============================================================================
function PainelPropriedades({ no, etiquetas, onLabel, onConfig, onRemover }: {
  no: NoFlow
  etiquetas: string[]
  onLabel: (label: string) => void
  onConfig: (patch: NoConfig) => void
  onRemover: () => void
}) {
  const tipo = (no.type ?? 'acao') as TipoNo
  const meta = NO_META[tipo]
  const Icone = meta.Icone
  const c = no.data.config

  return (
    <div className="w-full lg:w-72 shrink-0 bg-surface border border-border rounded-lg p-3 space-y-3 self-start">
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex items-center justify-center h-6 w-6 rounded text-white', meta.header)}>
          <Icone className="h-3.5 w-3.5" />
        </span>
        <div>
          <div className="text-[12px] font-bold text-ink uppercase tracking-wide">{meta.titulo}</div>
          <div className="text-[10px] text-ink-faint leading-tight">{meta.hint}</div>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Nome do passo</label>
        <Input value={no.data.label} onChange={e => onLabel(e.target.value)} placeholder={LABEL_DEFAULT[tipo]} />
      </div>

      {tipo === 'inicio' && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Etiqueta de entrada</label>
          <SelectEtiqueta value={c.etiqueta ?? ''} onChange={v => onConfig({ etiqueta: v })} etiquetas={etiquetas} />
          <p className="text-[10px] text-ink-faint mt-1">O fluxo captura chats que ESTÃO nessa etiqueta.</p>
        </div>
      )}

      {tipo === 'decisao' && (
        <>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Condição</label>
            <select
              value={c.cond ?? 'respondeu'}
              onChange={e => onConfig({ cond: e.target.value })}
              className="w-full bg-surface border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="respondeu">O cliente respondeu?</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Janela (horas)</label>
            <Input
              type="number" min="1" step="1"
              value={c.janela_h ?? 24}
              onChange={e => onConfig({ janela_h: Math.max(1, Number(e.target.value) || 1) })}
            />
            <p className="text-[10px] text-ink-faint mt-1">
              Saída <span className="text-emerald-500 font-bold">SIM</span> = respondeu ·{' '}
              <span className="text-red-500 font-bold">NÃO</span> = não respondeu.
            </p>
          </div>
        </>
      )}

      {tipo === 'espera' && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Esperar (horas)</label>
          <Input
            type="number" min="1" step="1"
            value={c.horas ?? 48}
            onChange={e => onConfig({ horas: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
      )}

      {tipo === 'acao' && (
        <>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">O que fazer</label>
            <select
              value={c.acao ?? 'enviar_msg'}
              // troca de ação limpa as chaves da ação anterior (contrato enxuto pra engine)
              onChange={e => onConfig({ acao: e.target.value as TipoAcao, etiqueta: undefined, se_ainda_em: undefined, mensagem: undefined })}
              className="w-full bg-surface border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="mover_etiqueta">Mover pra outra etiqueta</option>
              <option value="enviar_msg">Enviar mensagem ao cliente</option>
              <option value="avisar_vendedor">Avisar o vendedor</option>
            </select>
          </div>

          {c.acao === 'mover_etiqueta' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Mover pra etiqueta</label>
                <SelectEtiqueta value={c.etiqueta ?? ''} onChange={v => onConfig({ etiqueta: v })} etiquetas={etiquetas} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Só se ainda estiver em (opcional)</label>
                <SelectEtiqueta
                  value={c.se_ainda_em ?? ''}
                  onChange={v => onConfig({ se_ainda_em: v || undefined })}
                  etiquetas={etiquetas}
                  vazioLabel="— qualquer etiqueta —"
                />
                <p className="text-[10px] text-ink-faint mt-1">Trava de segurança: só move se o chat não mudou de etiqueta no meio do caminho.</p>
              </div>
            </>
          )}

          {(c.acao === 'enviar_msg' || c.acao === 'avisar_vendedor') && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                {c.acao === 'enviar_msg' ? 'Mensagem pro cliente' : 'Aviso pro vendedor'}
              </label>
              <textarea
                value={c.mensagem ?? ''}
                onChange={e => onConfig({ mensagem: e.target.value })}
                placeholder={c.acao === 'enviar_msg'
                  ? 'Oi {{primeiro_nome}}, tudo bem? Passando pra saber se ficou alguma dúvida…'
                  : 'Ex: O cliente {{primeiro_nome}} está parado há 2 dias sem resposta.'}
                className={cn(
                  'w-full min-h-[100px] rounded-md border border-border bg-surface px-3 py-2 text-[13px]',
                  'text-ink placeholder:text-ink-faint resize-y',
                  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
                )}
              />
              <p className="text-[10px] text-ink-faint mt-1">
                Pode usar <code className="font-mono bg-surface-2 px-1 rounded">{'{{primeiro_nome}}'}</code> — vira o nome do cliente.
              </p>
            </div>
          )}
        </>
      )}

      {tipo === 'fim' && (
        <p className="text-[11px] text-ink-muted">Quando o chat chega aqui, o fluxo termina pra ele. Nada a configurar.</p>
      )}

      <button
        onClick={onRemover}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-danger/40 text-danger text-[12px] font-medium hover:bg-danger/10 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" /> Remover este passo
      </button>
    </div>
  )
}

// ============================================================================
// Editor (canvas React Flow)
// ============================================================================
function EditorFluxo({ fluxo, vendedores, etiquetas, onVoltar, push }: {
  fluxo: FluxoRow
  vendedores: string[]
  etiquetas: string[]
  onVoltar: () => void
  push: (t: string, tone?: ToastMsg['tone']) => void
}) {
  const qc = useQueryClient()
  const rf = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const inicial = useMemo(() => paraReactFlow(fluxo.definicao), [fluxo.definicao])
  const [nodes, setNodes] = useState<NoFlow[]>(inicial.nodes)
  const [edges, setEdges] = useState<Edge[]>(inicial.edges)
  const [nome, setNome] = useState(fluxo.nome)
  const [modo, setModo] = useState<ModoFluxo>(fluxo.modo)
  const [escopo, setEscopo] = useState<string>(fluxo.escopo_vendedor ?? '')
  const [selId, setSelId] = useState<string | null>(null)

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(eds => applyEdgeChanges(changes, eds))
  }, [])

  // Conexão: cada handle de saída só pode ter 1 aresta (a nova substitui a antiga)
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return
    const quando = c.sourceHandle === 'sim' || c.sourceHandle === 'nao' ? c.sourceHandle : undefined
    setEdges(eds => {
      const semAntiga = eds.filter(e => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))
      return addEdge(makeEdge(c.source!, c.target!, quando), semAntiga)
    })
  }, [])

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelId(params.nodes[0]?.id ?? null)
  }, [])

  function adicionarNo(tipo: TipoNo, posicao?: { x: number; y: number }) {
    if (tipo === 'inicio' && nodes.some(n => n.type === 'inicio')) {
      push('Só pode ter 1 nó Início por fluxo', 'danger')
      return
    }
    let pos = posicao
    if (!pos) {
      const b = wrapperRef.current?.getBoundingClientRect()
      pos = b
        ? rf.screenToFlowPosition({ x: b.left + b.width / 2, y: b.top + b.height / 3 })
        : { x: 0, y: 0 }
      const desloc = (nodes.length % 5) * 24
      pos = { x: pos.x + desloc, y: pos.y + desloc }
    }
    setNodes(nds => [...nds, {
      id: proximoId(nds),
      type: tipo,
      position: pos!,
      data: { label: LABEL_DEFAULT[tipo], config: { ...CONFIG_DEFAULT[tipo] } },
    }])
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const tipo = e.dataTransfer.getData('application/branorte-fluxo') as TipoNo
    if (!tipo || !NO_META[tipo]) return
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    adicionarNo(tipo, pos)
  }

  function atualizarLabel(id: string, label: string) {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n))
  }

  function atualizarConfig(id: string, patch: NoConfig) {
    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n
      const config = { ...n.data.config, ...patch }
      // limpa chaves undefined pro contrato ficar enxuto
      for (const k of Object.keys(config) as Array<keyof NoConfig>) {
        if (config[k] === undefined) delete config[k]
      }
      return { ...n, data: { ...n.data, config } }
    }))
  }

  function removerNo(id: string) {
    setNodes(nds => nds.filter(n => n.id !== id))
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
    setSelId(null)
  }

  const salvar = useMutation({
    mutationFn: async (): Promise<string[]> => {
      const def = paraContrato(nodes, edges)
      const avisos = validarDefinicao(def)
      const { error } = await supabase
        .from('funil_fluxos')
        .update({
          nome: nome.trim() || 'Fluxo sem nome',
          modo,
          escopo_vendedor: escopo || null,
          definicao: def,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', fluxo.id)
      if (error) throw error
      return avisos
    },
    onSuccess: (avisos) => {
      qc.invalidateQueries({ queryKey: ['funil-fluxos'] })
      if (avisos.length) {
        push('Salvo como rascunho — ' + avisos.join(' · '), 'info')
      } else {
        push('Fluxo salvo', 'success')
      }
    },
    onError: (err: Error) => push('Erro ao salvar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const noSelecionado = selId ? nodes.find(n => n.id === selId) ?? null : null

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-surface border border-border rounded-lg p-2.5 flex flex-wrap items-center gap-2">
        <button
          onClick={onVoltar}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-[12px] font-medium text-ink hover:bg-surface-2 transition-colors shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar
        </button>
        <div className="flex-1 min-w-[180px]">
          <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do fluxo" className="font-semibold" />
        </div>
        <select
          value={modo}
          onChange={e => setModo(e.target.value as ModoFluxo)}
          className="bg-surface border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent shrink-0"
          title="Modo de execução do fluxo"
        >
          <option value="desativado">Desativado</option>
          <option value="alertar">Somente alertar</option>
          <option value="automatico">Automático</option>
        </select>
        <select
          value={escopo}
          onChange={e => setEscopo(e.target.value)}
          className="bg-surface border border-border rounded-md px-2.5 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent shrink-0 max-w-[180px]"
          title="Pra quais vendedores esse fluxo vale"
        >
          <option value="">Todos os vendedores</option>
          {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-60 shrink-0"
        >
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </button>
      </div>

      {/* Aviso fixo sobre os modos */}
      <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-[12px] text-ink flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <span>
          Modo <strong>"Somente alertar"</strong> = a engine só REGISTRA o que faria (seguro pra testar).{' '}
          <strong>"Automático"</strong> = move etiqueta e envia mensagem de verdade.
        </span>
      </div>

      {/* Paleta + Canvas + Propriedades */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Paleta */}
        <div className="w-full lg:w-44 shrink-0 bg-surface border border-border rounded-lg p-2.5 self-start">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-2">Passos</div>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-1.5">
            {ORDEM_PALETA.map(tipo => {
              const meta = NO_META[tipo]
              const Icone = meta.Icone
              return (
                <button
                  key={tipo}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('application/branorte-fluxo', tipo)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => adicionarNo(tipo)}
                  title={meta.hint + ' — arraste pro canvas ou clique pra adicionar'}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-white text-[11px] font-semibold',
                    'cursor-grab active:cursor-grabbing hover:opacity-90 transition-opacity',
                    meta.chip,
                  )}
                >
                  <Icone className="h-3.5 w-3.5" /> {meta.titulo}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-ink-faint mt-2 leading-snug">
            Arraste pro canvas (ou clique). Ligue os passos puxando das bolinhas de baixo pra bolinha de cima do próximo.
          </p>
        </div>

        {/* Canvas */}
        <div
          ref={wrapperRef}
          className="flex-1 min-w-0 h-[62vh] min-h-[420px] rounded-lg border border-border bg-surface overflow-hidden rf-branorte"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#94a3b8" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Painel de propriedades */}
        {noSelecionado ? (
          <PainelPropriedades
            no={noSelecionado}
            etiquetas={etiquetas}
            onLabel={label => atualizarLabel(noSelecionado.id, label)}
            onConfig={patch => atualizarConfig(noSelecionado.id, patch)}
            onRemover={() => removerNo(noSelecionado.id)}
          />
        ) : (
          <div className="hidden lg:block w-72 shrink-0 bg-surface border border-border border-dashed rounded-lg p-4 self-start text-[11px] text-ink-faint">
            Clique num passo do desenho pra editar as propriedades dele aqui.
          </div>
        )}
      </div>

      {/* Ajustes de tema pros controles do React Flow (dark mode) */}
      <style>{`
        .rf-branorte .react-flow__controls { box-shadow: none; }
        .rf-branorte .react-flow__controls button {
          background: hsl(var(--surface));
          border-bottom: 1px solid hsl(var(--border));
        }
        .rf-branorte .react-flow__controls button:hover { background: hsl(var(--surface-2)); }
        .rf-branorte .react-flow__controls button svg { fill: hsl(var(--ink)); }
        .rf-branorte .react-flow__edge-textbg { rx: 4; }
      `}</style>
    </div>
  )
}

// ============================================================================
// Página
// ============================================================================
export function FluxosFunil() {
  const [toasts, push] = useToast()
  const [editando, setEditando] = useState<FluxoRow | null>(null)
  const listas = useEtiquetasEVendedores()

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Workflow className="w-5 h-5 text-accent" />
            <h1 className="text-[18px] font-semibold text-ink">Fluxos do Funil</h1>
            {editando && (
              <span className="text-[12px] text-ink-muted">· editando: <strong className="text-ink">{editando.nome}</strong></span>
            )}
          </div>
          <p className="text-[12px] text-ink-muted">
            Desenhe o acompanhamento automático do funil: quem não responde recebe follow-up, muda de etiqueta ou vira aviso pro vendedor.
          </p>
        </div>

        {editando ? (
          <ReactFlowProvider>
            <EditorFluxo
              key={editando.id}
              fluxo={editando}
              vendedores={listas.data?.vendedores ?? []}
              etiquetas={listas.data?.etiquetas ?? []}
              onVoltar={() => setEditando(null)}
              push={push}
            />
          </ReactFlowProvider>
        ) : (
          <ListaFluxos push={push} onAbrir={f => setEditando(f)} />
        )}
      </div>
      <ToastStack toasts={toasts} />
    </div>
  )
}
