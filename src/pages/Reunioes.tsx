import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, ArrowLeft, CalendarClock, ClipboardList, CheckCircle2, Circle, PlayCircle, Mic, Square, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  useReunioes, useCriarReuniao, useAtualizarReuniao, useExcluirReuniao,
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

// Gravador de áudio da reunião: MediaRecorder (mic) → Blob → Supabase Storage
// (bucket reunioes-audio, público) → devolve a Gravacao pra salvar na reunião.
function Gravador({ reuniaoId, onAdd }: { reuniaoId: string; onAdd: (g: Gravacao) => void }) {
  const [rec, setRec] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  useEffect(() => () => { stopTimer(); streamRef.current?.getTracks().forEach(t => t.stop()) }, [])

  const finalize = async () => {
    const dur = Math.floor((Date.now() - startRef.current) / 1000)
    const blob = new Blob(chunksRef.current, { type: mrRef.current?.mimeType || 'audio/webm' })
    if (blob.size === 0) { setErr('Gravação vazia.'); return }
    setUploading(true)
    try {
      const path = `${reuniaoId}/${Date.now()}.webm`
      const { error } = await supabase.storage.from('reunioes-audio').upload(path, blob, { contentType: blob.type || 'audio/webm', upsert: false })
      if (error) throw error
      const { data: pub } = supabase.storage.from('reunioes-audio').getPublicUrl(path)
      onAdd({ id: uid(), url: pub.publicUrl, path, duracao_seg: dur, created_at: new Date().toISOString() })
    } catch (e) {
      setErr('Falhou ao salvar: ' + ((e as Error)?.message || 'erro'))
    } finally {
      setUploading(false)
    }
  }

  const start = async () => {
    setErr(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Seu navegador não suporta gravação.'); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => { void finalize() }
      mr.start()
      mrRef.current = mr
      startRef.current = Date.now()
      setElapsed(0)
      setRec(true)
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 500)
    } catch {
      setErr('Não deu pra acessar o microfone — permita o acesso no navegador.')
    }
  }

  const stop = () => {
    stopTimer()
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
      {err && <p className="text-[11px] text-danger mt-1.5">{err}</p>}
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
  const feitos = r.pauta.filter(p => p.feito).length
  const total = r.pauta.length
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

function Editor({ reuniao, onVoltar }: { reuniao: Reuniao; onVoltar: () => void }) {
  const atualizar = useAtualizarReuniao()
  const excluir = useExcluirReuniao()
  const [novoItem, setNovoItem] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const patch = (p: Partial<Pick<Reuniao, 'titulo' | 'data_reuniao' | 'status' | 'pauta' | 'resumo'>>) =>
    atualizar.mutate({ id: reuniao.id, ...p })

  const savePauta = (nova: PautaItem[]) => patch({ pauta: nova })
  const addItem = () => {
    const t = novoItem.trim()
    if (!t) return
    savePauta([...reuniao.pauta, { id: uid(), texto: t, feito: false }])
    setNovoItem('')
  }
  const toggle = (id: string) => savePauta(reuniao.pauta.map(p => p.id === id ? { ...p, feito: !p.feito } : p))
  const editTexto = (id: string, texto: string) => savePauta(reuniao.pauta.map(p => p.id === id ? { ...p, texto } : p))
  const editResp = (id: string, responsavel: string) => savePauta(reuniao.pauta.map(p => p.id === id ? { ...p, responsavel: responsavel || undefined } : p))
  const remove = (id: string) => savePauta(reuniao.pauta.filter(p => p.id !== id))

  const addGravacao = (g: Gravacao) => patch({ gravacoes: [...reuniao.gravacoes, g] })
  const removeGravacao = (g: Gravacao) => {
    patch({ gravacoes: reuniao.gravacoes.filter(x => x.id !== g.id) })
    supabase.storage.from('reunioes-audio').remove([g.path]).catch(() => { /* noop */ })
  }

  const feitos = reuniao.pauta.filter(p => p.feito).length
  const total = reuniao.pauta.length

  return (
    <div>
      {/* Topo: voltar + status + excluir */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onVoltar} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border text-ink-muted hover:text-ink hover:border-border-strong text-[13px] font-medium transition-colors">
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

      {/* Pauta / tarefas */}
      <div className="rounded-xl border border-border bg-surface p-4 mb-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5"><ClipboardList className="h-4 w-4 text-accent" /> Pauta &amp; tarefas</h2>
          {total > 0 && <span className="text-[11px] text-ink-faint tabular-nums">{feitos}/{total} feitas</span>}
        </div>

        <div className="space-y-1.5">
          {reuniao.pauta.map(item => (
            <div key={item.id} className="group flex items-center gap-2 rounded-lg border border-border/60 bg-surface-2/30 px-2.5 py-2 hover:border-border transition-colors">
              <button onClick={() => toggle(item.id)} className="shrink-0" title={item.feito ? 'Desmarcar' : 'Marcar como feita'}>
                {item.feito
                  ? <CheckCircle2 className="h-[18px] w-[18px] text-success" />
                  : <Circle className="h-[18px] w-[18px] text-ink-faint hover:text-accent transition-colors" />}
              </button>
              <input
                defaultValue={item.texto}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== item.texto) editTexto(item.id, v) }}
                className={`flex-1 bg-transparent text-[13px] outline-none min-w-0 ${item.feito ? 'line-through text-ink-faint' : 'text-ink'}`}
              />
              <input
                defaultValue={item.responsavel ?? ''}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (item.responsavel ?? '')) editResp(item.id, v) }}
                placeholder="quem?"
                className="w-20 shrink-0 bg-surface border border-border/60 rounded px-1.5 py-0.5 text-[11px] text-ink-muted outline-none focus:border-accent placeholder:text-ink-faint/60"
              />
              <button onClick={() => remove(item.id)} className="shrink-0 text-ink-faint/50 hover:text-danger opacity-0 group-hover:opacity-100 transition-all" title="Remover">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Add item */}
        <div className="mt-2 flex items-center gap-2">
          <Plus className="h-4 w-4 text-ink-faint shrink-0" />
          <input
            value={novoItem}
            onChange={e => setNovoItem(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem() }}
            placeholder="Adicionar tarefa/pauta e Enter…"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          {novoItem.trim() && (
            <button onClick={addItem} className="shrink-0 h-7 px-2.5 rounded-md bg-accent text-white text-[12px] font-semibold">Add</button>
          )}
        </div>
      </div>

      {/* Gravações de áudio */}
      <div className="rounded-xl border border-border bg-surface p-4 mb-3">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Mic className="h-4 w-4 text-danger" /> Gravações da reunião</h2>
          <Gravador reuniaoId={reuniao.id} onAdd={addGravacao} />
        </div>
        {reuniao.gravacoes.length === 0 ? (
          <p className="text-[11px] text-ink-faint">Nenhuma gravação ainda. Clique em "Gravar reunião" pra começar (o navegador vai pedir permissão do microfone).</p>
        ) : (
          <div className="space-y-2">
            {[...reuniao.gravacoes].reverse().map((g, i) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2">
                <span className="text-[11px] text-ink-muted shrink-0 tabular-nums w-[92px]">
                  Gravação {reuniao.gravacoes.length - i}<span className="text-ink-faint block text-[10px]">{fmtDur(g.duracao_seg)}</span>
                </span>
                <audio controls preload="none" src={g.url} className="flex-1 h-8 min-w-0" />
                <a href={g.url} download className="shrink-0 text-[11px] text-accent hover:underline" title="Baixar áudio">baixar</a>
                <button onClick={() => removeGravacao(g)} className="shrink-0 text-ink-faint/60 hover:text-danger" title="Excluir gravação">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumo */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-[13px] font-bold text-ink mb-2">📝 Resumo da reunião</h2>
        <textarea
          defaultValue={reuniao.resumo}
          onBlur={e => { if (e.target.value !== reuniao.resumo) patch({ resumo: e.target.value }) }}
          placeholder="O que foi decidido, próximos passos, responsáveis…"
          rows={5}
          className="w-full bg-surface-2/40 border border-border rounded-lg px-3 py-2 text-[13px] text-ink leading-relaxed outline-none focus:border-accent resize-y placeholder:text-ink-faint"
        />
        <p className="text-[10.5px] text-ink-faint mt-1.5">Salva automático ao sair do campo.</p>
      </div>

      {/* Confirm excluir */}
      {confirmDel && (
        <div className="fixed inset-0 z-[1200] bg-black/50 flex items-center justify-center p-6" onClick={() => setConfirmDel(false)}>
          <div className="bg-surface rounded-2xl border border-border p-5 w-full max-w-xs text-center shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="h-11 w-11 rounded-full bg-danger/10 mx-auto flex items-center justify-center mb-3"><Trash2 className="h-5 w-5 text-danger" /></div>
            <h2 className="font-semibold text-ink mb-1">Excluir reunião?</h2>
            <p className="text-[13px] text-ink-muted mb-4">"{reuniao.titulo}" e sua pauta serão apagadas.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDel(false)} className="flex-1 h-10 rounded-lg border border-border text-ink-muted font-medium">Cancelar</button>
              <button onClick={() => excluir.mutate(reuniao.id, { onSuccess: onVoltar })} className="flex-1 h-10 rounded-lg bg-danger text-white font-semibold">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
