// Copiloto IA do builder de orçamento.
//
// Drawer lateral que abre com botão flutuante 🤖 no canto inferior esquerdo
// do /orcamentos/montar. Vendedor digita ou grava áudio → manda pra /api/orcamento-ai
// → recebe resposta com texto markdown + cards de ação.

import { useEffect, useRef, useState } from 'react'
import { Bot, Mic, Send, X, Sparkles, Loader2, AlertCircle, Plus, Package, User, Check, Rocket, Trash2, Play, Pause } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export type AcaoSugerida =
  | {
      tipo: 'adicionar_item'
      preco_branorte_id: number
      quantidade: number
      justificativa?: string
      auto_apply?: boolean
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
  | {
      tipo: 'finalizar_orcamento'
      enviar_whatsapp?: boolean
      cliente_dados?: Record<string, string | undefined>
      auto_submit?: boolean
    }

interface Msg {
  role: 'user' | 'assistant'
  content: string
  tool_trace?: Array<{ name: string; ok: boolean; ms: number }>
  acoes?: AcaoSugerida[]
  acoesAplicadas?: Set<number>
}

interface ContextoOrcamento {
  cliente_nome?: string | null
  carrinho_resumo?: string | null
  orcamento_id?: number | string | null
}

interface Props {
  contexto: ContextoOrcamento
  onAdicionarItem?: (preco_branorte_id: number, quantidade: number) => void | Promise<void>
  onCarregarPacote?: (modelo_id: number) => void | Promise<void>
  onPreencherCliente?: (dados: Record<string, string | undefined>) => void | Promise<void>
  onFinalizarOrcamento?: (opts: { enviar_whatsapp?: boolean; cliente_dados?: Record<string, string | undefined> }) => void | Promise<void>
  onDrawerToggle?: (open: boolean) => void
}

const SUGESTOES_INICIAIS = [
  { icon: '🏭', text: 'Mini fábrica 150 kg/h monofásica' },
  { icon: '🚛', text: 'Moega + 2 roscas 210x14m + moinho 50cv' },
  { icon: '📦', text: '3 silos de 42 toneladas' },
  { icon: '⚙️', text: 'Compacta Master 300 kg/h trifásica' },
]

export function OrcamentoAIChat({
  contexto,
  onAdicionarItem,
  onCarregarPacote,
  onPreencherCliente,
  onFinalizarOrcamento,
  onDrawerToggle,
}: Props) {
  const [open, setOpen] = useState(false)

  // Notifica o pai quando drawer abre/fecha pra ajustar layout
  const toggleDrawer = (newState: boolean) => {
    setOpen(newState)
    onDrawerToggle?.(newState)
  }
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Áudio
  const [gravando, setGravando] = useState(false)
  const [transcrevendo, setTranscrevendo] = useState(false)
  const [audioReview, setAudioReview] = useState<{ blob: Blob; url: string; duracao: number } | null>(null)
  const [reproduzindo, setReproduzindo] = useState(false)
  const [duracaoAtual, setDuracaoAtual] = useState(0)
  const [nivelVolume, setNivelVolume] = useState<number[]>(new Array(24).fill(0))

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, enviando, transcrevendo])

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

  // Cleanup
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (audioReview) URL.revokeObjectURL(audioReview.url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Parse defensivo: se servidor crashar, retorna HTML em vez de JSON
      const rawText = await res.text()
      let data: { reply?: string; tool_trace?: unknown; acoes?: unknown; error?: string; detail?: string } = {}
      try {
        data = JSON.parse(rawText)
      } catch {
        // Resposta nao-JSON (page de erro do Vercel etc) — mostra primeiros 200 chars
        const snippet = rawText.slice(0, 200).trim()
        throw new Error(`Servidor erro (HTTP ${res.status}): ${snippet}`)
      }
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)

      const acoes = data.acoes as AcaoSugerida[] | undefined
      const autoApplied = new Set<number>()

      // Auto-apply: aplica automaticamente ações marcadas com auto_apply
      if (acoes?.length) {
        for (let i = 0; i < acoes.length; i++) {
          const acao = acoes[i]
          try {
            if (acao.tipo === 'adicionar_item' && acao.auto_apply && onAdicionarItem) {
              await onAdicionarItem(acao.preco_branorte_id, acao.quantidade)
              autoApplied.add(i)
            } else if (acao.tipo === 'carregar_pacote' && onCarregarPacote) {
              // Pacotes sempre auto-apply quando vendedor pediu explicitamente
              await onCarregarPacote(acao.modelo_id)
              autoApplied.add(i)
            } else if (acao.tipo === 'finalizar_orcamento' && acao.auto_submit && onFinalizarOrcamento) {
              await onFinalizarOrcamento({
                enviar_whatsapp: acao.enviar_whatsapp,
                cliente_dados: acao.cliente_dados,
              })
              autoApplied.add(i)
            }
          } catch {
            // Se falhar auto-apply, deixa o card manual
          }
        }
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || '(sem resposta)',
          tool_trace: data.tool_trace,
          acoes,
          acoesAplicadas: autoApplied,
        },
      ])
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  function limparConversa() {
    if (messages.length === 0) return
    if (!confirm('Limpar histórico da conversa?')) return
    setMessages([])
    setErro(null)
  }

  async function iniciarGravacao() {
    setErro(null)
    try {
      // Constraints melhoradas: noise suppression, echo cancel, AGC, mono pra
      // voz (Whisper roda melhor em mono 16-48kHz). Limpa ruido de fundo.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      })
      streamRef.current = stream

      // Analyser pra waveform
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      audioCtxRef.current = audioCtx
      analyserRef.current = analyser

      // Opus 128kbps — qualidade ~80% maior que default (~64kbps).
      // Fallback pro mime default se Opus nao suportado (Safari iOS antigo).
      const mimePreferido = 'audio/webm;codecs=opus'
      const mime = MediaRecorder.isTypeSupported(mimePreferido) ? mimePreferido : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 })
      chunksRef.current = []
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        audioCtxRef.current?.close().catch(() => {})
        audioCtxRef.current = null
        analyserRef.current = null
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        setNivelVolume(new Array(24).fill(0))
        setDuracaoAtual(0)

        if (blob.size === 0) return
        // Auto-envia direto: pula preview, transcreve e manda pro chat na hora.
        // Pra cancelar, vendedor usa o botao X (cancelarGravacao) durante a gravacao.
        enviarAudio(blob)
      }
      rec.start()
      recorderRef.current = rec
      startTimeRef.current = performance.now()
      setGravando(true)
      setDuracaoAtual(0)

      // Loop de visualização
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        // Pega 24 amostras espaçadas pra barras
        const bars: number[] = []
        const step = Math.floor(dataArray.length / 24)
        for (let i = 0; i < 24; i++) {
          const v = dataArray[i * step] / 255
          bars.push(v)
        }
        setNivelVolume(bars)
        setDuracaoAtual(Math.floor((performance.now() - startTimeRef.current) / 1000))
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch (e) {
      setErro(`Microfone bloqueado: ${(e as Error).message}`)
      setGravando(false)
    }
  }

  function pararGravacaoEPreview() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    setGravando(false)
  }

  function cancelarGravacao() {
    chunksRef.current = []
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      // Substituir onstop pra não criar preview
      recorderRef.current.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        audioCtxRef.current?.close().catch(() => {})
        audioCtxRef.current = null
        analyserRef.current = null
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        setNivelVolume(new Array(24).fill(0))
      }
      recorderRef.current.stop()
    } else {
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    setGravando(false)
    setAudioReview(null)
  }

  function descartarPreview() {
    if (audioReview) URL.revokeObjectURL(audioReview.url)
    setAudioReview(null)
    setReproduzindo(false)
  }

  function togglePlayPreview() {
    if (!audioReview) return
    if (!audioElRef.current) {
      audioElRef.current = new Audio(audioReview.url)
      audioElRef.current.onended = () => setReproduzindo(false)
    }
    if (reproduzindo) {
      audioElRef.current.pause()
      setReproduzindo(false)
    } else {
      audioElRef.current.currentTime = 0
      audioElRef.current.play().catch(() => {})
      setReproduzindo(true)
    }
  }

  async function enviarAudio(blobDireto?: Blob) {
    // Aceita blob direto (auto-send apos parar gravacao) OU usa audioReview
    // (fluxo antigo de preview — mantido pra backward compat caso volte).
    const blob = blobDireto ?? audioReview?.blob
    if (!blob) return
    if (!blobDireto) descartarPreview()
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
      } else if (acao.tipo === 'finalizar_orcamento' && onFinalizarOrcamento) {
        await onFinalizarOrcamento({
          enviar_whatsapp: acao.enviar_whatsapp,
          cliente_dados: acao.cliente_dados,
        })
      } else {
        setErro('Ação não suportada nesta versão')
        return
      }
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
  const inputDesabilitado = gravando || transcrevendo || !!audioReview

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => toggleDrawer(!open)}
        title="IA Branorte — montar orçamento"
        aria-label="Abrir IA Branorte"
        className={`fixed bottom-6 left-6 lg:bottom-8 lg:left-8 z-40 h-14 w-14 rounded-full shadow-xl flex items-center justify-center transition-all
                    bg-gradient-to-br from-accent to-accent/80 text-white hover:scale-105 hover:shadow-2xl ring-2 ring-accent/30
                    max-md:bottom-20`}
      >
        {(
          <div className="relative">
            <Bot className="h-6 w-6" />
            {!open && <Sparkles className="h-3 w-3 absolute -top-1 -right-1 text-yellow-300 animate-pulse" />}
          </div>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed top-0 left-0 z-30 h-screen w-full sm:w-[460px] bg-bg border-r border-border shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-gradient-to-r from-surface-2 to-surface-2/40">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center text-accent ring-1 ring-accent/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-ink leading-tight">IA Branorte</div>
              <div className="text-[11.5px] text-ink-muted truncate">
                {contexto.cliente_nome ? `Orçando: ${contexto.cliente_nome}` : 'Consultar catálogo'}
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={limparConversa}
                className="text-ink-faint hover:text-red-400 p-1.5 -m-1 rounded-md hover:bg-red-500/10 transition-colors"
                title="Limpar conversa"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => toggleDrawer(false)}
              className="text-ink-faint hover:text-ink p-1.5 -m-1 rounded-md hover:bg-surface-3 transition-colors"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Histórico */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-5 pt-6">
                <div className="text-center px-4">
                  <div className="text-[17px] font-bold text-ink mb-1.5">Monta o orçamento por voz ou texto</div>
                  <div className="text-[12.5px] text-ink-muted leading-relaxed">
                    Fale os equipamentos e quantidades — eu busco no catálogo e adiciono direto.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 px-1">
                  {SUGESTOES_INICIAIS.map(s => (
                    <button
                      key={s.text}
                      onClick={() => enviar(s.text)}
                      className="text-left p-3 rounded-xl bg-surface-2 hover:bg-surface-3 border border-border/40 hover:border-accent/40 transition-all group"
                    >
                      <div className="text-[18px] mb-1">{s.icon}</div>
                      <div className="text-[12px] font-medium text-ink-muted group-hover:text-ink leading-snug">{s.text}</div>
                    </button>
                  ))}
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2/60 border border-border/30">
                    <Mic className="h-3.5 w-3.5 text-accent" />
                    <span className="text-[11px] text-ink-faint">Aperte o microfone e fale tudo de uma vez</span>
                  </div>
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
                podeFinalizar={!!onFinalizarOrcamento}
              />
            ))}

            {enviando && (
              <div className="flex items-center gap-2.5 text-[12px] text-ink-muted px-2 animate-in fade-in">
                <div className="h-8 w-8 rounded-full bg-accent/15 flex items-center justify-center text-accent">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                </div>
                <TypingDots />
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
                <span className="break-words flex-1">{erro}</span>
                <button onClick={() => setErro(null)} className="text-red-400/60 hover:text-red-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Footer: gravação / preview / input */}
          <div className="border-t border-border bg-surface-2/40 p-3">
            {gravando ? (
              <BarraGravacao
                niveis={nivelVolume}
                duracao={duracaoAtual}
                onCancelar={cancelarGravacao}
                onParar={pararGravacaoEPreview}
              />
            ) : audioReview ? (
              <BarraPreviewAudio
                duracao={audioReview.duracao}
                reproduzindo={reproduzindo}
                onTogglePlay={togglePlayPreview}
                onDescartar={descartarPreview}
                onEnviar={enviarAudio}
              />
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Pergunte algo ou peça um pacote…"
                    rows={1}
                    disabled={inputDesabilitado}
                    className="flex-1 resize-none rounded-2xl bg-bg border border-border px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 max-h-[140px] transition-shadow"
                    style={{ minHeight: '44px' }}
                  />
                  <button
                    onClick={iniciarGravacao}
                    disabled={enviando || transcrevendo}
                    title="Gravar áudio"
                    className="h-11 w-11 shrink-0 rounded-full bg-surface-3 text-ink-muted hover:text-accent hover:bg-accent/10 hover:ring-2 hover:ring-accent/30 flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Mic className="h-4.5 w-4.5" />
                  </button>
                  <button
                    onClick={() => enviar()}
                    disabled={!podeEnviar}
                    className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-accent to-accent/80 text-white flex items-center justify-center hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all shadow-md disabled:shadow-none"
                    title="Enviar (Enter)"
                  >
                    <Send className="h-4 w-4 ml-0.5" />
                  </button>
                </div>
                <div className="text-[10px] text-ink-faint mt-2 px-1 flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                  gpt-5.4-mini · catálogo oficial · Enter envia, Shift+Enter pula linha
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================================
// COMPONENTES AUXILIARES
// ============================================================================

function TypingDots() {
  return (
    <div className="flex gap-1 py-2 px-3 bg-surface-2 border border-border/60 rounded-2xl rounded-bl-sm">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-muted animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-muted animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-muted animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  )
}

function formatTempo(s: number): string {
  const min = Math.floor(s / 60).toString().padStart(1, '0')
  const seg = (s % 60).toString().padStart(2, '0')
  return `${min}:${seg}`
}

function BarraGravacao({
  niveis,
  duracao,
  onCancelar,
  onParar,
}: {
  niveis: number[]
  duracao: number
  onCancelar: () => void
  onParar: () => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        onClick={onCancelar}
        className="h-11 w-11 shrink-0 rounded-full bg-surface-3 text-red-400 hover:bg-red-500/10 hover:ring-2 hover:ring-red-500/30 flex items-center justify-center transition-all"
        title="Cancelar (descartar)"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <div className="flex-1 h-11 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 px-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
        <div className="flex-1 flex items-center gap-[2px] h-6">
          {niveis.map((n, i) => (
            <div
              key={i}
              className="flex-1 bg-red-400 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(8, n * 100)}%`, minHeight: '3px' }}
            />
          ))}
        </div>
        <span className="text-[12px] font-mono text-red-300 tabular-nums shrink-0">
          {formatTempo(duracao)}
        </span>
      </div>
      <button
        onClick={onParar}
        className="h-11 w-11 shrink-0 rounded-full bg-accent text-white flex items-center justify-center hover:scale-105 transition-all shadow-md"
        title="Parar e revisar"
      >
        <Check className="h-4.5 w-4.5" />
      </button>
    </div>
  )
}

function BarraPreviewAudio({
  duracao,
  reproduzindo,
  onTogglePlay,
  onDescartar,
  onEnviar,
}: {
  duracao: number
  reproduzindo: boolean
  onTogglePlay: () => void
  onDescartar: () => void
  onEnviar: () => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        onClick={onDescartar}
        className="h-11 w-11 shrink-0 rounded-full bg-surface-3 text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-all"
        title="Descartar"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <div className="flex-1 h-11 rounded-2xl bg-accent/10 border border-accent/30 flex items-center gap-2.5 px-3">
        <button
          onClick={onTogglePlay}
          className="h-7 w-7 shrink-0 rounded-full bg-accent/20 text-accent hover:bg-accent/30 flex items-center justify-center transition-colors"
          title={reproduzindo ? 'Pausar' : 'Ouvir'}
        >
          {reproduzindo ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
        </button>
        <div className="flex-1 flex items-center gap-[2px]">
          {/* Waveform estática decorativa */}
          {Array.from({ length: 24 }).map((_, i) => {
            const h = 30 + Math.sin(i * 0.7) * 25 + Math.cos(i * 0.3) * 15
            return (
              <div
                key={i}
                className="flex-1 bg-accent/50 rounded-full"
                style={{ height: `${Math.max(15, h)}%`, minHeight: '4px' }}
              />
            )
          })}
        </div>
        <span className="text-[12px] font-mono text-accent tabular-nums shrink-0">
          {formatTempo(duracao)}
        </span>
      </div>
      <button
        onClick={onEnviar}
        className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-accent to-accent/80 text-white flex items-center justify-center hover:scale-105 transition-all shadow-md"
        title="Enviar áudio"
      >
        <Send className="h-4 w-4 ml-0.5" />
      </button>
    </div>
  )
}

function ChatMessageBubble({
  msg,
  onAplicarAcao,
  podeAdicionarItem,
  podeCarregarPacote,
  podePreencherCliente,
  podeFinalizar,
}: {
  msg: Msg
  onAplicarAcao: (idx: number) => void
  podeAdicionarItem: boolean
  podeCarregarPacote: boolean
  podePreencherCliente: boolean
  podeFinalizar: boolean
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="h-7 w-7 shrink-0 rounded-full bg-accent/15 flex items-center justify-center text-accent ring-1 ring-accent/20">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${
          isUser
            ? 'bg-gradient-to-br from-accent to-accent/90 text-white rounded-br-sm'
            : 'bg-surface-2 text-ink border border-border/40 rounded-bl-sm'
        }`}
      >
        <MarkdownLite text={msg.content} />

        {!isUser && msg.acoes && msg.acoes.length > 0 && (() => {
          const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
          const subtotalPendente = msg.acoes.reduce((acc, acao, idx) => {
            if (msg.acoesAplicadas?.has(idx)) return acc
            if (acao.tipo === 'adicionar_item') {
              return acc + (acao.preview?.valor_equipamento ?? 0) * acao.quantidade
            }
            return acc
          }, 0)
          const qtdAdicionar = msg.acoes.filter((a, i) => !msg.acoesAplicadas?.has(i) && a.tipo === 'adicionar_item').length
          return (
            <div className="mt-2.5 space-y-1.5">
              {msg.acoes.map((acao, i) => {
                const aplicada = msg.acoesAplicadas?.has(i)
                const podeAplicar =
                  acao.tipo === 'adicionar_item'
                    ? podeAdicionarItem
                    : acao.tipo === 'carregar_pacote'
                    ? podeCarregarPacote
                    : acao.tipo === 'preencher_cliente'
                    ? podePreencherCliente
                    : acao.tipo === 'finalizar_orcamento'
                    ? podeFinalizar
                    : false
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
                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-accent/15 border border-accent/40 text-[11.5px]">
                  <span className="text-ink-muted">
                    {qtdAdicionar} {qtdAdicionar === 1 ? 'item' : 'itens'} pendente{qtdAdicionar === 1 ? '' : 's'}
                  </span>
                  <span className="font-bold text-accent tabular-nums">
                    {fmtBRL(subtotalPendente)}
                  </span>
                </div>
              )}
            </div>
          )
        })()}

        {!isUser && msg.tool_trace && msg.tool_trace.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-border/30 text-[10px] text-ink-faint flex flex-wrap gap-1">
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
  } else if (acao.tipo === 'preencher_cliente') {
    icone = <User className="h-3.5 w-3.5" />
    titulo = 'Preencher dados do cliente'
    const campos = Object.keys(acao.dados).length
    subtitulo = `${campos} ${campos === 1 ? 'campo' : 'campos'}`
    detalhe = Object.entries(acao.dados)
      .map(([k, v]) => `${k}: ${v}`)
      .slice(0, 3)
      .join(' · ')
  } else {
    icone = <Rocket className="h-3.5 w-3.5" />
    titulo = 'Finalizar + Enviar pro meu WhatsApp'
    subtitulo = acao.enviar_whatsapp !== false
      ? 'Gera PDF/DOCX, salva e dispara WhatsApp'
      : 'Gera PDF/DOCX e salva no servidor'
    const clienteParts = acao.cliente_dados
      ? Object.entries(acao.cliente_dados).map(([k, v]) => `${k}: ${v}`).slice(0, 2).join(' · ')
      : null
    detalhe = clienteParts || 'Modal abre pra confirmar dados do cliente'
  }

  return (
    <div
      className={`rounded-xl border p-2.5 transition-all ${
        aplicada
          ? 'bg-emerald-500/10 border-emerald-500/40'
          : 'bg-bg/70 border-border/60 hover:border-accent/40'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`h-7 w-7 rounded-lg shrink-0 flex items-center justify-center ${
            aplicada ? 'bg-emerald-500 text-white' : 'bg-accent/15 text-accent'
          }`}
        >
          {aplicada ? <Check className="h-3.5 w-3.5" /> : icone}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold leading-tight">{titulo}</div>
          <div className="text-[11px] text-ink-muted mt-0.5">{subtitulo}</div>
          {detalhe && (
            <div className="text-[10.5px] text-ink-faint mt-0.5 break-words">{detalhe}</div>
          )}
        </div>
      </div>
      {!aplicada && (
        <button
          onClick={onAplicar}
          disabled={!podeAplicar}
          title={!podeAplicar ? 'Função não disponível nesta tela' : ''}
          className="mt-2 w-full text-[11.5px] py-1.5 rounded-lg font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {acao.tipo === 'carregar_pacote' ? 'Carregar pacote' : 'Aplicar'}
        </button>
      )}
      {aplicada && (
        <div className="mt-1.5 text-[11px] text-emerald-400 font-medium px-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Aplicado ao orçamento
        </div>
      )}
    </div>
  )
}

function MarkdownLite({ text }: { text: string }) {
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
    if (/^\|[\s:|-]+\|$/.test(ln.trim())) continue
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
