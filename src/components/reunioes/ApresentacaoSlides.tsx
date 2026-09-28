import { useEffect, useState } from 'react'
import type { ApresentacaoSlide } from '@/hooks/useReunioes'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const brlInteiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const numero = new Intl.NumberFormat('pt-BR')


type NavigateSlide = (type: ApresentacaoSlide['type']) => void

/** Animate presentation values only; the stored value remains the source of truth. */
function AnimatedValue({ value, format = numero.format }: { value: number; format?: (value: number) => string }) {
  const [display, setDisplay] = useState(() => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let start: number | undefined
    const finish = () => { cancelAnimationFrame(frame); setDisplay(value) }
    const tick = (now: number) => {
      start ??= now
      const progress = Math.min(1, (now - start) / 2000)
      setDisplay(progress === 1 ? value : value * (1 - Math.cos(Math.PI * progress)) / 2)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    if (preference.matches) finish()
    else { setDisplay(0); frame = requestAnimationFrame(tick) }
    const onPreferenceChange = () => { if (preference.matches) finish() }
    preference.addEventListener('change', onPreferenceChange)
    return () => { cancelAnimationFrame(frame); preference.removeEventListener('change', onPreferenceChange) }
  }, [value])
  return <span className="br-animated-value" aria-label={format(value)}><span className="br-animated-value" aria-hidden="true">{format(display)}</span></span>
}

const inteiro = (value: number) => numero.format(Math.round(value))

function SlideShell({ slide, pagina, total, children, footer }: {
  slide: ApresentacaoSlide
  pagina: number
  total: number
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section className={`br-slide br-slide-${slide.type}`} role="group" aria-label={`Slide ${pagina} de ${total}: ${slide.title}`}>
      <div className="br-slide-top">
        <span className="br-slide-brand">Branorte<span className="br-brand-square" /></span>
        {slide.eyebrow && <span className="br-slide-eyebrow">{slide.eyebrow}</span>}
      </div>
      <div className="br-slide-content">{children}</div>
      <div className="br-slide-bottom">
        <span className="br-slide-bottom-note">{footer}</span>
        <span className="br-slide-page">{String(pagina).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
      </div>
    </section>
  )
}

function CoverContent({ slide, onNavigate }: { slide: Extract<ApresentacaoSlide, { type: 'cover' }>; onNavigate?: NavigateSlide }) {
  return (
    <div className="br-cover-layout">
      <div className="br-cover-copy">
        <p className="br-cover-date">{slide.dateLabel}</p>
        <h2>{slide.title}</h2>
        {slide.subtitle && <p className="br-cover-subtitle">{slide.subtitle}</p>}
        {onNavigate && <button type="button" className="br-slide-action" onClick={() => onNavigate('calls')}>Começar reunião <span aria-hidden="true">→</span></button>}
      </div>
      {slide.highlight && <blockquote className="br-cover-quote">{slide.highlight}</blockquote>}
    </div>
  )
}

function CallsContent({ slide }: { slide: Extract<ApresentacaoSlide, { type: 'calls' }> }) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const vendedores = [...(slide.sellers ?? [])].sort((a, b) => b.count - a.count)
  const selected = vendedores.find(v => v.name === selectedName)
  const count = selected?.count ?? slide.total
  const target = selected ? slide.individualTarget : slide.teamTarget
  const pct = target > 0 ? Math.round(count / target * 100) : 0
  const remaining = Math.max(0, target - count)
  const maximo = Math.max(slide.individualTarget, ...vendedores.map(v => v.count), 1)
  return (
    <div className="br-template br-calls">
      <div className="br-template-heading"><h2>{slide.title}</h2><p>Clique em um vendedor para explorar o resultado</p></div>
      <div className="br-calls-layout">
        <div className="br-calls-focus">
          <span className="br-data-label">{selected ? selected.name : 'Resultado da equipe'}</span>
          <div className="br-calls-number"><strong><AnimatedValue value={count} format={inteiro} /></strong><span>/ {numero.format(target)}</span></div>
          <div className="br-calls-meter" role="progressbar" aria-valuenow={Math.min(count, target)} aria-valuemin={0} aria-valuemax={target} aria-valuetext={`${count} de ${target} chamadas`} aria-label={selected ? `Ligações de ${selected.name} ante a meta individual` : 'Ligações válidas ante a meta da equipe'}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <div className="br-calls-meter-label"><span>{pct}% da meta {selected ? 'individual' : 'coletiva'}</span><span>{selected ? remaining > 0 ? `Faltam ${numero.format(remaining)} para a meta` : 'Meta alcançada' : `${slide.metCount} de ${slide.sellerCount} chegaram a ${slide.individualTarget}`}</span></div>
          <p className="br-calls-definition">Feita pelo vendedor ou recebida e atendida por ele.</p>
          {selected && <button type="button" className="br-calls-reset" onClick={() => setSelectedName(null)}>← Ver equipe</button>}
        </div>
        <div className="br-calls-list" aria-label="Ligações válidas por vendedor">
          {vendedores.map((v, i) => (
            <button type="button" className={`br-calls-row${selected?.name === v.name ? ' is-selected' : ''}`} key={`${v.name}-${i}`} aria-pressed={selected?.name === v.name} aria-label={`${v.name}: ${v.count} chamadas. Ver resultado individual`} onClick={() => setSelectedName(selected?.name === v.name ? null : v.name)}>
              <span className="br-calls-name">{v.name}</span>
              <span className="br-calls-bar"><span className={v.count >= slide.individualTarget ? 'hit' : ''} style={{ width: `${Math.max(2, v.count / maximo * 100)}%` }} /></span>
              <strong className={v.count >= slide.individualTarget ? 'hit' : ''}>{numero.format(v.count)}</strong>
            </button>
          ))}
          <div className="br-calls-target"><span /> Meta individual: {slide.individualTarget}</div>
        </div>
      </div>
    </div>
  )
}

function SalesContent({ slide }: { slide: Extract<ApresentacaoSlide, { type: 'sales' }> }) {
  const falta = Math.max(0, slide.goal - slide.monthTotal)
  const pct = slide.goal > 0 ? Math.min(100, slide.monthTotal / slide.goal * 100) : 0
  return (
    <div className="br-template br-sales">
      <div className="br-template-heading"><h2>{slide.title}</h2><p>Fechamento de setembro</p></div>
      <div className="br-sales-head">
        <div><span className="br-data-label">Vendido no mês</span><strong><AnimatedValue value={slide.monthTotal} format={brl.format} /></strong></div>
        <div className="br-sales-gap"><span>Faltam para {brlInteiro.format(slide.goal)}</span><strong><AnimatedValue value={falta} format={brl.format} /></strong></div>
      </div>
      <div className="br-sales-track" role="progressbar" aria-valuenow={slide.monthTotal} aria-valuemin={0} aria-valuemax={slide.goal} aria-label="Vendido no mês ante a mega meta"><span style={{ width: `${pct}%` }} /></div>
      <div className="br-sales-track-label"><span>0</span><span>{Math.round(pct)}% da mega meta</span><span>{brlInteiro.format(slide.goal)}</span></div>
      <div className="br-sales-equation">
        <div><span>Antes da semana</span><strong>{brl.format(slide.beforeWeek)}</strong></div>
        <span aria-hidden="true">+</span>
        <div><span>Última semana</span><strong>{brl.format(slide.weekTotal)}</strong></div>
        <span aria-hidden="true">=</span>
        <div className="br-sales-equation-total"><span>Setembro</span><strong>{brl.format(slide.monthTotal)}</strong></div>
      </div>
      <div className="br-sales-mini">
        <div><strong><AnimatedValue value={slide.effectiveSales} format={inteiro} /></strong><span>vendas efetivas na semana</span></div>
        <div><strong><AnimatedValue value={slide.aboveTenK} format={inteiro} /></strong><span>acima de R$ 10 mil</span></div>
        <div><strong>{slide.metCount}/{slide.sellerCount}</strong><span>bateram a meta individual de {brlInteiro.format(slide.individualTarget)}</span></div>
      </div>
    </div>
  )
}

function TeamsContent({ slide }: { slide: Extract<ApresentacaoSlide, { type: 'teams' }> }) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const times = [...(slide.teams ?? [])].sort((a, b) => b.total - a.total)
  const teamTotal = times.reduce((total, time) => total + time.total, 0)
  const selected = times.find(time => time.name === selectedName)
  return (
    <div className="br-template br-teams">
      <div className="br-template-heading"><h2>{slide.title}</h2><p>Selecione um time para ver sua participação</p></div>
      <div className="br-teams-list">
        {times.map((time, i) => {
          const goal = typeof time.goal === 'number' && Number.isFinite(time.goal) && time.goal > 0 ? time.goal : null
          const percent = goal === null ? null : time.total / goal * 100
          const remaining = goal === null ? null : Math.max(0, goal - time.total)
          const percentLabel = percent === null ? null : percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
          const remainingLabel = remaining === null ? null : brlInteiro.format(remaining)
          return (
          <div className={`br-team${selected?.name === time.name ? ' is-selected' : ''}`} key={`${time.name}-${i}`}>
            <div className="br-team-index">{String(i + 1).padStart(2, '0')}</div>
            <div className="br-team-detail">
              <div className="br-team-heading"><button type="button" className="br-team-select" aria-pressed={selected?.name === time.name} onClick={() => setSelectedName(selected?.name === time.name ? null : time.name)}><span>{time.name}</span><strong>{brlInteiro.format(time.total)}</strong></button></div>
              <div className="br-team-meta">
                {goal === null ? <span className="br-team-goal-unset">Meta não informada</span> : <>
                  <span>Meta {brlInteiro.format(goal)}</span>
                  <strong>{percentLabel}% atingido</strong>
                  <span className={remaining === 0 ? 'is-met' : ''}>{remaining === 0 ? 'Meta atingida' : `Faltam ${remainingLabel}`}</span>
                </>}
              </div>
              <div className={`br-team-track${goal === null ? ' is-unset' : ''}`} role={goal === null ? undefined : 'progressbar'} aria-label={goal === null ? 'Meta não informada' : `Atingimento da meta de ${time.name}`} aria-valuenow={goal === null ? undefined : Math.max(0, Math.min(time.total, goal))} aria-valuemin={goal === null ? undefined : 0} aria-valuemax={goal ?? undefined} aria-valuetext={percentLabel === null ? undefined : `${percentLabel}% da meta`}>{percent !== null && <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />}</div>
              <div className="br-team-members">{(time.members ?? []).map(m => <span key={m.name}><b>{m.name}</b> {brlInteiro.format(m.value)}</span>)}</div>
            </div>
          </div>
          )
        })}
      </div>
      <p className="br-team-insight" aria-live="polite">{selected ? <><strong>{selected.name}</strong> responde por <strong>{(teamTotal > 0 ? selected.total / teamTotal * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong> das vendas dos três times.</> : 'Clique no nome de um time para comparar a participação no resultado dos três times.'}</p>
      {slide.globalOnly?.length ? <p className="br-team-global">No total geral, fora dos três times: {slide.globalOnly.map(p => `${p.name} ${brlInteiro.format(p.value)}`).join(' · ')}</p> : null}
    </div>
  )
}

function AgendaContent({ slide, onNavigate }: { slide: Extract<ApresentacaoSlide, { type: 'agenda' }>; onNavigate?: NavigateSlide }) {
  const destinationFor = (title: string): ApresentacaoSlide['type'] => {
    const titleKey = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (titleKey.includes('video')) return 'video'
    if (titleKey.includes('kanban') || titleKey.includes('funil') || titleKey.includes('compromiss')) return 'funnel'
    if (titleKey.includes('resultado') || titleKey.includes('ligac')) return 'calls'
    return 'sales'
  }
  return (
    <div className="br-template br-agenda">
      <div className="br-template-heading"><h2>{slide.title}</h2><p>Roteiro de {slide.totalMinutes} minutos</p></div>
      <div className="br-agenda-rail" aria-hidden="true">{(slide.items ?? []).map((item, i) => <span key={i} style={{ flex: Math.max(item.minutes, 2) }} className={item.minutes === Math.max(...slide.items.map(x => x.minutes)) ? 'primary' : ''} />)}</div>
      <ol className="br-agenda-items">
        {(slide.items ?? []).map((item, i) => (
          <li key={`${item.title}-${i}`} className={item.minutes === Math.max(...slide.items.map(x => x.minutes)) ? 'primary' : ''}>
            <button type="button" className="br-agenda-link" disabled={!onNavigate} onClick={() => onNavigate?.(destinationFor(item.title))} aria-label={`${item.title}, ${item.minutes} minutos. Ir para este tema`}>
              <span className="br-agenda-time">{item.minutes}<small>min</small></span>
              <span className="br-agenda-copy"><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function VideoContent({ slide, url, carregando, erro }: {
  slide: Extract<ApresentacaoSlide, { type: 'video' }>
  url?: string
  carregando: boolean
  erro: string | null
}) {
  const youtubeId = typeof slide.youtubeId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(slide.youtubeId) ? slide.youtubeId : null
  return (
    <div className={`br-template br-video-layout${youtubeId ? ' is-embedded' : ''}`}>
      <div className="br-video-copy">
        <span className="br-data-label">{slide.chapterLabel || 'Uma pergunta antes do Kanban'}</span>
        <h2>{slide.title}</h2>
        {slide.prompt && <p>{slide.prompt}</p>}
        {slide.source && <a href={slide.source} target="_blank" rel="noopener noreferrer">Abrir publicação original</a>}
      </div>
      <div className="br-video-screen">
        {youtubeId ? <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?controls=1&autoplay=0&rel=0&playsinline=1`}
          title={`Vídeo do slide: ${slide.title}`}
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        /> : url ? <video src={url} controls playsInline preload="metadata" aria-label={`Vídeo do slide: ${slide.title}`} />
          : <p>{carregando ? 'Carregando vídeo…' : erro || 'Vídeo ainda não disponível.'}</p>}
      </div>
    </div>
  )
}

function FunnelContent({ slide }: { slide: Extract<ApresentacaoSlide, { type: 'funnel' }> }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const selected = selectedIndex === null ? undefined : slide.stages[selectedIndex]
  const cores = ['#254b3c', '#1d5a40', '#197447', '#1d9454']
  const guidance = [
    'Priorizar os contatos sem retorno e definir a próxima tentativa com data.',
    'Confirmar a necessidade do cliente e agendar o próximo contato, começando pelos parados.',
    'Revisar o último combinado, identificar a objeção e definir como ajudar o vendedor a avançar.',
    'Identificar o que falta para fechar, a ajuda necessária e a próxima ação com responsável e prazo.',
  ]
  const stalledPct = selected && selected.count > 0 ? selected.stalled / selected.count * 100 : 0
  return (
    <div className="br-template br-funnel">
      <div className="br-template-heading"><h2>{slide.title}</h2><p>{slide.scope}</p></div>
      <div className="br-funnel-layout">
        <div className="br-funnel-graphic">
          <div className="br-funnel-stages" aria-label="Contatos por etiqueta do funil">
            {(slide.stages ?? []).map((stage, i) => (
              <button type="button" className={`br-funnel-band${selectedIndex === i ? ' is-selected' : ''}`} key={`${stage.name}-${i}`} style={{ width: `${100 - i * 11}%`, backgroundColor: cores[i % cores.length] }} aria-pressed={selectedIndex === i} aria-label={`${stage.name}: ${stage.count} contatos, ${stage.stalled} parados há mais de sete dias. Ver etapa`} onClick={() => setSelectedIndex(selectedIndex === i ? null : i)}>
                <span>{stage.name}</span><strong>{numero.format(stage.count)}</strong><em>{numero.format(stage.stalled)} {stage.stalled === 1 ? 'parado' : 'parados'} &gt; 7 dias</em>
              </button>
            ))}
          </div>
          <p className="br-interaction-hint">Clique em uma etapa para explorar</p>
        </div>
        <div className="br-funnel-actions">
          {selected ? <div className="br-funnel-summary" key={selected.name}>
            <h3>{selected.name}</h3>
            <div className="br-funnel-summary-metrics"><div><strong><AnimatedValue value={selected.count} format={inteiro} /></strong><span>contatos na etapa</span></div><div><strong><AnimatedValue value={selected.stalled} format={inteiro} /></strong><span>parados &gt; 7 dias</span></div></div>
            <p><strong>{stalledPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong> desta etapa sem mensagem há mais de sete dias.</p>
            <p>{guidance[selectedIndex ?? 0] ?? guidance[0]}</p>
            <button type="button" className="br-funnel-back" onClick={() => setSelectedIndex(null)}>← Ver orientações</button>
          </div> : <>
            <h3>Como conduzir agora</h3>
            <ol>{(slide.actions ?? []).map((acao, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span>{acao}</li>)}</ol>
          </>}
          <a className="br-slide-action" href="/funil" target="_blank" rel="noopener noreferrer">Abrir Kanban <span aria-hidden="true">↗</span></a>
          <p className="br-interaction-hint">O Kanban abre com os filtros salvos; confira o recorte de vendedores.</p>
          {slide.note && <details className="br-funnel-context"><summary>Critérios dos números</summary><p>{slide.note}</p></details>}
        </div>
      </div>
    </div>
  )
}

export function NativeSlide({ slide, pagina, total, videoUrl, videoLoading, videoError, onNavigate }: {
  slide: ApresentacaoSlide
  pagina: number
  total: number
  videoUrl?: string
  videoLoading: boolean
  videoError: string | null
  onNavigate?: NavigateSlide
}) {
  const footer = slide.type === 'calls' || slide.type === 'sales' || slide.type === 'teams' ? slide.takeaway
    : slide.type === 'funnel' ? slide.noteShort : undefined
  return <SlideShell slide={slide} pagina={pagina} total={total} footer={footer}>
    {slide.type === 'cover' && <CoverContent slide={slide} onNavigate={onNavigate} />}
    {slide.type === 'calls' && <CallsContent slide={slide} />}
    {slide.type === 'sales' && <SalesContent slide={slide} />}
    {slide.type === 'teams' && <TeamsContent slide={slide} />}
    {slide.type === 'agenda' && <AgendaContent slide={slide} onNavigate={onNavigate} />}
    {slide.type === 'video' && <VideoContent slide={slide} url={videoUrl} carregando={videoLoading} erro={videoError} />}
    {slide.type === 'funnel' && <FunnelContent slide={slide} />}
  </SlideShell>
}
