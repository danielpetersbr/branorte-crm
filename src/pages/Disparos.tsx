import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Play, Pause, Trash2, Plus, Users, Clock, AlertCircle, FlaskConical, Zap, Key, Copy, Check, Trash, Activity } from 'lucide-react'

const SUPA_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'
const EDGE_EXTERNAL = `${SUPA_URL}/functions/v1/dispatch-external`

type ApiKey = {
  id: string
  nome: string
  key_prefix: string
  ativa: boolean
  criado_em: string
  ultima_uso_em: string | null
  total_chamadas: number
  notas: string | null
}

type ApiLog = {
  id: string
  api_key_nome: string | null
  origem: string | null
  campaign_id: string | null
  status_code: number
  total_contatos: number | null
  total_atribuidos: number | null
  total_duplicados: number | null
  payload_resumo: any
  erro: string | null
  criado_em: string
}

type Vendedor = {
  vendedor_nome: string
  online: boolean
  share_percent: number
  max_per_hour: number
  enviados_hoje: number
  enviados_ultima_hora: number
  ultimo_envio_em: string | null
}

type Campanha = {
  id: string
  nome: string
  mensagem_template: string
  regra_distribuicao: 'igualitaria' | 'round_robin' | 'porcentagem' | 'manual'
  porcentagens_json: Record<string, number> | null
  status: 'rascunho' | 'ativa' | 'pausada' | 'concluida'
  rate_max_por_hora: number
  intervalo_min_seg: number
  intervalo_max_seg: number
  horario_inicio: string
  horario_fim: string
  dias_semana: number[]
  criado_em: string
  iniciado_em: string | null
  concluido_em: string | null
}

type Lead = {
  id: string
  campaign_id: string
  nome: string | null
  telefone: string
  vars_json: Record<string, any> | null
  vendedor_atribuido: string | null
  status: string
  enviado_em: string | null
  erro_msg: string | null
}

const STATUS_LABELS: Record<string, { txt: string; cor: string }> = {
  pendente:    { txt: 'Pendente', cor: 'bg-slate-500/20 text-slate-300' },
  enfileirado: { txt: 'Enfileirado', cor: 'bg-blue-500/20 text-blue-300' },
  enviado:     { txt: 'Enviado', cor: 'bg-emerald-500/20 text-emerald-300' },
  falhou:      { txt: 'Falhou', cor: 'bg-red-500/20 text-red-300' },
  duplicado:   { txt: 'Duplicado', cor: 'bg-amber-500/20 text-amber-300' },
  respondido:  { txt: 'Respondeu', cor: 'bg-purple-500/20 text-purple-300' },
  cancelado:   { txt: 'Cancelado', cor: 'bg-slate-500/20 text-slate-300' },
}

function normalizaTelefone(raw: string): string {
  const d = String(raw).replace(/[^\d]/g, '')
  if (d.length === 11 || d.length === 10) return '55' + d
  return d
}

export function Disparos() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [campSelecionada, setCampSelecionada] = useState<string | null>(null)
  const [novaCampForm, setNovaCampForm] = useState(false)

  // Vendedores status
  const { data: vendedores, isLoading: loadingV } = useQuery<Vendedor[]>({
    queryKey: ['vendor-dispatch-status'],
    queryFn: async () => {
      const { data } = await supabase.from('vendor_dispatch_status').select('*').order('vendedor_nome')
      return data || []
    },
    refetchInterval: 10000,
  })

  // WhatsApp Web aberto/fechado + versão da extensão por vendedor
  // Janela ampliada de 5min → 30min pra capturar quem pingou recentemente.
  const { data: vendorRuntime } = useQuery<Record<string, { ts: string; versao: string }>>({
    queryKey: ['vendor-runtime'],
    queryFn: async () => {
      const { data } = await supabase
        .from('wa_sync_debug')
        .select('vendedor_nome, recebido_em, client_version')
        .gte('recebido_em', new Date(Date.now() - 30 * 60_000).toISOString())
        .order('recebido_em', { ascending: false })
        .limit(500)
      const mapa: Record<string, { ts: string; versao: string }> = {}
      for (const row of (data || [])) {
        if (!mapa[row.vendedor_nome]) {
          mapa[row.vendedor_nome] = { ts: row.recebido_em, versao: row.client_version ?? '?' }
        }
      }
      return mapa
    },
    refetchInterval: 10000,
  })

  // Status consolidado por vendedor:
  // - desligado:    admin desligou no painel (v.online=false)
  // - ativo:        pingou nos ultimos 3min, versao OK, esta online
  // - lento:        pingou entre 3-15min atras (talvez WA open mas sem atividade)
  // - desconectado: pingou > 15min OU nunca pingou
  // - versao_antiga: pingou mas versao < 1.1 (sem suporte a disparo)
  type StatusVendedor = 'desligado' | 'ativo' | 'lento' | 'desconectado' | 'versao_antiga'
  function statusVendedor(v: Vendedor): { status: StatusVendedor; pingSec: number | null; versao: string | null } {
    const runtime = vendorRuntime?.[v.vendedor_nome]
    if (!v.online) return { status: 'desligado', pingSec: null, versao: runtime?.versao ?? null }
    if (!runtime) return { status: 'desconectado', pingSec: null, versao: null }
    const sec = (Date.now() - new Date(runtime.ts).getTime()) / 1000
    // valida versao
    const [maj, min] = (runtime.versao || '0.0').split('.').map(n => parseInt(n, 10) || 0)
    const versaoOk = maj > 1 || (maj === 1 && min >= 1)
    if (!versaoOk) return { status: 'versao_antiga', pingSec: sec, versao: runtime.versao }
    if (sec < 180) return { status: 'ativo', pingSec: sec, versao: runtime.versao }
    if (sec < 900) return { status: 'lento', pingSec: sec, versao: runtime.versao }
    return { status: 'desconectado', pingSec: sec, versao: runtime.versao }
  }

  function tempoRelativo(sec: number | null): string {
    if (sec === null) return 'sem ping'
    if (sec < 60) return `${Math.round(sec)}s atrás`
    if (sec < 3600) return `${Math.round(sec / 60)}min atrás`
    return `${Math.round(sec / 3600)}h atrás`
  }

  // Modal de teste
  const [testeVendedor, setTesteVendedor] = useState<string | null>(null)

  // Campanhas
  const { data: campanhas } = useQuery<Campanha[]>({
    queryKey: ['dispatch-campaigns'],
    queryFn: async () => {
      const { data } = await supabase.from('dispatch_campaign').select('*').order('criado_em', { ascending: false }).limit(50)
      return data || []
    },
    refetchInterval: 15000,
  })

  // Leads da campanha selecionada
  const { data: leads } = useQuery<Lead[]>({
    queryKey: ['dispatch-leads', campSelecionada],
    queryFn: async () => {
      if (!campSelecionada) return []
      const { data } = await supabase.from('dispatch_lead').select('*').eq('campaign_id', campSelecionada).order('criado_em', { ascending: true }).limit(500)
      return data || []
    },
    enabled: !!campSelecionada,
    refetchInterval: 5000,
  })

  // Toggle vendedor online
  const toggleVendedor = useMutation({
    mutationFn: async ({ nome, online }: { nome: string; online: boolean }) => {
      await supabase.from('vendor_dispatch_status').update({ online }).eq('vendedor_nome', nome)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] }),
  })

  // Update share_percent
  const setShare = useMutation({
    mutationFn: async ({ nome, percent }: { nome: string; percent: number }) => {
      await supabase.from('vendor_dispatch_status').update({ share_percent: percent }).eq('vendedor_nome', nome)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] }),
  })

  // Pausa/retoma campanha
  const setCampStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await supabase.from('dispatch_campaign').update({ status }).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispatch-campaigns'] }),
  })

  if (!profile) return <PageLoading />
  if (profile.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="h-12 w-12 text-warning mx-auto mb-2" />
        <h2 className="text-xl font-bold text-ink">Acesso restrito</h2>
        <p className="text-ink-muted">Apenas administradores podem usar a Central de Disparo.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Send className="h-6 w-6 text-accent" /> Central de Disparo
          </h1>
          <p className="text-ink-muted text-sm">Envia mensagens pelo WhatsApp dos vendedores · sem API oficial</p>
        </div>
        <Button variant="primary" onClick={() => setNovaCampForm(v => !v)}>
          <Plus className="h-4 w-4 mr-1" /> Nova campanha
        </Button>
      </header>

      {/* PAINEL VENDEDORES */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            Vendedores
            <span className="text-ink-faint font-normal text-[11px]">
              · {(vendedores ?? []).filter(v => statusVendedor(v).status === 'ativo').length} ativos de {(vendedores ?? []).length}
            </span>
          </h2>
          <div className="flex gap-3 text-[10px] text-ink-muted">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ativo</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> lento</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" /> desconectado</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> desligado</span>
          </div>
        </div>
        {loadingV ? <PageLoading /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {(vendedores ?? []).map(v => {
              const st = statusVendedor(v)
              const podeDisparar = st.status === 'ativo'
              const stCfg = {
                ativo:         { cor: 'border-emerald-500/40 bg-emerald-500/5',  dot: 'bg-emerald-400', txt: 'text-emerald-300', label: 'ATIVO',         hint: 'Pronto pra disparar' },
                lento:         { cor: 'border-amber-500/40 bg-amber-500/5',      dot: 'bg-amber-400',   txt: 'text-amber-300',   label: 'LENTO',         hint: 'WA aberto mas resposta atrasada' },
                versao_antiga: { cor: 'border-amber-500/40 bg-amber-500/5',      dot: 'bg-amber-400',   txt: 'text-amber-300',   label: 'RECARREGAR',    hint: 'Versão antiga — recarregar Chrome' },
                desconectado:  { cor: 'border-red-500/30 bg-red-500/5',          dot: 'bg-red-400',     txt: 'text-red-300',     label: 'DESCONECTADO', hint: 'Sem ping recente — WA fechado?' },
                desligado:     { cor: 'border-border bg-surface-2/30',           dot: 'bg-slate-500',   txt: 'text-slate-400',   label: 'DESLIGADO',     hint: 'Admin desligou no painel' },
              }[st.status]
              return (
              <div key={v.vendedor_nome} className={`border rounded-xl p-3 transition-all ${stCfg.cor}`}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={v.vendedor_nome} size="sm" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-ink truncate">{v.vendedor_nome}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${stCfg.dot} ${st.status === 'ativo' ? 'animate-pulse' : ''}`} />
                        <span className={`text-[9px] font-bold tracking-wider ${stCfg.txt}`} title={stCfg.hint}>
                          {stCfg.label}
                        </span>
                        <span className="text-[9px] text-ink-faint">· {tempoRelativo(st.pingSec)}</span>
                        {st.versao && (
                          <span className="text-[9px] text-ink-faint">· v{st.versao}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleVendedor.mutate({ nome: v.vendedor_nome, online: !v.online })}
                    title={v.online ? 'Clique pra desligar' : 'Clique pra ligar'}
                    className={`text-[9px] px-2 py-1 rounded-full font-bold tracking-wide transition-all flex-shrink-0 ${
                      v.online ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50'
                    }`}
                  >
                    {v.online ? '◉ LIGADO' : '○ DESLIG.'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <div className="bg-surface-2/50 rounded-lg p-1.5 border border-border/40">
                    <div className="text-[8px] text-ink-faint uppercase tracking-wider">Hoje</div>
                    <div className="text-ink font-bold text-[15px] tabular-nums leading-tight">{v.enviados_hoje}</div>
                  </div>
                  <div className="bg-surface-2/50 rounded-lg p-1.5 border border-border/40">
                    <div className="text-[8px] text-ink-faint uppercase tracking-wider">Última hora</div>
                    <div className="text-ink font-bold text-[13px] tabular-nums leading-tight">
                      {v.enviados_ultima_hora}<span className="text-ink-faint text-[10px]">/{v.max_per_hour}</span>
                    </div>
                    <div className="h-0.5 bg-surface-1 rounded-full mt-0.5 overflow-hidden">
                      <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (v.enviados_ultima_hora / Math.max(1, v.max_per_hour)) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="bg-surface-2/50 rounded-lg p-1.5 border border-border/40">
                    <label className="text-[8px] text-ink-faint uppercase tracking-wider">% share</label>
                    <input
                      type="number" min={0} max={100} step="0.1" defaultValue={v.share_percent}
                      onBlur={e => setShare.mutate({ nome: v.vendedor_nome, percent: Number(e.target.value) || 0 })}
                      className="w-full bg-transparent text-ink text-[13px] font-bold tabular-nums leading-tight focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  onClick={() => setTesteVendedor(v.vendedor_nome)}
                  disabled={!podeDisparar}
                  className={`w-full text-[10px] py-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-all ${
                    podeDisparar
                      ? 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/40'
                      : 'bg-surface-2/40 text-ink-faint border border-border cursor-not-allowed'
                  }`}
                  title={stCfg.hint}
                >
                  <FlaskConical className="h-3 w-3" />
                  {podeDisparar ? 'Testar disparo' : stCfg.label.toLowerCase()}
                </button>
              </div>
            )})}
          </div>
        )}
      </Card>

      {/* FORM NOVA CAMPANHA */}
      {novaCampForm && (
        <Card className="p-4">
          <NovaCampanhaForm
            vendedores={vendedores ?? []}
            onCancel={() => setNovaCampForm(false)}
            onCreated={(id) => {
              setNovaCampForm(false)
              setCampSelecionada(id)
              qc.invalidateQueries({ queryKey: ['dispatch-campaigns'] })
            }}
          />
        </Card>
      )}

      {/* DISTRIBUIÇÃO GLOBAL (% padrão) */}
      <DistribuicaoGlobalCard vendedores={vendedores ?? []} />

      {/* API EXTERNA (ReplyAgent, n8n etc.) */}
      <ApiExternaCard />

      {/* LISTA DE CAMPANHAS */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-accent" /> Campanhas
        </h2>
        <div className="space-y-2">
          {(campanhas ?? []).map(c => {
            const ativo = campSelecionada === c.id
            return (
              <div
                key={c.id}
                className={`border rounded-lg p-3 cursor-pointer transition-all ${ativo ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-2/40'}`}
                onClick={() => setCampSelecionada(ativo ? null : c.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-ink font-semibold text-[13px]">{c.nome}</div>
                    <div className="text-ink-muted text-[10px] mt-0.5">
                      {c.regra_distribuicao} · {c.rate_max_por_hora}/h · {c.horario_inicio.slice(0,5)}-{c.horario_fim.slice(0,5)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === 'rascunho' ? 'outline' : 'default'}>
                      {c.status}
                    </Badge>
                    {c.status === 'ativa' && (
                      <button onClick={(e) => { e.stopPropagation(); setCampStatus.mutate({ id: c.id, status: 'pausada' }) }} className="text-warning hover:text-warning/80">
                        <Pause className="h-4 w-4" />
                      </button>
                    )}
                    {c.status === 'pausada' && (
                      <button onClick={(e) => { e.stopPropagation(); setCampStatus.mutate({ id: c.id, status: 'ativa' }) }} className="text-emerald-400 hover:text-emerald-300">
                        <Play className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {(campanhas ?? []).length === 0 && (
            <div className="text-center py-6 text-ink-muted text-sm">
              Nenhuma campanha. Clique em "Nova campanha" pra começar.
            </div>
          )}
        </div>
      </Card>

      {/* DETALHE DA CAMPANHA SELECIONADA */}
      {campSelecionada && campanhas?.find(c => c.id === campSelecionada) && (
        <DetalheCampanha
          campanha={campanhas.find(c => c.id === campSelecionada)!}
          leads={leads ?? []}
          vendedores={vendedores ?? []}
        />
      )}

      {/* MODAL DE TESTE */}
      {testeVendedor && (
        <ModalTeste
          vendedor={testeVendedor}
          onClose={() => setTesteVendedor(null)}
          onSuccess={(campId) => {
            setTesteVendedor(null)
            setCampSelecionada(campId)
            qc.invalidateQueries({ queryKey: ['dispatch-campaigns'] })
          }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Modal de Teste
// ============================================================================
function ModalTeste({ vendedor, onClose, onSuccess }: { vendedor: string; onClose: () => void; onSuccess: (campId: string) => void }) {
  const [telefone, setTelefone] = useState('')
  const [nome, setNome] = useState('Teste')
  const [mensagem, setMensagem] = useState(`Olá {{nome}}, aqui é o ${vendedor} da Branorte. Esta é uma mensagem-teste.`)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  async function disparar() {
    const tel = normalizaTelefone(telefone)
    if (tel.length < 12) {
      setResultado('❌ Telefone inválido. Use DDD + número (ex: 48999999999).')
      return
    }
    setEnviando(true)
    setResultado(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/dispatch-test', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ vendedor_nome: vendedor, telefone: tel, nome: nome.trim() || 'Teste', mensagem: mensagem.trim() }),
      })
      const j = await r.json()
      if (!j.ok) {
        setResultado('❌ Erro: ' + (j.error || 'desconhecido'))
        return
      }
      setResultado('✅ ' + j.msg)
      setTimeout(() => onSuccess(j.campaign_id), 1200)
    } catch (e: any) {
      setResultado('❌ Erro de rede: ' + (e?.message ?? ''))
    } finally {
      setEnviando(false)
    }
  }

  // Preview da mensagem com {{nome}} resolvido
  const preview = mensagem.replace(/\{\{\s*nome\s*\}\}/g, nome || '[nome]').replace(/\{\{\s*vendedor\s*\}\}/g, vendedor)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-1 border border-border rounded-xl max-w-lg w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-accent" /> Teste de disparo
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">✕</button>
        </div>
        <p className="text-[11px] text-ink-muted">
          <strong className="text-accent">{vendedor}</strong> vai enviar 1 mensagem do WhatsApp dele em 5-15s.
        </p>
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Seu telefone (DDD+número)</label>
          <Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="48999999999" />
        </div>
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Nome (que vai no template)</label>
          <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Teste" />
        </div>
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Mensagem</label>
          <textarea
            value={mensagem} onChange={e => setMensagem(e.target.value)} rows={3}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-ink text-sm"
          />
        </div>
        <div className="border-l-2 border-accent bg-accent/5 rounded p-2">
          <div className="text-[9px] text-ink-faint uppercase mb-1">Preview que o cliente vai ver</div>
          <div className="text-[12px] text-ink whitespace-pre-line">{preview}</div>
        </div>
        {resultado && (
          <div className={`text-[11px] p-2 rounded ${resultado.startsWith('✅') ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
            {resultado}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="primary" onClick={disparar} loading={enviando}>
            <Zap className="h-4 w-4 mr-1" /> Disparar agora
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Form nova campanha
// ============================================================================
function NovaCampanhaForm({ onCancel, onCreated, vendedores }: { onCancel: () => void; onCreated: (id: string) => void; vendedores: Vendedor[] }) {
  const [nome, setNome] = useState('')
  const [mensagem, setMensagem] = useState('Olá {{nome}}, aqui é o {{vendedor}} da Branorte. Tudo bem?')
  const [regra, setRegra] = useState<'igualitaria' | 'round_robin' | 'porcentagem' | 'manual'>('igualitaria')
  const [rate, setRate] = useState(30)
  const [hi, setHi] = useState('08:00')
  const [hf, setHf] = useState('18:00')
  const [salvando, setSalvando] = useState(false)
  const [pesosCamp, setPesosCamp] = useState<Record<string, number>>({})

  async function criar() {
    if (!nome.trim() || !mensagem.trim()) return alert('preencha nome e mensagem')
    if (regra === 'porcentagem') {
      const soma = Object.values(pesosCamp).reduce((s, n) => s + (Number(n) || 0), 0)
      if (soma <= 0) return alert('defina pesos > 0 para pelo menos um vendedor (ou use "Copiar do painel global")')
    }
    setSalvando(true)
    const { data, error } = await supabase.from('dispatch_campaign').insert({
      nome: nome.trim(),
      mensagem_template: mensagem.trim(),
      regra_distribuicao: regra,
      porcentagens_json: regra === 'porcentagem' ? pesosCamp : null,
      status: 'rascunho',
      rate_max_por_hora: rate,
      horario_inicio: hi,
      horario_fim: hf,
    }).select('id').single()
    setSalvando(false)
    if (error) return alert('erro: ' + error.message)
    onCreated(data.id)
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink">Nova campanha</h3>
      <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome da campanha (ex: Leads Meta Ads Outubro)" />
      <textarea
        value={mensagem}
        onChange={e => setMensagem(e.target.value)}
        rows={4}
        className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-ink text-sm"
        placeholder="Mensagem (use {{nome}}, {{vendedor}}, ou outras variáveis)"
      />
      <div className="text-[10px] text-ink-faint">
        Variáveis disponíveis: <code className="text-accent">&#123;&#123;nome&#125;&#125;</code>, <code className="text-accent">&#123;&#123;vendedor&#125;&#125;</code>, e qualquer chave do JSON de cada lead.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Distribuição</label>
          <Select
            value={regra}
            onChange={e => setRegra(e.target.value as any)}
            options={[
              { value: 'igualitaria',  label: 'Igualitária (peso 1 cada)' },
              { value: 'round_robin',  label: 'Round-robin (alterna)' },
              { value: 'porcentagem',  label: '% por vendedor (peso)' },
              { value: 'manual',       label: 'Manual (eu atribuo)' },
            ]}
          />
        </div>
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Max/hora por vendedor</label>
          <Input type="number" value={rate} onChange={e => setRate(Number(e.target.value) || 30)} />
        </div>
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Início</label>
          <Input type="time" value={hi} onChange={e => setHi(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-ink-faint uppercase">Fim</label>
          <Input type="time" value={hf} onChange={e => setHf(e.target.value)} />
        </div>
      </div>
      <div className="text-[10px] text-ink-muted px-2 py-1.5 bg-surface-2/50 rounded">
        {regra === 'igualitaria' && '⚖️ Sorteio com peso igual para todos os vendedores online.'}
        {regra === 'round_robin' && '🔁 Alterna sequencialmente entre os vendedores online (1º Alvaro, 2º Daniel, 3º Eder...).'}
        {regra === 'porcentagem' && '🎯 Sorteio ponderado pelos pesos abaixo. Não precisa dar 100 — é proporcional (ex: 30/20/10 = 50%/33%/17%).'}
        {regra === 'manual' && '✋ Você atribui lead por lead. Distribuir não atribui automaticamente.'}
      </div>

      {regra === 'porcentagem' && (
        <WeightEditor
          vendedores={vendedores.filter(v => v.online)}
          pesos={pesosCamp}
          onChange={setPesosCamp}
          allowCopyGlobal
        />
      )}

      <div className="flex gap-2">
        <Button variant="primary" onClick={criar} loading={salvando}>Criar campanha</Button>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

// ============================================================================
// WeightEditor — editor de pesos com validação e preview
// ============================================================================
function WeightEditor({
  vendedores, pesos, onChange, allowCopyGlobal = false,
}: {
  vendedores: Vendedor[]
  pesos: Record<string, number>
  onChange: (p: Record<string, number>) => void
  allowCopyGlobal?: boolean
}) {
  const soma = useMemo(() => Object.values(pesos).reduce((s, n) => s + (Number(n) || 0), 0), [pesos])
  const proximoDe100 = soma >= 99.5 && soma <= 100.5

  function setPeso(nome: string, val: number) {
    onChange({ ...pesos, [nome]: Math.max(0, val) })
  }
  function igualar() {
    const each = Math.round((100 / vendedores.length) * 100) / 100
    const novo: Record<string, number> = {}
    for (const v of vendedores) novo[v.vendedor_nome] = each
    onChange(novo)
  }
  function normalizar() {
    if (soma <= 0) return igualar()
    const fator = 100 / soma
    const novo: Record<string, number> = {}
    for (const [k, v] of Object.entries(pesos)) novo[k] = Math.round(Number(v) * fator * 100) / 100
    onChange(novo)
  }
  function copiarGlobal() {
    const novo: Record<string, number> = {}
    for (const v of vendedores) novo[v.vendedor_nome] = Number(v.share_percent) || 0
    onChange(novo)
  }
  function zerar() {
    onChange({})
  }

  // Preview: se 100 leads, quantos vão pra cada
  const preview = useMemo(() => {
    if (soma <= 0) return {}
    const r: Record<string, number> = {}
    for (const v of vendedores) {
      const p = Number(pesos[v.vendedor_nome] ?? 0)
      r[v.vendedor_nome] = Math.round((p / soma) * 100)
    }
    return r
  }, [pesos, soma, vendedores])

  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-surface-2/30">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-[11px] font-semibold text-ink uppercase tracking-wider">Pesos por vendedor</label>
        <div className={`text-[11px] font-bold tabular-nums ${proximoDe100 ? 'text-emerald-400' : soma > 0 ? 'text-amber-400' : 'text-ink-faint'}`}>
          soma: {soma.toFixed(1)}{proximoDe100 ? ' ✓' : ''}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {vendedores.map(v => {
          const peso = Number(pesos[v.vendedor_nome] ?? 0)
          const pct = preview[v.vendedor_nome] ?? 0
          return (
            <div key={v.vendedor_nome} className="flex items-center gap-1.5 bg-surface-2 border border-border rounded px-2 py-1">
              <Avatar name={v.vendedor_nome} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-ink font-semibold truncate">{v.vendedor_nome}</div>
                {soma > 0 && (
                  <div className="text-[8px] text-ink-faint">→ {pct}/100 leads</div>
                )}
              </div>
              <input
                type="number" min={0} step="0.1" value={peso || ''}
                onChange={e => setPeso(v.vendedor_nome, Number(e.target.value) || 0)}
                placeholder="0"
                className="w-12 bg-surface-1 border border-border rounded px-1 py-0.5 text-ink text-[11px] font-bold text-right"
              />
            </div>
          )
        })}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button onClick={igualar} className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20">
          Igualar entre todos
        </button>
        <button onClick={normalizar} disabled={soma <= 0} className="text-[10px] px-2 py-1 rounded bg-surface-2 text-ink border border-border hover:bg-surface-3 disabled:opacity-40">
          Normalizar p/ 100%
        </button>
        {allowCopyGlobal && (
          <button onClick={copiarGlobal} className="text-[10px] px-2 py-1 rounded bg-surface-2 text-ink border border-border hover:bg-surface-3">
            Copiar do painel global
          </button>
        )}
        <button onClick={zerar} className="text-[10px] px-2 py-1 rounded bg-surface-2 text-ink-muted border border-border hover:bg-red-500/10 hover:text-red-400">
          Zerar tudo
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Detalhe da campanha — lista de leads + add + distribuir
// ============================================================================
function DetalheCampanha({ campanha, leads, vendedores }: { campanha: Campanha; leads: Lead[]; vendedores: Vendedor[] }) {
  const qc = useQueryClient()
  const [colando, setColando] = useState('')

  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1
    return counts
  }, [leads])

  async function adicionarColados() {
    const linhas = colando.split('\n').map(l => l.trim()).filter(Boolean)
    if (linhas.length === 0) return
    const rows = linhas.map(linha => {
      const [tel, ...resto] = linha.split(/[,;|\t]/).map(x => x.trim())
      const nome = resto.join(' ').trim() || null
      const telefone = normalizaTelefone(tel)
      return { campaign_id: campanha.id, telefone, nome, vars_json: nome ? { nome } : {} }
    }).filter(r => r.telefone && r.telefone.length >= 12)

    if (rows.length === 0) return alert('nenhum telefone válido')
    const { error } = await supabase.from('dispatch_lead').insert(rows)
    if (error) return alert('erro: ' + error.message)
    setColando('')
    qc.invalidateQueries({ queryKey: ['dispatch-leads', campanha.id] })
  }

  async function distribuir() {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/dispatch-distribute', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ campaign_id: campanha.id }),
    })
    const j = await r.json()
    if (!j.ok) return alert('erro: ' + (j.error || ''))
    alert(`Distribuído: ${j.atribuidos} leads enfileirados, ${j.duplicados} duplicados`)
    qc.invalidateQueries({ queryKey: ['dispatch-leads', campanha.id] })
    qc.invalidateQueries({ queryKey: ['dispatch-campaigns'] })
  }

  async function deletarLead(id: string) {
    await supabase.from('dispatch_lead').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['dispatch-leads', campanha.id] })
  }

  return (
    <Card className="p-4 space-y-4">
      <header>
        <h2 className="text-base font-bold text-ink">{campanha.nome}</h2>
        <p className="text-ink-muted text-[10px] mt-1 whitespace-pre-line">{campanha.mensagem_template}</p>
      </header>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {Object.entries(STATUS_LABELS).map(([k, v]) => (
          <div key={k} className={`rounded-lg px-3 py-2 ${v.cor}`}>
            <div className="text-[10px] uppercase opacity-70">{v.txt}</div>
            <div className="text-[16px] font-bold tabular-nums">{stats[k] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="border border-border rounded-lg p-3 bg-surface-2/30">
        <label className="text-[11px] text-ink-muted block mb-1">Cole leads (1 por linha · <code>telefone, nome</code>)</label>
        <textarea
          value={colando}
          onChange={e => setColando(e.target.value)}
          rows={4}
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-ink text-sm font-mono"
          placeholder={'5548999999999, João Silva\n5548988888888, Maria'}
        />
        <div className="flex gap-2 mt-2">
          <Button variant="secondary" onClick={adicionarColados} disabled={!colando.trim()}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar à fila
          </Button>
          <Button variant="primary" onClick={distribuir} disabled={(stats.pendente ?? 0) === 0}>
            <Send className="h-4 w-4 mr-1" /> Distribuir {stats.pendente ?? 0} leads
          </Button>
        </div>
      </div>

      {/* TABELA DE LEADS */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-surface-2/60">
            <tr>
              <th className="text-left px-3 py-2 text-ink-muted font-medium">Nome</th>
              <th className="text-left px-3 py-2 text-ink-muted font-medium">Telefone</th>
              <th className="text-left px-3 py-2 text-ink-muted font-medium">Vendedor</th>
              <th className="text-left px-3 py-2 text-ink-muted font-medium">Status</th>
              <th className="text-left px-3 py-2 text-ink-muted font-medium">Enviado</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {leads.slice(0, 200).map(l => {
              const lbl = STATUS_LABELS[l.status] ?? { txt: l.status, cor: 'bg-slate-500/20 text-slate-300' }
              return (
                <tr key={l.id} className="border-t border-border/40 hover:bg-surface-2/30">
                  <td className="px-3 py-1.5 text-ink">{l.nome ?? '—'}</td>
                  <td className="px-3 py-1.5 text-ink font-mono">{l.telefone}</td>
                  <td className="px-3 py-1.5 text-ink">{l.vendedor_atribuido ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${lbl.cor}`}>{lbl.txt}</span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-muted">
                    {l.enviado_em ? new Date(l.enviado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => deletarLead(l.id)} className="text-ink-faint hover:text-red-400">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              )
            })}
            {leads.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-ink-muted">Cole leads acima pra começar</td></tr>
            )}
          </tbody>
        </table>
        {leads.length > 200 && (
          <div className="text-center py-2 text-ink-faint text-[10px]">mostrando 200 de {leads.length} leads</div>
        )}
      </div>
    </Card>
  )
}

// ============================================================================
// DistribuicaoGlobalCard — painel de % global (default p/ campanhas externas)
// ============================================================================
function DistribuicaoGlobalCard({ vendedores }: { vendedores: Vendedor[] }) {
  const qc = useQueryClient()
  const online = vendedores.filter(v => v.online)
  const soma = useMemo(() => online.reduce((s, v) => s + (Number(v.share_percent) || 0), 0), [online])
  const proximoDe100 = soma >= 99.5 && soma <= 100.5

  async function setPesos(novo: Record<string, number>) {
    const updates = Object.entries(novo).map(([nome, p]) =>
      supabase.from('vendor_dispatch_status').update({ share_percent: p }).eq('vendedor_nome', nome)
    )
    await Promise.all(updates)
    qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] })
  }
  function igualar() {
    if (online.length === 0) return
    const each = Math.round((100 / online.length) * 100) / 100
    const novo: Record<string, number> = {}
    for (const v of online) novo[v.vendedor_nome] = each
    setPesos(novo)
  }
  function normalizar() {
    if (soma <= 0) return igualar()
    const fator = 100 / soma
    const novo: Record<string, number> = {}
    for (const v of online) novo[v.vendedor_nome] = Math.round((Number(v.share_percent) || 0) * fator * 100) / 100
    setPesos(novo)
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          Distribuição global · padrão p/ campanhas externas
        </h2>
        <div className="flex items-center gap-2">
          <div className={`text-[11px] font-bold tabular-nums ${proximoDe100 ? 'text-emerald-400' : soma > 0 ? 'text-amber-400' : 'text-ink-faint'}`}>
            soma: {soma.toFixed(1)}{proximoDe100 ? ' ✓' : soma > 0 ? ' (ajuste)' : ''}
          </div>
          <button onClick={igualar} className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20">
            Igualar 100%
          </button>
          <button onClick={normalizar} disabled={soma <= 0} className="text-[10px] px-2 py-1 rounded bg-surface-2 text-ink border border-border hover:bg-surface-3 disabled:opacity-40">
            Normalizar
          </button>
        </div>
      </div>
      <p className="text-[10px] text-ink-muted mb-2">
        Estes % são o padrão usado quando ReplyAgent/n8n chamam <code className="text-accent">dispatch-external</code> sem pesos específicos.
        Soma proporcional — não precisa dar 100, mas é bom prática.
      </p>
      {soma > 0 && (
        <div className="flex h-4 rounded overflow-hidden border border-border bg-surface-2">
          {online.filter(v => Number(v.share_percent) > 0).map((v, i) => {
            const pct = (Number(v.share_percent) / soma) * 100
            const cores = ['bg-emerald-500', 'bg-accent', 'bg-purple-500', 'bg-amber-500', 'bg-blue-500', 'bg-pink-500', 'bg-cyan-500', 'bg-orange-500', 'bg-rose-500']
            return (
              <div key={v.vendedor_nome} className={`${cores[i % cores.length]} flex items-center justify-center text-[8px] font-bold text-black/70 transition-all`} style={{ width: `${pct}%` }} title={`${v.vendedor_nome}: ${pct.toFixed(1)}%`}>
                {pct >= 8 ? v.vendedor_nome.substring(0, 3) : ''}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// ApiExternaCard — gerenciar keys + log de chamadas
// ============================================================================
function ApiExternaCard() {
  const [aberto, setAberto] = useState(false)
  const [novaKey, setNovaKey] = useState<{ key: string; nome: string } | null>(null)

  const { data: keys, refetch: refetchKeys } = useQuery<ApiKey[]>({
    queryKey: ['dispatch-api-keys'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${SUPA_URL}/functions/v1/dispatch-api-key`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      })
      const j = await r.json()
      return j.keys ?? []
    },
    enabled: aberto,
  })

  const { data: logs } = useQuery<ApiLog[]>({
    queryKey: ['dispatch-api-logs'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${SUPA_URL}/functions/v1/dispatch-api-key`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'logs', limit: 20 }),
      })
      const j = await r.json()
      return j.logs ?? []
    },
    enabled: aberto,
    refetchInterval: aberto ? 15000 : false,
  })

  async function criarKey() {
    const nome = prompt('Nome da chave (ex: ReplyAgent prod):')
    if (!nome?.trim()) return
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch(`${SUPA_URL}/functions/v1/dispatch-api-key`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', nome: nome.trim() }),
    })
    const j = await r.json()
    if (!j.ok) return alert('erro: ' + (j.error ?? ''))
    setNovaKey({ key: j.key, nome: nome.trim() })
    refetchKeys()
  }

  async function revogarKey(id: string, nome: string) {
    if (!confirm(`Revogar chave "${nome}"? Quem usar essa chave vai começar a falhar.`)) return
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${SUPA_URL}/functions/v1/dispatch-api-key`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', id }),
    })
    refetchKeys()
  }

  return (
    <Card className="p-4">
      <button onClick={() => setAberto(v => !v)} className="w-full flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Key className="h-4 w-4 text-accent" />
          API externa · disparar de ReplyAgent / n8n / webhook
        </h2>
        <span className="text-[10px] text-ink-muted">{aberto ? '▲ fechar' : '▼ abrir'}</span>
      </button>

      {aberto && (
        <div className="mt-3 space-y-3">
          <div className="border border-border rounded-lg p-3 bg-surface-2/30 space-y-2">
            <div className="text-[11px] font-semibold text-ink">Endpoint</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] bg-surface-1 border border-border rounded px-2 py-1 text-accent break-all">
                POST {EDGE_EXTERNAL}
              </code>
              <CopyBtn text={EDGE_EXTERNAL} />
            </div>
            <div className="text-[10px] text-ink-muted">
              Headers: <code className="text-accent">x-api-key: bnd_xxx</code> · <code className="text-accent">content-type: application/json</code>
            </div>
            <details className="text-[10px]">
              <summary className="cursor-pointer text-accent hover:underline">Exemplo de payload</summary>
              <pre className="mt-1 bg-surface-1 border border-border rounded p-2 text-[9px] text-ink-muted overflow-x-auto">{JSON.stringify({
                campaign_name: 'Leads ReplyAgent 14/11',
                message_template: 'Olá {{nome}}, aqui é o {{vendedor}} da Branorte. Vi seu interesse...',
                external_ref: 'replyagent-batch-2026-11-14',
                distribution: { type: 'global' },
                contacts: [
                  { phone: '48999999999', name: 'João' },
                  { phone: '48988888888', name: 'Maria', vars: { produto: 'Ração 25kg' } },
                ],
              }, null, 2)}</pre>
              <div className="mt-1 text-ink-muted">
                <strong>distribution.type:</strong>{' '}
                <code>global</code> (usa % do painel acima) ·{' '}
                <code>igualitaria</code> ·{' '}
                <code>round_robin</code> ·{' '}
                <code>porcentagem</code> (com <code>weights: {`{ALVARO: 30, DANIEL: 70}`}</code>)
              </div>
            </details>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold text-ink">API Keys</div>
              <Button variant="primary" onClick={criarKey}>
                <Plus className="h-3 w-3 mr-1" /> Gerar nova chave
              </Button>
            </div>
            {(keys ?? []).length === 0 ? (
              <div className="text-[10px] text-ink-muted text-center py-3 border border-dashed border-border rounded">
                Nenhuma chave criada. Clique em "Gerar nova chave" pra começar.
              </div>
            ) : (
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-surface-2/60">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-ink-muted font-medium">Nome</th>
                      <th className="text-left px-3 py-1.5 text-ink-muted font-medium">Prefixo</th>
                      <th className="text-left px-3 py-1.5 text-ink-muted font-medium">Status</th>
                      <th className="text-left px-3 py-1.5 text-ink-muted font-medium">Chamadas</th>
                      <th className="text-left px-3 py-1.5 text-ink-muted font-medium">Último uso</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(keys ?? []).map(k => (
                      <tr key={k.id} className="border-t border-border/40">
                        <td className="px-3 py-1 text-ink">{k.nome}</td>
                        <td className="px-3 py-1 text-ink-muted font-mono text-[10px]">{k.key_prefix}</td>
                        <td className="px-3 py-1">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${k.ativa ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
                            {k.ativa ? 'ATIVA' : 'REVOGADA'}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-ink tabular-nums">{k.total_chamadas}</td>
                        <td className="px-3 py-1 text-ink-muted text-[10px]">
                          {k.ultima_uso_em ? new Date(k.ultima_uso_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                        <td className="px-2 py-1">
                          {k.ativa && (
                            <button onClick={() => revogarKey(k.id, k.nome)} className="text-ink-faint hover:text-red-400" title="Revogar">
                              <Trash className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-semibold text-ink mb-2">Últimas chamadas externas</div>
            {(logs ?? []).length === 0 ? (
              <div className="text-[10px] text-ink-muted text-center py-3 border border-dashed border-border rounded">
                Nenhuma chamada externa ainda.
              </div>
            ) : (
              <div className="border border-border rounded overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="bg-surface-2/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 text-ink-muted">Quando</th>
                      <th className="text-left px-2 py-1 text-ink-muted">Chave</th>
                      <th className="text-left px-2 py-1 text-ink-muted">Status</th>
                      <th className="text-left px-2 py-1 text-ink-muted">Contatos</th>
                      <th className="text-left px-2 py-1 text-ink-muted">Atribuídos</th>
                      <th className="text-left px-2 py-1 text-ink-muted">Dup.</th>
                      <th className="text-left px-2 py-1 text-ink-muted">Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(logs ?? []).map(l => (
                      <tr key={l.id} className="border-t border-border/40">
                        <td className="px-2 py-1 text-ink-muted">{new Date(l.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="px-2 py-1 text-ink">{l.api_key_nome ?? '—'}</td>
                        <td className="px-2 py-1">
                          <span className={`px-1 rounded ${l.status_code === 200 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                            {l.status_code}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-ink tabular-nums">{l.total_contatos ?? '—'}</td>
                        <td className="px-2 py-1 text-ink tabular-nums">{l.total_atribuidos ?? '—'}</td>
                        <td className="px-2 py-1 text-ink-muted tabular-nums">{l.total_duplicados ?? '—'}</td>
                        <td className="px-2 py-1 text-red-400 text-[9px] max-w-32 truncate">{l.erro ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal mostrando key recém-criada (única vez) */}
      {novaKey && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-surface-1 border border-accent rounded-xl max-w-lg w-full p-5 space-y-3">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Key className="h-5 w-5 text-accent" /> Chave gerada: {novaKey.nome}
            </h3>
            <div className="bg-amber-500/10 border border-amber-500/40 rounded p-2 text-[11px] text-amber-300">
              ⚠️ Esta é a única vez que essa chave será mostrada. Copie e guarde agora em local seguro.
            </div>
            <div className="bg-surface-2 border border-border rounded p-2 font-mono text-[11px] text-accent break-all">
              {novaKey.key}
            </div>
            <div className="flex gap-2">
              <CopyBtn text={novaKey.key} label="Copiar chave" big />
              <Button variant="secondary" onClick={() => setNovaKey(null)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function CopyBtn({ text, label, big }: { text: string; label?: string; big?: boolean }) {
  const [copiou, setCopiou] = useState(false)
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopiou(true)
        setTimeout(() => setCopiou(false), 1500)
      }}
      className={`${big ? 'px-3 py-2 text-[12px]' : 'px-2 py-1 text-[10px]'} rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-1`}
    >
      {copiou ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {label ?? (copiou ? 'Copiado' : 'Copiar')}
    </button>
  )
}
