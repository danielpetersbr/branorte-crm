import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, ArrowLeft, CalendarClock, ClipboardList, CheckCircle2, Circle, PlayCircle, Mic, Square, Loader2, Sparkles, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  useReunioes, useCriarReuniao, useAtualizarReuniao, useExcluirReuniao, useGravacoes,
  type Reuniao, type PautaItem, type ReuniaoStatus, type Gravacao,
} from '@/hooks/useReunioes'

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

function fmtData(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
// timestamptz ISO → valor do <input type="datetime-local"> (hora local, sem fuso)
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function fromLocalInput(v: string): string {
  return new Date(v).toISOString()
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
  const ocupado = rec || uploading || pendentes.length > 0
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
    const parte = `${Date.now()}-${(partRef.current++).toString().padStart(2, '0')}`
    try {
      await subirBloco(blob, durSeg, parte)
    } catch (e) {
      const motivo = (e as Error)?.message || 'erro'
      setPendentes(p => [...p, { id: uid(), blob, durSeg, parte, motivo }])
      setErr(`Um bloco de ${fmtDur(durSeg)} não subiu (${motivo}). Ele está guardado aqui embaixo — clique em "Reenviar" antes de fechar a página.`)
    } finally {
      if (isFinal) setUploading(false)
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
    setErr(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Seu navegador não suporta gravação.'); return
    }
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
      setErr('Não deu pra acessar o microfone — permita o acesso no navegador.')
    }
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
      ) : uploading ? (
        <span className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg bg-surface-2 text-ink-muted text-[13px] font-medium">
          <Loader2 className="h-4 w-4 animate-spin" /> Salvando gravação…
        </span>
      ) : (
        <button onClick={start} className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 text-danger text-[13px] font-semibold hover:bg-danger/15 transition-colors">
          <Mic className="h-4 w-4" /> Gravar reunião
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
              <a
                href={URL.createObjectURL(p.blob)}
                download={`bloco-${p.parte}.webm`}
                className="shrink-0 text-[11px] text-accent hover:underline"
              >baixar</a>
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
  const { data: reunioes = [], isLoading } = useReunioes()
  const criar = useCriarReuniao()
  const [selId, setSelId] = useState<string | null>(null)
  const sel = reunioes.find(r => r.id === selId) ?? null

  const novaReuniao = () => {
    const agora = new Date()
    agora.setMinutes(0, 0, 0)
    criar.mutate(
      { titulo: 'Nova reunião', data_reuniao: agora.toISOString() },
      { onSuccess: (r) => setSelId(r.id) },
    )
  }

  return (
    <div className="p-3 lg:p-6 max-w-[900px] mx-auto">
      {sel ? (
        <Editor key={sel.id} reuniao={sel} onVoltar={() => setSelId(null)} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-semibold text-ink tracking-tight flex items-center gap-2">
                <ClipboardList className="h-6 w-6 text-accent" /> Adm de Reunião
              </h1>
              <p className="text-[12px] text-ink-faint mt-0.5">Monte a pauta antes · marque as tarefas durante · escreva o resumo depois.</p>
            </div>
            <button
              onClick={novaReuniao}
              disabled={criar.isPending}
              className="shrink-0 h-10 px-4 inline-flex items-center gap-1.5 rounded-lg bg-accent text-white text-[13px] font-bold hover:bg-accent/90 shadow-sm transition-all disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Nova reunião
            </button>
          </div>

          {isLoading ? (
            <p className="text-[13px] text-ink-muted py-10 text-center">Carregando…</p>
          ) : reunioes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-14 text-center">
              <ClipboardList className="h-8 w-8 text-ink-faint mx-auto mb-2" />
              <p className="text-[13px] text-ink-muted">Nenhuma reunião ainda.</p>
              <button onClick={novaReuniao} className="mt-3 text-[13px] text-accent font-medium hover:underline">Criar a primeira →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {reunioes.map(r => <ReuniaoCard key={r.id} r={r} onAbrir={() => setSelId(r.id)} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReuniaoCard({ r, onAbrir }: { r: Reuniao; onAbrir: () => void }) {
  const feitos = r.tarefas.filter(p => p.feito).length
  const total = r.tarefas.length
  const pct = total > 0 ? (feitos / total) * 100 : 0
  const S = STATUS_META[r.status]
  return (
    <button
      onClick={onAbrir}
      className="text-left rounded-xl border border-border bg-surface p-4 hover:border-border-strong hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h3 className="text-[14px] font-semibold text-ink tracking-tight truncate flex-1">{r.titulo}</h3>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${S.cls}`}>
          <S.icon className="h-3 w-3" /> {S.label}
        </span>
      </div>
      <p className="text-[11px] text-ink-faint flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {fmtData(r.data_reuniao)}</p>
      {total > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-muted mb-1">
            <span>{feitos}/{total} tarefas</span>
            <span className="tabular-nums">{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {r.resumo && <p className="mt-2 text-[11px] text-ink-faint line-clamp-2">{r.resumo}</p>}
    </button>
  )
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
    <div className="rounded-xl border border-border bg-surface p-4 mb-3">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5">
          <Icon className={`h-4 w-4 ${iconCls}`} /> {titulo}
          <span className="text-[11px] font-normal text-ink-faint">— {sub}</span>
        </h2>
        {items.length > 0 && <span className="text-[11px] text-ink-faint tabular-nums">{feitos}/{items.length}</span>}
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <div key={item.id} className="group flex items-center gap-2 rounded-lg border border-border/60 bg-surface-2/30 px-2.5 py-2 hover:border-border transition-colors">
            <button onClick={() => toggle(item.id)} className="shrink-0" title={item.feito ? 'Desmarcar' : 'Marcar'}>
              {item.feito
                ? <CheckCircle2 className={`h-[18px] w-[18px] ${doneCls}`} />
                : <Circle className="h-[18px] w-[18px] text-ink-faint hover:text-accent transition-colors" />}
            </button>
            <input
              defaultValue={item.texto}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== item.texto) editTexto(item.id, v) }}
              className={`flex-1 bg-transparent text-[13px] outline-none min-w-0 ${item.feito ? 'line-through text-ink-faint' : 'text-ink'}`}
            />
            {showResp && (
              <input
                defaultValue={item.responsavel ?? ''}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (item.responsavel ?? '')) editResp(item.id, v) }}
                placeholder="quem?"
                className="w-20 shrink-0 bg-surface border border-border/60 rounded px-1.5 py-0.5 text-[11px] text-ink-muted outline-none focus:border-accent placeholder:text-ink-faint/60"
              />
            )}
            <button onClick={() => remove(item.id)} className="shrink-0 text-ink-faint/50 hover:text-danger opacity-0 group-hover:opacity-100 transition-all" title="Remover">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[11px] text-ink-faint px-1 py-1">{emptyHint}</p>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Plus className="h-4 w-4 text-ink-faint shrink-0" />
        <input
          value={novo}
          onChange={e => setNovo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
        />
        {novo.trim() && <button onClick={add} className="shrink-0 h-7 px-2.5 rounded-md bg-accent text-white text-[12px] font-semibold">Add</button>}
      </div>
    </div>
  )
}

function Editor({ reuniao, onVoltar }: { reuniao: Reuniao; onVoltar: () => void }) {
  const atualizar = useAtualizarReuniao()
  const excluir = useExcluirReuniao()
  const [confirmDel, setConfirmDel] = useState(false)
  const [resumoLocal, setResumoLocal] = useState(reuniao.resumo)
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
  const paths = reuniao.gravacoes.map(g => g.path).join('|')
  useEffect(() => {
    const lista = paths ? paths.split('|') : []
    if (lista.length === 0) return
    let vivo = true
    supabase.storage.from('reunioes-audio').createSignedUrls(lista, 7200).then(({ data }) => {
      if (!vivo || !data) return
      const mapa: Record<string, string> = {}
      data.forEach(d => { if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl })
      setAssinadas(mapa)
    })
    return () => { vivo = false }
  }, [paths])
  const naoTranscritos = reuniao.gravacoes.filter(g => !g.transcricao).length
  // Todo patch de gravacoes acontece DEPOIS de uma chamada de IA (30 s+) ou de um
  // upload (15 min). Sem a ref, o handler grava por cima com a lista de quando
  // foi clicado — duas transcricoes em paralelo perdiam uma.
  const reuniaoRef = useRef(reuniao)
  useEffect(() => { reuniaoRef.current = reuniao })

  const patch = (p: Partial<Pick<Reuniao, 'titulo' | 'data_reuniao' | 'status' | 'pauta' | 'tarefas' | 'resumo' | 'gravacoes'>>) =>
    atualizar.mutate({ id: reuniao.id, ...p })

  // As 3 escritas em `gravacoes` vão por RPC — o Postgres remonta o array. Ver
  // o comentário em useGravacoes(): mandar o array inteiro do browser era o que
  // apagava bloco.
  const addGravacao = async (g: Gravacao) => { await gravacoes.add(reuniao.id, g) }
  // Storage primeiro: se o delete do arquivo falhar, a gravação continua listada
  // (dá pra tentar de novo). Ao contrário, sobraria áudio órfão invisível no app.
  const removeGravacao = async (g: Gravacao) => {
    const { error } = await supabase.storage.from('reunioes-audio').remove([g.path])
    if (error) { setTranscrErr('Não deu pra apagar o áudio: ' + error.message); return }
    await gravacoes.remove(reuniao.id, g.id)
  }

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
      if (resumo) { setResumoLocal(resumo); patch({ resumo }) }
    } catch (e) { setIaErr('Resumo falhou: ' + (e as Error).message) }
    finally { setResumindo(false) }
  }

  return (
    <div>
      {/* Topo: voltar + status + excluir */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => {
            // Sair desmonta o gravador: o bloco em curso (até 15 min) morreria
            // sem chegar no Storage.
            if (gravando && !window.confirm('A gravação ainda está rodando. Se sair agora, o trecho atual é perdido. Sair mesmo assim?')) return
            onVoltar()
          }}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border text-ink-muted hover:text-ink hover:border-border-strong text-[13px] font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Reuniões
        </button>
        <div className="flex-1" />
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {STATUS_ORDER.map(s => {
            const on = reuniao.status === s
            const S = STATUS_META[s]
            return (
              <button key={s} onClick={() => patch({ status: s })}
                className={`px-3 py-1.5 text-[12px] font-medium inline-flex items-center gap-1 transition-colors ${on ? S.cls.replace('border-', 'border-transparent ') : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}>
                <S.icon className="h-3.5 w-3.5" /> {S.label}
              </button>
            )
          })}
        </div>
        <button onClick={() => setConfirmDel(true)} title="Excluir reunião" className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-ink-faint hover:text-danger hover:border-danger/40 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Título + data */}
      <div className="rounded-xl border border-border bg-surface p-4 mb-3">
        <input
          defaultValue={reuniao.titulo}
          onBlur={e => { const v = e.target.value.trim() || 'Reunião'; if (v !== reuniao.titulo) patch({ titulo: v }) }}
          placeholder="Título da reunião"
          className="w-full bg-transparent text-[18px] font-bold text-ink tracking-tight outline-none placeholder:text-ink-faint"
        />
        <label className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
          <CalendarClock className="h-3.5 w-3.5 text-ink-faint" />
          <input
            type="datetime-local"
            defaultValue={toLocalInput(reuniao.data_reuniao)}
            onChange={e => { if (e.target.value) patch({ data_reuniao: fromLocalInput(e.target.value) }) }}
            className="bg-surface-2 border border-border rounded-md px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

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

      {/* Gravações de áudio */}
      <div className="rounded-xl border border-border bg-surface p-4 mb-3">
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
        {transcrErr && <p className="text-[11px] text-danger mb-2">{transcrErr}</p>}
        {atualizar.isError && <p className="text-[11px] text-danger mb-2">Não deu pra salvar no servidor. Recarregue a página antes de continuar — a última alteração pode ter se perdido.</p>}
        {reuniao.gravacoes.length === 0 ? (
          <p className="text-[11px] text-ink-faint">Nenhuma gravação ainda. Clique em "Gravar reunião" pra começar (o navegador vai pedir permissão do microfone).</p>
        ) : (
          <div className="space-y-2">
            {[...reuniao.gravacoes].reverse().map((g, i) => (
              <div key={g.id} className="rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-muted shrink-0 tabular-nums w-[92px]">
                    Gravação {reuniao.gravacoes.length - i}<span className="text-ink-faint block text-[10px]">{fmtDur(g.duracao_seg)}</span>
                  </span>
                  <audio controls preload="none" src={assinadas[g.path]} className="flex-1 h-8 min-w-0" />
                  <button
                    onClick={() => transcrever(g)}
                    disabled={transcrevendo === g.id}
                    className="shrink-0 h-7 px-2 inline-flex items-center gap-1 rounded-md border border-border text-[11px] text-ink-muted hover:text-ink hover:border-border-strong disabled:opacity-60 transition-colors"
                    title="Transcrever o áudio com IA (Whisper)"
                  >
                    {transcrevendo === g.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                    {g.transcricao ? 're-transcrever' : 'transcrever'}
                  </button>
                  <a href={assinadas[g.path]} download className="shrink-0 text-[11px] text-accent hover:underline" title="Baixar áudio">baixar</a>
                  <button onClick={() => removeGravacao(g)} className="shrink-0 text-ink-faint/60 hover:text-danger" title="Excluir gravação">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {g.transcricao && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-accent cursor-pointer select-none">📄 Transcrição</summary>
                    <p className="mt-1.5 text-[12px] text-ink-muted leading-relaxed whitespace-pre-wrap bg-surface rounded-md border border-border/50 p-2.5 max-h-52 overflow-y-auto">{g.transcricao}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumo */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="text-[13px] font-bold text-ink">📝 Resumo da reunião</h2>
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
          onChange={e => setResumoLocal(e.target.value)}
          onBlur={() => { if (resumoLocal !== reuniao.resumo) patch({ resumo: resumoLocal }) }}
          placeholder="O que foi decidido, próximos passos, responsáveis… ou clique em 'Gerar resumo com IA'."
          rows={6}
          className="w-full bg-surface-2/40 border border-border rounded-lg px-3 py-2 text-[13px] text-ink leading-relaxed outline-none focus:border-accent resize-y placeholder:text-ink-faint"
        />
        <p className="text-[10.5px] text-ink-faint mt-1.5">Salva automático ao sair do campo. A IA usa a pauta + as transcrições das gravações.</p>
      </div>

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
                  { onSuccess: onVoltar },
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
