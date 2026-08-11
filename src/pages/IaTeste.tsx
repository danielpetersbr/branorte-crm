import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, Send, RotateCcw, Flag, ShieldCheck, Loader2, Power, Tag, ArrowRightLeft,
  ClipboardList, MessageSquare, X, CheckCircle2, Thermometer,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useVendedorNome } from '@/hooks/useVendedorNome'
import {
  CATEGORIAS, useApontamentos, useApontamentosDaConversa, useApontar, useAtualizarApontamento,
  useEnviarTurno, useMensagens, useNovaSessao, useReligarIa, useSessaoAtiva,
  type ApontamentoIa, type FeedbackPrioridade, type FeedbackStatus, type MsgTeste,
} from '@/hooks/useIaTeste'

// ============================================================================
// /ia-teste — ARENA DE TESTE DA IA ATENDENTE
//
// O vendedor entra, finge ser um cliente, conversa com a MESMA IA que atende no
// WhatsApp dele, e marca "errou" na resposta ruim na hora em que ela acontece.
// Cada marcação vira um item de roadmap com a conversa inteira anexada — que é o
// que faltava: no grupo do WhatsApp chegava "ela tá repetitiva", sem o caso.
//
// Nada aqui toca produção. A garantia não é de tela: é a edge, que em `chat_id`
// com prefixo `teste:` bloqueia toda escrita fora da tabela de teste.
// ============================================================================

const STATUS_LABEL: Record<FeedbackStatus | 'todos', string> = {
  todos: 'Todos', novo: 'Novo', analisando: 'Analisando', resolvido: 'Corrigido', rejeitado: 'Não procede',
}
const STATUS_STYLE: Record<FeedbackStatus, string> = {
  novo: 'bg-info/15 text-info border-info/30',
  analisando: 'bg-warning/15 text-warning border-warning/30',
  resolvido: 'bg-success-bg text-success border-success/30',
  rejeitado: 'bg-surface-2 text-ink-muted border-border',
}
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map(c => [c.id, c.label]))

function hora(s: string): string {
  return new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function dataHora(s: string): string {
  return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function IaTeste() {
  const { profile } = useAuth()
  const { nome: vendedorNome, isLoading: carregandoNome } = useVendedorNome()
  const [aba, setAba] = useState<'conversar' | 'apontamentos'>('conversar')
  const { data: apontamentosNovos } = useApontamentos('novo')

  if (carregandoNome) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-ink-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  if (!vendedorNome) {
    return (
      <div className="min-h-screen bg-bg p-6">
        <div className="max-w-xl mx-auto bg-surface border border-border rounded-lg p-6 text-center">
          <Bot className="w-8 h-8 mx-auto mb-2 text-ink-faint" />
          <p className="text-[13px] text-ink">Não consegui identificar seu nome de vendedor.</p>
          <p className="text-[12px] text-ink-muted mt-1">A IA responde com a sua configuração, então preciso saber quem é você. Fala com o Daniel.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        <div className="mb-4 flex items-start gap-3">
          <Bot className="w-6 h-6 text-accent mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-ink">Testar a IA</h1>
            <p className="text-[12px] text-ink-muted">
              Converse como se fosse um cliente. É a mesma IA que atende no seu WhatsApp — com a sua configuração.
            </p>
          </div>
        </div>

        <div className="flex gap-1.5 mb-4">
          <button
            onClick={() => setAba('conversar')}
            className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
              aba === 'conversar' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'}`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Conversar
          </button>
          <button
            onClick={() => setAba('apontamentos')}
            className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
              aba === 'apontamentos' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'}`}
          >
            <ClipboardList className="w-3.5 h-3.5" /> Apontamentos
            {!!apontamentosNovos?.length && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-info/20 text-info">{apontamentosNovos.length}</span>
            )}
          </button>
        </div>

        {aba === 'conversar'
          ? <Conversa vendedorNome={vendedorNome} userId={profile?.id ?? null} />
          : <Apontamentos ehAdmin={profile?.role === 'admin'} />}
      </div>
    </div>
  )
}

// ─── ABA CONVERSAR ─────────────────────────────────────────────────────────

function Conversa({ vendedorNome, userId }: { vendedorNome: string; userId: string | null }) {
  const { data: sessao, isLoading } = useSessaoAtiva(userId)
  const { data: msgs } = useMensagens(sessao?.chat_id ?? null)
  const { data: apontados } = useApontamentosDaConversa(sessao?.chat_id ?? null)
  const novaSessao = useNovaSessao()
  const religar = useReligarIa()
  const enviar = useEnviarTurno()
  const [texto, setTexto] = useState('')
  const [alvoApontamento, setAlvoApontamento] = useState<MsgTeste | null>(null)
  const fim = useRef<HTMLDivElement>(null)

  const lista = useMemo(() => msgs ?? [], [msgs])
  const jaApontadas = useMemo(() => new Set((apontados ?? []).map(a => a.mensagem_id)), [apontados])

  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }) }, [lista.length, enviar.isPending])

  // Sem sessão aberta, cria uma sozinho — o vendedor não deveria precisar apertar
  // "começar" pra fazer a coisa mais óbvia da tela.
  useEffect(() => {
    if (!isLoading && !sessao && userId && !novaSessao.isPending) {
      novaSessao.mutate({ userId, vendedorNome, nomeContato: 'Cliente' })
    }
  }, [isLoading, sessao, userId, vendedorNome, novaSessao])

  async function mandar() {
    const t = texto.trim()
    if (!t || !sessao || enviar.isPending) return
    setTexto('')
    try {
      await enviar.mutateAsync({
        chatId: sessao.chat_id, vendedorNome, nomeContato: sessao.nome_contato || 'Cliente',
        texto: t, historico: lista,
      })
    } catch (e) {
      setTexto(t)
      alert('Não consegui falar com a IA: ' + String((e as Error)?.message || e))
    }
  }

  if (isLoading || !sessao) {
    return <div className="bg-surface border border-border rounded-lg py-16 text-center text-ink-faint"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
  }

  const dados = (sessao.dados_coletados ?? {}) as Record<string, unknown>
  const temDados = Object.keys(dados).filter(k => !k.startsWith('_')).length > 0

  return (
    <div className="space-y-3">
      <div className="bg-success-bg border border-success/30 rounded-lg px-3 py-2 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
        <p className="text-[11px] text-ink-muted leading-relaxed">
          <span className="text-success font-medium">Isolado de verdade.</span> Nada daqui vira lead, nem manda mensagem
          pra ninguém, nem entra nos números do painel. Pode testar o que quiser, inclusive o absurdo.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col" style={{ height: 'min(62vh, 560px)' }}>
        <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2 bg-surface-2/40">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0"><Bot className="w-4 h-4 text-accent" /></div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink truncate">IA do {vendedorNome}</p>
              <p className="text-[10px] text-ink-faint">
                {sessao.ativo ? 'atendendo' : `parada — ${sessao.motivo_desligamento === 'vendedor_assumir' ? 'passou o bastão pra você' : sessao.motivo_desligamento ?? 'encerrou'}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!sessao.ativo && (
              <button
                onClick={() => religar.mutate(sessao.chat_id)}
                className="text-[11px] px-2 py-1 rounded-md border border-border bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-3 flex items-center gap-1"
                title="Continuar testando depois do handoff"
              >
                <Power className="w-3 h-3" /> Religar
              </button>
            )}
            <button
              onClick={() => userId && novaSessao.mutate({ userId, vendedorNome, nomeContato: 'Cliente' })}
              disabled={novaSessao.isPending}
              className="text-[11px] px-2 py-1 rounded-md border border-border bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-3 flex items-center gap-1"
              title="Começa do zero, com a memória limpa"
            >
              <RotateCcw className="w-3 h-3" /> Reiniciar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
          {lista.length === 0 && (
            <div className="text-center py-10">
              <MessageSquare className="w-7 h-7 mx-auto mb-2 text-ink-faint opacity-50" />
              <p className="text-[12px] text-ink-muted">Escreva como um cliente escreveria.</p>
              <p className="text-[11px] text-ink-faint mt-1">Ex.: "vi o anúncio de vocês, quanto custa a fábrica de ração?"</p>
            </div>
          )}

          {lista.map(m => (
            <Balao
              key={m.id}
              m={m}
              jaApontada={jaApontadas.has(m.id)}
              onApontar={() => setAlvoApontamento(m)}
            />
          ))}

          {enviar.isPending && (
            <div className="flex items-center gap-2 text-[11px] text-ink-faint pl-1">
              <Loader2 className="w-3 h-3 animate-spin" /> ela está pensando…
            </div>
          )}
          <div ref={fim} />
        </div>

        <div className="border-t border-border p-2 flex items-end gap-2">
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void mandar() } }}
            rows={1}
            placeholder="Escreva como cliente… (Enter manda, Shift+Enter quebra linha)"
            className="flex-1 resize-none bg-surface-2 border border-border rounded-md px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent max-h-28"
          />
          <button
            onClick={() => void mandar()}
            disabled={!texto.trim() || enviar.isPending}
            className="h-9 px-3 rounded-md bg-accent text-white text-[12px] font-medium disabled:opacity-40 flex items-center gap-1.5 shrink-0"
          >
            <Send className="w-3.5 h-3.5" /> Enviar
          </button>
        </div>
      </div>

      {temDados && (
        <div className="bg-surface border border-border rounded-lg px-3 py-2.5">
          <p className="text-[11px] font-medium text-ink-muted mb-1.5 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> O que ela entendeu até agora
            {sessao.temperatura && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface-2 text-ink-muted flex items-center gap-1">
                <Thermometer className="w-2.5 h-2.5" /> {sessao.temperatura}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(dados).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
              <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-surface-2 border border-border text-ink-muted">
                <span className="text-ink-faint">{k}:</span> {String(v)}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-ink-faint mt-2">
            Se ela entendeu errado aqui, marque "errou" na resposta — é o dado que ela usa pra escolher o modelo.
          </p>
        </div>
      )}

      {alvoApontamento && (
        <ModalApontar
          msg={alvoApontamento}
          historico={lista}
          dados={dados}
          chatId={sessao.chat_id}
          vendedorNome={vendedorNome}
          userId={userId}
          onFechar={() => setAlvoApontamento(null)}
        />
      )}
    </div>
  )
}

function Balao({ m, jaApontada, onApontar }: { m: MsgTeste; jaApontada: boolean; onApontar: () => void }) {
  if (m.papel === 'cliente') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] bg-accent text-white rounded-lg rounded-br-sm px-3 py-2">
          <p className="text-[13px] whitespace-pre-wrap break-words">{m.texto}</p>
          <p className="text-[9px] opacity-70 text-right mt-0.5">{hora(m.created_at)}</p>
        </div>
      </div>
    )
  }

  if (m.papel === 'sistema') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] bg-warning/10 border border-warning/25 rounded-md px-3 py-1.5">
          <p className="text-[11px] text-ink-muted leading-relaxed">{m.texto}</p>
        </div>
      </div>
    )
  }

  const acoes = m.acoes ?? {}
  const midias = m.midias ?? []
  return (
    <div className="flex justify-start">
      <div className="max-w-[82%] space-y-1.5">
        <div className="bg-surface-2 border border-border rounded-lg rounded-bl-sm px-3 py-2">
          <p className="text-[13px] text-ink whitespace-pre-wrap break-words">{m.texto}</p>

          {midias.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {midias.map((mid, i) => (
                <div key={i} className="rounded-md overflow-hidden border border-border bg-bg">
                  {String(mid.tipo || '').startsWith('video')
                    ? <video src={mid.url} controls className="w-full max-h-56 bg-black" />
                    : <img src={mid.url} alt={mid.titulo || 'anexo'} className="w-full max-h-56 object-contain bg-black/20" loading="lazy" />}
                  {mid.titulo && <p className="text-[10px] text-ink-faint px-2 py-1">{mid.titulo}</p>}
                </div>
              ))}
              <p className="text-[10px] text-ink-faint">↑ o cliente receberia {midias.length === 1 ? 'este anexo' : `estes ${midias.length} anexos`}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="flex flex-wrap gap-1">
              {acoes.etiqueta && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-info/30 bg-info/15 text-info flex items-center gap-0.5">
                  <Tag className="w-2.5 h-2.5" /> etiquetaria "{acoes.etiqueta}"
                </span>
              )}
              {acoes.desligada && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-warning/30 bg-warning/15 text-warning flex items-center gap-0.5">
                  <ArrowRightLeft className="w-2.5 h-2.5" /> passou pra você
                </span>
              )}
            </div>
            <span className="text-[9px] text-ink-faint shrink-0">{hora(m.created_at)}</span>
          </div>
        </div>

        <button
          onClick={onApontar}
          disabled={jaApontada}
          className={`text-[10px] px-2 py-1 rounded-md border flex items-center gap-1 transition ${
            jaApontada
              ? 'border-success/30 bg-success-bg text-success cursor-default'
              : 'border-border bg-surface text-ink-faint hover:text-danger hover:border-danger/40'}`}
        >
          {jaApontada ? <><CheckCircle2 className="w-3 h-3" /> apontado</> : <><Flag className="w-3 h-3" /> ela errou aqui</>}
        </button>
      </div>
    </div>
  )
}

function ModalApontar({ msg, historico, dados, chatId, vendedorNome, userId, onFechar }: {
  msg: MsgTeste
  historico: MsgTeste[]
  dados: Record<string, unknown>
  chatId: string
  vendedorNome: string
  userId: string | null
  onFechar: () => void
}) {
  const apontar = useApontar()
  const [categoria, setCategoria] = useState<string>('')
  const [comentario, setComentario] = useState('')
  const [esperado, setEsperado] = useState('')

  async function salvar() {
    if (!categoria || !userId) return
    // O contexto vai junto e é o ponto todo: apontamento sem a conversa não dá pra
    // analisar depois — foi o que aconteceu com os relatos soltos no grupo do zap.
    const conversa = historico
      .filter(m => m.papel !== 'sistema')
      .slice(-14)
      .map(m => ({ de: m.papel === 'ia' ? 'ia' : 'cliente', txt: m.texto.slice(0, 400) }))
    await apontar.mutateAsync({
      chatId, mensagemId: msg.id, vendedorNome, userId, categoria, comentario, esperado,
      contexto: { conversa, texto_ia: msg.texto, dados },
    })
    onFechar()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-surface border border-border rounded-lg w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-[14px] font-semibold text-ink flex items-center gap-2"><Flag className="w-4 h-4 text-danger" /> O que ela errou?</p>
          <button onClick={onFechar} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
            <p className="text-[10px] text-ink-faint mb-1">resposta apontada</p>
            <p className="text-[12px] text-ink whitespace-pre-wrap">{msg.texto}</p>
          </div>

          <div>
            <label className="text-[11px] font-medium text-ink-muted block mb-1.5">Tipo do erro</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CATEGORIAS.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCategoria(c.id)}
                  className={`text-left text-[11px] px-2.5 py-2 rounded-md border transition ${
                    categoria === c.id ? 'border-accent bg-accent/10 text-ink' : 'border-border bg-surface-2 text-ink-muted hover:bg-surface-3'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-ink-muted block mb-1">O que ela deveria ter respondido?</label>
            <textarea
              value={esperado} onChange={e => setEsperado(e.target.value)} rows={2}
              placeholder="Do seu jeito. É isso que vira o ajuste."
              className="w-full resize-none bg-surface-2 border border-border rounded-md px-3 py-2 text-[12px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-ink-muted block mb-1">Quer explicar melhor? (opcional)</label>
            <textarea
              value={comentario} onChange={e => setComentario(e.target.value)} rows={2}
              className="w-full resize-none bg-surface-2 border border-border rounded-md px-3 py-2 text-[12px] text-ink focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onFechar} className="text-[12px] px-3 py-1.5 rounded-md border border-border text-ink-muted hover:text-ink">Cancelar</button>
          <button
            onClick={() => void salvar()}
            disabled={!categoria || apontar.isPending}
            className="text-[12px] px-3 py-1.5 rounded-md bg-accent text-white font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            {apontar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-3.5 h-3.5" />} Apontar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ABA APONTAMENTOS (roadmap) ────────────────────────────────────────────

function Apontamentos({ ehAdmin }: { ehAdmin: boolean }) {
  const [filtro, setFiltro] = useState<FeedbackStatus | 'todos'>('novo')
  const { data, isLoading } = useApontamentos(filtro)
  const [aberto, setAberto] = useState<number | null>(null)
  const atualizar = useAtualizarApontamento()

  const lista = data ?? []

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border rounded-lg p-2 flex flex-wrap gap-1.5">
        {(['novo', 'analisando', 'resolvido', 'rejeitado', 'todos'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFiltro(s)}
            className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition ${
              filtro === s ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="bg-surface border border-border rounded-lg py-12 text-center text-ink-faint"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
      ) : lista.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg py-12 text-center text-ink-faint">
          <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-[13px]">Nenhum apontamento nesse status.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(a => (
            <ItemApontamento
              key={a.id}
              a={a}
              aberto={aberto === a.id}
              ehAdmin={ehAdmin}
              onToggle={() => setAberto(aberto === a.id ? null : a.id)}
              onPatch={patch => atualizar.mutate({ id: a.id, patch })}
              salvando={atualizar.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemApontamento({ a, aberto, ehAdmin, onToggle, onPatch, salvando }: {
  a: ApontamentoIa
  aberto: boolean
  ehAdmin: boolean
  onToggle: () => void
  onPatch: (patch: Partial<Pick<ApontamentoIa, 'status' | 'prioridade' | 'resposta_time'>>) => void
  salvando: boolean
}) {
  const [resposta, setResposta] = useState(a.resposta_time ?? '')

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2/40">
        <Flag className="w-4 h-4 mt-0.5 shrink-0 text-danger" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-[13px] font-medium text-ink truncate">{CAT_LABEL[a.categoria] ?? a.categoria}</span>
            <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${STATUS_STYLE[a.status]}`}>
              {STATUS_LABEL[a.status]}
            </span>
          </div>
          <p className="text-[11px] text-ink-muted truncate">{a.esperado || a.comentario || a.contexto?.texto_ia || '—'}</p>
          <div className="text-[10px] text-ink-faint flex items-center gap-1.5 mt-0.5">
            <span>#{a.id}</span><span>·</span><span>{a.vendedor_nome}</span><span>·</span><span>{dataHora(a.created_at)}</span>
            {a.prioridade && <><span>·</span><span className="uppercase">{a.prioridade}</span></>}
          </div>
        </div>
      </button>

      {aberto && (
        <div className="border-t border-border bg-surface-2/30 px-4 py-3 space-y-3">
          {a.contexto?.texto_ia && (
            <div>
              <p className="text-[10px] text-ink-faint mb-1">o que ela respondeu</p>
              <p className="text-[12px] text-ink bg-surface border border-border rounded-md px-3 py-2 whitespace-pre-wrap">{a.contexto.texto_ia}</p>
            </div>
          )}
          {a.esperado && (
            <div>
              <p className="text-[10px] text-ink-faint mb-1">o que deveria ter respondido</p>
              <p className="text-[12px] text-success bg-success-bg border border-success/25 rounded-md px-3 py-2 whitespace-pre-wrap">{a.esperado}</p>
            </div>
          )}
          {a.comentario && (
            <div>
              <p className="text-[10px] text-ink-faint mb-1">observação</p>
              <p className="text-[12px] text-ink-muted whitespace-pre-wrap">{a.comentario}</p>
            </div>
          )}

          {!!a.contexto?.conversa?.length && (
            <details className="group">
              <summary className="text-[11px] text-ink-muted cursor-pointer hover:text-ink">ver a conversa inteira ({a.contexto.conversa.length} mensagens)</summary>
              <div className="mt-2 space-y-1.5 bg-surface border border-border rounded-md p-2 max-h-64 overflow-y-auto">
                {a.contexto.conversa.map((c, i) => (
                  <div key={i} className={c.de === 'ia' ? 'text-left' : 'text-right'}>
                    <span className={`inline-block max-w-[85%] text-[11px] px-2 py-1 rounded ${
                      c.de === 'ia' ? 'bg-surface-2 text-ink border border-border' : 'bg-accent/15 text-ink'}`}>
                      {c.txt}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {!!a.contexto?.dados && Object.keys(a.contexto.dados).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(a.contexto.dados).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-ink-muted">
                  <span className="text-ink-faint">{k}:</span> {String(v)}
                </span>
              ))}
            </div>
          )}

          {a.resposta_time && !ehAdmin && (
            <div>
              <p className="text-[10px] text-ink-faint mb-1">resposta de quem analisou</p>
              <p className="text-[12px] text-ink bg-surface border border-border rounded-md px-3 py-2 whitespace-pre-wrap">{a.resposta_time}</p>
            </div>
          )}

          {ehAdmin && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex flex-wrap gap-1.5">
                {(['novo', 'analisando', 'resolvido', 'rejeitado'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => onPatch({ status: s })}
                    disabled={salvando}
                    className={`text-[11px] px-2.5 py-1 rounded-md border font-medium ${
                      a.status === s ? STATUS_STYLE[s] : 'bg-surface text-ink-muted border-border hover:bg-surface-3'}`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['baixa', 'media', 'alta', 'critica'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => onPatch({ prioridade: p as FeedbackPrioridade })}
                    disabled={salvando}
                    className={`text-[11px] px-2.5 py-1 rounded-md border uppercase ${
                      a.prioridade === p ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-muted border-border hover:bg-surface-3'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={resposta}
                  onChange={e => setResposta(e.target.value)}
                  placeholder="Devolutiva pro vendedor (ele vê aqui)"
                  className="flex-1 bg-surface border border-border rounded-md px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => onPatch({ resposta_time: resposta })}
                  disabled={salvando}
                  className="text-[12px] px-3 py-1.5 rounded-md bg-accent text-white font-medium disabled:opacity-40"
                >
                  Salvar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default IaTeste
