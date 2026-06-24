// /transportadora — Portal das transportadoras (fora do app do staff).
// Fluxo: cadastro próprio (email/senha + estados que atende) → aguarda aprovação
// da Branorte → vê as cotações dos estados dela e responde com valor (+ anexo).
// Roda com auth própria (Supabase), interceptada antes do gating do app interno.
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Truck, Loader2, LogOut, Paperclip, MapPin, Package, CheckCircle2, AlertTriangle, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { UFS_BR, useTranspMinhaConta, useTranspCotacoes, useTranspResponder, useTranspMarcarAnalisando, type TranspCotacao, type TranspConta } from '@/hooks/useFrete'

function fmtMoeda(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-border bg-surface-1/90 backdrop-blur">
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-accent/10 flex items-center justify-center"><Truck className="h-4 w-4 text-accent" /></div>
          <span className="font-semibold">Branorte</span>
          <span className="text-ink-faint text-sm">· Portal de Fretes</span>
        </div>
      </header>
      {children}
    </div>
  )
}

function Splash() {
  return <Shell><div className="flex items-center justify-center py-32 text-ink-faint"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>
}

function EstadosPicker({ estados, setEstados }: { estados: string[]; setEstados: (e: string[]) => void }) {
  const toggle = (uf: string) => setEstados(estados.includes(uf) ? estados.filter(x => x !== uf) : [...estados, uf])
  return (
    <div>
      <label className="text-xs text-ink-faint block mb-1">Estados que você atende <span className="text-red-500">*</span></label>
      <div className="grid grid-cols-6 sm:grid-cols-9 gap-1.5">
        {UFS_BR.map(uf => (
          <button type="button" key={uf} onClick={() => toggle(uf)}
            className={`py-1.5 rounded-md text-xs font-medium border transition-colors ${estados.includes(uf) ? 'bg-accent text-white border-accent' : 'bg-bg text-ink-muted border-border hover:border-accent'}`}>
            {uf}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Auth (entrar / criar conta) ----------
function AuthView() {
  const [modo, setModo] = useState<'entrar' | 'cadastro'>('entrar')
  const [email, setEmail] = useState(''); const [senha, setSenha] = useState('')
  const [nome, setNome] = useState(''); const [cnpj, setCnpj] = useState(''); const [tel, setTel] = useState('')
  const [estados, setEstados] = useState<string[]>([])
  const [erro, setErro] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)

  async function entrar() {
    setErro(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setBusy(false)
    if (error) setErro(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos.' : error.message)
  }
  async function cadastrar() {
    setErro(''); setMsg('')
    if (!nome.trim()) { setErro('Informe o nome da transportadora.'); return }
    if (!email.trim() || senha.length < 6) { setErro('Email válido e senha de 6+ caracteres.'); return }
    if (estados.length === 0) { setErro('Selecione ao menos um estado que você atende.'); return }
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password: senha,
      options: { data: { transp_nome: nome.trim(), transp_cnpj: cnpj.trim() || null, transp_telefone: tel.trim() || null, transp_estados: estados } },
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    if (!data.session) setMsg('Cadastro criado! Confirme seu email e depois entre aqui pra continuar.')
    // se já veio sessão, o TransportadoraApp cria a conta automaticamente.
  }

  return (
    <Shell>
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-surface-1 border border-border rounded-2xl p-6">
          <h1 className="text-lg font-bold text-ink mb-1">{modo === 'entrar' ? 'Entrar' : 'Criar conta da transportadora'}</h1>
          <p className="text-sm text-ink-muted mb-4">{modo === 'entrar' ? 'Acesse pra ver e responder as cotações dos seus estados.' : 'Cadastre-se pra receber as cotações de frete da Branorte nos estados que você atende.'}</p>

          <div className="space-y-3">
            {modo === 'cadastro' && (
              <>
                <div><label className="text-xs text-ink-faint block mb-1">Nome da transportadora <span className="text-red-500">*</span></label>
                  <input value={nome} onChange={e => setNome(e.target.value)} className={inputCls} placeholder="Ex: Transportes Silva" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-ink-faint block mb-1">CNPJ</label>
                    <input value={cnpj} onChange={e => setCnpj(e.target.value)} className={inputCls} placeholder="opcional" /></div>
                  <div><label className="text-xs text-ink-faint block mb-1">WhatsApp / telefone</label>
                    <input value={tel} onChange={e => setTel(e.target.value)} className={inputCls} placeholder="opcional" /></div>
                </div>
                <EstadosPicker estados={estados} setEstados={setEstados} />
              </>
            )}
            <div><label className="text-xs text-ink-faint block mb-1">Email <span className="text-red-500">*</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Senha <span className="text-red-500">*</span></label>
              <input type="password" value={senha} onChange={e => setSenha(e.target.value)} className={inputCls} placeholder={modo === 'cadastro' ? 'mínimo 6 caracteres' : ''} /></div>

            {erro && <p className="text-sm text-red-500">{erro}</p>}
            {msg && <p className="text-sm text-accent">{msg}</p>}

            <button onClick={modo === 'entrar' ? entrar : cadastrar} disabled={busy}
              className="w-full py-2.5 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{modo === 'entrar' ? 'Entrar' : 'Criar conta'}
            </button>
          </div>

          <button onClick={() => { setModo(modo === 'entrar' ? 'cadastro' : 'entrar'); setErro(''); setMsg('') }}
            className="mt-4 text-sm text-accent hover:underline w-full text-center">
            {modo === 'entrar' ? 'Não tem conta? Cadastre sua transportadora' : 'Já tenho conta — entrar'}
          </button>
        </div>
      </div>
    </Shell>
  )
}

// ---------- Completar cadastro (logado mas sem conta) ----------
function CompletarCadastro({ onDone }: { onDone: () => void }) {
  const [nome, setNome] = useState(''); const [cnpj, setCnpj] = useState(''); const [tel, setTel] = useState('')
  const [estados, setEstados] = useState<string[]>([]); const [erro, setErro] = useState(''); const [busy, setBusy] = useState(false)
  async function salvar() {
    setErro('')
    if (!nome.trim()) { setErro('Informe o nome.'); return }
    if (estados.length === 0) { setErro('Selecione ao menos um estado.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await (supabase as any).from('frete_transportadora_contas').insert({
      user_id: user?.id, nome: nome.trim(), cnpj: cnpj.trim() || null, telefone: tel.trim() || null, email: user?.email ?? null, estados,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    onDone()
  }
  return (
    <Shell>
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-surface-1 border border-border rounded-2xl p-6 space-y-3">
          <h1 className="text-lg font-bold text-ink">Complete seu cadastro</h1>
          <div><label className="text-xs text-ink-faint block mb-1">Nome da transportadora <span className="text-red-500">*</span></label>
            <input value={nome} onChange={e => setNome(e.target.value)} className={inputCls} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-ink-faint block mb-1">CNPJ</label><input value={cnpj} onChange={e => setCnpj(e.target.value)} className={inputCls} /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Telefone</label><input value={tel} onChange={e => setTel(e.target.value)} className={inputCls} /></div>
          </div>
          <EstadosPicker estados={estados} setEstados={setEstados} />
          {erro && <p className="text-sm text-red-500">{erro}</p>}
          <button onClick={salvar} disabled={busy} className="w-full py-2.5 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-60">{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </Shell>
  )
}

// ---------- Aguardando aprovação ----------
function Aguardando({ conta, onLogout }: { conta: TranspConta; onLogout: () => void }) {
  return (
    <Shell>
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="h-14 w-14 rounded-full bg-amber-500/15 mx-auto flex items-center justify-center mb-4"><Loader2 className="h-7 w-7 text-amber-500 animate-spin" /></div>
        <h1 className="text-lg font-bold text-ink mb-1">Cadastro em análise</h1>
        <p className="text-sm text-ink-muted">Olá, <b className="text-ink">{conta.nome}</b>. Seu cadastro foi recebido e está aguardando a aprovação da Branorte. Assim que liberarem, você verá as cotações dos estados: <b className="text-ink">{conta.estados.join(', ') || '—'}</b>.</p>
        <button onClick={onLogout} className="mt-6 text-sm text-ink-muted hover:text-ink inline-flex items-center gap-1"><LogOut className="h-4 w-4" /> Sair</button>
      </div>
    </Shell>
  )
}

// ---------- Portal (cotações + responder) ----------
function Portal({ conta, onLogout }: { conta: TranspConta; onLogout: () => void }) {
  const cot = useTranspCotacoes(true)
  const lista = cot.data ?? []
  return (
    <Shell>
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
        <div className="flex items-end justify-between gap-3 mb-5 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-ink">Cotações abertas</h1>
            <p className="text-sm text-ink-muted mt-0.5">{conta.nome} · atende <span className="text-ink font-medium">{conta.estados.join(', ') || '—'}</span></p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-muted tabular-nums">{lista.length} aberta{lista.length === 1 ? '' : 's'}</span>
            <button onClick={onLogout} className="text-sm text-ink-muted hover:text-ink inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-border-strong"><LogOut className="h-4 w-4" /> Sair</button>
          </div>
        </div>

        {cot.isLoading && <div className="py-20 text-center text-ink-faint"><Loader2 className="h-6 w-6 animate-spin inline" /></div>}
        {!cot.isLoading && lista.length === 0 && (
          <div className="border border-dashed border-border rounded-2xl p-16 text-center text-sm text-ink-faint">
            Nenhuma cotação aberta nos seus estados agora.<br />Assim que a Branorte abrir um frete pra {conta.estados.join('/') || 'seus estados'}, aparece aqui.
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
          {lista.map(c => <CotacaoCard key={c.id} c={c} />)}
        </div>
      </div>
    </Shell>
  )
}

function CotacaoCard({ c }: { c: TranspCotacao }) {
  const responder = useTranspResponder()
  const marcar = useTranspMarcarAnalisando()
  const [aberto, setAberto] = useState(false)
  const [valor, setValor] = useState(c.meu_valor != null ? String(c.meu_valor) : '')
  const [prazo, setPrazo] = useState(c.meu_prazo_dias != null ? String(c.meu_prazo_dias) : '')
  const [obs, setObs] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [erro, setErro] = useState(''); const [ok, setOk] = useState(false)
  const [zoom, setZoom] = useState(false)
  const itensTxt = (c.equipamentos_itens ?? []).map(i => `${i.qtd && i.qtd > 1 ? i.qtd + '× ' : ''}${i.nome}`).join(', ')
  const carregar = c.tipo_cotacao === 'carregar'
  const foto = (c.equipamentos_itens ?? []).find(i => i.foto_url)?.foto_url ?? null

  async function enviar() {
    setErro('')
    const v = Number(String(valor).replace(',', '.'))
    if (!v || v <= 0) { setErro('O valor do frete é obrigatório.'); return }
    const p = Number(prazo)
    if (!prazo || !Number.isFinite(p) || p <= 0) { setErro('O prazo de entrega (dias) é obrigatório.'); return }
    try {
      await responder.mutateAsync({ solicitacao_id: c.id, valor: v, prazo_dias: p, observacoes: obs.trim() || null, file })
      setOk(true); setAberto(false)
    } catch (e: any) {
      setErro('Não consegui enviar: ' + (e?.message ?? e))
    }
  }

  return (
    <div className={`flex flex-col bg-surface-1 border rounded-2xl p-4 sm:p-5 transition-shadow hover:shadow-sm ${carregar || c.urgente ? 'border-red-500/40' : 'border-border'}`}>
      {/* topo: código + selos + valor respondido */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-[11px] font-mono text-ink-faint">{c.codigo}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${carregar ? 'bg-red-500/15 text-red-500' : 'bg-accent/15 text-accent'}`}>{carregar ? 'PRA CARREGAR' : 'Cotação'}</span>
          {c.urgente && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-500/15 text-red-500">⚠ URGENTE</span>}
        </div>
        {c.meu_valor != null && (
          <div className="text-right shrink-0">
            <div className="text-[9px] text-ink-faint uppercase tracking-wider">você respondeu</div>
            <div className="font-bold text-accent leading-tight">{fmtMoeda(c.meu_valor)}</div>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-2">
        {foto && (
          <button type="button" onClick={() => setZoom(true)} title="Clique para ampliar a foto"
            className="shrink-0 relative group cursor-zoom-in">
            <img src={foto} alt="" className="h-16 w-16 rounded-lg object-cover border border-border" />
            <span className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/35 flex items-center justify-center transition-colors">
              <span className="text-white text-[15px] opacity-0 group-hover:opacity-100">🔍</span>
            </span>
          </button>
        )}
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink leading-snug">{itensTxt || c.descricao_carga || 'Carga'}</h3>
          <div className="text-xs text-ink-muted flex items-center gap-1 mt-1"><MapPin className="h-3.5 w-3.5 shrink-0 text-accent" /> Grão Pará/SC → {c.cidade_destino}/{c.uf_destino}{c.distancia_km ? ` · ${Math.round(c.distancia_km)} km` : ''}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        {([
          ['Peso', c.peso_total_kg ? `${Math.round(c.peso_total_kg)} kg` : '—'],
          ['Volume', c.volume_m3 ? `${c.volume_m3.toFixed(1)} m³` : '—'],
          ['Medidas', c.comprimento_m ? `${c.comprimento_m}×${c.largura_m}×${c.altura_m} m` : '—'],
          ['Indivisível', c.carga_indivisivel ? 'Sim' : 'Não'],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-bg border border-border/60 px-2.5 py-2 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-faint">{k}</div>
            <div className="text-[13px] text-ink font-medium mt-0.5 truncate" title={v}>{v}</div>
          </div>
        ))}
      </div>
      {c.observacoes && <p className="text-xs text-ink-muted mt-3 bg-bg rounded-lg px-3 py-2 border border-border/60">{c.observacoes}</p>}

      {ok && <p className="text-sm text-accent mt-3 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Cotação enviada! Obrigado.</p>}

      {!aberto ? (
        <button onClick={() => { setAberto(true); setOk(false); if (c.meu_valor == null) marcar.mutate(c.id) }}
          className="mt-4 w-full px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 inline-flex items-center justify-center gap-1.5">
          <Send className="h-4 w-4" /> {c.meu_valor != null ? 'Atualizar minha cotação' : 'Responder cotação'}
        </button>
      ) : (
        <div className="mt-4 pt-4 border-t border-border space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="text-xs text-ink-faint block mb-1">Valor do frete (R$) <span className="text-red-500">*</span></label>
              <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${inputCls} ${!valor ? 'border-red-400 ring-1 ring-red-400/30' : ''}`} /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Prazo de entrega (dias) <span className="text-red-500">*</span></label>
              <input value={prazo} onChange={e => setPrazo(e.target.value)} inputMode="numeric" placeholder="ex: 15" className={`${inputCls} ${!prazo ? 'border-red-400 ring-1 ring-red-400/30' : ''}`} /></div>
          </div>
          <div><label className="text-xs text-ink-faint block mb-1">Observação</label>
            <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Tipo de caminhão, condições, etc. (opcional)" className={inputCls} /></div>
          <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
            <Paperclip className="h-4 w-4 shrink-0" />
            <span className="px-3 py-1.5 rounded-lg border border-border hover:border-accent text-xs truncate">{file ? file.name : 'Anexar PDF/imagem (opcional)'}</span>
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {erro && <p className="text-sm text-red-500">{erro}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={enviar} disabled={responder.isPending}
              className="flex-1 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
              {responder.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar cotação
            </button>
            <button onClick={() => setAberto(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-ink-muted hover:text-ink">Cancelar</button>
          </div>
        </div>
      )}

      {zoom && foto && (
        <div className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(false)}>
          <img src={foto} alt="" className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setZoom(false)} title="Fechar"
            className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl leading-none">✕</button>
        </div>
      )}
    </div>
  )
}

// Logado, mas a conta atual NÃO é transportadora (ex: alguém da Branorte que abriu
// o portal já logado no CRM). Não cria conta sozinho — pede pra sair e entrar com a
// conta da transportadora. Evita "virar transportadora" sem querer no login de staff.
function LogadoSemConta({ email, onLogout, onCompletar }: { email: string | null; onLogout: () => void; onCompletar: () => void }) {
  return (
    <Shell>
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="h-14 w-14 rounded-full bg-amber-500/15 mx-auto flex items-center justify-center mb-4"><AlertTriangle className="h-7 w-7 text-amber-500" /></div>
        <h1 className="text-lg font-bold text-ink mb-1">Esse acesso não é de transportadora</h1>
        <p className="text-sm text-ink-muted mb-2">Você está logado como <b className="text-ink">{email || '—'}</b>, mas essa conta não está cadastrada como transportadora.</p>
        <p className="text-sm text-ink-muted mb-6">Se você é da Branorte, use o CRM normal. Se você é transportadora, <b>saia</b> e entre/cadastre com o email da transportadora.</p>
        <div className="flex items-center justify-center gap-2">
          <button onClick={onLogout} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 inline-flex items-center gap-1.5"><LogOut className="h-4 w-4" /> Sair / trocar de conta</button>
          <button onClick={onCompletar} className="px-4 py-2 rounded-lg border border-border text-sm text-ink-muted hover:text-ink">Sou transportadora</button>
        </div>
      </div>
    </Shell>
  )
}

export function TransportadoraApp() {
  const qc = useQueryClient()
  const [session, setSession] = useState<any>(undefined) // undefined = carregando
  const [ensuring, setEnsuring] = useState(false)
  const [semMeta, setSemMeta] = useState(false)
  const [completarManual, setCompletarManual] = useState(false)

  // Portal é sempre tema CLARO (público, identidade da marca). Em domínio dedicado
  // (transportadoras.branorte.com) não há preferência salva e cairia no escuro do
  // sistema. Ao desmontar, restaura o dark se o usuário (staff) o tinha — assim o
  // /transportadora no domínio do CRM não bagunça o tema do app interno.
  useEffect(() => {
    const root = document.documentElement
    const eraDark = root.classList.contains('dark')
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
    return () => {
      if (eraDark) { root.classList.add('dark'); root.style.colorScheme = '' }
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); qc.invalidateQueries({ queryKey: ['transp-conta'] }) })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const conta = useTranspMinhaConta()

  // 1º acesso: cria a conta a partir do metadata do cadastro (cobre confirmação de email)
  useEffect(() => {
    let cancel = false
    ;(async () => {
      if (!session || conta.isLoading || conta.data || ensuring || semMeta) return
      const { data: { user } } = await supabase.auth.getUser()
      const m = (user?.user_metadata ?? {}) as any
      if (!m?.transp_nome) { if (!cancel) setSemMeta(true); return }
      setEnsuring(true)
      await (supabase as any).from('frete_transportadora_contas').insert({
        user_id: user!.id, nome: m.transp_nome, cnpj: m.transp_cnpj ?? null,
        telefone: m.transp_telefone ?? null, email: user!.email ?? null, estados: m.transp_estados ?? [],
      })
      await qc.invalidateQueries({ queryKey: ['transp-conta'] })
      if (!cancel) setEnsuring(false)
    })()
    return () => { cancel = true }
  }, [session, conta.isLoading, conta.data, ensuring, semMeta, qc])

  const logout = async () => { await supabase.auth.signOut(); setSemMeta(false); setCompletarManual(false) }

  if (session === undefined) return <Splash />
  if (!session) return <AuthView />
  if (conta.isLoading || ensuring) return <Splash />
  if (!conta.data) {
    if (completarManual) return <CompletarCadastro onDone={() => { setCompletarManual(false); setSemMeta(false); qc.invalidateQueries({ queryKey: ['transp-conta'] }) }} />
    if (semMeta) return <LogadoSemConta email={session?.user?.email ?? null} onLogout={logout} onCompletar={() => setCompletarManual(true)} />
    return <Splash />
  }
  if (!conta.data.aprovado) return <Aguardando conta={conta.data} onLogout={logout} />
  return <Portal conta={conta.data} onLogout={logout} />
}

export default TransportadoraApp
