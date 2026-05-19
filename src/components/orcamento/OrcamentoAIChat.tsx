// Copiloto IA do builder de orçamento.
//
// Drawer lateral 380px que abre com botão flutuante 🤖 no canto inferior direito
// do /orcamentos/montar. Vendedor digita ou grava áudio → manda pra /api/orcamento-ai
// → recebe resposta com texto markdown + (futuro) sugestões de ação.
//
// Não modifica o orçamento (Sprint 1 = só leitura/consulta).
// As tools que rodam no servidor só fazem SELECT em precos_branorte,
// catalogo_motores e orcamento_modelos.

import { useEffect, useRef, useState } from 'react'
import { Bot, Mic, MicOff, Send, X, Sparkles, Loader2, AlertCircle, Plus, Package, User, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ============================================================================
// AÇÕES SUGERIDAS PELA IA (Sprint 2)
// Tipos espelham o backend (api/orcamento-ai.ts)
// ============================================================================

export type AcaoSugerida =
  | {
      tipo: 'adicionar_item'
      preco_branorte_id: number
      quantidade: number
      justificativa?: string
      preview?: {
        categoria: string
        descricao: string
        valor_equipamento: number | null
        motor_cv: number | null
        motor_polos: number | null
        capacidade: string | null
      }
    }
  | {
      tipo: 'carregar_pacote'
      modelo_id: number
      justificativa?: string
      preview?: {
        basename: string
        producao_kgh: number | null
        armazenamento_kg: number | null
        total_proposta: number | null
        qtd_itens: number
      }
    }
  | {
      tipo: 'preencher_cliente'
      dados: Record<string, string | undefined>
    }

interface Msg {
  role: 'user' | 'assistant'
  content: string
  tool_trace?: Array<{ name: string; ok: boolean; ms: number }>
  // Ações vindas dessa resposta da IA (Sprint 2)
  acoes?: AcaoSugerida[]
  // Estado das ações aprovadas pelo vendedor (key = índice da ação)
  acoesAplicadas?: Set<number>
}

interface ContextoOrcamento {
  cliente_nome?: string | null
  carrinho_resumo?: string | null
  orcamento_id?: number | string | null
}

interface Props {
  contexto: ContextoOrcamento
  // Callbacks que o builder injeta. Quando o vendedor clica "Aplicar" num card,
  // o componente chama o callback correspondente. Se for null, o botão fica
  // disabled (Sprint 1 não passou callbacks; Sprint 2 sim).
  onAdicionarItem?: (preco_branorte_id: number, quantidade: number) => void | Promise<void>
  onCarregarPacote?: (modelo_id: number) => void | Promise<void>
  onPreencherCliente?: (dados: Record<string, string | undefined>) => void | Promise<void>
}

const SUGESTOES_INICIAIS = [
  'Monta um orçamento de mini fábrica monofásica 150 kg/h',
  'Quero fábrica de 500 kg/h trifásica com ensacadeira',
  'Lista as Compactas Master entre 100 e 300 kg/h',
  'Qual o preço da caçamba de pesagem 1900 L?',
  'Quanto custa um motor 5 CV trifásico 4 polos?',
]

export function OrcamentoAIChat({
  contexto,
  onAdicionarItem,
  onCarregarPacote,
  onPreencherCliente,
}: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gravando, setGravando] = useState(false)
  const [transcrevendo, setTranscrevendo] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll quando chega mensagem nova
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, enviando])

  // Cleanup do recorder se desmontar
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  async function enviar(textoOverride?: string) {
    const texto = (textoOverride ?? input).trim()
    if (!texto || enviando) return

    setErro(null)
    const novaMsg: Msg = { role: 'user', content: texto }
    const historicoNovo = [...messages, novaMsg]
    setMessages(historicoNovo)
    setInput('')
    setEnviando(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão expirada — faça login novamente')

      const res = await fetch('/api/orcamento-ai', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: historicoNovo.map(m => ({ role: m.role, content: m.content })),
          context: {
            cliente_nome: contexto.cliente_nome,
            carrinho_resumo: contexto.carrinho_resumo,
            orcamento_id: contexto.orcamento_id,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || '(sem resposta)',
          tool_trace: data.tool_trace,
          acoes: data.acoes as AcaoSugerida[] | undefined,
          acoesAplicadas: new Set<number>(),
        },
      ])
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function iniciarGravacao() {
    setErro(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      // webm/opus é o default do MediaRecorder no Chrome/Edge e o Whisper aceita
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        if (blob.size === 0) return
        await transcreverETrazerInput(blob)
      }
      rec.start()
      recorderRef.current = rec
      setGravando(true)
    } catch (e) {
      setErro(`Microfone bloqueado: ${(e as Error).message}`)
    }
  }

  function pararGravacao() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    setGravando(false)
  }

  async function transcreverETrazerInput(blob: Blob) {
    setTranscrevendo(true)
    setErro(null)
    try {
      const base64 = await blobParaBase64(blob)
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão expirada')

      const res = await fetch('/api/orcamento-ai-transcrever', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio_base64: base64, mime: 'audio/webm' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const text = (data.text || '').trim()
      if (text) {
        // Envia direto — fluxo "fala → IA responde" sem revisar texto
        await enviar(text)
      } else {
        setErro('Não entendi o áudio. Tente de novo.')
      }
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setTranscrevendo(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  // Aprova uma ação sugerida: chama o callback do builder e marca como aplicada.
  // Mensagem msgIdx, ação idxAcao dentro de msg.acoes.
  async function aplicarAcao(msgIdx: number, idxAcao: number) {
    const msg = messages[msgIdx]
    const acao = msg?.acoes?.[idxAcao]
    if (!acao || msg.acoesAplicadas?.has(idxAcao)) return

    try {
      if (acao.tipo === 'adicionar_item' && onAdicionarItem) {
        await onAdicionarItem(acao.preco_branorte_id, acao.quantidade)
      } else if (acao.tipo === 'carregar_pacote' && onCarregarPacote) {
        await onCarregarPacote(acao.modelo_id)
      } else if (acao.tipo === 'preencher_cliente' && onPreencherCliente) {
        await onPreencherCliente(acao.dados)
      } else {
        setErro('Ação não suportada nesta versão')
        return
      }
      // Marca como aplicada (immutable update)
      setMessages(prev =>
        prev.map((m, i) => {
          if (i !== msgIdx) return m
          const nova = new Set(m.acoesAplicadas ?? [])
          nova.add(idxAcao)
          return { ...m, acoesAplicadas: nova }
        }),
      )
    } catch (e) {
      setErro(`Falha ao aplicar: ${(e as Error).message}`)
    }
  }

  const podeEnviar = input.trim().length > 0 && !enviando && !transcrevendo

  return (
    <>
      {/* Botão flutuante (sempre visível)
          Posicionado em bottom-left pra não bater com o FAB de Feedback (bottom-right global).
          Em mobile sobe um pouco pra não bater com a bottom nav. */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Copiloto IA — montar orçamento"
        aria-label="Abrir copiloto IA"
        className={`fixed bottom-6 left-6 lg:bottom-8 lg:left-8 z-40 h-14 w-14 rounded-full shadow-xl flex items-center justify-center transition-all
                    ${open
                      ? 'bg-surface-2 text-ink border border-border hover:bg-surface-3'
                      : 'bg-gradient-to-br from-accent to-accent/80 text-white hover:scale-105 hover:shadow-2xl ring-1 ring-accent/40'}
                    max-md:bottom-20`}
      >
        {open ? <X className="h-5 w-5" /> : (
          <div className="relative">
            <Bot className="h-6 w-6" />
            <Sparkles className="h-3 w-3 absolute -top-1 -right-1 text-yellow-300" />
          </div>
        )}
      </button>

      {/* Drawer lateral — abre do lado oposto ao FAB (esquerda no desktop, full em mobile) */}
      {open && (
        <div className="fixed top-0 left-0 z-30 h-screen w-full sm:w-[420px] bg-bg border-r border-border shadow-2xl flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-surface-2/40">
            <div className="h-9 w-9 rounded-full bg-accent/15 flex items-center justify-center text-accent">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-ink leading-tight">Copiloto IA</div>
              <div className="text-[11px] text-ink-muted truncate">
                {contexto.cliente_nome ? `Orçando: ${contexto.cliente_nome}` : 'Consultar catálogo'}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-ink-faint hover:text-ink p-1 -m-1"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Histórico de mensagens */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="text-[11px] text-ink-muted px-2">
                  Pergunte preço, capacidade, motor, ou peça pra montar um pacote. Tudo consultado
                  na base oficial — sem invenção.
                </div>
                <div className="space-y-1.5">
                  {SUGESTOES_INICIAIS.map(s => (
                    <button
                      key={s}
                      onClick={() => enviar(s)}
                      className="block w-full text-left text-[12px] px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink border border-border/60 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <ChatMessageBubble
                key={i}
                msg={m}
                onAplicarAcao={idxAcao => aplicarAcao(i, idxAcao)}
                podeAdicionarItem={!!onAdicionarItem}
                podeCarregarPacote={!!onCarregarPacote}
                podePreencherCliente={!!onPreencherCliente}
              />
            ))}

            {enviando && (
              <div className="flex items-center gap-2 text-[12px] text-ink-muted px-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Consultando catálogo…
              </div>
            )}
            {transcrevendo && (
              <div className="flex items-center gap-2 text-[12px] text-ink-muted px-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Transcrevendo áudio…
              </div>
            )}

            {erro && (
              <div className="flex items-start gap-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span className="break-words">{erro}</span>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border bg-surface-2/40 p-3">
            <div className="flex items-end gap-2">
              <button
                onClick={gravando ? pararGravacao : iniciarGravacao}
                disabled={enviando || transcrevendo}
                title={gravando ? 'Parar gravação' : 'Gravar áudio'}
                className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center transition-all ${
                  gravando
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-surface-3 text-ink-muted hover:text-ink hover:bg-surface-2'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {gravando ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={gravando ? 'Gravando… clique no microfone pra parar' : 'Pergunte algo… (Enter envia)'}
                rows={1}
                disabled={gravando || transcrevendo}
                className="flex-1 resize-none rounded-lg bg-bg border border-border px-3 py-2 text-[13px] text-ink placeholder-ink-faint focus:outline-none focus:ring-1 focus:ring-accent/60 max-h-28"
              />
              <button
                onClick={() => enviar()}
                disabled={!podeEnviar}
                className="h-10 w-10 shrink-0 rounded-lg bg-accent text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                title="Enviar (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="text-[10px] text-ink-faint mt-1.5 px-1">
              gpt-4o-mini · respostas baseadas no catálogo oficial
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ChatMessageBubble({
  msg,
  onAplicarAcao,
  podeAdicionarItem,
  podeCarregarPacote,
  podePreencherCliente,
}: {
  msg: Msg
  onAplicarAcao: (idx: number) => void
  podeAdicionarItem: boolean
  podeCarregarPacote: boolean
  podePreencherCliente: boolean
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
          isUser
            ? 'bg-accent text-white rounded-br-sm'
            : 'bg-surface-2 text-ink border border-border/60 rounded-bl-sm'
        }`}
      >
        <MarkdownLite text={msg.content} />

        {/* Cards de ação sugerida (Sprint 2). Só aparecem em mensagens do assistente. */}
        {!isUser && msg.acoes && msg.acoes.length > 0 && (() => {
          const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
          // Calcula subtotal das ações 'adicionar_item' pendentes (não aplicadas)
          const subtotalPendente = msg.acoes.reduce((acc, acao, idx) => {
            if (msg.acoesAplicadas?.has(idx)) return acc
            if (acao.tipo === 'adicionar_item') {
              return acc + (acao.preview?.valor_equipamento ?? 0) * acao.quantidade
            }
            return acc
          }, 0)
          const qtdAdicionar = msg.acoes.filter((a, i) => !msg.acoesAplicadas?.has(i) && a.tipo === 'adicionar_item').length
          return (
            <div className="mt-2 space-y-1.5">
              {msg.acoes.map((acao, i) => {
                const aplicada = msg.acoesAplicadas?.has(i)
                const podeAplicar =
                  acao.tipo === 'adicionar_item'
                    ? podeAdicionarItem
                    : acao.tipo === 'carregar_pacote'
                    ? podeCarregarPacote
                    : podePreencherCliente
                return (
                  <AcaoCard
                    key={i}
                    acao={acao}
                    aplicada={!!aplicada}
                    podeAplicar={podeAplicar}
                    onAplicar={() => onAplicarAcao(i)}
                  />
                )
              })}
              {qtdAdicionar > 1 && subtotalPendente > 0 && (
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-[11px]">
                  <span className="text-ink-muted">
                    {qtdAdicionar} {qtdAdicionar === 1 ? 'item pendente' : 'itens pendentes'}
                  </span>
                  <span className="font-semibold text-accent tabular-nums">
                    Subtotal: {fmtBRL(subtotalPendente)}
                  </span>
                </div>
              )}
            </div>
          )
        })()}

        {!isUser && msg.tool_trace && msg.tool_trace.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[10px] text-ink-faint flex flex-wrap gap-1">
            {msg.tool_trace.map((t, i) => (
              <span key={i} title={`${t.ms}ms`} className="px-1.5 py-0.5 rounded bg-bg/40">
                {t.ok ? '✓' : '✗'} {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AcaoCard({
  acao,
  aplicada,
  podeAplicar,
  onAplicar,
}: {
  acao: AcaoSugerida
  aplicada: boolean
  podeAplicar: boolean
  onAplicar: () => void
}) {
  const fmtBRL = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n) : '—'

  let icone: JSX.Element
  let titulo: string
  let subtitulo: string
  let detalhe: string | null = null

  if (acao.tipo === 'adicionar_item') {
    icone = <Plus className="h-3.5 w-3.5" />
    titulo = acao.preview?.descricao || `Item #${acao.preco_branorte_id}`
    const valor = (acao.preview?.valor_equipamento ?? 0) * acao.quantidade
    subtitulo = `${acao.quantidade}x · ${fmtBRL(valor)}`
    detalhe = [
      acao.preview?.capacidade,
      acao.preview?.motor_cv ? `${acao.preview.motor_cv} CV` : null,
      acao.preview?.motor_polos ? `${acao.preview.motor_polos}p` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  } else if (acao.tipo === 'carregar_pacote') {
    icone = <Package className="h-3.5 w-3.5" />
    titulo = acao.preview?.basename || `Modelo #${acao.modelo_id}`
    subtitulo = `Pacote completo · ${fmtBRL(acao.preview?.total_proposta)}`
    detalhe = [
      acao.preview?.qtd_itens ? `${acao.preview.qtd_itens} itens` : null,
      acao.preview?.producao_kgh ? `${acao.preview.producao_kgh} kg/h` : null,
      acao.preview?.armazenamento_kg ? `armaz. ${acao.preview.armazenamento_kg} kg` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  } else {
    icone = <User className="h-3.5 w-3.5" />
    titulo = 'Preencher dados do cliente'
    const campos = Object.keys(acao.dados).length
    subtitulo = `${campos} ${campos === 1 ? 'campo' : 'campos'}`
    detalhe = Object.entries(acao.dados)
      .map(([k, v]) => `${k}: ${v}`)
      .slice(0, 3)
      .join(' · ')
  }

  return (
    <div
      className={`rounded-lg border p-2 transition-all ${
        aplicada
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-bg/60 border-border/60'
      }`}
    >
      <div className="flex items-start gap-2">
        <div
          className={`h-6 w-6 rounded shrink-0 flex items-center justify-center ${
            aplicada ? 'bg-emerald-500 text-white' : 'bg-accent/15 text-accent'
          }`}
        >
          {aplicada ? <Check className="h-3.5 w-3.5" /> : icone}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold leading-tight truncate">{titulo}</div>
          <div className="text-[10.5px] text-ink-muted">{subtitulo}</div>
          {detalhe && (
            <div className="text-[10px] text-ink-faint truncate mt-0.5">{detalhe}</div>
          )}
        </div>
      </div>
      {!aplicada && (
        <button
          onClick={onAplicar}
          disabled={!podeAplicar}
          title={!podeAplicar ? 'Função não disponível nesta tela' : ''}
          className="mt-1.5 w-full text-[11px] py-1.5 rounded font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {acao.tipo === 'carregar_pacote' ? 'Carregar pacote (substitui carrinho)' : 'Aplicar'}
        </button>
      )}
      {aplicada && (
        <div className="mt-1.5 text-[10.5px] text-emerald-400 font-medium px-1">
          ✓ Aplicado ao orçamento
        </div>
      )}
    </div>
  )
}

// Renderer de markdown leve — só o que o copiloto realmente usa: bold, code,
// listas, tabelas. Não usei react-markdown pra não inflar bundle.
function MarkdownLite({ text }: { text: string }) {
  // Substitui ** → <strong>, ` → <code>, e quebras de linha em <br/>
  const linhas = text.split('\n')
  const elementos: JSX.Element[] = []
  let buffer: string[] = []
  let inTable = false
  let tableHeader: string[] = []
  let tableRows: string[][] = []

  function flushBuffer() {
    if (!buffer.length) return
    elementos.push(
      <p key={elementos.length} className="whitespace-pre-wrap break-words">
        {renderInline(buffer.join('\n'))}
      </p>
    )
    buffer = []
  }
  function flushTable() {
    if (!inTable) return
    elementos.push(
      <div key={elementos.length} className="my-1.5 overflow-x-auto">
        <table className="text-[11.5px] border-collapse w-full">
          {tableHeader.length > 0 && (
            <thead>
              <tr className="border-b border-border/60">
                {tableHeader.map((h, i) => (
                  <th key={i} className="text-left px-1.5 py-1 font-semibold">
                    {renderInline(h.trim())}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={i} className="border-b border-border/30">
                {row.map((cell, j) => (
                  <td key={j} className="px-1.5 py-1 align-top">
                    {renderInline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    inTable = false
    tableHeader = []
    tableRows = []
  }

  for (const ln of linhas) {
    // Linha de separador de tabela: |---|---|
    if (/^\|[\s:|-]+\|$/.test(ln.trim())) continue
    // Linha de tabela
    if (ln.trim().startsWith('|') && ln.trim().endsWith('|')) {
      flushBuffer()
      const cells = ln.trim().slice(1, -1).split('|')
      if (!inTable) {
        tableHeader = cells
        inTable = true
      } else {
        tableRows.push(cells)
      }
      continue
    }
    if (inTable) flushTable()
    buffer.push(ln)
  }
  if (inTable) flushTable()
  flushBuffer()

  return <>{elementos}</>
}

function renderInline(s: string): JSX.Element {
  // **bold** → <strong>, `code` → <code>
  const partes: (string | JSX.Element)[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(s)) !== null) {
    if (match.index > lastIndex) partes.push(s.slice(lastIndex, match.index))
    const tok = match[0]
    if (tok.startsWith('**')) {
      partes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    } else {
      partes.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-bg/60 text-[11px] font-mono">
          {tok.slice(1, -1)}
        </code>
      )
    }
    lastIndex = match.index + tok.length
  }
  if (lastIndex < s.length) partes.push(s.slice(lastIndex))
  return <>{partes}</>
}

async function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
