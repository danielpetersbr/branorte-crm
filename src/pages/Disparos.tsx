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
import { Send, Play, Pause, Trash2, Plus, Users, Clock, AlertCircle, CheckCircle2, XCircle, RefreshCw, FlaskConical, Zap, Wifi, WifiOff } from 'lucide-react'

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
  const { data: vendorRuntime } = useQuery<Record<string, { ts: string; versao: string }>>({
    queryKey: ['vendor-runtime'],
    queryFn: async () => {
      const { data } = await supabase
        .from('wa_sync_debug')
        .select('vendedor_nome, recebido_em, client_version')
        .gte('recebido_em', new Date(Date.now() - 5 * 60_000).toISOString())
        .order('recebido_em', { ascending: false })
        .limit(300)
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
  function isWaAberto(vendedor: string): boolean {
    const ts = vendorRuntime?.[vendedor]?.ts
    if (!ts) return false
    return Date.now() - new Date(ts).getTime() < 90_000
  }
  function temDispatch(vendedor: string): boolean {
    // Dispatch só existe a partir de v1.1.0
    const v = vendorRuntime?.[vendedor]?.versao
    if (!v) return false
    const [maj, min] = v.split('.').map(n => parseInt(n, 10) || 0)
    return maj > 1 || (maj === 1 && min >= 1)
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
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          Vendedores · ligue/desligue + ajuste %
        </h2>
        {loadingV ? <PageLoading /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {(vendedores ?? []).map(v => {
              const waAberto = isWaAberto(v.vendedor_nome)
              const dispatchOk = temDispatch(v.vendedor_nome)
              const versao = vendorRuntime?.[v.vendedor_nome]?.versao
              return (
              <div key={v.vendedor_nome} className={`border rounded-lg p-3 ${v.online ? 'border-accent/40 bg-accent/5' : 'border-border bg-surface-2/30'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={v.vendedor_nome} size="sm" />
                    <span className="text-[12px] font-semibold text-ink">{v.vendedor_nome}</span>
                    <span title={waAberto ? 'WhatsApp Web aberto' : 'WhatsApp Web fechado'}>
                      {waAberto
                        ? <Wifi className="h-3 w-3 text-emerald-400" />
                        : <WifiOff className="h-3 w-3 text-red-400" />}
                    </span>
                    {versao && (
                      <span className={`text-[9px] px-1 rounded ${dispatchOk ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`} title={dispatchOk ? 'Versão suporta disparo' : 'Versão antiga sem disparo — recarregar Chrome'}>
                        v{versao}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => toggleVendedor.mutate({ nome: v.vendedor_nome, online: !v.online })}
                    className={`text-[10px] px-2 py-1 rounded-full font-bold tracking-wide ${v.online ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}
                  >
                    {v.online ? '● ONLINE' : '○ OFFLINE'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
                  <div>
                    <div className="text-ink-faint uppercase tracking-wider">Hoje</div>
                    <div className="text-ink font-bold text-[13px]">{v.enviados_hoje}</div>
                  </div>
                  <div>
                    <div className="text-ink-faint uppercase tracking-wider">Última h</div>
                    <div className="text-ink font-bold text-[13px]">{v.enviados_ultima_hora}/{v.max_per_hour}</div>
                  </div>
                  <div>
                    <label className="text-ink-faint uppercase tracking-wider">% share</label>
                    <input
                      type="number" min={0} max={100} defaultValue={v.share_percent}
                      onBlur={e => setShare.mutate({ nome: v.vendedor_nome, percent: Number(e.target.value) || 0 })}
                      className="w-full bg-surface-2 border border-border rounded px-1.5 py-0.5 text-ink text-[12px] font-bold"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setTesteVendedor(v.vendedor_nome)}
                  disabled={!waAberto || !dispatchOk}
                  className="w-full text-[10px] py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                  title={!waAberto ? 'WhatsApp Web do vendedor fechado' : !dispatchOk ? `Versão ${versao || 'antiga'} sem disparo — pedir pra recarregar Chrome` : 'Disparar 1 mensagem-teste deste vendedor'}
                >
                  <FlaskConical className="h-3 w-3" />
                  {!dispatchOk ? 'recarregar Chrome' : !waAberto ? 'WA fechado' : 'Testar comigo'}
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
            onCancel={() => setNovaCampForm(false)}
            onCreated={(id) => {
              setNovaCampForm(false)
              setCampSelecionada(id)
              qc.invalidateQueries({ queryKey: ['dispatch-campaigns'] })
            }}
          />
        </Card>
      )}

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
function NovaCampanhaForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [nome, setNome] = useState('')
  const [mensagem, setMensagem] = useState('Olá {{nome}}, aqui é o {{vendedor}} da Branorte. Tudo bem?')
  const [regra, setRegra] = useState<'igualitaria' | 'round_robin' | 'porcentagem' | 'manual'>('igualitaria')
  const [rate, setRate] = useState(30)
  const [hi, setHi] = useState('08:00')
  const [hf, setHf] = useState('18:00')
  const [salvando, setSalvando] = useState(false)

  async function criar() {
    if (!nome.trim() || !mensagem.trim()) return alert('preencha nome e mensagem')
    setSalvando(true)
    const { data, error } = await supabase.from('dispatch_campaign').insert({
      nome: nome.trim(),
      mensagem_template: mensagem.trim(),
      regra_distribuicao: regra,
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
              { value: 'igualitaria',  label: 'Igualitária' },
              { value: 'round_robin',  label: 'Round-robin' },
              { value: 'porcentagem',  label: '% por vendedor' },
              { value: 'manual',       label: 'Manual' },
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
      <div className="flex gap-2">
        <Button variant="primary" onClick={criar} loading={salvando}>Criar campanha</Button>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
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
