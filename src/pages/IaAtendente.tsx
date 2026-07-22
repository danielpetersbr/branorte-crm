import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot, Brain, Settings2, Film, Loader2, Save, Plus, Trash2, Upload,
  RefreshCw, AlertCircle, Image as ImageIcon, FileText, Zap, MessageSquare,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// ============================================================================
// IA Atendente (admin) — status, cérebro (base de conhecimento), configuração
// e mídias que a IA pode mandar. Tudo lê/escreve direto nas tabelas ia_*:
// alterações valem NA HORA pra edge function (sem atualizar extensão).
// ============================================================================

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

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface IaAtendimentoRow {
  id: number
  chat_id: string
  vendedor_nome: string | null
  nome_contato: string | null
  ativo: boolean
  respostas_hoje: number
  dia_ref: string | null
  atualizado_em: string
}

interface AutomationRunRow {
  id: number
  created_at: string
  vendedor_nome: string | null
  chat_id: string | null
  acao: string | null
  payload: Record<string, unknown> | null
}

interface ConhecimentoRow {
  id: number
  secao: string
  titulo: string | null
  conteudo: string | null
  escopo: 'empresa' | 'vendedor'
  vendedor_nome: string | null
  ordem: number
  ativo: boolean
}

interface MidiaRow {
  id: number
  titulo: string | null
  descricao_ia: string | null
  tipo: 'image' | 'video' | 'document'
  url: string
  filename: string | null
  ativo: boolean
  criado_em: string
}

interface ConfigForm {
  modelo_openai: string
  modelo_fallback: string
  tom: string
  max_respostas_dia: number
  permitir_midia: boolean
}

const MODELOS_SUGERIDOS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4o-mini', 'gpt-4.1-mini']
const LIMITE_UPLOAD_BYTES = 16 * 1024 * 1024 // 16MB

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// "554899998888@c.us" → "554899998888"
function foneDoChatId(chatId: string | null | undefined): string {
  if (!chatId) return '—'
  return chatId.split('@')[0]
}

function hojeISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dia}`
}

// slug pro campo secao: "Preços e Condições" → "precos-e-condicoes"
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'secao'
}

// nome de arquivo seguro pro storage
function sanitizarNomeArquivo(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'arquivo'
}

// ─── Queries ────────────────────────────────────────────────────────────────
function useIaAtendimentos() {
  return useQuery({
    queryKey: ['ia-atendimentos'],
    queryFn: async (): Promise<IaAtendimentoRow[]> => {
      const { data, error } = await supabase
        .from('ia_atendimentos')
        .select('id, chat_id, vendedor_nome, nome_contato, ativo, respostas_hoje, dia_ref, atualizado_em')
        .eq('ativo', true)
        .order('atualizado_em', { ascending: false })
      if (error) throw error
      return (data ?? []) as IaAtendimentoRow[]
    },
    staleTime: 30 * 1000,
  })
}

function useIaRuns() {
  return useQuery({
    queryKey: ['ia-runs'],
    queryFn: async (): Promise<AutomationRunRow[]> => {
      const { data, error } = await supabase
        .from('automation_runs')
        .select('id, created_at, vendedor_nome, chat_id, acao, payload')
        .eq('regra_key', 'ia_atendente')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as AutomationRunRow[]
    },
    staleTime: 30 * 1000,
  })
}

function useIaConhecimento() {
  return useQuery({
    queryKey: ['ia-conhecimento'],
    queryFn: async (): Promise<ConhecimentoRow[]> => {
      const { data, error } = await supabase
        .from('ia_conhecimento')
        .select('id, secao, titulo, conteudo, escopo, vendedor_nome, ordem, ativo')
        .order('ordem', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data ?? []) as ConhecimentoRow[]
    },
    staleTime: 30 * 1000,
  })
}

function useIaConfig() {
  return useQuery({
    queryKey: ['ia-config'],
    queryFn: async (): Promise<Record<string, unknown>> => {
      const { data, error } = await supabase
        .from('ia_config')
        .select('chave, valor')
      if (error) throw error
      const map: Record<string, unknown> = {}
      for (const row of (data ?? []) as Array<{ chave: string; valor: { v?: unknown } | null }>) {
        map[row.chave] = row.valor?.v
      }
      return map
    },
    staleTime: 30 * 1000,
  })
}

function useIaMidias() {
  return useQuery({
    queryKey: ['ia-midias'],
    queryFn: async (): Promise<MidiaRow[]> => {
      const { data, error } = await supabase
        .from('ia_midias')
        .select('id, titulo, descricao_ia, tipo, url, filename, ativo, criado_em')
        .order('criado_em', { ascending: false })
      if (error) throw error
      return (data ?? []) as MidiaRow[]
    },
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Seção 1 — Visão geral
// ============================================================================
function SecaoVisaoGeral({ push }: { push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const atendimentos = useIaAtendimentos()
  const runs = useIaRuns()
  const hoje = hojeISO()

  async function atualizar() {
    await Promise.all([atendimentos.refetch(), runs.refetch()])
    push('Dados atualizados', 'success')
  }

  if (atendimentos.isLoading || runs.isLoading) return <PageLoading />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-ink-muted">
          Clientes com a IA ligada agora e as últimas respostas que ela mandou.
        </p>
        <button
          onClick={atualizar}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-[12px] font-medium text-ink hover:bg-surface-2 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </button>
      </div>

      {/* Clientes com IA ligada */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-accent/15 border-b border-accent/30 flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Clientes com IA ligada
          </h3>
          <span className="text-[10px] text-ink-muted">{atendimentos.data?.length ?? 0} ativos</span>
        </div>
        {(atendimentos.data?.length ?? 0) === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-faint">
            Nenhum cliente com IA ligada agora. O vendedor liga pelo botão 🤖 na conversa do WhatsApp.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2/50 text-ink-muted">
              <tr>
                <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Cliente</th>
                <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Vendedor</th>
                <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Respostas hoje</th>
                <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Última atividade</th>
              </tr>
            </thead>
            <tbody>
              {atendimentos.data!.map(a => (
                <tr key={a.id} className="border-t border-border/40 hover:bg-surface-2/30">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{a.nome_contato || foneDoChatId(a.chat_id)}</div>
                    <div className="text-[10px] text-ink-faint font-mono">{foneDoChatId(a.chat_id)}</div>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{a.vendedor_nome ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">
                    {a.dia_ref === hoje ? a.respostas_hoje : 0}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-faint tabular-nums">{formatDataHora(a.atualizado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Últimas respostas da IA */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-info/15 border-b border-info/30 flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-info flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Últimas ações da IA
          </h3>
          <span className="text-[10px] text-ink-muted">últimas 30</span>
        </div>
        {(runs.data?.length ?? 0) === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-faint">
            Nenhuma ação registrada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2/50 text-ink-muted">
                <tr>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Quando</th>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Vendedor</th>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Cliente</th>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Ação</th>
                  <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Texto</th>
                </tr>
              </thead>
              <tbody>
                {runs.data!.map(r => {
                  const texto = r.acao === 'ia_resposta' && typeof r.payload?.texto === 'string'
                    ? (r.payload.texto as string)
                    : null
                  return (
                    <tr key={r.id} className="border-t border-border/40 hover:bg-surface-2/30 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-ink-faint tabular-nums">{formatDataHora(r.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{r.vendedor_nome ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-ink-muted">{foneDoChatId(r.chat_id)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={cn(
                          'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border',
                          r.acao === 'ia_resposta'
                            ? 'bg-success/10 border-success/30 text-success'
                            : 'bg-surface-2 border-border text-ink-muted',
                        )}>
                          {r.acao ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink max-w-[420px]">
                        {texto ? <span className="whitespace-pre-wrap break-words">{texto}</span> : <span className="text-ink-faint">—</span>}
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
// Seção 2 — Cérebro (base de conhecimento)
// ============================================================================
function ConhecimentoEditor({ row, push }: { row: ConhecimentoRow; push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()
  const [titulo, setTitulo] = useState(row.titulo ?? '')
  const [conteudo, setConteudo] = useState(row.conteudo ?? '')
  const [ativo, setAtivo] = useState(row.ativo)

  const dirty = titulo !== (row.titulo ?? '') || conteudo !== (row.conteudo ?? '') || ativo !== row.ativo

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ia_conhecimento')
        .update({ titulo, conteudo, ativo })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-conhecimento'] })
      push('Seção salva — a IA já usa o novo conteúdo', 'success')
    },
    onError: (err: Error) => push('Erro ao salvar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  return (
    <div className={cn(
      'bg-surface border rounded-lg p-3',
      ativo ? 'border-border' : 'border-border/60 opacity-70',
    )}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {row.escopo === 'vendedor' ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/10 border border-warning/30 text-warning text-[10px] font-semibold uppercase tracking-wide">
            Vendedor · {row.vendedor_nome ?? '?'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent text-[10px] font-semibold uppercase tracking-wide">
            Empresa
          </span>
        )}
        <span className="text-[10px] text-ink-faint font-mono">{row.secao}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-ink-faint">{ativo ? 'Ativo' : 'Inativo'}</span>
          <Toggle on={ativo} onChange={setAtivo} />
        </div>
      </div>
      <Input
        value={titulo}
        onChange={e => setTitulo(e.target.value)}
        placeholder="Título da seção"
        className="mb-2 font-semibold"
      />
      <textarea
        value={conteudo}
        onChange={e => setConteudo(e.target.value)}
        placeholder="Conteúdo que a IA vai usar nas respostas..."
        className={cn(
          'w-full min-h-[120px] rounded-md border border-border bg-surface px-3 py-2 text-[13px]',
          'text-ink placeholder:text-ink-faint resize-y',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
        )}
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending || !dirty}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
            dirty
              ? 'bg-accent text-white hover:opacity-90'
              : 'bg-surface-2 text-ink-faint cursor-default',
            'disabled:opacity-60',
          )}
        >
          {salvar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {dirty ? 'Salvar' : 'Salvo'}
        </button>
      </div>
    </div>
  )
}

function SecaoCerebro({ push }: { push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()
  const { data: rows, isLoading } = useIaConhecimento()
  const [novoTitulo, setNovoTitulo] = useState('')

  const criar = useMutation({
    mutationFn: async () => {
      const titulo = novoTitulo.trim()
      if (!titulo) throw new Error('Dê um título pra nova seção')
      const maxOrdem = Math.max(0, ...(rows ?? []).map(r => r.ordem || 0))
      const { error } = await supabase.from('ia_conhecimento').insert({
        secao: slugify(titulo),
        titulo,
        conteudo: '',
        escopo: 'empresa',
        ordem: maxOrdem + 10,
        ativo: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setNovoTitulo('')
      qc.invalidateQueries({ queryKey: ['ia-conhecimento'] })
      push('Seção criada — preencha o conteúdo e salve', 'success')
    },
    onError: (err: Error) => push(err?.message ?? 'Erro ao criar seção', 'danger'),
  })

  if (isLoading) return <PageLoading />

  return (
    <div className="space-y-3">
      {/* Aviso fixo */}
      <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-[12px] text-ink flex items-start gap-2">
        <Zap className="h-4 w-4 text-success shrink-0 mt-0.5" />
        <span>
          <strong>Alterações valem NA HORA</strong> pra IA atendente e pro coach — sem precisar atualizar extensão.
        </span>
      </div>

      {/* Nova seção */}
      <div className="bg-surface border border-border rounded-lg p-3 flex flex-col sm:flex-row gap-2">
        <Input
          value={novoTitulo}
          onChange={e => setNovoTitulo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') criar.mutate() }}
          placeholder="Título da nova seção (ex: Prazo de entrega)"
          className="flex-1"
        />
        <button
          onClick={() => criar.mutate()}
          disabled={criar.isPending}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-60"
        >
          {criar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Nova seção
        </button>
      </div>

      {(rows?.length ?? 0) === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-6 text-center text-[12px] text-ink-faint">
          Nenhuma seção ainda. Crie a primeira acima.
        </div>
      ) : (
        rows!.map(r => <ConhecimentoEditor key={r.id} row={r} push={push} />)
      )}
    </div>
  )
}

// ============================================================================
// Seção 3 — Configuração
// ============================================================================
function SecaoConfig({ push }: { push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()
  const { data: cfg, isLoading } = useIaConfig()
  const [form, setForm] = useState<ConfigForm | null>(null)

  useEffect(() => {
    if (cfg && !form) {
      setForm({
        modelo_openai: typeof cfg.modelo_openai === 'string' ? cfg.modelo_openai : 'gpt-5.4-mini',
        modelo_fallback: typeof cfg.modelo_fallback === 'string' ? cfg.modelo_fallback : 'gpt-4o-mini',
        tom: typeof cfg.tom === 'string' ? cfg.tom : '',
        max_respostas_dia: typeof cfg.max_respostas_dia === 'number' ? cfg.max_respostas_dia : 15,
        permitir_midia: typeof cfg.permitir_midia === 'boolean' ? cfg.permitir_midia : true,
      })
    }
  }, [cfg, form])

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form) return
      const rows = [
        { chave: 'modelo_openai', valor: { v: form.modelo_openai.trim() } },
        { chave: 'modelo_fallback', valor: { v: form.modelo_fallback.trim() } },
        { chave: 'tom', valor: { v: form.tom } },
        { chave: 'max_respostas_dia', valor: { v: form.max_respostas_dia } },
        { chave: 'permitir_midia', valor: { v: form.permitir_midia } },
      ]
      const { error } = await supabase.from('ia_config').upsert(rows)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-config'] })
      push('Configuração salva — vale na hora', 'success')
    },
    onError: (err: Error) => push('Erro ao salvar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  if (isLoading || !form) return <PageLoading />

  return (
    <div className="space-y-3 max-w-2xl">
      <datalist id="ia-modelos">
        {MODELOS_SUGERIDOS.map(m => <option key={m} value={m} />)}
      </datalist>

      <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              Modelo principal
            </label>
            <Input
              list="ia-modelos"
              value={form.modelo_openai}
              onChange={e => setForm({ ...form, modelo_openai: e.target.value })}
              placeholder="gpt-5.4-mini"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              Modelo reserva (fallback)
            </label>
            <Input
              list="ia-modelos"
              value={form.modelo_fallback}
              onChange={e => setForm({ ...form, modelo_fallback: e.target.value })}
              placeholder="gpt-4o-mini"
            />
            <p className="text-[10px] text-ink-faint mt-1">Usado se o principal falhar.</p>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
            Tom de voz global
          </label>
          <textarea
            value={form.tom}
            onChange={e => setForm({ ...form, tom: e.target.value })}
            placeholder="Entra no prompt de TODOS os vendedores. Ex: 'Caloroso, direto, do interior; sempre chama o cliente pelo nome'"
            className={cn(
              'w-full min-h-[100px] rounded-md border border-border bg-surface px-3 py-2 text-[13px]',
              'text-ink placeholder:text-ink-faint resize-y',
              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              Limite de respostas por dia (por cliente)
            </label>
            <Input
              type="number"
              min="1"
              step="1"
              value={form.max_respostas_dia}
              onChange={e => setForm({ ...form, max_respostas_dia: Math.max(0, Number(e.target.value) || 0) })}
              className="w-32"
            />
            <p className="text-[10px] text-ink-faint mt-1">Chegou no limite, a IA para e devolve pro vendedor.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              Permitir mandar mídia
            </label>
            <div className="flex items-center gap-2 mt-2">
              <Toggle
                on={form.permitir_midia}
                onChange={v => setForm({ ...form, permitir_midia: v })}
              />
              <span className="text-[12px] text-ink-muted">
                {form.permitir_midia ? 'Pode mandar fotos e vídeos cadastrados' : 'Só responde com texto'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-60"
        >
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configurações
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Seção 4 — Mídias
// ============================================================================
function MidiaCard({ midia, push }: { midia: MidiaRow; push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()
  const [titulo, setTitulo] = useState(midia.titulo ?? '')
  const [descricao, setDescricao] = useState(midia.descricao_ia ?? '')
  const dirty = titulo !== (midia.titulo ?? '') || descricao !== (midia.descricao_ia ?? '')

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ia_midias')
        .update({ titulo, descricao_ia: descricao })
        .eq('id', midia.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-midias'] })
      push('Mídia salva', 'success')
    },
    onError: (err: Error) => push('Erro ao salvar: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const toggleAtivo = useMutation({
    mutationFn: async (ativo: boolean) => {
      const { error } = await supabase.from('ia_midias').update({ ativo }).eq('id', midia.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ia-midias'] }),
    onError: (err: Error) => push('Erro: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('ia_midias').delete().eq('id', midia.id)
      if (error) throw error
      // best-effort: remove o arquivo do bucket também (se falhar, só fica órfão)
      if (midia.filename) {
        await supabase.storage.from('ia-midias').remove([midia.filename]).catch(() => {})
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-midias'] })
      push('Mídia excluída', 'success')
    },
    onError: (err: Error) => push('Erro ao excluir: ' + (err?.message ?? 'falha de rede'), 'danger'),
  })

  return (
    <div className={cn(
      'bg-surface border rounded-lg p-3 flex flex-col sm:flex-row gap-3',
      midia.ativo ? 'border-border' : 'border-border/60 opacity-70',
    )}>
      {/* Preview */}
      <div className="w-full sm:w-40 shrink-0">
        {midia.tipo === 'image' && (
          <img
            src={midia.url}
            alt={midia.titulo ?? 'imagem'}
            className="w-full h-28 object-cover rounded-md border border-border bg-surface-2"
            loading="lazy"
          />
        )}
        {midia.tipo === 'video' && (
          <video
            src={midia.url}
            controls
            preload="metadata"
            className="w-full h-28 object-cover rounded-md border border-border bg-black"
          />
        )}
        {midia.tipo === 'document' && (
          <a
            href={midia.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-center justify-center gap-1 w-full h-28 rounded-md border border-border bg-surface-2 text-ink-muted hover:text-accent transition-colors"
          >
            <FileText className="h-8 w-8" />
            <span className="text-[10px] font-medium">Abrir documento</span>
          </a>
        )}
        <div className="flex items-center gap-1 mt-1 text-[10px] text-ink-faint">
          {midia.tipo === 'image' && <ImageIcon className="h-3 w-3" />}
          {midia.tipo === 'video' && <Film className="h-3 w-3" />}
          {midia.tipo === 'document' && <FileText className="h-3 w-3" />}
          <span className="truncate">{midia.filename ?? midia.tipo}</span>
        </div>
      </div>

      {/* Conteúdo editável */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <Input
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Título da mídia"
            className="font-semibold"
          />
          <Toggle
            on={midia.ativo}
            onChange={v => toggleAtivo.mutate(v)}
            disabled={toggleAtivo.isPending}
          />
        </div>
        <textarea
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          placeholder="Quando a IA deve mandar essa mídia? Ex: 'Cliente perguntou como funciona a Compacta 02'"
          className={cn(
            'w-full min-h-[70px] rounded-md border border-border bg-surface px-3 py-2 text-[13px]',
            'text-ink placeholder:text-ink-faint resize-y',
            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
          )}
        />
        <div className="flex items-center justify-between mt-2">
          <button
            onClick={() => { if (window.confirm('Excluir esta mídia? A IA não vai mais poder mandar ela.')) excluir.mutate() }}
            disabled={excluir.isPending}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-danger hover:bg-danger/10 transition-colors disabled:opacity-60"
          >
            {excluir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Excluir
          </button>
          <button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || !dirty}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              dirty ? 'bg-accent text-white hover:opacity-90' : 'bg-surface-2 text-ink-faint cursor-default',
              'disabled:opacity-60',
            )}
          >
            {salvar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {dirty ? 'Salvar' : 'Salvo'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SecaoMidias({ push }: { push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const qc = useQueryClient()
  const { data: midias, isLoading } = useIaMidias()
  const [enviando, setEnviando] = useState(false)

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo
    if (!file) return
    if (file.size > LIMITE_UPLOAD_BYTES) {
      push('Arquivo muito grande — o limite é 16MB (o WhatsApp não aceita mais que isso)', 'danger')
      return
    }
    setEnviando(true)
    try {
      const path = `${Date.now()}-${sanitizarNomeArquivo(file.name)}`
      const { error: upErr } = await supabase.storage.from('ia-midias').upload(path, file)
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('ia-midias').getPublicUrl(path)
      const tipo: MidiaRow['tipo'] = file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('image/') ? 'image' : 'document'
      const tituloDefault = file.name.replace(/\.[^.]+$/, '')
      const { error: insErr } = await supabase.from('ia_midias').insert({
        titulo: tituloDefault,
        descricao_ia: '',
        tipo,
        url: pub.publicUrl,
        filename: path,
        ativo: true,
      })
      if (insErr) throw insErr
      qc.invalidateQueries({ queryKey: ['ia-midias'] })
      push('Mídia enviada — agora descreva quando a IA deve mandar ela', 'success')
    } catch (err) {
      push('Erro no upload: ' + ((err as Error)?.message ?? 'falha de rede'), 'danger')
    } finally {
      setEnviando(false)
    }
  }

  if (isLoading) return <PageLoading />

  return (
    <div className="space-y-3">
      {/* Dica */}
      <div className="bg-info/10 border border-info/30 rounded-lg p-3 text-[12px] text-ink flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <span>
          <strong>Descreva QUANDO usar cada mídia</strong> — é isso que a IA lê pra decidir
          (ex.: "Cliente perguntou como funciona a Compacta 02" → vídeo da Compacta 02).
        </span>
      </div>

      {/* Upload */}
      <label className={cn(
        'flex items-center justify-center gap-2 w-full py-4 rounded-lg border-2 border-dashed border-border',
        'text-[13px] font-medium text-ink-muted cursor-pointer hover:border-accent hover:text-accent transition-colors',
        enviando && 'opacity-60 pointer-events-none',
      )}>
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {enviando ? 'Enviando...' : 'Enviar foto, vídeo ou documento (máx. 16MB)'}
        <input type="file" className="hidden" onChange={onUpload} disabled={enviando} />
      </label>

      {(midias?.length ?? 0) === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-6 text-center text-[12px] text-ink-faint">
          Nenhuma mídia cadastrada. Envie a primeira acima.
        </div>
      ) : (
        midias!.map(m => <MidiaCard key={m.id} midia={m} push={push} />)
      )}
    </div>
  )
}

// ============================================================================
// Página
// ============================================================================
type Aba = 'visao' | 'cerebro' | 'config' | 'midias'

const ABAS: Array<{ id: Aba; label: string; icon: typeof Bot }> = [
  { id: 'visao', label: 'Visão geral', icon: Bot },
  { id: 'cerebro', label: 'Cérebro', icon: Brain },
  { id: 'config', label: 'Configuração', icon: Settings2 },
  { id: 'midias', label: 'Mídias', icon: Film },
]

export function IaAtendente() {
  const [aba, setAba] = useState<Aba>('visao')
  const [toasts, push] = useToast()

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-5 h-5 text-accent" />
            <h1 className="text-[18px] font-semibold text-ink">IA Atendente</h1>
          </div>
          <p className="text-[12px] text-ink-muted">
            A IA responde clientes no WhatsApp quando o vendedor liga ela na conversa (botão 🤖).
            Aqui você acompanha quem está com IA ligada, edita o que ela sabe, ajusta o tom e cadastra as mídias que ela pode mandar.
          </p>
        </div>

        {/* Abas */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {ABAS.map(a => {
            const Icon = a.icon
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors',
                  aba === a.id
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface text-ink-muted border-border hover:bg-surface-2',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {a.label}
              </button>
            )
          })}
        </div>

        {aba === 'visao' && <SecaoVisaoGeral push={push} />}
        {aba === 'cerebro' && <SecaoCerebro push={push} />}
        {aba === 'config' && <SecaoConfig push={push} />}
        {aba === 'midias' && <SecaoMidias push={push} />}
      </div>
      <ToastStack toasts={toasts} />
    </div>
  )
}
