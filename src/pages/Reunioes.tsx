import { useState, useRef, useEffect, type InputHTMLAttributes } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowLeft, CalendarClock, ClipboardList, CheckCircle2, Circle, PlayCircle, Mic, Square, Loader2, Sparkles, FileText, MessageSquare, Link2, Copy, Check, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  useReunioes, useCriarReuniao, useAtualizarReuniao, useExcluirReuniao, useGravacoes,
  useGarantirLinkFeedback, useReuniaoFeedbacks, useFeedbackContagem, useMarcarFeedbackLido, useExcluirFeedback,
  type Reuniao, type PautaItem, type ReuniaoStatus, type Gravacao, type ApresentacaoManifesto,
} from '@/hooks/useReunioes'
import { Apresentacao } from '@/components/reunioes/Apresentacao'
import { ReunioesLista } from '@/components/reunioes/ReunioesLista'
import './Reunioes.css'
import type { AtualizacaoReuniao } from '@/lib/reunioes-updates'

// ============================================================================
// Adm de Reunião — organiza a PAUTA antes, marca as tarefas DURANTE (checkbox),
// e guarda o RESUMO depois. Lista de reuniões → editor de uma reunião.
// ============================================================================

const STATUS_META: Record<ReuniaoStatus, { label: string; cls: string; icon: typeof Circle }> = {
  planejada:    { label: 'Planejada',    cls: 'text-info bg-info/10 border-info/30',       icon: Circle },
  em_andamento: { label: 'Em andamento', cls: 'text-warning bg-warning/10 border-warning/30', icon: PlayCircle },
  concluida:    { label: 'Concluída',    cls: 'text-success bg-success/10 border-success/30', icon: CheckCircle2 },
}
const STATUS_ORDER: ReuniaoStatus[] = ['planejada', 'em_andamento', 'concluida']

// timestamptz ISO → valor do <input type="datetime-local"> (hora local, sem fuso)
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function uid(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `i${Date.now()}${Math.round(Math.random() * 1e6)}`
}
function fmtDur(seg: number): string {
  const m = Math.floor(seg / 60), s = seg % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Chama o endpoint de IA das reuniões (transcrever/resumo) com o JWT da sessão.
async function callReuniaoIA(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/reuniao-ia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json?.detail as string) || (json?.error as string) || `HTTP ${res.status}`)
  return json
}

// Bloco que não conseguiu ser salvo. Fica guardado em memória pra reenvio manual
// — 15 min de reunião não podem sumir por uma falha de rede (foi o que a reunião
// de 12/08/2026 perdeu: o bloco das 13:51 nunca chegou no Storage).
interface Pendente { id: string; blob: Blob; durSeg: number; parte: string; motivo: string }

function BaixarBloco({ pendente }: { pendente: Pendente }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(pendente.blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [pendente.blob])
  return url ? <a href={url} download={`bloco-${pendente.parte}.webm`} className="shrink-0 text-[11px] text-accent hover:underline">Baixar</a> : null
}

// Gravador de áudio da reunião: MediaRecorder (mic) → Blob → Supabase Storage
// (bucket reunioes-audio, público) → devolve a Gravacao pra salvar na reunião.

function Gravador({ reuniaoId, onAdd, onOcupado }: { reuniaoId: string; onAdd: (g: Gravacao) => Promise<void>; onOcupado: (v: boolean) => void }) {
  // O upload de um bloco só acontece até 15 min depois de o recorder abrir — o
  // onAdd capturado ali carrega uma lista de gravações velha e sobrescreve os
  // blocos já salvos. A ref aponta sempre pro onAdd do render atual.
  const onAddRef = useRef(onAdd)
  useEffect(() => { onAddRef.current = onAdd })
  const [rec, setRec] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadsEmCurso, setUploadsEmCurso] = useState(0)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [reenviando, setReenviando] = useState<string | null>(null)
  const mrRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const segTimerRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const segStartRef = useRef<number>(0)
  const stoppingRef = useRef<boolean>(false)
  const partRef = useRef<number>(0)

  // Fatiamento automático: cada bloco tem no máx. 15 min — bem abaixo do limite
  // de ~25 min do modelo gpt-4o-transcribe (áudio maior é rejeitado pela OpenAI
  // como "corrupted or unsupported"). Cada bloco vira uma gravação curta,
  // transcrita à parte; o resumo junta todas. Reunião de qualquer duração passa.
  const SEG_MS = 15 * 60 * 1000

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const stopSegTimer = () => { if (segTimerRef.current) { clearInterval(segTimerRef.current); segTimerRef.current = null } }
  // Ao desmontar, fecha o bloco corrente ANTES de soltar o microfone — sem o
  // stop() o onstop nunca dispara e o áudio já gravado morre com o componente.
  useEffect(() => () => {
    stopTimer(); stopSegTimer()
    stoppingRef.current = true
    try { mrRef.current?.stop() } catch { /* noop */ }
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  // Fechar a aba gravando descarta o bloco em curso (até 15 min) e qualquer
  // bloco que ainda não subiu. O navegador só deixa avisar, não impedir.
  // O mesmo estado trava o botão "voltar" da tela (o Editor desmontaria o
  // gravador e o áudio do bloco corrente morreria em silêncio).
  const ocupado = rec || starting || uploading || uploadsEmCurso > 0 || pendentes.length > 0
  useEffect(() => { onOcupado(ocupado) }, [ocupado, onOcupado])
  useEffect(() => {
    if (!ocupado) return
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [ocupado])

  // Sobe um bloco pro Storage e registra na reunião. O nome do arquivo (epoch +
  // nº da parte) é decidido UMA vez, fora do retry: antes o contador era
  // incrementado dentro da função de upload, então cada tentativa queimava um
  // número e abria buraco na numeração. Com o path fixo + upsert, reenviar o
  // mesmo bloco sobrescreve em vez de duplicar. Só mexe no estado de UI
  // (uploading) no bloco final — os intermediários sobem em silêncio, sem
  // interromper a gravação em curso.
  // Em 12/08 a queda de rede durou mais que os 2 s de espera da versão anterior e
  // menos que os 15 min até o bloco seguinte (que subiu em 0,79 s). Esperar mais
  // não atrapalha nada — o upload roda em paralelo à gravação.
  const ESPERAS = [5_000, 20_000, 60_000, 180_000]

  const subirBloco = async (blob: Blob, durSeg: number, parte: string): Promise<void> => {
    const path = `${reuniaoId}/${parte}.webm`
    let ultimoErro = ''
    for (let i = 0; i <= ESPERAS.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, ESPERAS[i - 1]))
      const { error } = await supabase.storage.from('reunioes-audio')
        .upload(path, blob, { contentType: blob.type || 'audio/webm', upsert: true })
      if (!error) {
        const { data: pub } = supabase.storage.from('reunioes-audio').getPublicUrl(path)
        // Registrar na linha pode falhar mesmo com o áudio já no Storage — nesse
        // caso o bloco vira órfão. Deixa o erro subir pra virar pendente.
        await onAddRef.current({ id: uid(), url: pub.publicUrl, path, duracao_seg: durSeg, created_at: new Date().toISOString() })
        return
      }
      ultimoErro = error.message || 'erro no upload'
    }
    throw new Error(ultimoErro)
  }

  const finalize = async (blob: Blob, durSeg: number, isFinal: boolean) => {
    if (blob.size === 0) { if (isFinal) setUploading(false); return }
    if (isFinal) setUploading(true)
    setUploadsEmCurso(n => n + 1)
    const parte = `${Date.now()}-${(partRef.current++).toString().padStart(2, '0')}`
    try {
      await subirBloco(blob, durSeg, parte)
    } catch (e) {
      const motivo = (e as Error)?.message || 'erro'
      setPendentes(p => [...p, { id: uid(), blob, durSeg, parte, motivo }])
      setErr(`Um bloco de ${fmtDur(durSeg)} não subiu (${motivo}). Ele está guardado aqui embaixo — clique em "Reenviar" antes de fechar a página.`)
    } finally {
      if (isFinal) setUploading(false)
      setUploadsEmCurso(n => n - 1)
    }
  }

  const reenviar = async (p: Pendente) => {
    setReenviando(p.id); setErr(null)
    try {
      await subirBloco(p.blob, p.durSeg, p.parte)
      setPendentes(list => list.filter(x => x.id !== p.id))
    } catch (e) {
      setErr('Ainda não foi: ' + ((e as Error)?.message || 'erro'))
    } finally { setReenviando(null) }
  }

  const start = async () => {
    if (starting || rec) return
    setErr(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Seu navegador não suporta gravação.'); return
    }
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      stoppingRef.current = false
      partRef.current = 0
      // Micro desconectado no meio da reunião: sem isto a tela seguia "gravando".
      stream.getAudioTracks()[0]?.addEventListener('ended', () =>
        encerrarPorFalha('O microfone foi desconectado e a gravação parou. O que já subiu está salvo.'))
      startRecorder()
      startRef.current = Date.now()
      setElapsed(0)
      setRec(true)
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 500)
      segTimerRef.current = window.setInterval(rotate, SEG_MS)
    } catch {
      streamRef.current?.getTracks().forEach(t => t.stop())
      setErr('Não deu pra acessar o microfone — permita o acesso no navegador.')
    } finally { setStarting(false) }
  }

  // Abre um MediaRecorder num bloco novo. Cada recorder acumula no seu próprio
  // array (não num ref compartilhado) pra não perder chunks durante a rotação.
  const startRecorder = () => {
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    // 32 kbps mono: voz nítida e leve. Bloco de 15 min ≈ 3,4 MB.
    const mrOpts: MediaRecorderOptions = { audioBitsPerSecond: 32000 }
    if (mime) mrOpts.mimeType = mime
    const mr = new MediaRecorder(streamRef.current!, mrOpts)
    const localChunks: Blob[] = []
    const segStart = Date.now()
    segStartRef.current = segStart
    mr.ondataavailable = e => { if (e.data.size > 0) localChunks.push(e.data) }
    mr.onerror = () => encerrarPorFalha('O gravador falhou e a gravação parou. O que já subiu está salvo.')
    mr.onstop = () => {
      const durSeg = Math.max(1, Math.round((Date.now() - segStart) / 1000))
      void finalize(new Blob(localChunks, { type: mr.mimeType || 'audio/webm' }), durSeg, stoppingRef.current)
    }
    // timeslice: o encoder entrega pedaço a cada 30 s em vez de só no stop().
    // Não salva do crash de aba, mas reduz o que fica preso no encoder.
    mr.start(30_000)
    mrRef.current = mr
  }

  // Fecha o bloco atual (dispara o upload dele) e abre o próximo — sem soltar o
  // microfone. Chamado a cada SEG_MS enquanto a reunião está sendo gravada.
  const rotate = () => {
    if (stoppingRef.current) return
    try { mrRef.current?.stop() } catch { /* noop */ }
    // Se o micro sumiu (máquina dormiu, outro app pegou o device), abrir o
    // recorder novo lança. Sem este catch a exceção escapava do setInterval e a
    // tela seguia contando "Parar · 1:12:33" com nada sendo gravado.
    try { startRecorder() } catch {
      encerrarPorFalha('A gravação parou sozinha (o microfone foi perdido). Clique em "Gravar reunião" pra retomar — o que já subiu está salvo.')
    }
  }

  // Para tudo sem tentar salvar o bloco corrente (ele já se perdeu).
  const encerrarPorFalha = (msg: string) => {
    stopTimer(); stopSegTimer()
    stoppingRef.current = true
    streamRef.current?.getTracks().forEach(t => t.stop())
    setRec(false); setUploading(false)
    setErr(msg)
  }

  const stop = () => {
    stopTimer()
    stopSegTimer()
    stoppingRef.current = true
    // Só prometer "Salvando…" se existe mesmo um bloco pra salvar: se o recorder
    // já morreu, o onstop nunca dispara e a tela travava nesse estado pra sempre.
    const vivo = mrRef.current?.state === 'recording'
    if (vivo) setUploading(true)
    try { mrRef.current?.stop() } catch { /* noop */ }
    streamRef.current?.getTracks().forEach(t => t.stop())
    setRec(false)
  }

  return (
    <div>
      {rec ? (
        <button onClick={stop} className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg bg-danger text-white text-[13px] font-semibold shadow-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/70" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
          </span>
          <Square className="h-3.5 w-3.5" /> Parar · {fmtDur(elapsed)}
        </button>
      ) : uploading || uploadsEmCurso > 0 ? (
        <span className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg bg-surface-2 text-ink-muted text-[13px] font-medium">
          <Loader2 className="h-4 w-4 animate-spin" /> Salvando gravação…
        </span>
      ) : (
        <button onClick={start} disabled={starting} className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 text-danger text-[13px] font-semibold hover:bg-danger/15 transition-colors">
          <Mic className="h-4 w-4" /> {starting ? 'Abrindo microfone…' : 'Gravar reunião'}
        </button>
      )}
      {rec && <p className="text-[11px] text-ink-muted mt-1.5">Salvando em blocos de 15 min — cada bloco é transcrito à parte.</p>}
      {err && <p className="text-[11px] text-danger mt-1.5">{err}</p>}
      {pendentes.length > 0 && (
        <div className="mt-2 rounded-lg border border-danger/40 bg-danger/5 p-2 space-y-1.5">
          <p className="text-[11px] font-semibold text-danger">
            {pendentes.length} bloco{pendentes.length > 1 ? 's' : ''} não salvo{pendentes.length > 1 ? 's' : ''} — não feche esta página sem reenviar.
          </p>
          {pendentes.map(p => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted flex-1 truncate">Bloco de {fmtDur(p.durSeg)} · {p.motivo}</span>
              {/* Escape final: se nem o reenvio for, dá pra salvar o áudio no
                  disco e subir depois, em vez de perder a reunião. */}
              <BaixarBloco pendente={p} />
              <button
                onClick={() => reenviar(p)}
                disabled={reenviando === p.id}
                className="shrink-0 h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-danger text-white text-[11px] font-semibold disabled:opacity-60"
              >
                {reenviando === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Reenviar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Reunioes() {
  const { data: reunioes = [], isLoading, error, refetch } = useReunioes()
  const { data: contagem = {} } = useFeedbackContagem()
  const criar = useCriarReuniao()
  const [selId, setSelId] = useState<string | null>(null)
  const sel = reunioes.find(r => r.id === selId) ?? null

  const novaReuniao = () => {
    if (criar.isPending) return
    const agora = new Date()
    agora.setMinutes(0, 0, 0)
    criar.mutate(
      { titulo: 'Nova reunião', data_reuniao: agora.toISOString() },
      { onSuccess: (r) => setSelId(r.id), onError: () => toast.error('Não foi possível criar a reunião. Tente novamente.') },
    )
  }

  return (
    <div className="reunioes-page">
      {sel ? <Editor key={sel.id} reuniao={sel} onVoltar={() => setSelId(null)} /> :
        <ReunioesLista reunioes={reunioes} contagem={contagem} isLoading={isLoading} error={error}
          onRetry={() => { void refetch() }} onCreate={novaReuniao} creating={criar.isPending} onOpen={setSelId} />}
    </div>
  )
}

// Atualizações remotas podem atualizar o campo, sem apagar uma digitação em curso.
function CampoAoSair({ value, onCommit, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(value) }, [value])
  return <input {...props} value={draft} onFocus={() => { focused.current = true }} onChange={event => setDraft(event.target.value)} onBlur={() => {
    focused.current = false
    const trimmed = draft.trim()
    if (props.required && !trimmed) { setDraft(value); return }
    setDraft(trimmed)
    if (trimmed !== value) onCommit(trimmed)
  }} />
}

function TextoItem({ value, onCommit, done = false, label = 'Descrição do item', className = '' }: { value: string; onCommit: (value: string) => void; done?: boolean; label?: string; className?: string }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (!focused.current) setDraft(value) }, [value])
  useEffect(() => {
    const ajustarAltura = () => { if (field.current) { field.current.style.height = 'auto'; field.current.style.height = `${field.current.scrollHeight}px` } }
    ajustarAltura()
    window.addEventListener('resize', ajustarAltura)
    return () => window.removeEventListener('resize', ajustarAltura)
  }, [draft])
  return <textarea ref={field} rows={2} aria-label={label} value={draft}
    onFocus={() => { focused.current = true }} onChange={event => setDraft(event.target.value)}
    onBlur={() => { focused.current = false; const text = draft.trim(); setDraft(text || value); if (text && text !== value) onCommit(text) }}
    className={`reuniao-item-text${done ? ' is-done' : ''} ${className}`} />
}

// Lista com checkbox reutilizável — serve tanto pra Pauta (tópicos) quanto
// pra Tarefas (ações + responsável). Gerencia seu próprio input de "adicionar".
function ChecklistSection({ titulo, sub, icon: Icon, iconCls, doneCls, items, onChange, showResp, placeholder, emptyHint }: {
  titulo: string; sub: string; icon: typeof ClipboardList; iconCls: string; doneCls: string
  items: PautaItem[]; onChange: (items: PautaItem[]) => void; showResp: boolean; placeholder: string; emptyHint: string
}) {
  const [novo, setNovo] = useState('')
  const feitos = items.filter(i => i.feito).length
  const add = () => { const t = novo.trim(); if (!t) return; onChange([...items, { id: uid(), texto: t, feito: false }]); setNovo('') }
  const toggle = (id: string) => onChange(items.map(p => p.id === id ? { ...p, feito: !p.feito } : p))
  const editTexto = (id: string, texto: string) => onChange(items.map(p => p.id === id ? { ...p, texto } : p))
  const editResp = (id: string, responsavel: string) => onChange(items.map(p => p.id === id ? { ...p, responsavel: responsavel || undefined } : p))
  const remove = (id: string) => onChange(items.filter(p => p.id !== id))
  return (
    <section className="reuniao-section">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="reuniao-section-title">
          <Icon className={`h-4 w-4 ${iconCls}`} /> {titulo}
          <span className="reuniao-section-subtitle">{sub}</span>
        </h2>
        {items.length > 0 && <span className="text-[11px] text-ink-faint tabular-nums">{feitos}/{items.length}</span>}
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <div key={item.id} className="reuniao-checklist-row">
            <button onClick={() => toggle(item.id)} className="reuniao-check" role="checkbox" aria-checked={item.feito} aria-label={`${item.feito ? 'Desmarcar' : 'Marcar'}: ${item.texto}`}>
              {item.feito
                ? <CheckCircle2 className={`h-[18px] w-[18px] ${doneCls}`} />
                : <Circle className="h-[18px] w-[18px] text-ink-faint hover:text-accent transition-colors" />}
            </button>
            <TextoItem value={item.texto} onCommit={value => editTexto(item.id, value)} done={item.feito} />
            {showResp && (
              <CampoAoSair
                aria-label="Responsável pela tarefa"
                value={item.responsavel ?? ''}
                onCommit={value => editResp(item.id, value)}
                placeholder="Responsável"
                className="reuniao-responsavel w-28 shrink-0 bg-surface border border-border/60 rounded px-1.5 py-0.5 text-[11px] text-ink-muted outline-none focus:border-accent placeholder:text-ink-faint/60"
              />
            )}
            <button onClick={() => remove(item.id)} className="reuniao-remove" title="Remover item" aria-label={`Remover: ${item.texto}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[11px] text-ink-faint px-1 py-1">{emptyHint}</p>}
      </div>
      <div className="reuniao-add-item">
        <Plus className="h-4 w-4 text-ink-faint shrink-0" />
        <input
          aria-label={placeholder}
          value={novo}
          onChange={e => setNovo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
        />
        {novo.trim() && <button onClick={add} className="shrink-0 h-7 px-2.5 rounded-md bg-accent text-white text-[12px] font-semibold">Adicionar</button>}
      </div>
    </section>
  )
}

function Editor({ reuniao, onVoltar }: { reuniao: Reuniao; onVoltar: () => void }) {
  const { profile } = useAuth()
  const podeEditarApresentacao = profile?.role === 'admin' || String(profile?.role) === 'owner'
  const [falhaSalvamento, setFalhaSalvamento] = useState<AtualizacaoReuniao | null>(null)
  const atualizar = useAtualizarReuniao(setFalhaSalvamento)
  const excluir = useExcluirReuniao()
  const [confirmDel, setConfirmDel] = useState(false)
  const [resumoLocal, setResumoLocal] = useState(reuniao.resumo)
  const resumoDirty = useRef(false)
  const [resumoSujo, setResumoSujo] = useState(false)
  const escritasPendentes = useIsMutating({ mutationKey: ['reunioes-update'] })
  useEffect(() => { if (!resumoDirty.current) setResumoLocal(reuniao.resumo) }, [reuniao.resumo])
  useEffect(() => {
    const avisar = (event: BeforeUnloadEvent) => {
      if (resumoDirty.current || escritasPendentes > 0) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [escritasPendentes])
  const [transcrevendo, setTranscrevendo] = useState<string | null>(null)
  const [lote, setLote] = useState<{ feitos: number; total: number } | null>(null)
  const [resumindo, setResumindo] = useState(false)
  const [iaErr, setIaErr] = useState<string | null>(null)
  const [transcrErr, setTranscrErr] = useState<string | null>(null)
  const [gravando, setGravando] = useState(false)
  const gravacoes = useGravacoes()
  // O bucket é PRIVADO (áudio de reunião de diretoria não pode abrir por link
  // solto). O player e o download usam URL assinada, gerada sob demanda a partir
  // do `path` — a `url` pública gravada no jsonb das gravações antigas não vale
  // mais. Uma chamada em lote por reunião; 2h cobre a sessão.
  const [assinadas, setAssinadas] = useState<Record<string, string>>({})
  const [audioError, setAudioError] = useState(false)
  const [audioAttempt, setAudioAttempt] = useState(0)
  const paths = reuniao.gravacoes.map(g => g.path).join('|')
  useEffect(() => {
    const lista = paths ? paths.split('|') : []
    if (lista.length === 0) { setAssinadas({}); return }
    let vivo = true
    setAudioError(false)
    supabase.storage.from('reunioes-audio').createSignedUrls(lista, 7200).then(({ data, error }) => {
      if (!vivo) return
      if (error || !data) { setAudioError(true); return }
      const mapa: Record<string, string> = {}
      data.forEach(d => { if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl })
      setAssinadas(mapa)
      setAudioError(lista.some(path => !mapa[path]))
    }).catch(() => { if (vivo) setAudioError(true) })
    return () => { vivo = false }
  }, [paths, audioAttempt])
  const naoTranscritos = reuniao.gravacoes.filter(g => !g.transcricao).length
  // Todo patch de gravacoes acontece DEPOIS de uma chamada de IA (30 s+) ou de um
  // upload (15 min). Sem a ref, o handler grava por cima com a lista de quando
  // foi clicado — duas transcricoes em paralelo perdiam uma.
  const reuniaoRef = useRef(reuniao)
  useEffect(() => { reuniaoRef.current = reuniao })

  const patch = (p: Partial<Pick<Reuniao, 'titulo' | 'data_reuniao' | 'status' | 'pauta' | 'tarefas' | 'resumo' | 'apresentacao_manifesto'>>) =>
    atualizar.mutate({ id: reuniao.id, ...p })

  const salvarApresentacao = async (manifesto: ApresentacaoManifesto) => {
    await atualizar.mutateAsync({ id: reuniao.id, apresentacao_manifesto: manifesto })
  }

  // As 3 escritas em `gravacoes` vão por RPC — o Postgres remonta o array. Ver
  // o comentário em useGravacoes(): mandar o array inteiro do browser era o que
  // apagava bloco.
  const addGravacao = async (g: Gravacao) => { await gravacoes.add(reuniao.id, g) }
  const removeGravacao = async (g: Gravacao) => {
    if (!window.confirm('Excluir esta gravação e sua transcrição? Esta ação não pode ser desfeita.')) return
    setTranscrErr(null)
    try {
      await gravacoes.remove(reuniao.id, g.id)
      const { error } = await supabase.storage.from('reunioes-audio').remove([g.path])
      if (error) setTranscrErr('Gravação removida da reunião, mas o arquivo de áudio não pôde ser apagado do armazenamento.')
    } catch (error) { setTranscrErr('Não foi possível excluir a gravação: ' + (error as Error).message) }
  }

  const salvarResumo = async () => {
    if (!resumoDirty.current) return true
    const texto = resumoLocal
    try {
      await atualizar.mutateAsync({ id: reuniao.id, resumo: texto })
      if (resumoRef.current === texto) { resumoDirty.current = false; setResumoSujo(false) }
      return true
    } catch { return false }
  }
  const resumoRef = useRef(resumoLocal)
  resumoRef.current = resumoLocal


  const transcrever = async (g: Gravacao) => {
    setTranscrErr(null); setTranscrevendo(g.id)
    try {
      // manda o `path`: o bucket é privado, quem baixa é a API com service_role
      const { texto } = await callReuniaoIA({ action: 'transcrever', path: g.path }) as { texto: string }
      await gravacoes.setTranscricao(reuniao.id, g.id, texto)
    } catch (e) { setTranscrErr('Transcrição falhou: ' + (e as Error).message); throw e }
    finally { setTranscrevendo(null) }
  }

  // Transcreve de uma vez os blocos que ainda não têm texto. Uma reunião de 1h30
  // são 7 blocos — clicar 7 vezes e esperar cada um era o motivo de as reuniões
  // de 10/08 e 12/08 ficarem sem transcrição nenhuma. Sequencial de propósito:
  // em paralelo estoura o rate limit da OpenAI.
  const transcreverTudo = async () => {
    const faltando = reuniaoRef.current.gravacoes.filter(g => !g.transcricao)
    if (faltando.length === 0) return
    setTranscrErr(null); setLote({ feitos: 0, total: faltando.length })
    let feitos = 0
    for (const g of faltando) {
      try { await transcrever(g); feitos++; setLote({ feitos, total: faltando.length }) }
      catch { setTranscrErr(`Parou no bloco ${feitos + 1} de ${faltando.length}. Os anteriores foram salvos — clique de novo pra continuar de onde parou.`); break }
    }
    setLote(null)
  }

  const gerarResumo = async () => {
    setIaErr(null); setResumindo(true)
    try {
      const atual = reuniaoRef.current
      const transcricoes = atual.gravacoes.map(g => g.transcricao).filter(Boolean) as string[]
      if (transcricoes.length === 0 && atual.pauta.length === 0 && atual.tarefas.length === 0) {
        setIaErr('Não há nada pra resumir: transcreva as gravações primeiro (botão "Transcrever tudo").')
        return
      }
      // A API aceita lista vazia e resume só a pauta — saía uma ata convincente
      // que não usou um segundo do áudio. Melhor avisar de quanto está faltando.
      const faltam = atual.gravacoes.length - transcricoes.length
      if (faltam > 0 && !window.confirm(`${faltam} de ${atual.gravacoes.length} gravações ainda não foram transcritas e vão ficar de fora da ata. Gerar assim mesmo?`)) return
      // O resumo escrito à mão é sobrescrito sem volta.
      if (resumoLocal.trim() && !window.confirm('Isso substitui o resumo que já está escrito. Continuar?')) return
      const { resumo } = await callReuniaoIA({ action: 'resumo', transcricoes, pauta: atual.pauta, tarefas: atual.tarefas, titulo: atual.titulo }) as { resumo: string }
      if (resumo) {
        setResumoLocal(resumo); resumoRef.current = resumo; resumoDirty.current = true; setResumoSujo(true)
        await atualizar.mutateAsync({ id: reuniao.id, resumo })
        if (resumoRef.current === resumo) { resumoDirty.current = false; setResumoSujo(false) }
      }
    } catch (e) { setIaErr('Resumo falhou: ' + (e as Error).message) }
    finally { setResumindo(false) }
  }

  return (
    <div className="reuniao-editor">
      <div className="reuniao-editor-toolbar">
        <button
          disabled={escritasPendentes > 0}
          onClick={async () => {
            if (!await salvarResumo()) return
            // Sair desmonta o gravador: o bloco em curso (até 15 min) morreria
            // sem chegar no Storage.
            if (gravando) { toast.error('Pare a gravação e aguarde o envio de todos os blocos antes de sair.'); return }
            onVoltar()
          }}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border text-ink-muted hover:text-ink hover:border-border-strong text-[13px] font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Reuniões
        </button>
        <span className="reuniao-save-state" role="status">{escritasPendentes > 0 ? <><Loader2 size={14} className="animate-spin" /> Salvando…</> : falhaSalvamento ? 'Confira a alteração não salva' : resumoSujo ? 'Resumo com alterações por salvar' : atualizar.isSuccess ? <><Check size={14} /> Alterações salvas</> : 'Salvamento automático'}</span>
        <div className="reuniao-status-switch" aria-label="Status da reunião">
          {STATUS_ORDER.map(s => {
            const on = reuniao.status === s
            const S = STATUS_META[s]
            return (
              <button key={s} aria-pressed={on} onClick={() => patch({ status: s })}
                className={`px-3 py-1.5 text-[12px] font-medium inline-flex items-center gap-1 transition-colors ${on ? S.cls.replace('border-', 'border-transparent ') : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}>
                <S.icon className="h-3.5 w-3.5" /> {S.label}
              </button>
            )
          })}
        </div>
        <button disabled={gravando || escritasPendentes > 0 || transcrevendo !== null || resumindo} onClick={() => setConfirmDel(true)} title="Excluir reunião" className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-ink-faint hover:text-danger hover:border-danger/40 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {falhaSalvamento && <div role="alert" className="reuniao-save-error">Uma alteração não foi salva ({Object.keys(falhaSalvamento).filter(key => key !== 'id').map(key => ({ titulo: 'título', data_reuniao: 'data', resumo: 'resumo', pauta: 'pauta', tarefas: 'tarefas', status: 'status', apresentacao_manifesto: 'apresentação' }[key] || key)).join(', ')}). Revise esses campos antes de continuar.
        <button onClick={() => setFalhaSalvamento(null)}>Entendi</button>
      </div>}
      <header className="reuniao-editor-heading">
        <TextoItem label="Título da reunião" value={reuniao.titulo} onCommit={titulo => patch({ titulo })} className="reuniao-title-field" />
        <label className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
          <CalendarClock className="h-3.5 w-3.5 text-ink-faint" />
          <input
            type="datetime-local"
            aria-label="Data e horário da reunião"
            key={reuniao.data_reuniao}
            defaultValue={toLocalInput(reuniao.data_reuniao)}
            onBlur={e => { if (e.target.value && e.target.validity.valid) { const date = new Date(e.target.value); if (Number.isFinite(date.getTime()) && date.toISOString() !== reuniao.data_reuniao) patch({ data_reuniao: date.toISOString() }) } else e.target.value = toLocalInput(reuniao.data_reuniao) }}
            className="bg-surface-2 border border-border rounded-md px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
          />
        </label>
      </header>

      <div className="reuniao-presentation">
      <Apresentacao
        reuniaoId={reuniao.id}
        titulo={reuniao.titulo}
        manifesto={reuniao.apresentacao_manifesto}
        onSave={salvarApresentacao}
        podeEditar={podeEditarApresentacao}
      />
      </div>
      <div className="reuniao-workspace">

      {/* PAUTA — o que discutir (preparado antes) */}
      <ChecklistSection
        titulo="Pauta" sub="o que discutir (prepare antes)"
        icon={ClipboardList} iconCls="text-accent" doneCls="text-accent"
        items={reuniao.pauta} onChange={p => patch({ pauta: p })}
        showResp={false}
        placeholder="Adicionar tópico da pauta e Enter…"
        emptyHint="Liste aqui os assuntos que quer tratar na reunião."
      />

      {/* TAREFAS — anotadas durante a reunião (ações + responsável) */}
      <ChecklistSection
        titulo="Tarefas" sub="anote durante a reunião (o que ficou pra fazer)"
        icon={CheckCircle2} iconCls="text-success" doneCls="text-success"
        items={reuniao.tarefas} onChange={t => patch({ tarefas: t })}
        showResp={true}
        placeholder="Adicionar tarefa e Enter…"
        emptyHint="Durante a reunião, anote aqui as ações que surgirem — com o responsável."
      />

      </div>
      {/* Gravações de áudio */}
      <section className="reuniao-section reuniao-recordings">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Mic className="h-4 w-4 text-danger" /> Gravações da reunião</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {naoTranscritos > 0 && (
              <button
                onClick={transcreverTudo}
                disabled={lote !== null || transcrevendo !== null}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 text-accent text-[12px] font-semibold hover:bg-accent/15 disabled:opacity-60 transition-colors"
                title="Transcreve de uma vez todos os blocos que ainda não têm texto"
              >
                {lote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                {lote ? `Transcrevendo ${lote.feitos + 1}/${lote.total}…` : `Transcrever tudo (${naoTranscritos})`}
              </button>
            )}
            <Gravador reuniaoId={reuniao.id} onAdd={addGravacao} onOcupado={setGravando} />
          </div>
        </div>
        {transcrErr && <p role="alert" className="text-sm text-danger mb-2">{transcrErr}</p>}
        {audioError && <p role="alert" className="text-sm text-danger mb-2">Não foi possível carregar um ou mais áudios. <button className="underline" onClick={() => setAudioAttempt(n => n + 1)}>Tentar novamente</button></p>}

        {reuniao.gravacoes.length === 0 ? (
          <p className="text-[11px] text-ink-faint">Nenhuma gravação ainda. Clique em "Gravar reunião" pra começar (o navegador vai pedir permissão do microfone).</p>
        ) : (
          <div className="space-y-2">
            {[...reuniao.gravacoes].reverse().map((g, i) => (
              <div key={g.id} className="rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2">
                <div className="reuniao-audio-row">
                  <span className="text-[11px] text-ink-muted shrink-0 tabular-nums w-[92px]">
                    Gravação {reuniao.gravacoes.length - i}<span className="text-ink-faint block text-[10px]">{fmtDur(g.duracao_seg)}</span>
                  </span>
                  <audio controls preload="none" src={assinadas[g.path]} className="flex-1 h-8 min-w-0" />
                  <button
                    onClick={() => { void transcrever(g).catch(() => {}) }}
                    disabled={transcrevendo !== null || lote !== null}
                    className="shrink-0 h-7 px-2 inline-flex items-center gap-1 rounded-md border border-border text-[11px] text-ink-muted hover:text-ink hover:border-border-strong disabled:opacity-60 transition-colors"
                    title="Transcrever o áudio com IA (Whisper)"
                  >
                    {transcrevendo === g.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                    {g.transcricao ? 're-transcrever' : 'transcrever'}
                  </button>
                  {assinadas[g.path] && <a href={assinadas[g.path]} download className="shrink-0 text-[11px] text-accent hover:underline" title="Baixar áudio">baixar</a>}
                  <button disabled={transcrevendo !== null || lote !== null || gravando} onClick={() => { void removeGravacao(g) }} className="shrink-0 text-ink-faint/60 hover:text-danger" title="Excluir gravação">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {g.transcricao && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-accent cursor-pointer select-none">Ver transcrição</summary>
                    <p className="mt-1.5 text-[12px] text-ink-muted leading-relaxed whitespace-pre-wrap bg-surface rounded-md border border-border/50 p-2.5 max-h-52 overflow-y-auto">{g.transcricao}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Resumo */}
      <section className="reuniao-section reuniao-summary">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="reuniao-section-title"><FileText size={18} /> Resumo da reunião</h2>
          <button
            onClick={gerarResumo}
            disabled={resumindo}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 text-accent text-[12px] font-semibold hover:bg-accent/15 disabled:opacity-60 transition-colors"
            title="Gera o resumo a partir da pauta + transcrições das gravações"
          >
            {resumindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {resumindo ? 'Gerando…' : 'Gerar resumo com IA'}
          </button>
        </div>
        {iaErr && <p className="text-[11px] text-danger mb-2">{iaErr}</p>}
        <textarea
          value={resumoLocal}
          disabled={resumindo}
          aria-label="Resumo da reunião"
          onChange={e => { resumoDirty.current = true; setResumoSujo(true); setResumoLocal(e.target.value) }}
          onBlur={() => { void salvarResumo() }}
          placeholder="O que foi decidido, próximos passos, responsáveis… ou clique em 'Gerar resumo com IA'."
          rows={6}
          className="w-full bg-surface-2/40 border border-border rounded-lg px-3 py-2 text-[13px] text-ink leading-relaxed outline-none focus:border-accent resize-y placeholder:text-ink-faint"
        />
        <div className="reuniao-summary-save"><p className="text-xs text-ink-muted" role="status">{resumoSujo ? 'Há alterações no resumo por salvar.' : 'O resumo é salvo ao sair do campo.'}</p><button disabled={!resumoSujo || escritasPendentes > 0 || resumindo} onClick={() => { void salvarResumo() }}>Salvar resumo</button></div>
      </section>

      {/* Feedback dos vendedores — o link que vai pro grupo depois da reunião */}
      <FeedbackSection reuniao={reuniao} />

      {/* Confirm excluir */}
      {confirmDel && (
        <div className="fixed inset-0 z-[1200] bg-black/50 flex items-center justify-center p-6" onClick={() => setConfirmDel(false)}>
          <div className="bg-surface rounded-2xl border border-border p-5 w-full max-w-xs text-center shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="h-11 w-11 rounded-full bg-danger/10 mx-auto flex items-center justify-center mb-3"><Trash2 className="h-5 w-5 text-danger" /></div>
            <h2 className="font-semibold text-ink mb-1">Excluir reunião?</h2>
            <p className="text-[13px] text-ink-muted mb-4">
              "{reuniao.titulo}", a pauta e {reuniao.gravacoes.length > 0 ? `as ${reuniao.gravacoes.length} gravações` : 'as gravações'} serão apagadas — inclusive o áudio.
            </p>
            {excluir.isError && <p className="text-[11px] text-danger mb-2">{(excluir.error as Error).message}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConfirmDel(false)} className="flex-1 h-10 rounded-lg border border-border text-ink-muted font-medium">Cancelar</button>
              <button
                onClick={() => excluir.mutate(
                  { id: reuniao.id, paths: reuniao.gravacoes.map(g => g.path) },
                  { onSuccess: (result) => { if (result.cleanupError) toast.warning(result.cleanupError); onVoltar() } },
                )}
                disabled={excluir.isPending}
                className="flex-1 h-10 rounded-lg bg-danger text-white font-semibold disabled:opacity-60"
              >{excluir.isPending ? 'Excluindo…' : 'Excluir'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Feedback dos vendedores — gera/copia o link público (/reuniao/<token>) que vai
// pro grupo depois da reunião, e lista o que voltou.
// ============================================================================

function fmtQuando(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function FeedbackSection({ reuniao }: { reuniao: Reuniao }) {
  const garantirLink = useGarantirLinkFeedback()
  const { data: feedbacks = [], isLoading, error: feedbackError, refetch: refetchFeedback } = useReuniaoFeedbacks(reuniao.id)
  const marcarLido = useMarcarFeedbackLido()
  const excluir = useExcluirFeedback()
  const [copiado, setCopiado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const link = reuniao.feedback_token ? `${window.location.origin}/reuniao/${reuniao.feedback_token}` : ''
  const novos = feedbacks.filter(f => !f.lido).length
  const mensagem = (l: string) =>
    `Fechamos a reunião "${reuniao.titulo}". Se ficou alguma sugestão de melhoria, dúvida ou algo pra acrescentar, escreve aqui (leva 1 minuto):\n${l}`

  // O token só nasce quando o link é pedido de fato — reunião que ninguém
  // compartilhou não fica com porta pública aberta à toa.
  const obterLink = async (): Promise<string | null> => {
    if (link) return link
    setErro(null)
    try {
      const token = await garantirLink.mutateAsync(reuniao.id)
      return `${window.location.origin}/reuniao/${token}`
    } catch (e) {
      setErro('Não deu pra gerar o link: ' + ((e as Error)?.message || 'erro'))
      return null
    }
  }

  // clipboard.writeText falha calado em contexto sem permissão; o campo abaixo
  // fica visível justamente pra copiar na mão quando isso acontece.
  const copiar = async () => {
    const l = await obterLink()
    if (!l) return
    try {
      await navigator.clipboard.writeText(l)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      setErro('Não consegui copiar sozinho — selecione o link no campo abaixo e copie.')
    }
  }

  const mandarWhats = async () => {
    const l = await obterLink()
    if (!l) return
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem(l))}`, '_blank', 'noopener')
  }

  return (
    <div className="reuniao-section reuniao-feedback">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5">
          <MessageSquare className="h-4 w-4 text-info" /> Feedback dos vendedores
          {feedbacks.length > 0 && (
            <span className="text-[11px] font-normal text-ink-faint">
              — {feedbacks.length} comentário{feedbacks.length > 1 ? 's' : ''}{novos > 0 ? ` · ${novos} novo${novos > 1 ? 's' : ''}` : ''}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={copiar}
            disabled={garantirLink.isPending}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border text-ink-muted hover:text-ink hover:border-border-strong text-[12px] font-semibold disabled:opacity-60 transition-colors"
            title="Copia o link público pra mandar pros vendedores"
          >
            {garantirLink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copiado ? 'Copiado!' : 'Copiar link'}
          </button>
          <button
            onClick={mandarWhats}
            disabled={garantirLink.isPending}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-accent text-white text-[12px] font-semibold hover:bg-accent/90 disabled:opacity-60 transition-colors"
            title="Abre o WhatsApp com a mensagem pronta pra escolher o grupo"
          >
            <Send className="h-3.5 w-3.5" /> Mandar no WhatsApp
          </button>
        </div>
      </div>

      {erro && <p className="text-[11px] text-danger mb-2">{erro}</p>}

      {link ? (
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="h-3.5 w-3.5 text-ink-faint shrink-0" />
          <input
            readOnly
            value={link}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 bg-surface-2/40 border border-border rounded-md px-2 py-1.5 text-[11.5px] text-ink-muted outline-none focus:border-accent"
          />
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-faint mb-3">
          O vendedor abre sem login, relê a pauta e a ata, e escreve a sugestão. As gravações e as tarefas não aparecem pra ele.
        </p>
      )}

      {feedbackError ? <p role="alert" className="text-danger text-sm">Não foi possível carregar os comentários. <button onClick={() => { void refetchFeedback() }} className="underline">Tentar novamente</button></p> : isLoading ? (
        <p className="text-[11px] text-ink-faint">Carregando comentários…</p>
      ) : feedbacks.length === 0 ? (
        <p className="text-[11px] text-ink-faint">Nenhum comentário ainda.</p>
      ) : (
        <div className="space-y-2">
          {feedbacks.map(f => (
            <div
              key={f.id}
              className={`group rounded-lg border px-3 py-2.5 transition-colors ${f.lido ? 'border-border/60 bg-surface-2/20' : 'border-info/30 bg-info/5'}`}
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[12.5px] font-semibold text-ink">{f.nome}</span>
                {f.tipo && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border text-ink-muted">{f.tipo}</span>
                )}
                <span className="text-[10.5px] text-ink-faint">{fmtQuando(f.created_at)}</span>
                <div className="flex-1" />
                <button
                  onClick={() => marcarLido.mutate({ id: f.id, reuniaoId: reuniao.id, lido: !f.lido }, { onError: () => setErro('Não foi possível atualizar o comentário. Tente novamente.') })}
                  className="shrink-0 text-[10.5px] text-ink-faint hover:text-accent transition-colors"
                  title={f.lido ? 'Marcar como não lido' : 'Marcar como lido'}
                >
                  {f.lido ? 'lido' : 'marcar lido'}
                </button>
                <button
                  onClick={() => { if (window.confirm('Excluir este comentário?')) excluir.mutate({ id: f.id, reuniaoId: reuniao.id }, { onError: () => setErro('Não foi possível excluir o comentário. Tente novamente.') }) }}
                  className="reuniao-remove"
                  title="Excluir comentário"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[13px] text-ink-muted leading-relaxed whitespace-pre-wrap">{f.comentario}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
