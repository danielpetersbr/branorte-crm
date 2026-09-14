import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Mic, Send, Square, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { OrcamentoAISnapshot, PropostaOrcamento } from '@/lib/orcamento-ai/types'
import { useOrcamentoAI } from '@/hooks/useOrcamentoAI'
import { OrcamentoAIProposalCard } from './OrcamentoAIProposalCard'
import { compactChatMessage } from '@/lib/orcamento-ai/chat-display'

interface Props {
  snapshot: OrcamentoAISnapshot
  onApplyProposal: (proposal: PropostaOrcamento) => void | Promise<void>
  onRequestFinalize: () => void
  onDrawerToggle?: (open: boolean) => void
}

export function OrcamentoAIChat({ snapshot, onApplyProposal, onRequestFinalize, onDrawerToggle }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [appliedProposalId, setAppliedProposalId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, proposal, questions, loading, error, send, clear, recordEvent } = useOrcamentoAI(snapshot)

  function toggle(value: boolean) { setOpen(value); onDrawerToggle?.(value) }
  useEffect(() => {
    if (open) document.body.dataset.aiDrawerOpen = '1'
    else delete document.body.dataset.aiDrawerOpen
    return () => { delete document.body.dataset.aiDrawerOpen }
  }, [open])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, proposal, loading])
  useEffect(() => { setAppliedProposalId(null) }, [proposal?.id])
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()) }, [])

  async function submit() {
    const text = input.trim()
    if (!text) return
    setInput('')
    await send(text)
  }

  async function startRecording() {
    setLocalError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size) void transcribe(blob)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (cause) {
      setLocalError(`Microfone bloqueado: ${cause instanceof Error ? cause.message : 'sem permissão'}`)
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    setRecording(false)
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sessão expirada — faça login novamente.')
      const response = await fetch('/api/orcamento-ai-transcrever', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: await blobToBase64(blob), mime: 'audio/webm' }),
      })
      const result = await response.json() as { text?: string; error?: string }
      if (!response.ok) throw new Error(result.error || 'Falha na transcrição.')
      if (!result.text?.trim()) throw new Error('Não entendi o áudio. Tente novamente.')
      await send(result.text)
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Falha na transcrição.')
    } finally { setTranscribing(false) }
  }

  async function apply() {
    if (!proposal) return
    setApplying(true)
    setLocalError(null)
    try { await onApplyProposal(proposal); setAppliedProposalId(proposal.id); void recordEvent('applied', proposal.id, snapshot.orcamentoId) }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Não foi possível aplicar a proposta.') }
    finally { setApplying(false) }
  }

  return <>
    <button type="button" onClick={() => toggle(true)} className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 sm:bottom-20 sm:left-4 z-40 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl sm:rounded-full bg-emerald-600 text-white shadow-xl ring-1 ring-white/20 hover:bg-emerald-700" aria-label="Abrir Orçamentista Branorte"><Bot size={24} /></button>
    {open && <div className="fixed inset-0 z-40 bg-black/30" onClick={() => toggle(false)} />}
    <aside className={`fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-full max-w-none sm:max-w-2xl flex-col bg-slate-100 text-slate-900 shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`} aria-hidden={!open}>
      <header className="flex shrink-0 items-center justify-between bg-slate-950 px-3 py-2.5 sm:px-4 sm:py-3 text-white shadow-sm">
        <div className="min-w-0"><p className="flex items-center gap-2 text-[15px] font-semibold leading-tight"><Bot size={19} /> Orçamentista Branorte</p><p className="mt-0.5 truncate text-[10px] sm:text-xs text-slate-300">Monta, confere e só aplica com sua autorização</p></div>
        <div className="flex gap-1"><button type="button" onClick={() => { if (!messages.length || confirm('Limpar a conversa?')) clear() }} className="rounded p-2 hover:bg-white/10" aria-label="Limpar conversa"><Trash2 size={18} /></button><button type="button" onClick={() => toggle(false)} className="rounded p-2 hover:bg-white/10" aria-label="Fechar"><X size={20} /></button></div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 pb-5 sm:p-4">
        {!messages.length && <div className="rounded-2xl border border-emerald-200 bg-white p-3.5 sm:p-4 text-[13px] sm:text-sm leading-relaxed text-slate-700 shadow-sm"><span className="mb-1 block font-semibold text-emerald-800">Comece por aqui</span>Envie os dados do cliente e diga o modelo ou os equipamentos. Exemplo: “Ronaldo Biazi, Hidrolândia/GO, Compacta 03 Master 150500-4000-4000 monofásica”.</div>}
        {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`max-w-[96%] sm:max-w-[92%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-[13px] sm:text-sm leading-relaxed ${message.role === 'user' ? 'ml-auto rounded-br-md bg-emerald-700 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900 shadow-sm'}`}>{compactChatMessage(message.content)}</div>)}
        {questions.flatMap((question) => question.options ?? []).length > 0 && <div className="rounded-xl border border-slate-300 bg-white p-4 text-slate-900 shadow-sm"><p className="mb-3 text-sm font-bold">Escolha o modelo correto:</p><div className="space-y-2">{questions.flatMap((question) => question.options ?? []).map((option) => <button key={option.id} type="button" onClick={() => void send(`Confirmo o modelo: ${option.label}`, option.id)} className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-900 hover:border-emerald-600 hover:bg-emerald-50">{option.label}</button>)}</div></div>}
        {proposal && <OrcamentoAIProposalCard proposal={proposal} applied={appliedProposalId === proposal.id} applying={applying} onApply={apply} onCorrect={() => inputRef.current?.focus()} onFinalize={onRequestFinalize} />}
        {(loading || transcribing) && <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" />{transcribing ? 'Transcrevendo áudio…' : 'Montando e conferindo a proposta…'}</div>}
        {(error || localError) && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{localError || error}</p>}
      </div>
      <footer className="shrink-0 border-t border-slate-200 bg-white px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3"><div className="flex items-end gap-2">
        <button type="button" disabled={loading || transcribing} onClick={recording ? stopRecording : startRecording} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${recording ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`} aria-label={recording ? 'Parar gravação' : 'Gravar áudio'}>{recording ? <Square size={17} /> : <Mic size={20} />}</button>
        <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} rows={1} placeholder="Digite o pedido do orçamento…" className="min-h-11 max-h-28 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-[13px] sm:text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
        <button type="button" disabled={!input.trim() || loading || transcribing} onClick={() => void submit()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white disabled:bg-slate-300" aria-label="Enviar"><Send size={19} /></button>
      </div></footer>
    </aside>
  </>
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
