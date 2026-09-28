import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Download, Filter, Flag, LayoutGrid, ListChecks, Loader2, Maximize2, Minimize2, Phone, Play, Presentation, TrendingUp, Upload, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { ApresentacaoManifesto, ApresentacaoSlide } from '@/hooks/useReunioes'
import { NativeSlide } from './ApresentacaoSlides'
import './Apresentacao.css'

const BUCKET = 'reunioes-apresentacoes'
const MAX_BYTES = 20 * 1024 * 1024
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const chapters = {
  cover: { label: 'Abertura', Icon: Flag },
  calls: { label: 'Ligações', Icon: Phone },
  sales: { label: 'Vendas', Icon: TrendingUp },
  teams: { label: 'Times', Icon: Users },
  agenda: { label: 'Pauta', Icon: ListChecks },
  video: { label: 'Vídeo', Icon: Play },
  funnel: { label: 'Funil', Icon: Filter },
}

function chapterSummary(slide: ApresentacaoSlide): string {
  switch (slide.type) {
    case 'cover': return slide.subtitle || 'Vamos começar a reunião'
    case 'calls': return `${slide.total} chamadas válidas · ${slide.metCount} de ${slide.sellerCount} na meta`
    case 'sales': return `${slide.effectiveSales} vendas na semana · ${slide.aboveTenK} acima de R$ 10 mil`
    case 'teams': return `${slide.teams.length} times · clique para explorar cada resultado`
    case 'agenda': return `${slide.totalMinutes} minutos · vá direto ao assunto`
    case 'video': return 'Assistir ao vídeo dentro da apresentação'
    case 'funnel': return 'Explore as etapas e abra os clientes no Kanban'
  }
}
function erroLegivel(error: unknown): string {
  const mensagem = error instanceof Error ? error.message : 'Erro inesperado. Tente novamente.'
  return /row.level security|unauthoriz|permission|forbidden|42501|403/i.test(mensagem)
    ? 'Sua conta não tem permissão para enviar arquivos nesta reunião.'
    : mensagem
}

function sufixo(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function ApresentacaoViewer({ titulo, manifesto, onClose }: { titulo: string; manifesto: ApresentacaoManifesto; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [showOverview, setShowOverview] = useState(false)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({})
  const [videoLoading, setVideoLoading] = useState(true)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const overviewRef = useRef<HTMLButtonElement>(null)
  const fullscreenExitedAt = useRef(0)
  const total = manifesto.slides.length
  const slide = manifesto.slides[index]
  const navigateTo = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(manifesto.slides.length - 1, next))
    setDirection(bounded < index ? 'back' : 'forward')
    setIndex(bounded)
    setShowOverview(false)
  }, [index, manifesto.slides.length])
  const navigateToType = (type: ApresentacaoSlide['type']) => {
    const next = manifesto.slides.findIndex(s => s.type === type)
    if (next >= 0) navigateTo(next)
  }
  // A query normaliza um objeto novo a cada refetch. Só renovar as URLs quando
  // o caminho de algum vídeo mudar: trocar o src reiniciaria a reprodução.
  const videoPathSignature = JSON.stringify([...new Set(manifesto.slides
    .filter((s): s is Extract<ApresentacaoSlide, { type: 'video' }> => s.type === 'video' && !s.youtubeId && !!s.videoPath && !s.videoPath.startsWith('__'))
    .map(s => s.videoPath))].sort())

  useEffect(() => {
    let vivo = true
    const paths = JSON.parse(videoPathSignature) as string[]
    setVideoLoading(!!paths.length)
    setVideoError(null)
    if (!paths.length) { setVideoUrls({}); return }
    supabase.storage.from(BUCKET).createSignedUrls(paths, 7200).then(({ data, error }) => {
      if (!vivo) return
      if (error) setVideoError(`Não foi possível abrir o vídeo: ${error.message}`)
      const urls: Record<string, string> = {}
      for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl
      setVideoUrls(urls)
      setVideoLoading(false)
    }).catch(error => { if (vivo) { setVideoError(erroLegivel(error)); setVideoLoading(false) } })
    return () => { vivo = false }
  }, [videoPathSignature])

  useEffect(() => {
    const anterior = document.body.style.overflow
    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => { document.body.style.overflow = anterior; focoAnterior?.focus() }
  }, [])

  useEffect(() => {
    // Links e cards são desmontados ao navegar; mantenha o foco no apresentador.
    if (!playerRef.current?.contains(document.activeElement)) overviewRef.current?.focus()
  }, [index, showOverview])

  const toggleFullscreen = useCallback(async () => {
    setFullscreenError(null)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen()
      else setFullscreenError('Este navegador não oferece tela cheia. Abra a apresentação no Chrome, Edge ou Safari no computador.')
    } catch {
      setFullscreenError('Não foi possível entrar em tela cheia. Clique no botão para tentar novamente.')
    }
  }, [])

  const closePlayer = useCallback(async () => {
    if (document.fullscreenElement && playerRef.current?.contains(document.fullscreenElement)) {
      try { await document.exitFullscreen() } catch { /* O navegador pode já ter saído da tela cheia. */ }
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    const onFullscreenChange = () => {
      const ativa = document.fullscreenElement === playerRef.current
      setFullscreen(ativa)
      if (!document.fullscreenElement) fullscreenExitedAt.current = Date.now()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // O primeiro Esc pertence ao navegador: sai da tela cheia e mantém os slides abertos.
        if (document.fullscreenElement || Date.now() - fullscreenExitedAt.current < 300) return
        if (showOverview) { event.preventDefault(); setShowOverview(false); return }
        event.preventDefault(); void closePlayer(); return
      }
      if (event.key === 'Tab') {
        const foco = Array.from(playerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], video[controls], iframe, summary, [tabindex="0"]') ?? [])
        const primeiro = foco[0], ultimo = foco[foco.length - 1]
        if (!playerRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? ultimo : primeiro)?.focus() }
        else if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo?.focus() }
        else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro?.focus() }
        return
      }
      if (event.target instanceof HTMLElement && (event.target.matches('video, iframe, input, textarea, select') || event.target.isContentEditable)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) void toggleFullscreen(); return }
      if (event.key.toLowerCase() === 'g') { event.preventDefault(); if (!event.repeat) setShowOverview(value => !value); return }
      if (/^[1-9]$/.test(event.key) && Number(event.key) <= total) { event.preventDefault(); navigateTo(Number(event.key) - 1); return }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); navigateTo(index + 1) }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); navigateTo(index - 1) }
      if (event.key === 'Home') { event.preventDefault(); navigateTo(0) }
      if (event.key === 'End') { event.preventDefault(); navigateTo(total - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePlayer, toggleFullscreen, total, index, navigateTo, showOverview])

  return createPortal(<div ref={playerRef} className={`br-player${fullscreen ? ' is-fullscreen' : ''}`} role="dialog" aria-modal="true" aria-label={`Apresentação da reunião: ${titulo}`}>
    <header className="br-player-header">
      <span className="br-player-mark">Branorte</span><span className="br-player-title">{titulo}</span>
      <div className="br-player-header-actions">
        <span className="br-player-counter">{index + 1} / {total}</span>
        <button ref={overviewRef} className="br-player-overview-toggle" onClick={() => setShowOverview(value => !value)} aria-expanded={showOverview} aria-label={showOverview ? 'Voltar ao slide' : 'Todos os slides'} aria-keyshortcuts="g" title="Todos os slides (G)"><LayoutGrid size={18} /><span>{showOverview ? 'Voltar ao slide' : 'Todos os slides'}</span></button>
        <button className="br-player-fullscreen" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-pressed={fullscreen} aria-keyshortcuts="f" title={fullscreen ? 'Sair da tela cheia (F ou Esc)' : 'Tela cheia (F)'}>
          {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}<span>{fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</span><kbd className="br-player-shortcut">F</kbd>
        </button>
        <button ref={closeRef} onClick={() => void closePlayer()} aria-label="Fechar apresentação" title="Fechar apresentação"><X size={21} /></button>
      </div>
    </header>
    {fullscreenError && <p className="br-player-error" role="alert">{fullscreenError}</p>}
    <div className="br-player-stage-wrap" data-direction={direction}>
      {showOverview ? <section className="br-overview" aria-label="Todos os slides">
        <div className="br-overview-heading"><h2>Por onde vamos?</h2><p>Escolha um assunto para ir direto ao slide.</p></div>
        <div className="br-overview-grid">{manifesto.slides.map((item, i) => {
          const { Icon } = chapters[item.type]
          const label = item.type === 'video' && item.chapterLabel ? item.chapterLabel : chapters[item.type].label
          return <button key={item.id} className={`br-overview-card br-overview-${item.type}${i === index ? ' is-active' : ''}`} onClick={() => navigateTo(i)} aria-label={`Ir para slide ${i + 1}: ${item.title}`}>
            <div><Icon size={26} /><small>{String(i + 1).padStart(2, '0')} · {label}</small></div><h3>{item.title}</h3><p>{chapterSummary(item)}</p><ArrowRight size={20} aria-hidden="true" />
          </button>
        })}</div>
      </section> : <NativeSlide key={slide.id} slide={slide} pagina={index + 1} total={total} videoUrl={slide.type === 'video' ? videoUrls[slide.videoPath] : undefined} videoLoading={videoLoading} videoError={videoError} onNavigate={navigateToType} />}
    </div>
    <footer className="br-player-controls">
      <button onClick={() => navigateTo(index - 1)} disabled={index === 0} aria-label="Slide anterior"><ArrowLeft size={18} /><span>Anterior</span></button>
      <nav className="br-player-chapters" aria-label="Navegar pelos slides">{manifesto.slides.map((item, i) => {
        const { Icon } = chapters[item.type]
        const label = item.type === 'video' && item.chapterLabel ? item.chapterLabel : chapters[item.type].label
        return <button key={item.id} className={i === index && !showOverview ? 'is-active' : ''} onClick={() => navigateTo(i)} aria-current={i === index && !showOverview ? 'step' : undefined} aria-label={`Slide ${i + 1}: ${label}`} title={`${item.title} (tecla ${i + 1})`}><Icon size={16} /><span>{label}</span><small>{i + 1}</small></button>
      })}</nav>
      <button onClick={() => navigateTo(index + 1)} disabled={index === total - 1} aria-label="Próximo slide"><span>Próximo</span><ArrowRight size={18} /></button>
    </footer>
  </div>, document.body)
}

export function Apresentacao({ reuniaoId, titulo, manifesto, onSave, podeEditar }: {
  reuniaoId: string
  titulo: string
  manifesto: ApresentacaoManifesto | null
  onSave: (manifesto: ApresentacaoManifesto) => Promise<void>
  podeEditar: boolean
}) {
  const atual: ApresentacaoManifesto = manifesto ?? { version: 2, slides: [], pptx: null }
  const atualRef = useRef(atual)
  useEffect(() => { atualRef.current = atual }, [manifesto])
  const [aberta, setAberta] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, setPendente] = useState<ApresentacaoManifesto | null>(null)
  const videoSlides = atual.slides.filter((s): s is Extract<ApresentacaoSlide, { type: 'video' }> => s.type === 'video')
  const [videoSlideId, setVideoSlideId] = useState(videoSlides[0]?.id ?? '')
  const videoInput = useRef<HTMLInputElement>(null)
  const pptxInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (videoSlides.length && !videoSlides.some(s => s.id === videoSlideId)) setVideoSlideId(videoSlides[0].id)
  }, [videoSlides, videoSlideId])

  const enviarArquivo = async (arquivo: File | undefined, tipo: 'video' | 'pptx') => {
    if (!arquivo || pendente) return
    setErro(null); setOcupado(tipo)
    try {
      if (!arquivo.name.toLowerCase().endsWith(tipo === 'video' ? '.mp4' : '.pptx')) throw new Error(`Selecione um arquivo ${tipo === 'video' ? 'MP4' : 'PowerPoint'}.`)
      if (arquivo.size > MAX_BYTES) throw new Error('O arquivo ultrapassa o limite de 20 MB.')
      if (tipo === 'video' && !videoSlideId) throw new Error('A apresentação precisa ter um slide do tipo vídeo.')
      const path = `${reuniaoId}/${tipo === 'video' ? 'video' : 'apresentacao'}-${sufixo()}.${tipo === 'video' ? 'mp4' : 'pptx'}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: tipo === 'video' ? 'video/mp4' : PPTX_MIME })
      if (error) throw error
      const base = atualRef.current
      const novo: ApresentacaoManifesto = tipo === 'video'
        ? { ...base, slides: base.slides.map(s => s.type === 'video' && s.id === videoSlideId ? { ...s, videoPath: path, youtubeId: undefined } : s) }
        : { ...base, pptx: path }
      try { await onSave(novo); atualRef.current = novo }
      catch (error) { setPendente(novo); throw new Error(`O arquivo subiu, mas não foi vinculado à reunião: ${erroLegivel(error)}`) }
    } catch (error) { setErro(erroLegivel(error)) }
    finally { if (videoInput.current) videoInput.current.value = ''; if (pptxInput.current) pptxInput.current.value = ''; setOcupado(null) }
  }

  const baixarPptx = async () => {
    if (!atual.pptx) return
    const aba = window.open('about:blank', '_blank')
    if (!aba) { setErro('O navegador bloqueou a nova aba. Permita pop-ups para baixar o PowerPoint.'); return }
    aba.opener = null
    setOcupado('download'); setErro(null)
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(atual.pptx, 300, { download: true })
      if (error || !data?.signedUrl) throw error ?? new Error('O link não foi gerado.')
      aba.location.replace(data.signedUrl)
    } catch (error) { aba.close(); setErro(`Não foi possível baixar o PowerPoint: ${erroLegivel(error)}`) }
    finally { setOcupado(null) }
  }

  return <div className="rounded-xl border border-border bg-surface p-4 mb-3">
    <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Presentation className="h-4 w-4 text-accent" /> Apresentação</h2><span className="text-[11px] text-ink-faint">{atual.slides.length ? `${atual.slides.length} slides` : 'Sem slides'}</span></div>
    <p className="mt-1 text-[11px] text-ink-faint">Slides interativos dentro do CRM, com vídeo reproduzido no próprio slide.</p>
    <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => setAberta(true)} disabled={!atual.slides.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"><Maximize2 className="h-4 w-4" /> Abrir apresentação</button>{atual.pptx && <button onClick={baixarPptx} disabled={!!ocupado} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-ink-muted hover:text-ink disabled:opacity-50"><Download className="h-4 w-4" /> Baixar PowerPoint</button>}</div>
    {podeEditar ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
      <input ref={videoInput} type="file" accept=".mp4,video/mp4" className="hidden" onChange={event => enviarArquivo(event.target.files?.[0], 'video')} />
      {videoSlides.length > 1 && <select value={videoSlideId} onChange={event => setVideoSlideId(event.target.value)} className="h-8 rounded-lg border border-border bg-surface px-2 text-[11px] text-ink">{videoSlides.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
      {videoSlides.length > 0 && <button onClick={() => videoInput.current?.click()} disabled={!!ocupado || !!pendente} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] text-ink-muted hover:text-ink disabled:opacity-50"><Upload className="h-3.5 w-3.5" /> Enviar vídeo MP4</button>}
      <input ref={pptxInput} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden" onChange={event => enviarArquivo(event.target.files?.[0], 'pptx')} />
      <button onClick={() => pptxInput.current?.click()} disabled={!!ocupado || !!pendente} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] text-ink-muted hover:text-ink disabled:opacity-50"><Upload className="h-3.5 w-3.5" /> {atual.pptx ? 'Trocar PowerPoint' : 'Enviar PowerPoint'}</button>
    </div> : <p className="mt-3 border-t border-border/70 pt-3 text-[11px] text-ink-faint">Somente administradores podem enviar arquivos.</p>}
    {pendente && podeEditar && <button onClick={async () => { setOcupado('vinculo'); setErro(null); try { await onSave(pendente); atualRef.current = pendente; setPendente(null) } catch (error) { setErro(`Ainda não foi possível vincular o arquivo: ${erroLegivel(error)}`) } finally { setOcupado(null) } }} disabled={!!ocupado} className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent disabled:opacity-50">Tentar salvar vínculo novamente</button>}
    {ocupado && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-accent"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {ocupado === 'download' ? 'Preparando download…' : 'Enviando arquivo…'}</p>}
    {erro && <p role="alert" className="mt-2 text-[11px] text-danger">{erro}</p>}
    {aberta && atual.slides.length > 0 && <ApresentacaoViewer titulo={titulo} manifesto={atual} onClose={() => setAberta(false)} />}
  </div>
}
