import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Users, AlertCircle, Activity } from 'lucide-react'

type Vendedor = {
  vendedor_nome: string
  online: boolean
  bloqueado: boolean
  share_percent: number
  max_per_hour: number
  enviados_hoje: number
  enviados_ultima_hora: number
  ultimo_envio_em: string | null
}

export function Disparos() {
  const { profile } = useAuth()
  const qc = useQueryClient()

  // Vendedores status
  const { data: vendedores, isLoading: loadingV } = useQuery<Vendedor[]>({
    queryKey: ['vendor-dispatch-status'],
    queryFn: async () => {
      const { data } = await supabase.from('vendor_dispatch_status').select('*').order('vendedor_nome')
      return data || []
    },
    refetchInterval: 10000,
  })

  // Heartbeat da extensão por vendedor (só pra saber se está online/com WA aberto).
  // Não dispara nada — é só sinal de disponibilidade pra roteamento.
  type Runtime = { ts: string; versao: string; semWa: boolean; heartbeatOnly: boolean; wppReady: boolean; semChatsHaTempo: boolean }
  const { data: vendorRuntime } = useQuery<Record<string, Runtime>>({
    queryKey: ['vendor-runtime'],
    queryFn: async () => {
      const { data } = await supabase
        .from('wa_sync_debug')
        .select('vendedor_nome, recebido_em, client_version, diag, etiquetas_count, total_chats')
        .gte('recebido_em', new Date(Date.now() - 30 * 60_000).toISOString())
        .order('recebido_em', { ascending: false })
        .limit(500)
      const pingsRecentes: Record<string, { total: number; comDados: number }> = {}
      const cincoMinAtras = Date.now() - 5 * 60_000
      for (const row of (data || []) as any[]) {
        if (new Date(row.recebido_em).getTime() < cincoMinAtras) continue
        const r = pingsRecentes[row.vendedor_nome] ?? { total: 0, comDados: 0 }
        r.total += 1
        if ((row.etiquetas_count ?? 0) > 0 || (row.total_chats ?? 0) > 0) r.comDados += 1
        pingsRecentes[row.vendedor_nome] = r
      }
      const mapa: Record<string, Runtime> = {}
      for (const row of (data || []) as any[]) {
        if (!mapa[row.vendedor_nome]) {
          const heartbeatOnly = !!row.diag?.heartbeat_only
          const wppReady = row.diag?.wpp_ready === true
            || (!heartbeatOnly && ((row.etiquetas_count ?? 0) > 0 || (row.total_chats ?? 0) > 0))
          const pr = pingsRecentes[row.vendedor_nome] ?? { total: 0, comDados: 0 }
          const semChatsHaTempo = pr.total >= 5 && pr.comDados === 0
          mapa[row.vendedor_nome] = {
            ts: row.recebido_em,
            versao: row.client_version ?? '?',
            semWa: !!row.diag?.sem_wa_aberto,
            heartbeatOnly,
            wppReady,
            semChatsHaTempo,
          }
        }
      }
      return mapa
    },
    refetchInterval: 5000,
  })

  // Status consolidado por vendedor (apenas disponibilidade pra receber lead — não envia nada).
  type StatusVendedor = 'desligado' | 'ativo' | 'aguardando' | 'wa_fechado' | 'verificar_wa' | 'lento' | 'desconectado' | 'versao_antiga'
  function statusVendedor(v: Vendedor): { status: StatusVendedor; pingSec: number | null; versao: string | null } {
    const runtime = vendorRuntime?.[v.vendedor_nome]
    if (!v.online) return { status: 'desligado', pingSec: null, versao: runtime?.versao ?? null }
    if (!runtime) return { status: 'desconectado', pingSec: null, versao: null }
    const sec = (Date.now() - new Date(runtime.ts).getTime()) / 1000
    const [maj, min] = (runtime.versao || '0.0').split('.').map(n => parseInt(n, 10) || 0)
    const versaoOk = maj > 1 || (maj === 1 && min >= 1)
    if (!versaoOk) return { status: 'versao_antiga', pingSec: sec, versao: runtime.versao }
    if (sec >= 900) return { status: 'desconectado', pingSec: sec, versao: runtime.versao }
    if (sec >= 180) return { status: 'lento', pingSec: sec, versao: runtime.versao }
    if (runtime.semWa) return { status: 'wa_fechado', pingSec: sec, versao: runtime.versao }
    if (runtime.semChatsHaTempo) return { status: 'verificar_wa', pingSec: sec, versao: runtime.versao }
    if (runtime.wppReady) return { status: 'ativo', pingSec: sec, versao: runtime.versao }
    if (runtime.heartbeatOnly) return { status: 'aguardando', pingSec: sec, versao: runtime.versao }
    return { status: 'ativo', pingSec: sec, versao: runtime.versao }
  }

  function tempoRelativo(sec: number | null): string {
    if (sec === null) return 'sem sinal'
    if (sec < 60) return `há ${Math.round(sec)}s`
    if (sec < 3600) return `há ${Math.round(sec / 60)}min`
    return `há ${Math.round(sec / 3600)}h`
  }

  // Toggle vendedor online — controla se ele entra no rodízio de leads
  const toggleVendedor = useMutation({
    mutationFn: async ({ nome, online }: { nome: string; online: boolean }) => {
      await supabase.from('vendor_dispatch_status').update({ online }).eq('vendedor_nome', nome)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] }),
  })

  // Toggle vendedor bloqueado — fica visível mas não recebe leads
  const toggleBloqueado = useMutation({
    mutationFn: async ({ nome, bloqueado }: { nome: string; bloqueado: boolean }) => {
      const upd: any = { bloqueado }
      if (bloqueado) upd.share_percent = 0
      const { error } = await supabase.from('vendor_dispatch_status').update(upd).eq('vendedor_nome', nome)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] }),
    onError: (err: any) => {
      alert('Não foi possível bloquear/desbloquear: ' + (err?.message || err))
    },
  })

  if (!profile) return <PageLoading />
  if (profile.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="h-12 w-12 text-warning mx-auto mb-2" />
        <h2 className="text-xl font-bold text-ink">Acesso restrito</h2>
        <p className="text-ink-muted">Apenas administradores podem usar a Central de Roteamento.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <GitBranch className="h-6 w-6 text-accent" /> Central de Roteamento
        </h1>
        <p className="text-ink-muted text-sm">
          Define qual vendedor atende cada lead que cai na central. O envio da mensagem inicial fica por conta do ReplyAgent — esta página não dispara mensagens pela extensão dos vendedores.
        </p>
      </header>

      {/* PAINEL VENDEDORES */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            Vendedores
            <span className="text-ink-faint font-normal text-[11px]">
              · {(vendedores ?? []).filter(v => statusVendedor(v).status === 'ativo').length} ativo{(vendedores ?? []).filter(v => statusVendedor(v).status === 'ativo').length === 1 ? '' : 's'} de {(vendedores ?? []).length}
            </span>
          </h2>
          <div className="flex gap-2.5 text-[10px] text-ink-muted flex-wrap">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ativo</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> aguardando WA</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-orange-400" /> WA fechado / verificar</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> lento</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" /> desconectado</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> desligado</span>
          </div>
        </div>
        {loadingV ? <PageLoading /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {(vendedores ?? []).map(v => {
              const st = statusVendedor(v)
              const stCfg = {
                ativo:         { cor: 'border-emerald-500/40 bg-emerald-500/5',  dot: 'bg-emerald-400', txt: 'text-emerald-300', label: 'ATIVO',         hint: 'Disponível para receber leads' },
                aguardando:    { cor: 'border-cyan-500/40 bg-cyan-500/5',        dot: 'bg-cyan-400',    txt: 'text-cyan-300',    label: 'AGUARDANDO WA', hint: 'Chrome ok, mas WA Web ainda carregando — peça pra abrir e logar' },
                wa_fechado:    { cor: 'border-orange-500/40 bg-orange-500/5',    dot: 'bg-orange-400',  txt: 'text-orange-300',  label: 'WA FECHADO',    hint: 'Extensão viva mas WhatsApp Web foi fechado — peça pra abrir web.whatsapp.com' },
                verificar_wa:  { cor: 'border-orange-500/40 bg-orange-500/5',    dot: 'bg-orange-400',  txt: 'text-orange-300',  label: 'VERIFICAR WA',  hint: 'Extensão viva, mas WhatsApp Web retorna 0 chats há vários minutos. Provavelmente deslogado — peça pra ele abrir web.whatsapp.com e escanear o QR code.' },
                lento:         { cor: 'border-amber-500/40 bg-amber-500/5',      dot: 'bg-amber-400',   txt: 'text-amber-300',   label: 'LENTO',         hint: 'WA aberto mas resposta atrasada' },
                versao_antiga: { cor: 'border-amber-500/40 bg-amber-500/5',      dot: 'bg-amber-400',   txt: 'text-amber-300',   label: 'RECARREGAR',    hint: 'Versão antiga — recarregar Chrome' },
                desconectado:  { cor: 'border-red-500/30 bg-red-500/5',          dot: 'bg-red-400',     txt: 'text-red-300',     label: 'DESCONECTADO', hint: 'Sem ping recente — Chrome fechado ou PC dormindo' },
                desligado:     { cor: 'border-border bg-surface-2/30',           dot: 'bg-slate-500',   txt: 'text-slate-400',   label: 'DESLIGADO',     hint: 'Admin desligou no painel — não recebe leads' },
              }[st.status]
              return (
              <div key={v.vendedor_nome} className={`border rounded-xl p-3 transition-all ${stCfg.cor}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={v.vendedor_nome} size="sm" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-ink truncate">{v.vendedor_nome}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className={`h-1.5 w-1.5 rounded-full ${stCfg.dot} ${st.status === 'ativo' ? 'animate-pulse' : ''}`} />
                        <span className={`text-[9px] font-bold tracking-wider ${stCfg.txt}`} title={stCfg.hint}>
                          {stCfg.label}
                        </span>
                        <span className="text-[9px] text-ink-faint">· {tempoRelativo(st.pingSec)}</span>
                        {st.versao && (
                          <span className="text-[9px] text-ink-faint">· v{st.versao}</span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-ink-muted">
                        fatia: <span className="text-ink font-semibold tabular-nums">{Number(v.share_percent).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleVendedor.mutate({ nome: v.vendedor_nome, online: !v.online })}
                    title={v.online ? 'Clique pra desligar (sai do rodízio)' : 'Clique pra ligar (entra no rodízio)'}
                    className={`text-[9px] px-2 py-1 rounded-full font-bold tracking-wide transition-all flex-shrink-0 ${
                      v.online ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50'
                    }`}
                  >
                    {v.online ? '◉ LIGADO' : '○ DESLIG.'}
                  </button>
                </div>
              </div>
            )})}
          </div>
        )}
      </Card>

      {/* DISTRIBUIÇÃO GLOBAL (% padrão) */}
      <DistribuicaoGlobalCard
        vendedores={vendedores ?? []}
        onToggleBloqueado={(nome, bloqueado) => toggleBloqueado.mutate({ nome, bloqueado })}
      />
    </div>
  )
}

// ============================================================================
// DistribuicaoGlobalCard — painel de % global de roteamento
// ============================================================================
function DistribuicaoGlobalCard({ vendedores, onToggleBloqueado }: { vendedores: Vendedor[]; onToggleBloqueado: (nome: string, bloqueado: boolean) => void }) {
  const qc = useQueryClient()
  // Todos os online (mesmo bloqueados aparecem na lista pra dar opção de desbloquear)
  const online = useMemo(() => vendedores.filter(v => v.online), [vendedores])
  const ativos = useMemo(() => online.filter(v => !v.bloqueado), [online])
  const [local, setLocal] = useState<Record<string, number>>({})
  useEffect(() => {
    const novo: Record<string, number> = {}
    for (const v of online) novo[v.vendedor_nome] = Number(v.share_percent) || 0
    setLocal(novo)
  }, [online.map(v => `${v.vendedor_nome}:${v.share_percent}`).join('|')])

  const soma = useMemo(() => Object.values(local).reduce((s, n) => s + (Number(n) || 0), 0), [local])
  const proximoDe100 = soma >= 99.5 && soma <= 100.5
  const cores = ['bg-emerald-500', 'bg-cyan-500', 'bg-purple-500', 'bg-amber-500', 'bg-blue-500', 'bg-pink-500', 'bg-orange-500', 'bg-rose-500', 'bg-teal-500']

  async function persistirUm(nome: string, valor: number) {
    const { error } = await supabase.from('vendor_dispatch_status').update({ share_percent: valor }).eq('vendedor_nome', nome)
    if (error) {
      alert('Não foi possível salvar % do ' + nome + ': ' + error.message)
      return
    }
    qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] })
  }
  async function persistirTodos(novo: Record<string, number>) {
    const results = await Promise.all(Object.entries(novo).map(([nome, p]) =>
      supabase.from('vendor_dispatch_status').update({ share_percent: p }).eq('vendedor_nome', nome)
    ))
    const erros = results.filter(r => r.error).map(r => r.error?.message)
    if (erros.length > 0) {
      alert('Erro ao salvar pesos: ' + erros[0])
    }
    qc.invalidateQueries({ queryKey: ['vendor-dispatch-status'] })
  }

  function igualar() {
    if (ativos.length === 0) return
    const each = Math.round((100 / ativos.length) * 100) / 100
    const novo: Record<string, number> = {}
    for (const v of online) novo[v.vendedor_nome] = v.bloqueado ? 0 : each
    setLocal(novo)
    persistirTodos(novo)
  }
  function normalizar() {
    if (soma <= 0) return igualar()
    const fator = 100 / soma
    const novo: Record<string, number> = {}
    for (const [k, val] of Object.entries(local)) novo[k] = Math.round((Number(val) || 0) * fator * 100) / 100
    setLocal(novo)
    persistirTodos(novo)
  }
  function zerar() {
    const novo: Record<string, number> = {}
    for (const v of online) novo[v.vendedor_nome] = 0
    setLocal(novo)
    persistirTodos(novo)
  }
  function ajustar(nome: string, delta: number) {
    const atual = Number(local[nome] ?? 0)
    const novo = Math.max(0, Math.min(100, atual + delta))
    setLocal({ ...local, [nome]: novo })
    persistirUm(nome, novo)
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" />
            Quanto cada vendedor recebe
          </h2>
          <p className="text-[10px] text-ink-muted mt-0.5">
            Define a fatia de leads que cada vendedor recebe quando um lead chega na central. Vale para chamadas do ReplyAgent / n8n que não enviam pesos próprios.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`text-[12px] font-bold tabular-nums px-2 py-1 rounded ${proximoDe100 ? 'bg-emerald-500/15 text-emerald-300' : soma > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-surface-2 text-ink-faint'}`}>
            soma: {soma.toFixed(0)}%{proximoDe100 ? ' ✓' : ''}
          </div>
          <button onClick={igualar} className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 font-medium">
            Dividir igualmente
          </button>
          <button onClick={normalizar} disabled={soma <= 0} className="text-[10px] px-2 py-1 rounded bg-surface-2 text-ink border border-border hover:bg-surface-3 disabled:opacity-40">
            Ajustar p/ 100%
          </button>
          <button onClick={zerar} className="text-[10px] px-2 py-1 rounded bg-surface-2 text-ink-muted border border-border hover:bg-red-500/10 hover:text-red-300">
            Zerar tudo
          </button>
        </div>
      </div>

      {/* Barra de proporção visual */}
      {soma > 0 ? (
        <div className="flex h-6 rounded-lg overflow-hidden border border-border bg-surface-2 mb-3">
          {online.filter(v => Number(local[v.vendedor_nome] ?? 0) > 0).map((v, i) => {
            const pct = (Number(local[v.vendedor_nome] ?? 0) / soma) * 100
            return (
              <div
                key={v.vendedor_nome}
                className={`${cores[i % cores.length]} flex items-center justify-center text-[10px] font-bold text-black/80 transition-all`}
                style={{ width: `${pct}%` }}
                title={`${v.vendedor_nome}: ${pct.toFixed(1)}%`}
              >
                {pct >= 6 ? v.vendedor_nome.substring(0, Math.max(2, Math.floor(pct / 4))) : ''}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-6 rounded-lg border border-dashed border-border bg-surface-2/40 mb-3 flex items-center justify-center text-[10px] text-ink-faint">
          Sem distribuição definida — clique em "Dividir igualmente" pra começar
        </div>
      )}

      {/* Sliders por vendedor */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {online.map((v, i) => {
          const valor = Number(local[v.vendedor_nome] ?? 0)
          const cor = cores[i % cores.length]
          const corAccent = cor.replace('bg-', 'accent-')
          const bloq = v.bloqueado
          return (
            <div key={v.vendedor_nome} className={`border rounded-lg p-3 transition-colors ${
              bloq ? 'border-red-500/30 bg-red-500/5 opacity-75' :
              valor > 0 ? 'border-accent/30 bg-surface-2/50' : 'border-border bg-surface-2/50'
            }`}>
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className={`h-2.5 w-2.5 rounded-full ${bloq ? 'bg-red-500/50' : cor} flex-shrink-0`} />
                  <span className={`text-[12px] font-bold truncate ${bloq ? 'text-ink-muted line-through' : 'text-ink'}`}>{v.vendedor_nome}</span>
                  {bloq && <span className="text-[8px] px-1 py-0.5 bg-red-500/20 text-red-300 rounded font-bold flex-shrink-0">BLOQUEADO</span>}
                </div>
                <button
                  onClick={() => onToggleBloqueado(v.vendedor_nome, !bloq)}
                  title={bloq ? 'Desbloquear — voltar a receber leads' : 'Bloquear — não receber mais leads (será ignorado em Dividir igualmente e no roteamento)'}
                  className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide flex-shrink-0 transition-colors ${
                    bloq
                      ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30'
                      : 'bg-slate-800 text-ink-muted hover:bg-red-500/20 hover:text-red-300 border border-slate-700'
                  }`}
                >
                  {bloq ? '✓ DESBLOQUEAR' : '✕ BLOQUEAR'}
                </button>
              </div>

              {!bloq && (
                <>
                  <div className="flex items-center justify-end gap-1 mb-2">
                    <button
                      onClick={() => ajustar(v.vendedor_nome, -5)}
                      className="w-6 h-6 rounded bg-slate-900 border border-slate-700 text-ink hover:bg-red-500/30 hover:text-red-200 hover:border-red-500/50 text-[14px] font-bold leading-none flex items-center justify-center transition-colors"
                      title="-5%"
                    >−</button>
                    <input
                      type="number" min={0} max={100} step="1"
                      value={valor === 0 ? '' : valor}
                      onChange={e => setLocal({ ...local, [v.vendedor_nome]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                      onBlur={() => persistirUm(v.vendedor_nome, valor)}
                      placeholder="0"
                      className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-[14px] font-bold tabular-nums text-center focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-[11px] text-ink-muted font-semibold">%</span>
                    <button
                      onClick={() => ajustar(v.vendedor_nome, 5)}
                      className="w-6 h-6 rounded bg-slate-900 border border-slate-700 text-ink hover:bg-emerald-500/30 hover:text-emerald-200 hover:border-emerald-500/50 text-[14px] font-bold leading-none flex items-center justify-center transition-colors"
                      title="+5%"
                    >+</button>
                  </div>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={valor}
                    onChange={e => setLocal({ ...local, [v.vendedor_nome]: Number(e.target.value) })}
                    onMouseUp={() => persistirUm(v.vendedor_nome, valor)}
                    onTouchEnd={() => persistirUm(v.vendedor_nome, valor)}
                    className={`w-full h-1.5 ${corAccent} cursor-pointer`}
                  />
                  <div className="text-[10px] text-ink-faint mt-1.5 min-h-[14px]">
                    {soma > 0 && valor > 0
                      ? <>recebe <span className="text-ink font-semibold">{Math.round((valor / soma) * 100)}</span> de cada 100 leads</>
                      : valor === 0 ? <span className="text-ink-faint/50">— não recebe leads —</span> : null}
                  </div>
                </>
              )}
              {bloq && (
                <div className="text-[10px] text-red-300/70 italic mt-1">
                  Não recebe leads. Leads que cairiam aqui vão para outro vendedor disponível, com anotação no histórico.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
