import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'
import { useWaKanban, useWaVendedores, useWaMovimentos, TODOS, type WaChat } from '@/hooks/useWaKanban'
import { useOrcamentosPorTelefone, lookupOrcamento, foneCanon } from '@/hooks/useAtendimentos'
import {
  tempoRelativo, temperaturaDe, TEMP_META, resumoColuna,
  formatarTelefone, nomeContato, ordenarChats, ORDENACAO_LABEL,
  precisaResposta,
  type Ordenacao, type Temperatura,
} from '@/lib/wa-funil'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Kanban WhatsApp — espelho fiel do quadro de etiquetas que cada vendedor
// vê no Wascript, sincronizado pela extensão Branorte WA Sync (30s).
// Colunas = etiquetas na ordem oficial do funil; cards = clientes com a
// última mensagem; painel lateral com detalhes + histórico.

const LIMITE_INICIAL = 30

// Preset "Funil ativo": etapas de venda em andamento (esconde fechamento/sem etiqueta)
const FUNIL_ATIVO = new Set([
  'PROSPECCAO', '2A TENTATIVA', 'NOVO LEAD', 'FOLLOW UP',
  'LEAD QUENTE', 'ORCAMENTO ENVIADO', 'INTERESSE FUTURO',
])

// Colunas de negociação: mostram o valor do orçamento no card + total no topo
// (cruzado por telefone via orcamentos_gerados / RPC orcamentos_por_telefone_canon)
const COLUNAS_COM_VALOR = new Set(['FOLLOW UP', 'LEAD QUENTE'])

const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

function BotaoWhats({ phone }: { phone: string }) {
  return (
    <a
      href={`https://wa.me/${phone.replace(/\D/g, '')}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title="Abrir conversa no WhatsApp"
      className="shrink-0 h-7 w-7 rounded-full bg-accent-bg text-accent border border-accent/30 inline-flex items-center justify-center hover:brightness-110"
    >
      <MessageCircle className="h-3.5 w-3.5" />
    </a>
  )
}

// Cifrão inline — render consistente cross-plataforma (evita o emoji 💰 variar por SO)
function IconCifrao({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 1.5v21M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

function ChatCard({
  chat, onClick, mostrarVendedor, compacto, valorOrcamento,
}: { chat: WaChat; onClick: () => void; mostrarVendedor?: boolean; compacto?: boolean; valorOrcamento?: number | null }) {
  const temp = temperaturaDe(chat.last_message_at)
  const meta = TEMP_META[temp]
  const fresco = temp === 'fresco'
  const pendente = precisaResposta(chat)
  const encerrou = chat.last_message_from_me === false && !pendente
  const nome = nomeContato(chat.contact_name, chat.phone)
  const tel = formatarTelefone(chat.phone)
  const temValor = valorOrcamento != null && valorOrcamento > 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      title={pendente ? 'Cliente aguardando resposta' : undefined}
      className={[
        'group relative w-full cursor-pointer select-none overflow-hidden text-left',
        'rounded-xl border border-border',
        'bg-gradient-to-b from-surface-2 to-surface',
        'pl-3.5 pr-3 transition-[border-color,box-shadow,transform] duration-150 ease-out',
        'hover:-translate-y-px hover:border-border-strong hover:shadow-[0_4px_14px_-4px_rgba(0,0,0,0.5)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent)/0.5)]',
        compacto ? 'py-2' : 'py-2.5',
      ].join(' ')}
      style={{
        borderColor: pendente ? 'hsl(var(--warning) / 0.55)' : undefined,
        boxShadow: pendente ? '0 0 0 1px hsl(var(--warning) / 0.4)' : undefined,
      }}
    >
      {/* tint âmbar levíssimo quando o cliente está aguardando resposta */}
      {pendente && (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl bg-[hsl(var(--warning)/0.06)]" />
      )}

      {/* trilho de temperatura — hairline vertical à esquerda */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2.5 left-0 w-[3px] rounded-full"
        style={{ backgroundColor: meta.cor, opacity: pendente ? 1 : 0.55 }}
      />

      <div className="relative">
        {/* topo: avatar (photo-ready) + identidade */}
        <div className="flex items-start gap-2.5">
          <Avatar name={nome} src={chat.foto_url ?? undefined} size="sm" pulse={fresco} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium leading-tight text-ink">{nome}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{tempoRelativo(chat.last_message_at)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate font-mono text-[11px] tracking-tight text-ink-faint">{tel}</span>
              {mostrarVendedor && chat.vendedor && (
                <span className="shrink-0 rounded px-1 text-[10px] font-medium text-accent ring-1 ring-inset ring-[hsl(var(--accent)/0.25)]">
                  {chat.vendedor}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* VALOR da negociação — a estrela: campo verde da marca, número tabular forte */}
        {temValor && (
          <div
            className={[
              compacto ? 'mt-2' : 'mt-2.5',
              'flex items-center justify-between gap-2 rounded-lg bg-accent-bg',
              'px-2.5 ring-1 ring-inset ring-[hsl(var(--success)/0.22)]',
              compacto ? 'py-1' : 'py-1.5',
            ].join(' ')}
            title="Valor do último orçamento gerado pra este telefone"
          >
            {!compacto && (
              <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--success)/0.8)]">
                <IconCifrao className="h-3 w-3 text-success" />
                Negociação
              </span>
            )}
            <span className="ml-auto flex items-baseline gap-0.5 text-success">
              <span className="text-[10px] font-semibold text-[hsl(var(--success)/0.6)]">R$</span>
              <span className="whitespace-nowrap text-[17px] font-bold tabular-nums tracking-tight">
                {brl(valorOrcamento as number).replace(/^R\$\s?/, '')}
              </span>
            </span>
          </div>
        )}

        {/* preview — escondido no modo compacto */}
        {!compacto && chat.last_message_preview && (
          <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-ink-muted">
            {chat.last_message_from_me && <span className="text-ink-faint">Você: </span>}
            {chat.last_message_preview}
          </p>
        )}

        {/* rodapé: temperatura + status + whatsapp */}
        <div className={`${compacto ? 'mt-2' : 'mt-2.5'} flex items-center gap-2`}>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-ink-faint">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.cor }} />
            {meta.label}
          </span>

          {pendente ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--warning)/0.12)] px-1.5 py-0.5 text-[10px] font-semibold text-warning ring-1 ring-inset ring-[hsl(var(--warning)/0.35)]">
              <MessageCircle className="h-3 w-3 animate-pulse" /> aguardando
            </span>
          ) : encerrou ? (
            <span className="text-[10px] text-ink-faint">encerrou</span>
          ) : chat.last_message_from_me ? (
            <span className="text-[10px] text-ink-faint">você respondeu</span>
          ) : null}

          {/* stopPropagation: clicar no WhatsApp não abre o drawer do card */}
          <span className="ml-auto" onClick={e => e.stopPropagation()}>
            <BotaoWhats phone={chat.phone} />
          </span>
        </div>
      </div>
    </div>
  )
}

function ResumoTemperatura({
  chats, filtroTemp, onToggleTemp,
}: { chats: WaChat[]; filtroTemp: Temperatura | null; onToggleTemp: (t: Temperatura) => void }) {
  const r = resumoColuna(chats)
  const itens = ([
    { cor: TEMP_META.fresco.cor, n: r.fresco, t: 'fresco', label: 'Hoje' },
    { cor: TEMP_META.recente.cor, n: r.recente, t: 'recente', label: 'Recente' },
    { cor: TEMP_META.morno.cor, n: r.morno, t: 'morno', label: 'Morno' },
    { cor: TEMP_META.parado.cor, n: r.parado, t: 'parado', label: 'Parado' },
  ] as { cor: string; n: number; t: Temperatura; label: string }[]).filter(i => i.n > 0)
  if (r.aguardando === 0 && itens.length === 0) return null
  return (
    <div className="flex items-center gap-2 px-3 pb-2 text-[11px] tabular-nums flex-wrap">
      {r.aguardando > 0 && (
        <span className="text-warning font-semibold" title="Cliente aguardando resposta">↙ {r.aguardando}</span>
      )}
      {itens.map(i => (
        <button
          key={i.t}
          onClick={() => onToggleTemp(i.t)}
          title={`${i.label} — clique pra filtrar`}
          className={
            'inline-flex items-center gap-0.5 rounded px-1 transition-colors ' +
            (filtroTemp === i.t ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:text-ink')
          }
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: i.cor }} />
          {i.n}
        </button>
      ))}
    </div>
  )
}

function ChatDrawer({
  chat, etiquetas, vendedor, onClose,
}: { chat: WaChat; etiquetas: { nome: string; cor: string }[]; vendedor: string; onClose: () => void }) {
  const { data: movimentos = [] } = useWaMovimentos(vendedor, chat.phone)
  const nome = nomeContato(chat.contact_name, chat.phone)
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-[400px] overflow-y-auto border-l border-border bg-surface p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={nome} size="md" />
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-ink truncate">{nome}</h2>
              <div className="text-[12px] font-mono text-ink-muted">{formatarTelefone(chat.phone)}</div>
              {chat.vendedor && <div className="text-[11px] text-accent font-semibold">{chat.vendedor}</div>}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-xl leading-none px-1">×</button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {etiquetas.map(e => (
            <span key={e.nome} className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: `${e.cor}22`, color: e.cor, border: `1px solid ${e.cor}55` }}>
              {e.nome}
            </span>
          ))}
          {etiquetas.length === 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-warning-bg text-warning border border-warning/30">
              SEM ETIQUETA
            </span>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">
            Última mensagem · {tempoRelativo(chat.last_message_at)}
          </div>
          {chat.last_message_preview ? (
            <p className="text-[13px] text-ink leading-snug">
              {chat.last_message_from_me ? <span className="text-accent font-medium">Você: </span> : null}
              {chat.last_message_preview}
            </p>
          ) : (
            <p className="text-[13px] text-ink-faint">Sem preview disponível.</p>
          )}
          {chat.last_message_from_me === false && (
            <p className="mt-1.5 text-[11px] text-warning">⏳ Cliente aguardando resposta</p>
          )}
        </div>

        <a href={`https://wa.me/${chat.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-bg border border-accent/30 text-accent text-[13px] font-semibold py-2 hover:brightness-110 transition">
          <MessageCircle className="h-4 w-4" /> Abrir conversa no WhatsApp
        </a>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Histórico de etiquetas</div>
          {movimentos.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Nenhuma movimentação registrada.</p>
          ) : (
            <ul className="space-y-2">
              {movimentos.map((m, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-ink-faint tabular-nums shrink-0">{tempoRelativo(m.detectado_em)}</span>
                  <span className="text-ink-muted">
                    {m.etiqueta_de ? <>{m.etiqueta_de} → </> : <>+ </>}
                    <span className="text-ink font-medium">{m.etiqueta_para ?? '(removida)'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

export function FunilWhatsApp() {
  const { profile } = useAuth()
  const { data: vendedores = [] } = useWaVendedores()
  const { data: vendorsData } = useVendors()
  const [vendedorSel, setVendedorSel] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [chatAberto, setChatAberto] = useState<WaChat | null>(null)
  const [limites, setLimites] = useState<Record<string, number>>({})
  const [seletorAberto, setSeletorAberto] = useState(false)
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('recente')
  const [soAguardando, setSoAguardando] = useState(false)
  const [filtroTemp, setFiltroTemp] = useState<Temperatura | null>(null)
  const [compacto, setCompacto] = useState(false)
  const [mostrarRanking, setMostrarRanking] = useState(false)

  const [escondidas, setEscondidas] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wa-funil-cols-hidden')
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>()
    } catch { return new Set<string>() }
  })
  const salvarEscondidas = (s: Set<string>) => {
    setEscondidas(s)
    try { localStorage.setItem('wa-funil-cols-hidden', JSON.stringify([...s])) } catch { /* ignore */ }
  }
  const toggleColuna = (nome: string) => {
    const s = new Set(escondidas)
    s.has(nome) ? s.delete(nome) : s.add(nome)
    salvarEscondidas(s)
  }

  const vendedorTravado = useMemo(() => {
    if (profile?.role !== 'vendor' || !profile?.vendor_id) return null
    const v = (vendorsData ?? []).find(v => v.id === profile.vendor_id)
    if (!v) return null
    const upper = v.name.toUpperCase().trim()
    return vendedores.find(w => w === upper)
      ?? vendedores.find(w => w.split(/\s+/)[0] === upper.split(/\s+/)[0])
      ?? null
  }, [profile, vendorsData, vendedores])

  const vendedor = vendedorTravado ?? vendedorSel ?? (vendedores.length ? TODOS : null)
  const modoTodos = vendedor === TODOS
  const { data, isLoading, error } = useWaKanban(vendedor)

  const filtro = busca.trim().toLowerCase()
  const filtroDigitos = filtro.replace(/\D/g, '')

  const colunasTodas = useMemo(() => {
    if (!data) return []
    const visiveis = data.colunas.filter(c => !c.oculta)
    const semEtiqueta = { nome: 'SEM ETIQUETA', cor: '#f59e0b', oculta: false, chats: data.semEtiqueta }
    return [semEtiqueta, ...visiveis]
  }, [data])

  const colunas = useMemo(
    () => (escondidas.size === 0 ? colunasTodas : colunasTodas.filter(c => !escondidas.has(c.nome))),
    [colunasTodas, escondidas]
  )

  // Telefones das colunas de negociação → valor do orçamento (cruzado por telefone)
  const telefonesNegociacao = useMemo(() => {
    const set = new Set<string>()
    for (const col of colunasTodas) {
      if (!COLUNAS_COM_VALOR.has(col.nome)) continue
      for (const c of col.chats) if (c.phone) set.add(c.phone)
    }
    return [...set]
  }, [colunasTodas])
  const { data: orcMap } = useOrcamentosPorTelefone(telefonesNegociacao)

  // Pipeline de exibição: busca → só-aguardando → filtro-temperatura → ordenação
  const processar = (chats: WaChat[]): WaChat[] => {
    let cs = chats
    if (filtro) {
      cs = cs.filter(c =>
        (c.contact_name ?? '').toLowerCase().includes(filtro) ||
        (filtroDigitos && c.phone.includes(filtroDigitos))
      )
    }
    if (soAguardando) cs = cs.filter(precisaResposta)
    if (filtroTemp) cs = cs.filter(c => temperaturaDe(c.last_message_at) === filtroTemp)
    return ordenarChats(cs, ordenacao)
  }

  // KPIs sobre as colunas visíveis (panorama, ignora busca/filtros temporários)
  const kpis = useMemo(() => {
    let total = 0, aguardando = 0, parado7 = 0
    for (const col of colunas) {
      for (const c of col.chats) {
        total++
        if (precisaResposta(c)) aguardando++
        if (temperaturaDe(c.last_message_at) === 'parado') parado7++
      }
    }
    return { total, aguardando, parado7 }
  }, [colunas])

  // Ranking por vendedor (modo Todos): quem tem mais cliente aguardando
  const ranking = useMemo(() => {
    if (!modoTodos) return []
    const m = new Map<string, { aguardando: number; total: number }>()
    for (const col of colunas) {
      for (const c of col.chats) {
        const v = c.vendedor ?? '—'
        const e = m.get(v) ?? { aguardando: 0, total: 0 }
        e.total++
        if (precisaResposta(c)) e.aguardando++
        m.set(v, e)
      }
    }
    return [...m.entries()].map(([v, e]) => ({ vendedor: v, ...e })).sort((a, b) => b.aguardando - a.aguardando)
  }, [colunas, modoTodos])

  const filaAtiva = soAguardando && ordenacao === 'aguardando'
  const ativarFila = () => {
    if (filaAtiva) { setSoAguardando(false); setOrdenacao('recente') }
    else { setSoAguardando(true); setOrdenacao('aguardando') }
  }

  const etiquetasDoChat = useMemo(() => {
    if (!chatAberto || !data) return []
    // Casa por chave estável (vendedor:phone), não por referência de objeto — a lista
    // é recriada no refetch de 30s, então `.includes(chatAberto)` (ref antiga) falharia
    // e o drawer mostraria "SEM ETIQUETA" errado pra um cliente etiquetado.
    return data.colunas
      .filter(c => c.chats.some(x => x.phone === chatAberto.phone && x.vendedor === chatAberto.vendedor))
      .map(c => ({ nome: c.nome, cor: c.cor }))
  }, [chatAberto, data])

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4 gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Funil · Kanban WhatsApp</h1>
          <p className="text-[13px] text-ink-muted">
            Espelho das etiquetas do WhatsApp de cada vendedor
            {data?.ultimaSync && <> · sincronizado {tempoRelativo(data.ultimaSync)}</>}
            {data && <> · {data.totalChats.toLocaleString('pt-BR')} conversas</>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <Link to="/funil/manual" className="text-ink-muted hover:text-ink underline-offset-2 hover:underline">Funil manual</Link>
          <span className="text-ink-faint">·</span>
          <Link to="/funil/relatorio" className="text-ink-muted hover:text-ink underline-offset-2 hover:underline">Relatório</Link>
        </div>
      </div>

      {/* Painel de números */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={ativarFila}
            className={
              'h-9 px-3 rounded-md text-[13px] font-semibold inline-flex items-center gap-2 border transition-colors ' +
              (filaAtiva
                ? 'bg-warning-bg text-warning border-warning/40'
                : 'bg-surface text-ink border-border hover:border-border-strong')
            }
            title="Mostra só quem está aguardando resposta, mais antigo no topo"
          >
            ⚡ Fila de resposta
            <span className="tabular-nums rounded-full bg-warning/20 text-warning px-1.5">{kpis.aguardando}</span>
          </button>
          <div className="h-9 px-3 rounded-md bg-surface border border-border inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TEMP_META.parado.cor }} />
            Parados +7d <span className="tabular-nums text-ink font-semibold">{kpis.parado7}</span>
          </div>
          <div className="h-9 px-3 rounded-md bg-surface border border-border inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            Total <span className="tabular-nums text-ink font-semibold">{kpis.total.toLocaleString('pt-BR')}</span>
          </div>
          {modoTodos && (
            <button
              onClick={() => setMostrarRanking(v => !v)}
              className="h-9 px-3 rounded-md bg-surface border border-border text-[12px] text-ink-muted hover:text-ink hover:border-border-strong"
            >
              {mostrarRanking ? 'Ocultar ranking' : 'Ranking por vendedor'}
            </button>
          )}
        </div>
      )}

      {/* Ranking por vendedor (modo Todos) */}
      {modoTodos && mostrarRanking && ranking.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-2">
          {ranking.map((r, i) => (
            <button
              key={r.vendedor}
              onClick={() => setVendedorSel(r.vendedor)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-left hover:border-border-strong"
            >
              <div className="text-[12px] font-semibold text-ink flex items-center gap-1.5">
                {i === 0 && <span>🏆</span>}{r.vendedor}
              </div>
              <div className="text-[11px] text-ink-muted tabular-nums">
                <span className="text-warning font-semibold">{r.aguardando}</span> aguardando · {r.total} total
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {vendedorTravado ? (
          <span className="h-9 px-3 rounded-md bg-accent-bg border border-accent/30 text-accent text-[13px] font-semibold inline-flex items-center">
            {vendedorTravado}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setVendedorSel(TODOS)}
              className={modoTodos
                ? 'h-9 px-3 rounded-md bg-accent-bg text-accent border border-accent/30 text-[13px] font-semibold'
                : 'h-9 px-3 rounded-md bg-surface text-ink-muted border border-border text-[13px] hover:text-ink hover:border-border-strong'}>
              Todos
            </button>
            {vendedores.map(v => (
              <button key={v} onClick={() => setVendedorSel(v)}
                className={v === vendedor
                  ? 'h-9 px-3 rounded-md bg-accent-bg text-accent border border-accent/30 text-[13px] font-semibold'
                  : 'h-9 px-3 rounded-md bg-surface text-ink-muted border border-border text-[13px] hover:text-ink hover:border-border-strong'}>
                {v}
              </button>
            ))}
          </div>
        )}

        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente ou telefone…"
          className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink focus:border-accent outline-none w-56" />

        {/* Ordenação */}
        <select value={ordenacao} onChange={e => setOrdenacao(e.target.value as Ordenacao)}
          className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink">
          {(Object.keys(ORDENACAO_LABEL) as Ordenacao[]).map(o => (
            <option key={o} value={o}>{ORDENACAO_LABEL[o]}</option>
          ))}
        </select>

        {/* Toggle só aguardando */}
        <button onClick={() => setSoAguardando(v => !v)}
          className={'h-9 px-3 rounded-md text-[13px] border ' + (soAguardando
            ? 'bg-warning-bg text-warning border-warning/40 font-semibold'
            : 'bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong')}>
          ↙ Só aguardando
        </button>

        {/* Filtro de temperatura ativo → chip pra limpar */}
        {filtroTemp && (
          <button onClick={() => setFiltroTemp(null)}
            className="h-9 px-3 rounded-md text-[13px] border inline-flex items-center gap-1.5"
            style={{ borderColor: `${TEMP_META[filtroTemp].cor}66`, color: TEMP_META[filtroTemp].cor }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TEMP_META[filtroTemp].cor }} />
            {TEMP_META[filtroTemp].label} ✕
          </button>
        )}

        {/* Compacto */}
        <button onClick={() => setCompacto(v => !v)}
          className={'h-9 px-3 rounded-md text-[13px] border ' + (compacto
            ? 'bg-accent-bg text-accent border-accent/30 font-semibold'
            : 'bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong')}>
          Compacto
        </button>

        {/* Seletor de colunas */}
        <div className="relative">
          <button onClick={() => setSeletorAberto(o => !o)}
            className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink-muted hover:text-ink hover:border-border-strong inline-flex items-center gap-1.5">
            Colunas
            {escondidas.size > 0 && (
              <span className="text-[11px] tabular-nums text-accent bg-accent-bg rounded-full px-1.5">
                {colunasTodas.length - escondidas.size}/{colunasTodas.length}
              </span>
            )}
          </button>
          {seletorAberto && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSeletorAberto(false)} />
              <div className="absolute right-0 z-40 mt-1 w-64 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface shadow-xl p-2">
                <div className="flex items-center gap-1 px-1 pb-2 border-b border-border mb-1">
                  <button onClick={() => salvarEscondidas(new Set())} className="text-[11px] text-accent hover:underline">Todas</button>
                  <span className="text-ink-faint">·</span>
                  <button onClick={() => salvarEscondidas(new Set(colunasTodas.map(c => c.nome)))} className="text-[11px] text-ink-muted hover:text-ink hover:underline">Nenhuma</button>
                  <span className="text-ink-faint">·</span>
                  <button onClick={() => salvarEscondidas(new Set(colunasTodas.filter(c => !FUNIL_ATIVO.has(c.nome)).map(c => c.nome)))}
                    className="text-[11px] text-ink-muted hover:text-ink hover:underline" title="Só Prospecção → Orçamento Enviado">Funil ativo</button>
                </div>
                {colunasTodas.map(c => {
                  const visivel = !escondidas.has(c.nome)
                  return (
                    <button key={c.nome} onClick={() => toggleColuna(c.nome)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 text-left">
                      <span className={'h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] ' +
                        (visivel ? 'bg-accent border-accent text-white' : 'border-border text-transparent')}>✓</span>
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: c.cor }} />
                      <span className="text-[12px] text-ink truncate flex-1">{c.nome}</span>
                      <span className="text-[11px] tabular-nums text-ink-faint">{c.chats.length}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Board */}
      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger-bg text-danger text-[13px] p-3">
          Erro carregando o kanban: {String((error as Error).message)}
        </div>
      ) : isLoading || !data ? (
        <PageLoading />
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-3 pb-2">
            {colunas.map(col => {
              const chats = processar(col.chats)
              const limite = limites[col.nome] ?? LIMITE_INICIAL
              const visiveis = chats.slice(0, limite)
              const mostrarValor = COLUNAS_COM_VALOR.has(col.nome)
              // dedupe por telefone canônico — o mesmo cliente pode ter card em 2 vendedores
              // (modo Todos); somar por linha contaria o orçamento em dobro.
              const vistosValor = new Set<string>()
              const totalValor = mostrarValor
                ? chats.reduce((s, c) => {
                    const k = foneCanon(c.phone)
                    if (!k || vistosValor.has(k)) return s
                    vistosValor.add(k)
                    return s + (lookupOrcamento(orcMap, c.phone)?.valor ?? 0)
                  }, 0)
                : 0
              return (
                <div key={col.nome} className="flex h-full w-[280px] shrink-0 flex-col rounded-xl border border-border bg-surface-2/50">
                  <div className="border-b border-border shrink-0">
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.cor }} />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">{col.nome}</span>
                      {mostrarValor && totalValor > 0 && (
                        <span className="flex shrink-0 items-baseline gap-0.5 text-success" title="Soma dos últimos orçamentos gerados nesta coluna">
                          <span className="text-[9px] font-semibold text-[hsl(var(--success)/0.6)]">R$</span>
                          <span className="whitespace-nowrap text-[13px] font-bold tabular-nums tracking-tight">{brl(totalValor).replace(/^R\$\s?/, '')}</span>
                        </span>
                      )}
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-muted bg-surface border border-border rounded-full px-2 py-0.5">
                        {chats.length}
                      </span>
                    </div>
                    <ResumoTemperatura
                      chats={col.chats}
                      filtroTemp={filtroTemp}
                      onToggleTemp={t => setFiltroTemp(prev => (prev === t ? null : t))}
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {visiveis.map(c => (
                      <ChatCard key={`${c.vendedor ?? ''}:${c.phone}`} chat={c} mostrarVendedor={modoTodos} compacto={compacto}
                        valorOrcamento={mostrarValor ? lookupOrcamento(orcMap, c.phone)?.valor ?? null : null}
                        onClick={() => setChatAberto(c)} />
                    ))}
                    {chats.length > limite && (
                      <button onClick={() => setLimites(l => ({ ...l, [col.nome]: limite + 50 }))}
                        className="w-full rounded-md border border-border bg-surface py-1.5 text-[12px] text-ink-muted hover:text-ink hover:border-border-strong">
                        Mostrar mais ({chats.length - limite} restantes)
                      </button>
                    )}
                    {chats.length === 0 && <p className="text-center text-[12px] text-ink-faint py-4">Vazio</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {chatAberto && vendedor && (
        <ChatDrawer
          chat={chatAberto}
          etiquetas={etiquetasDoChat}
          vendedor={chatAberto.vendedor ?? vendedor}
          onClose={() => setChatAberto(null)}
        />
      )}
    </div>
  )
}
