import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquarePlus, X, Bug, Lightbulb, Sparkles, Upload, Loader2, Check, ImageIcon, Camera } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCriarFeedback, type RoadmapTipo } from '@/hooks/useRoadmap'

const TIPOS: Array<{ id: RoadmapTipo; label: string; icon: typeof Bug; cor: string }> = [
  { id: 'bug', label: 'Bug / Erro', icon: Bug, cor: 'text-rose-400 border-rose-400/40 bg-rose-500/10' },
  { id: 'sugestao', label: 'Sugestão', icon: Lightbulb, cor: 'text-amber-400 border-amber-400/40 bg-amber-500/10' },
  { id: 'melhoria', label: 'Melhoria', icon: Sparkles, cor: 'text-emerald-400 border-emerald-400/40 bg-emerald-500/10' },
]

// Botao flutuante de feedback (bug/sugestao/melhoria). Aparece em todas as paginas
// loggadas. Vendedor descreve + cola screenshot (Ctrl+V) ou anexa arquivo.
// Auto-detecta URL atual + user pra dar contexto ao admin.
export function RoadmapFAB() {
  const { profile } = useAuth()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<RoadmapTipo>('bug')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [capturando, setCapturando] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const criar = useCriarFeedback()

  // Captura a tela atual (o que está atrás do modal) via html2canvas.
  // Esconde o modal temporariamente pro print não pegar ele mesmo.
  async function capturarTela() {
    setCapturando(true)
    setOpen(false)
    try {
      // 2 frames pra garantir que o React desmontou o modal antes do canvas
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(document.body, {
        scale: window.devicePixelRatio || 1,
        logging: false,
        backgroundColor: null,
        useCORS: true,
        // Captura só o viewport (o que o usuário vê), não a página inteira
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png', 0.92))
      if (blob) {
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' })
        setScreenshot(file)
      }
    } catch (e) {
      setErro('Falha ao capturar tela: ' + (e as Error).message)
    } finally {
      setCapturando(false)
      setOpen(true)
    }
  }

  // Reset ao fechar
  useEffect(() => {
    if (!open) return
    setEnviado(false)
    setErro(null)
  }, [open])

  // Preview da imagem
  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(screenshot)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [screenshot])

  // Paste de screenshot (Ctrl+V) dentro do modal
  useEffect(() => {
    if (!open) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            setScreenshot(file)
            e.preventDefault()
            return
          }
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open])

  // Esc fecha o modal
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function enviar() {
    if (!titulo.trim()) {
      setErro('Conta rapidinho o que aconteceu (1 linha basta).')
      return
    }
    setErro(null)
    try {
      await criar.mutateAsync({
        tipo,
        titulo,
        descricao,
        url_origem: loc.pathname + loc.search,
        screenshot,
        criado_por: profile?.id ?? null,
        criado_por_nome: profile?.display_name ?? profile?.email ?? null,
      })
      setEnviado(true)
      // Reseta form depois de mostrar success
      setTimeout(() => {
        setTitulo('')
        setDescricao('')
        setScreenshot(null)
        setTipo('bug')
        setOpen(false)
      }, 1400)
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  // Se nao tem profile aprovado, nao mostra (Pendente / Login nao precisam)
  if (!profile || !profile.approved_at) return null

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 group flex items-center gap-2 bg-accent hover:bg-accent-700 text-white rounded-full shadow-lg p-3 transition-all hover:scale-105"
        title="Reportar bug, sugestão ou melhoria"
        aria-label="Abrir feedback"
      >
        <MessageSquarePlus className="w-5 h-5" />
        <span className="hidden md:inline group-hover:inline text-[12px] font-semibold pr-1">Feedback</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-bg border border-border rounded-t-xl sm:rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[92vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-start gap-3">
              <MessageSquarePlus className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[15px] font-bold text-ink">Mandar feedback pro Daniel</div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  Achou bug? Tem sugestão? Manda aqui que vou ver. Cola um print com Ctrl+V se ajudar.
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink p-1 -m-1">
                <X className="h-4 w-4" />
              </button>
            </div>

            {enviado ? (
              <div className="px-4 py-12 flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-success-bg flex items-center justify-center">
                  <Check className="w-6 h-6 text-success" />
                </div>
                <div className="text-[14px] font-semibold text-ink">Recebido!</div>
                <div className="text-[12px] text-ink-muted text-center">
                  Vou olhar e te dar retorno. Obrigado por reportar.
                </div>
              </div>
            ) : (
              <>
                {/* Form */}
                <div className="px-4 py-4 space-y-3 overflow-y-auto">
                  {/* Tipo */}
                  <div>
                    <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1.5">Tipo</label>
                    <div className="grid grid-cols-3 gap-2">
                      {TIPOS.map(t => {
                        const Icon = t.icon
                        const ativo = tipo === t.id
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setTipo(t.id)}
                            className={`text-[12px] px-3 py-2.5 rounded-md border-2 font-semibold flex flex-col items-center gap-1 transition ${
                              ativo ? t.cor : 'bg-surface-2 border-border text-ink-muted hover:bg-surface-3'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {t.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Titulo */}
                  <div>
                    <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1">
                      O que aconteceu? <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={titulo}
                      onChange={e => setTitulo(e.target.value)}
                      placeholder="Ex: Motor monofásico não recalcula ao trocar voltagem"
                      maxLength={140}
                      className="w-full text-[13px] px-3 py-2 bg-surface-2 border border-border rounded text-ink placeholder:text-ink-faint"
                      autoFocus
                    />
                  </div>

                  {/* Descricao */}
                  <div>
                    <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1">
                      Detalhes (opcional)
                    </label>
                    <textarea
                      value={descricao}
                      onChange={e => setDescricao(e.target.value)}
                      placeholder="Passo-a-passo, contexto, o que esperava que acontecesse..."
                      rows={3}
                      className="w-full text-[13px] px-3 py-2 bg-surface-2 border border-border rounded text-ink placeholder:text-ink-faint resize-none"
                    />
                  </div>

                  {/* Screenshot */}
                  <div>
                    <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1">
                      Screenshot (opcional)
                    </label>
                    {previewUrl ? (
                      <div className="relative inline-block">
                        <img src={previewUrl} alt="Preview" className="max-h-32 rounded border border-border" />
                        <button
                          type="button"
                          onClick={() => setScreenshot(null)}
                          className="absolute -top-2 -right-2 bg-danger text-white rounded-full p-1 shadow"
                          title="Remover"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={capturarTela}
                          disabled={capturando}
                          className="border-2 border-dashed border-accent/40 bg-accent/5 rounded p-3 text-center text-[12px] text-accent hover:bg-accent/10 hover:border-accent transition flex flex-col items-center gap-1 disabled:opacity-50 font-semibold"
                          title="Captura a tela atual automaticamente"
                        >
                          <Camera className="w-5 h-5" />
                          <span>Capturar tela</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-border rounded p-3 text-center text-[12px] text-ink-muted hover:border-accent hover:bg-accent/5 transition flex flex-col items-center gap-1"
                        >
                          <ImageIcon className="w-5 h-5" />
                          <span>Anexar / Ctrl+V</span>
                        </button>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) setScreenshot(f)
                      }}
                      className="hidden"
                    />
                  </div>

                  {/* URL contexto */}
                  <div className="text-[10px] text-ink-faint bg-surface-2/40 rounded px-2 py-1.5 border border-border/40">
                    📍 Página: <span className="font-mono">{loc.pathname}</span>
                    {profile?.display_name && <> · {profile.display_name}</>}
                  </div>

                  {erro && (
                    <div className="text-[12px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                      {erro}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-2 text-[12px] text-ink-muted hover:bg-surface-2 rounded"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={enviar}
                    disabled={criar.isPending || !titulo.trim()}
                    className="px-4 py-2 text-[12px] bg-accent hover:bg-accent-700 text-white font-semibold rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {criar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Enviar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
