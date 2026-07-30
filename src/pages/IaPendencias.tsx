import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BellRing, Clock, HelpCircle, Truck, FileWarning, UserCheck, AlertTriangle,
  RefreshCw, Search, Send, X, Loader2, ExternalLink, Inbox,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { useVendedorNome } from '@/hooks/useVendedorNome'
import { cn } from '@/lib/utils'

// ============================================================================
// Painel de Pendências da IA — tudo que a IA parou pra pedir ajuda e ninguém viu.
//
// A IA pausa um atendimento em 5 situações. Cada uma vira uma linha aqui:
//   1. consulta interna aguardando o vendedor responder (ia_consultas_internas)
//   2. a mesma coisa, mas pedindo base de frete            (tipo = 'frete')
//   3. pedido de orçamento que deu erro                    (ia_orcamento_pedidos)
//   4. conversa que um humano assumiu na mão               (estado HUMAN_TAKEOVER)
//   5. conversa travada em erro                            (estado AI_ERROR)
//
// Ordem = MAIS ANTIGA PRIMEIRO. Quem espera há mais tempo é o mais urgente —
// não existe "prioridade" aqui além do relógio.
// ============================================================================

// Edge da IA atendente (mesmo shared secret estático usado pela extensão da frota)
const IA_EDGE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/ia-atendente'
const IA_EDGE_SECRET = 'branorte-wa-sync-2026'

// ─── Toast mínimo local (padrão do repo — não há provider global) ───────────
interface ToastMsg { id: number; texto: string; tone: 'success' | 'danger' | 'info' }

function useToast(): [ToastMsg[], (texto: string, tone?: ToastMsg['tone']) => void] {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const push = (texto: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }
  return [toasts, push]
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[1100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border backdrop-blur bg-surface/95',
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

// ─── Tipos das linhas cruas ─────────────────────────────────────────────────
interface ConsultaRow {
  codigo: string
  tipo: string
  chat_id: string
  vendedor_nome: string | null
  cliente_nome: string | null
  cliente_telefone: string | null
  duvida: string
  contexto: string | null
  destinatario_nome: string | null
  criado_em: string
  enviada_em: string | null
  alertado_em: string | null
}

interface VencidaRow {
  codigo: string
  minutos_esperando: number | null
  acao: string | null
}

interface OrcamentoRow {
  id: number
  chat_id: string
  vendedor_nome: string | null
  cliente_nome: string | null
  cliente_telefone: string | null
  modelo_slug: string | null
  voltagem: string | null
  erro: string | null
  criado_em: string
}

interface AtendimentoRow {
  id: number
  chat_id: string
  vendedor_nome: string | null
  nome_contato: string | null
  estado: string
  estado_desde: string
  estado_motivo: string | null
  assumido_por: string | null
  assumido_em: string | null
}

// ─── Modelo único da tela ───────────────────────────────────────────────────
type TipoPendencia = 'consulta' | 'frete' | 'orcamento_erro' | 'assumida' | 'ai_error'

interface Pendencia {
  key: string
  tipo: TipoPendencia
  cliente: string
  telefone: string | null      // só quando temos um número de verdade
  chatId: string
  responsavel: string
  desde: string                // ISO — base do "esperando há"
  titulo: string               // a informação principal (dúvida / erro / modelo)
  contexto: string | null      // linha secundária, quando existir
  atrasada: boolean
  acao: string | null          // 'alertar' | 'reforcar' | 'aguardar' (só consultas)
  minutos: number | null       // vem da view; senão calculamos do `desde`
  codigo?: string              // consultas — chave das ações
  orcamentoId?: number         // orçamentos — chave do reprocessar
}

const META: Record<TipoPendencia, { label: string; icon: typeof HelpCircle; cor: string }> = {
  consulta:       { label: 'Dúvida pro vendedor', icon: HelpCircle,  cor: 'bg-accent/10 border-accent/30 text-accent' },
  frete:          { label: 'Base de frete',       icon: Truck,       cor: 'bg-info/10 border-info/30 text-info' },
  orcamento_erro: { label: 'Orçamento com erro',  icon: FileWarning, cor: 'bg-danger/10 border-danger/30 text-danger' },
  assumida:       { label: 'Assumida na mão',     icon: UserCheck,   cor: 'bg-warning/10 border-warning/30 text-warning' },
  ai_error:       { label: 'IA em erro',          icon: AlertTriangle, cor: 'bg-danger/10 border-danger/30 text-danger' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function minutosDesde(iso: string): number {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return 0
  return Math.max(0, Math.round((Date.now() - d) / 60000))
}

// 47 → "47 min" · 195 → "3h 15" · 2900 → "2d 0h"
function formatEspera(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

// "554899998888@c.us" → "554899998888". Contato @lid NÃO é telefone: devolve null.
function foneDoChatId(chatId: string | null | undefined): string | null {
  if (!chatId) return null
  const [num, dominio] = chatId.split('@')
  if (dominio !== 'c.us') return null
  const digitos = (num || '').replace(/\D/g, '')
  return digitos.length >= 10 ? digitos : null
}

function normalizarFone(tel: string | null | undefined): string | null {
  const digitos = (tel ?? '').replace(/\D/g, '')
  return digitos.length >= 10 ? digitos : null
}

// "mini-fabrica-de-racao-compacta-jr-monofasico" → "Mini fabrica de racao compacta jr monofasico"
function humanizarSlug(slug: string | null | undefined): string {
  if (!slug) return '—'
  const s = slug.replace(/[-_]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Queries ────────────────────────────────────────────────────────────────
const REFRESH_MS = 60 * 1000

function useConsultas() {
  return useQuery({
    queryKey: ['ia-pend-consultas'],
    queryFn: async (): Promise<ConsultaRow[]> => {
      const { data, error } = await supabase
        .from('ia_consultas_internas')
        .select('codigo, tipo, chat_id, vendedor_nome, cliente_nome, cliente_telefone, duvida, contexto, destinatario_nome, criado_em, enviada_em, alertado_em')
        .eq('status', 'aguardando')
        .order('criado_em', { ascending: true })
      if (error) throw error
      return (data ?? []) as ConsultaRow[]
    },
    staleTime: 30 * 1000,
    refetchInterval: REFRESH_MS,
  })
}

// Quem já passou do prazo. A view só traz consultas 'aguardando' JÁ ENVIADAS,
// então serve como um mapa por código — não como lista principal.
function useVencidas() {
  return useQuery({
    queryKey: ['ia-pend-vencidas'],
    queryFn: async (): Promise<VencidaRow[]> => {
      const { data, error } = await supabase
        .from('v_ia_consultas_vencidas')
        .select('codigo, minutos_esperando, acao')
      if (error) throw error
      return (data ?? []) as VencidaRow[]
    },
    staleTime: 30 * 1000,
    refetchInterval: REFRESH_MS,
  })
}

function useOrcamentosComErro() {
  return useQuery({
    queryKey: ['ia-pend-orcamentos'],
    queryFn: async (): Promise<OrcamentoRow[]> => {
      const { data, error } = await supabase
        .from('ia_orcamento_pedidos')
        .select('id, chat_id, vendedor_nome, cliente_nome, cliente_telefone, modelo_slug, voltagem, erro, criado_em')
        .eq('status', 'erro')
        .order('criado_em', { ascending: true })
      if (error) throw error
      return (data ?? []) as OrcamentoRow[]
    },
    staleTime: 30 * 1000,
    refetchInterval: REFRESH_MS,
  })
}

function useAtendimentosParados() {
  return useQuery({
    queryKey: ['ia-pend-atendimentos'],
    queryFn: async (): Promise<AtendimentoRow[]> => {
      const { data, error } = await supabase
        .from('ia_atendimentos')
        .select('id, chat_id, vendedor_nome, nome_contato, estado, estado_desde, estado_motivo, assumido_por, assumido_em')
        .in('estado', ['HUMAN_TAKEOVER', 'AI_ERROR'])
        .order('estado_desde', { ascending: true })
      if (error) throw error
      return (data ?? []) as AtendimentoRow[]
    },
    staleTime: 30 * 1000,
    refetchInterval: REFRESH_MS,
  })
}

// ─── Ações por linha ────────────────────────────────────────────────────────
function AcoesConsulta({ p, push }: { p: Pendencia; push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()
  const { nome: vendedorNome } = useVendedorNome()
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')

  function invalidarTudo() {
    qc.invalidateQueries({ queryKey: ['ia-pend-consultas'] })
    qc.invalidateQueries({ queryKey: ['ia-pend-vencidas'] })
    qc.invalidateQueries({ queryKey: ['ia-pend-atendimentos'] })
  }

  // A resposta NÃO vai crua pro cliente: a edge entrega como orientação e a
  // persona reescreve. "Deixa comigo" e variações desligam a IA (assumida).
  const responder = useMutation({
    mutationFn: async () => {
      const resposta = texto.trim()
      if (!resposta) throw new Error('Escreva a resposta antes de enviar')
      const r = await fetch(IA_EDGE_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + IA_EDGE_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'consulta_responder',
          codigo: p.codigo,
          resposta,
          vendedor_nome: vendedorNome || p.responsavel,
        }),
      })
      const j = await r.json().catch(() => null)
      if (!j?.ok) throw new Error(j?.error ?? `falha HTTP ${r.status}`)
      return j as { ok: true; assumiu?: boolean; skip?: string; status?: string }
    },
    onSuccess: (j) => {
      setAberto(false)
      setTexto('')
      invalidarTudo()
      if (j.skip === 'ja_fechada') push(`Consulta já estava ${j.status ?? 'fechada'} — nada a fazer`, 'info')
      else if (j.assumiu) push('IA desligada — a conversa é sua agora', 'success')
      else push('Orientação enviada — a IA voltou a atender', 'success')
    },
    onError: (err: Error) => push('Erro ao responder: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const cancelar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ia_consultas_internas')
        .update({ status: 'cancelada', atualizado_em: new Date().toISOString() })
        .eq('codigo', p.codigo!)
      if (error) throw error
    },
    onSuccess: () => {
      invalidarTudo()
      push('Consulta cancelada', 'success')
    },
    onError: (err: Error) => push('Erro ao cancelar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-1.5 justify-end">
        <button
          onClick={() => setAberto(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors',
            aberto
              ? 'bg-surface-2 border-border text-ink-muted'
              : 'bg-accent text-white border-accent hover:opacity-90',
          )}
        >
          {aberto ? <X className="h-3 w-3" /> : <Send className="h-3 w-3" />}
          {aberto ? 'Fechar' : 'Responder'}
        </button>
        <button
          onClick={() => cancelar.mutate()}
          disabled={cancelar.isPending}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-danger/40 text-danger text-[11px] font-semibold hover:bg-danger/10 transition-colors disabled:opacity-50"
          title="Marca a consulta como cancelada — a IA para de esperar por ela"
        >
          {cancelar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          Cancelar
        </button>
      </div>

      {aberto && (
        <div className="mt-2">
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            autoFocus
            placeholder="Responda como se estivesse falando com a IA. Ex: 'O prazo é 45 dias a partir do pagamento'. Escreva 'deixa comigo' pra assumir a conversa e desligar a IA."
            className={cn(
              'w-full min-h-[84px] rounded-md border border-border bg-surface px-3 py-2 text-[13px]',
              'text-ink placeholder:text-ink-faint resize-y',
              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
            )}
          />
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <span className="text-[10px] text-ink-faint">
              A IA reescreve com as palavras dela — o cliente não vê esse texto cru.
            </span>
            <button
              onClick={() => responder.mutate()}
              disabled={responder.isPending || !texto.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
            >
              {responder.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Enviar resposta
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AcoesOrcamento({ p, push }: { p: Pendencia; push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()

  // Volta pra fila: o worker (ia-orcamento-worker) pega os 'pendente' e tenta de novo.
  const reprocessar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ia_orcamento_pedidos')
        .update({ status: 'pendente', erro: null, atualizado_em: new Date().toISOString() })
        .eq('id', p.orcamentoId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-pend-orcamentos'] })
      push('Orçamento devolvido pra fila — o worker tenta de novo', 'success')
    },
    onError: (err: Error) => push('Erro ao reprocessar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      <button
        onClick={() => reprocessar.mutate()}
        disabled={reprocessar.isPending}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-50"
        title="Marca como pendente de novo pro worker tentar gerar outra vez"
      >
        {reprocessar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Reprocessar
      </button>
    </div>
  )
}

// ─── Linha ──────────────────────────────────────────────────────────────────
function LinhaPendencia({ p, push }: { p: Pendencia; push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const meta = META[p.tipo]
  const Icon = meta.icon
  const minutos = p.minutos ?? minutosDesde(p.desde)

  return (
    <div className={cn(
      'px-3 py-2.5 border-t border-border/40 first:border-t-0',
      p.atrasada ? 'bg-danger/5' : 'hover:bg-surface-2/30',
    )}>
      <div className="flex flex-col lg:flex-row lg:items-start gap-2 lg:gap-3">
        {/* Cliente + tipo */}
        <div className="lg:w-56 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide', meta.cor)}>
              <Icon className="h-3 w-3" /> {meta.label}
            </span>
          </div>
          <div className="font-semibold text-[13px] text-ink truncate" title={p.cliente}>{p.cliente}</div>
          <div className="text-[10px] text-ink-faint font-mono truncate" title={p.chatId}>
            {p.telefone ?? p.chatId}
          </div>
        </div>

        {/* Detalhe */}
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] text-ink whitespace-pre-wrap break-words">{p.titulo}</p>
          {p.contexto && (
            <p className="text-[11px] text-ink-muted mt-0.5 whitespace-pre-wrap break-words line-clamp-3">{p.contexto}</p>
          )}
        </div>

        {/* Espera + responsável */}
        <div className="lg:w-40 shrink-0 lg:text-right">
          <div className={cn(
            'inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums',
            p.atrasada ? 'text-danger' : 'text-ink',
          )}>
            {p.atrasada && <AlertTriangle className="h-3 w-3" />}
            <Clock className="h-3 w-3 opacity-60" />
            {formatEspera(minutos)}
          </div>
          <div className="text-[10px] text-ink-faint tabular-nums">desde {formatDataHora(p.desde)}</div>
          <div className="text-[11px] text-ink-muted truncate mt-0.5" title={p.responsavel}>{p.responsavel}</div>
          {p.acao === 'reforcar' && (
            <div className="text-[10px] font-semibold text-danger uppercase tracking-wide">Reforço vencido</div>
          )}
          {p.acao === 'alertar' && (
            <div className="text-[10px] font-semibold text-warning uppercase tracking-wide">Alerta vencido</div>
          )}
        </div>

        {/* Ações */}
        <div className="lg:w-64 shrink-0">
          {(p.tipo === 'consulta' || p.tipo === 'frete') && <AcoesConsulta p={p} push={push} />}
          {p.tipo === 'orcamento_erro' && <AcoesOrcamento p={p} push={push} />}
          <div className="flex justify-end mt-1.5">
            {p.telefone ? (
              <a
                href={`https://wa.me/${p.telefone}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-accent transition-colors"
              >
                <ExternalLink className="h-3 w-3" /> Abrir conversa
              </a>
            ) : (
              <span className="text-[10px] text-ink-faint" title="Contato @lid do WhatsApp — não expõe telefone, não dá pra montar o link">
                sem telefone pra abrir
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────
const FILTROS: Array<{ id: 'todas' | TipoPendencia; label: string }> = [
  { id: 'todas', label: 'Todas' },
  { id: 'consulta', label: 'Dúvidas' },
  { id: 'frete', label: 'Fretes' },
  { id: 'orcamento_erro', label: 'Orçamentos' },
  { id: 'assumida', label: 'Assumidas' },
  { id: 'ai_error', label: 'IA em erro' },
]

export function IaPendencias() {
  const [toasts, push] = useToast()
  const [filtro, setFiltro] = useState<'todas' | TipoPendencia>('todas')
  const [soAtrasadas, setSoAtrasadas] = useState(false)
  const [busca, setBusca] = useState('')

  const consultas = useConsultas()
  const vencidas = useVencidas()
  const orcamentos = useOrcamentosComErro()
  const atendimentos = useAtendimentosParados()

  const carregando = consultas.isLoading || vencidas.isLoading || orcamentos.isLoading || atendimentos.isLoading
  const erro = consultas.error || vencidas.error || orcamentos.error || atendimentos.error

  // Junta as 4 origens numa lista só, mais antigas primeiro.
  const todas = useMemo<Pendencia[]>(() => {
    const mapaVencidas = new Map<string, VencidaRow>()
    for (const v of vencidas.data ?? []) mapaVencidas.set(v.codigo, v)

    const out: Pendencia[] = []

    for (const c of consultas.data ?? []) {
      const v = mapaVencidas.get(c.codigo)
      const base = c.enviada_em ?? c.criado_em
      out.push({
        key: 'c:' + c.codigo,
        tipo: c.tipo === 'frete' ? 'frete' : 'consulta',
        cliente: c.cliente_nome?.trim() || normalizarFone(c.cliente_telefone) || foneDoChatId(c.chat_id) || c.chat_id,
        telefone: normalizarFone(c.cliente_telefone) ?? foneDoChatId(c.chat_id),
        chatId: c.chat_id,
        responsavel: c.destinatario_nome?.trim() || c.vendedor_nome?.trim() || '—',
        desde: base,
        titulo: c.duvida,
        contexto: c.contexto,
        atrasada: !!v && v.acao !== 'aguardar',
        acao: v?.acao ?? null,
        minutos: v?.minutos_esperando ?? null,
        codigo: c.codigo,
      })
    }

    for (const o of orcamentos.data ?? []) {
      out.push({
        key: 'o:' + o.id,
        tipo: 'orcamento_erro',
        cliente: o.cliente_nome?.trim() || normalizarFone(o.cliente_telefone) || o.chat_id,
        telefone: normalizarFone(o.cliente_telefone) ?? foneDoChatId(o.chat_id),
        chatId: o.chat_id,
        responsavel: o.vendedor_nome?.trim() || '—',
        desde: o.criado_em,
        titulo: o.erro?.trim() || 'Erro sem mensagem registrada',
        contexto: `${humanizarSlug(o.modelo_slug)}${o.voltagem ? ' · ' + o.voltagem : ''}`,
        atrasada: true, // orçamento com erro não tem prazo: já nasce vencido
        acao: null,
        minutos: null,
        orcamentoId: o.id,
      })
    }

    for (const a of atendimentos.data ?? []) {
      const assumida = a.estado === 'HUMAN_TAKEOVER'
      out.push({
        key: 'a:' + a.id,
        tipo: assumida ? 'assumida' : 'ai_error',
        cliente: a.nome_contato?.trim() || foneDoChatId(a.chat_id) || a.chat_id,
        telefone: foneDoChatId(a.chat_id),
        chatId: a.chat_id,
        responsavel: (assumida ? a.assumido_por?.trim() : null) || a.vendedor_nome?.trim() || '—',
        desde: (assumida ? a.assumido_em : null) ?? a.estado_desde,
        titulo: a.estado_motivo?.trim() || (assumida ? 'Vendedor assumiu a conversa' : 'A IA parou com erro nesta conversa'),
        contexto: null,
        atrasada: !assumida, // AI_ERROR é problema; assumida é só acompanhamento
        acao: null,
        minutos: null,
      })
    }

    return out.sort((x, y) => new Date(x.desde).getTime() - new Date(y.desde).getTime())
  }, [consultas.data, vencidas.data, orcamentos.data, atendimentos.data])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return todas.filter(p => {
      if (filtro !== 'todas' && p.tipo !== filtro) return false
      if (soAtrasadas && !p.atrasada) return false
      if (!termo) return true
      return [p.cliente, p.responsavel, p.titulo, p.chatId, p.telefone ?? '']
        .join(' ').toLowerCase().includes(termo)
    })
  }, [todas, filtro, soAtrasadas, busca])

  const stats = useMemo(() => ({
    total: todas.length,
    atrasadas: todas.filter(p => p.atrasada).length,
    consultas: todas.filter(p => p.tipo === 'consulta').length,
    fretes: todas.filter(p => p.tipo === 'frete').length,
    orcamentos: todas.filter(p => p.tipo === 'orcamento_erro').length,
    conversas: todas.filter(p => p.tipo === 'assumida' || p.tipo === 'ai_error').length,
  }), [todas])

  async function atualizar() {
    await Promise.all([consultas.refetch(), vencidas.refetch(), orcamentos.refetch(), atendimentos.refetch()])
    push('Pendências atualizadas', 'success')
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <BellRing className="w-5 h-5 text-accent" />
            <h1 className="text-[18px] font-semibold text-ink">Pendências da IA</h1>
          </div>
          <p className="text-[12px] text-ink-muted">
            Tudo que a IA parou pra pedir ajuda e ainda não teve resposta. Ordenado da mais antiga pra mais nova —
            quem está esperando há mais tempo aparece primeiro.
          </p>
        </div>

        {carregando ? (
          <PageLoading />
        ) : erro ? (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-[13px] text-danger">
            Não consegui carregar as pendências: {(erro as Error)?.message ?? 'falha de rede'}
          </div>
        ) : (
          <>
            {/* Números do topo */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
              {[
                { label: 'Pendências', valor: stats.total, cor: 'text-ink' },
                { label: 'Atrasadas', valor: stats.atrasadas, cor: stats.atrasadas ? 'text-danger' : 'text-ink-muted' },
                { label: 'Dúvidas', valor: stats.consultas, cor: 'text-ink' },
                { label: 'Fretes', valor: stats.fretes, cor: 'text-ink' },
                { label: 'Orç. com erro', valor: stats.orcamentos, cor: stats.orcamentos ? 'text-danger' : 'text-ink-muted' },
                { label: 'Conversas paradas', valor: stats.conversas, cor: 'text-ink' },
              ].map(s => (
                <div key={s.label} className="bg-surface border border-border rounded-lg px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint truncate">{s.label}</div>
                  <div className={cn('text-[18px] font-semibold tabular-nums', s.cor)}>{s.valor}</div>
                </div>
              ))}
            </div>

            {/* Filtros + busca */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="flex flex-wrap gap-1.5">
                {FILTROS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFiltro(f.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
                      filtro === f.id
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surface text-ink-muted border-border hover:bg-surface-2',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
                <button
                  onClick={() => setSoAtrasadas(v => !v)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
                    soAtrasadas
                      ? 'bg-danger text-white border-danger'
                      : 'bg-surface text-ink-muted border-border hover:bg-surface-2',
                  )}
                >
                  <AlertTriangle className="h-3 w-3" /> Só atrasadas
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-56">
                  <Input
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar cliente / responsável"
                    leftIcon={<Search className="h-3.5 w-3.5" />}
                  />
                </div>
                <button
                  onClick={atualizar}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-[12px] font-medium text-ink hover:bg-surface-2 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Atualizar
                </button>
              </div>
            </div>

            {/* Lista */}
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-accent/15 border-b border-accent/30 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
                  <Inbox className="h-3.5 w-3.5" /> Fila de pendências
                </h3>
                <span className="text-[10px] text-ink-muted">
                  {visiveis.length} de {stats.total} · atualiza sozinho a cada minuto
                </span>
              </div>

              {visiveis.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-[13px] font-medium text-ink">
                    {stats.total === 0 ? 'Nenhuma pendência agora.' : 'Nada bate com esse filtro.'}
                  </p>
                  <p className="text-[12px] text-ink-faint mt-1">
                    {stats.total === 0
                      ? 'A IA está atendendo sozinha — quando ela travar ou pedir ajuda, aparece aqui.'
                      : 'Tente limpar a busca ou voltar pro filtro "Todas".'}
                  </p>
                </div>
              ) : (
                visiveis.map(p => <LinhaPendencia key={p.key} p={p} push={push} />)
              )}
            </div>
          </>
        )}
      </div>
      <ToastStack toasts={toasts} />
    </div>
  )
}
