import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ArrowUpRight, Building2, ChevronRight, Maximize2, RefreshCw, Trophy, Users, X } from 'lucide-react'
import './escritorio-painel.css'

export interface EscritorioPainelMes {
  atendimentos: number
  leads: number
  orcamentos: number
}

export interface EscritorioPainelVendedor {
  nome: string
  status: string
  statusLabel: string
  atendimentos: number | null
  leads: number | null
  orcamentos: number | null
  ligacoes: number | null
  followup: number | null
  quentes: number | null
  mes: EscritorioPainelMes | null
}

export interface EscritorioPainelRanking extends EscritorioPainelMes {
  nome: string
  historico?: boolean
}

export interface EscritorioPainelProps {
  vendedores: EscritorioPainelVendedor[]
  rankingMes: EscritorioPainelRanking[]
  atualizadoEm: number | null
  carregando: boolean
  erro: boolean
  rankingCarregando: boolean
  rankingErro: boolean
  avisoMensal?: string
  onRefresh: () => void
  onEscritorio: () => void
}

type Metrica = keyof EscritorioPainelMes
type PainelDialog = { tipo: 'ranking' } | { tipo: 'vendedor'; nome: string } | null
const METRICAS: { chave: Metrica; rotulo: string }[] = [
  { chave: 'atendimentos', rotulo: 'Atendimentos' },
  { chave: 'leads', rotulo: 'Leads' },
  { chave: 'orcamentos', rotulo: 'Orçamentos' },
]
const fuso = 'America/Sao_Paulo'
const numero = (valor: number | null | undefined) => valor == null ? '—' : valor.toLocaleString('pt-BR')
const nomeLegivel = (nome: string) => nome.toLocaleLowerCase('pt-BR').replace(/(^|\s)\S/g, letra => letra.toLocaleUpperCase('pt-BR'))
const iniciais = (nome: string) => nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(parte => parte[0]).join('').toLocaleUpperCase('pt-BR')
function tomStatus(status: string) {
  if (status === 'ativo') return 'ativo'
  if (['desconectado', 'desligado'].includes(status)) return 'offline'
  return 'pausa'
}

function Status({ vendedor }: { vendedor: EscritorioPainelVendedor }) {
  return <span className={`bnp-status bnp-status--${tomStatus(vendedor.status)}`}><i aria-hidden="true" />{vendedor.statusLabel}</span>
}

export function EscritorioPainel({
  vendedores, rankingMes, atualizadoEm, carregando, erro,
  rankingCarregando, rankingErro, avisoMensal, onRefresh, onEscritorio,
}: EscritorioPainelProps) {
  const [monitor, setMonitor] = useState(false)
  const [painelElement, setPainelElement] = useState<HTMLElement | null>(null)
  const [dialog, setDialog] = useState<PainelDialog>(null)
  const [metrica, setMetrica] = useState<Metrica>('atendimentos')
  const [agora, setAgora] = useState(() => Date.now())
  const monitorAberto = useRef(false)
  const fullscreenProprio = useRef(false)
  const focoAnterior = useRef<HTMLElement | null>(null)
  const focoDialog = useRef<HTMLElement | null>(null)
  const sairRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const intervalo = window.setInterval(() => setAgora(Date.now()), 60_000)
    return () => window.clearInterval(intervalo)
  }, [])

  const fecharMonitor = useCallback(() => {
    monitorAberto.current = false
    setDialog(null)
    setMonitor(false)
    if (fullscreenProprio.current && document.fullscreenElement) {
      fullscreenProprio.current = false
      void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  function abrirMonitor() {
    focoAnterior.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    monitorAberto.current = true
    setMonitor(true)
    // O modo monitor também funciona em navegadores sem Fullscreen API, como o iPad.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().then(() => {
        fullscreenProprio.current = true
        if (!monitorAberto.current) {
          fullscreenProprio.current = false
          void document.exitFullscreen().catch(() => undefined)
        }
      }).catch(() => undefined)
    }
  }

  useEffect(() => {
    if (!monitor) return
    monitorAberto.current = true
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sairRef.current?.focus()
    function aoMudarFullscreen() {
      if (fullscreenProprio.current && !document.fullscreenElement) {
        fullscreenProprio.current = false
        fecharMonitor()
      }
    }
    document.addEventListener('fullscreenchange', aoMudarFullscreen)
    return () => {
      document.body.style.overflow = overflowAnterior
      document.removeEventListener('fullscreenchange', aoMudarFullscreen)
      monitorAberto.current = false
      if (fullscreenProprio.current && document.fullscreenElement) {
        fullscreenProprio.current = false
        void document.exitFullscreen().catch(() => undefined)
      }
      focoAnterior.current?.focus()
    }
  }, [monitor, fecharMonitor])

  useEffect(() => {
    if (!monitor || dialog) return
    function aoTeclar(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        fecharMonitor()
      }
      if (event.key !== 'Tab' || !painelElement) return
      const alvos = Array.from(painelElement.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]'))
      const primeiro = alvos[0]
      const ultimo = alvos[alvos.length - 1]
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault()
        ultimo?.focus()
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault()
        primeiro?.focus()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [monitor, dialog, painelElement, fecharMonitor])

  function abrirDialog(proximo: NonNullable<PainelDialog>) {
    focoDialog.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDialog(proximo)
  }

  const totais = useMemo(() => {
    const somar = (chave: Metrica) => carregando || (erro && !vendedores.length) || vendedores.some(v => v[chave] == null)
      ? null : vendedores.reduce((total, vendedor) => total + (vendedor[chave] ?? 0), 0)
    return { atendimentos: somar('atendimentos'), leads: somar('leads'), orcamentos: somar('orcamentos') }
  }, [vendedores, carregando, erro])
  const ranking = useMemo(() => [...rankingMes].sort((a, b) => b[metrica] - a[metrica] || a.nome.localeCompare(b.nome, 'pt-BR')), [rankingMes, metrica])
  const selecionado = dialog?.tipo === 'vendedor' ? vendedores.find(v => v.nome === dialog.nome) : undefined
  const ativos = vendedores.filter(v => v.status === 'ativo').length
  const dataHoje = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', timeZone: fuso }).format(agora)
  const mesAtual = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: fuso }).format(agora)
  const horaAtualizada = atualizadoEm == null ? null : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso }).format(atualizadoEm)
  const dadosAusentes = vendedores.some(v => v.atendimentos == null || v.leads == null || v.orcamentos == null)

  const conteudo = (
    <section ref={setPainelElement} className={`bnp-panel${monitor ? ' bnp-panel--monitor' : ''}`} aria-label="Painel do time comercial" role={monitor ? 'dialog' : undefined} aria-modal={monitor || undefined}>
      <div className="bnp-content">
      <header className="bnp-header">
        <div className="bnp-heading">
          <div className="bnp-brand"><span className="bnp-brandmark" aria-hidden="true"><i /><i /><i /></span>BRANORTE<span className="bnp-brand-divider" />COMERCIAL</div>
          <h2>Painel do time<span className="bnp-today">Hoje</span></h2>
          <p>{dataHoje}<span aria-hidden="true"> · </span>Horário de Brasília</p>
        </div>
        <div className="bnp-actions">
          <button type="button" className="bnp-button bnp-button--icon" onClick={onRefresh} disabled={carregando} aria-label="Atualizar dados" title="Atualizar dados"><RefreshCw className={carregando ? 'bnp-spin' : ''} size={18} /></button>
          <button type="button" className="bnp-button bnp-button--ranking" onClick={() => abrirDialog({ tipo: 'ranking' })}><Trophy size={17} /><span>Ranking do mês</span></button>
          {monitor ? <button ref={sairRef} type="button" className="bnp-button" onClick={fecharMonitor}><ArrowLeft size={17} /><span>Voltar</span></button> : <button type="button" className="bnp-button" onClick={abrirMonitor}><Maximize2 size={17} /><span>Tela cheia</span></button>}
        </div>
      </header>

      {erro && <div className="bnp-alert" role="status">Alguns dados estão indisponíveis ou sem atualização de hoje. O traço (—) indica o que não foi confirmado.</div>}

      <div className="bnp-summary" aria-label="Resumo de hoje" aria-busy={carregando}>
        <div className="bnp-kpi bnp-kpi--primary"><span>Atendimentos hoje</span><strong>{numero(totais.atendimentos)}</strong><span className="bnp-kpi-note">Ritmo do dia <ArrowUpRight size={14} aria-hidden="true" /></span></div>
        <div className="bnp-kpi"><span>Leads recebidos</span><strong>{numero(totais.leads)}</strong><span className="bnp-kpi-note">Hoje</span></div>
        <div className="bnp-kpi"><span>Orçamentos</span><strong>{numero(totais.orcamentos)}</strong><span className="bnp-kpi-note">Hoje</span></div>
        <div className="bnp-kpi bnp-kpi--active"><span>Ativos agora</span><strong>{(carregando || erro) && !vendedores.length ? '—' : ativos}<small> / {vendedores.length}</small></strong><span className="bnp-kpi-note"><i className="bnp-live-dot" aria-hidden="true" />Status do time</span></div>
      </div>

      <div className="bnp-team-heading"><h3>Ritmo do dia <span>{vendedores.length} vendedores</span></h3><span className="bnp-update" aria-live="polite">{carregando ? 'Atualizando…' : horaAtualizada ? `Atualizado às ${horaAtualizada}` : 'Aguardando dados'}</span></div>

      <div className={`bnp-sellers${vendedores.length === 9 ? ' bnp-sellers--nine' : ''}`} aria-label="Vendedores e resultados de hoje" aria-busy={carregando}>
        {vendedores.map(vendedor => <button type="button" key={vendedor.nome} className="bnp-seller" onClick={() => abrirDialog({ tipo: 'vendedor', nome: vendedor.nome })} aria-label={`Ver detalhes de ${nomeLegivel(vendedor.nome)}`}>
          <span className="bnp-seller-header"><span className={`bnp-avatar bnp-avatar--${tomStatus(vendedor.status)}`} aria-hidden="true">{iniciais(vendedor.nome)}</span><span className="bnp-seller-identity"><span className="bnp-seller-name">{nomeLegivel(vendedor.nome)}</span><Status vendedor={vendedor} /></span><ChevronRight size={15} className="bnp-card-arrow" aria-hidden="true" /></span>
          <span className="bnp-seller-main"><strong>{numero(vendedor.atendimentos)}</strong><span>atendimentos hoje</span></span>
          <span className="bnp-seller-metrics"><span><span>Leads</span><strong>{numero(vendedor.leads)}</strong></span><span><span>Orçamentos</span><strong>{numero(vendedor.orcamentos)}</strong></span></span>
        </button>)}
        {!vendedores.length && <div className="bnp-empty"><Users size={30} /><strong>{carregando ? 'Preparando o painel…' : 'Nenhum vendedor para exibir'}</strong><span>{carregando ? 'Buscando os resultados do time.' : 'Os vendedores cadastrados aparecerão aqui.'}</span></div>}
      </div>

      <footer className="bnp-footer"><span>{dadosAusentes ? '— indica um dado ainda indisponível.' : 'Toque em um vendedor para ver o dia e o mês.'}</span><button type="button" onClick={() => { if (monitor) fecharMonitor(); onEscritorio() }}><Building2 size={15} />Ver escritório<ChevronRight size={14} /></button></footer>
      </div>

      <Dialog.Root open={dialog !== null} onOpenChange={aberto => { if (!aberto) setDialog(null) }}>
        <Dialog.Portal container={painelElement}>
          <Dialog.Overlay className="bnp-dialog-overlay" />
          <Dialog.Content className={`bnp-dialog ${dialog?.tipo === 'ranking' ? 'bnp-dialog--ranking' : ''}`} onCloseAutoFocus={event => { event.preventDefault(); focoDialog.current?.focus() }}>
            <div className="bnp-dialog-top"><span className="bnp-eyebrow">{dialog?.tipo === 'ranking' ? 'DESTAQUES DO TIME' : 'DESEMPENHO INDIVIDUAL'}</span><Dialog.Close asChild><button type="button" className="bnp-button bnp-button--icon" aria-label="Fechar detalhes"><X size={20} /></button></Dialog.Close></div>
            {dialog?.tipo === 'ranking' ? <>
              <Dialog.Title className="bnp-dialog-title"><Trophy size={27} />Ranking do mês</Dialog.Title>
              <Dialog.Description className="bnp-dialog-description">{mesAtual} · Acumulado até hoje</Dialog.Description>
              {avisoMensal && <p className="bnp-month-warning">{avisoMensal}</p>}
              <div className="bnp-segmented" aria-label="Métrica do ranking">{METRICAS.map(item => <button key={item.chave} type="button" aria-pressed={metrica === item.chave} onClick={() => setMetrica(item.chave)}>{item.rotulo}</button>)}</div>
              <div className="bnp-ranking-scroll" aria-live="polite" aria-busy={rankingCarregando}>
                {rankingCarregando ? <div className="bnp-empty"><RefreshCw size={24} className="bnp-spin" /><strong>Carregando o mês…</strong></div> : rankingErro ? <div className="bnp-empty"><strong>Não foi possível carregar o ranking.</strong><button type="button" className="bnp-button" onClick={onRefresh}><RefreshCw size={16} />Tentar novamente</button></div> : ranking.length ? <ol className="bnp-ranking-list">{ranking.map(vendedor => {
                  const posicao = ranking.findIndex(item => item[metrica] === vendedor[metrica]) + 1
                  return <li key={vendedor.nome} className={posicao === 1 && vendedor[metrica] > 0 ? 'bnp-rank-first' : ''}>
                    <span className="bnp-rank-position">{posicao.toString().padStart(2, '0')}</span><span className="bnp-rank-person"><strong>{nomeLegivel(vendedor.nome)}</strong><span>{vendedor.historico ? 'Histórico do mês' : `${numero(vendedor.atendimentos)} atend. · ${numero(vendedor.leads)} leads`}</span></span><strong className="bnp-rank-value">{numero(vendedor[metrica])}</strong>
                  </li>
                })}</ol> : <div className="bnp-empty"><Trophy size={30} /><strong>Ainda sem resultados neste mês.</strong></div>}
              </div>
              <p className="bnp-dialog-footnote">Ordenado por {METRICAS.find(item => item.chave === metrica)?.rotulo.toLocaleLowerCase('pt-BR')}. Resultados iguais dividem a posição.</p>
            </> : <>
              <Dialog.Title className="bnp-dialog-title">{selecionado ? nomeLegivel(selecionado.nome) : 'Detalhes do vendedor'}</Dialog.Title>
              <Dialog.Description className="bnp-dialog-description">Resultados do dia e acumulado do mês.</Dialog.Description>
              {selecionado && <div className="bnp-detail-scroll">
                <Status vendedor={selecionado} />
                <div className="bnp-detail-heading"><h3>Hoje</h3><span>{dataHoje}</span></div>
                <div className="bnp-detail-metrics"><div className="bnp-detail-feature"><strong>{numero(selecionado.atendimentos)}</strong><span>Atendimentos</span></div><div><strong>{numero(selecionado.leads)}</strong><span>Leads recebidos</span></div><div><strong>{numero(selecionado.orcamentos)}</strong><span>Orçamentos gerados</span></div><div><strong>{numero(selecionado.ligacoes)}</strong><span>Ligações atendidas</span></div></div>
                <div className="bnp-detail-heading"><h3>Neste mês</h3><span>{mesAtual}</span></div>
                {avisoMensal && <p className="bnp-month-warning">{avisoMensal}</p>}
                {rankingCarregando ? <p className="bnp-detail-note">Carregando o acumulado…</p> : <div className="bnp-month-metrics">{METRICAS.map(item => <div key={item.chave}><strong>{numero(selecionado.mes?.[item.chave])}</strong><span>{item.rotulo}</span></div>)}</div>}
                {rankingErro && <p className="bnp-detail-note">O acumulado do mês está indisponível.</p>}
                <div className="bnp-detail-heading"><h3>Funil agora</h3><span>Posição atual</span></div>
                <div className="bnp-funnel"><div><span>Em follow-up</span><strong>{numero(selecionado.followup)}</strong></div><div><span>Leads quentes</span><strong>{numero(selecionado.quentes)}</strong></div></div>
                <p className="bnp-dialog-footnote">O funil mostra a carteira atual; não representa apenas a atividade de hoje. — indica um dado indisponível.</p>
              </div>}
            </>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )

  return monitor ? createPortal(conteudo, document.body) : conteudo
}
