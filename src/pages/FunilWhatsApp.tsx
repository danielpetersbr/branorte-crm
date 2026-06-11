import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'
import { useWaKanban, useWaVendedores, useWaMovimentos, TODOS, type WaChat } from '@/hooks/useWaKanban'
import { tempoRelativo, temperaturaDe, TEMP_META, resumoColuna } from '@/lib/wa-funil'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Kanban WhatsApp — espelho fiel do quadro de etiquetas que cada vendedor
// vê no Wascript, sincronizado pela extensão Branorte WA Sync (30s).
// Colunas = etiquetas na ordem oficial do funil; cards = clientes com a
// última mensagem trocada; clique abre o painel com detalhes + histórico.

const LIMITE_INICIAL = 30

// Preset "Funil ativo": etapas de venda em andamento (esconde fechamento/sem etiqueta)
const FUNIL_ATIVO = new Set([
  'PROSPECCAO', '2A TENTATIVA', 'NOVO LEAD', 'FOLLOW UP',
  'LEAD QUENTE', 'ORCAMENTO ENVIADO', 'INTERESSE FUTURO',
])

function ChatCard({ chat, onClick, mostrarVendedor }: { chat: WaChat; onClick: () => void; mostrarVendedor?: boolean }) {
  const temp = temperaturaDe(chat.last_message_at)
  const meta = TEMP_META[temp]
  const fresco = temp === 'fresco'
  const aguardando = chat.last_message_from_me === false
  const nome = chat.contact_name || chat.phone
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border bg-surface p-2.5 hover:bg-surface-2 transition-colors"
      style={{ borderColor: aguardando ? `${meta.cor}66` : undefined, borderLeftWidth: 3, borderLeftColor: meta.cor }}
    >
      <div className="flex items-start gap-2">
        <Avatar name={nome} size="sm" pulse={fresco} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-ink truncate">{nome}</span>
            <span className="text-[10px] text-ink-faint shrink-0 tabular-nums">
              {tempoRelativo(chat.last_message_at)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-ink-faint">{chat.phone}</span>
            {mostrarVendedor && chat.vendedor && (
              <span className="text-[10px] font-semibold text-accent bg-accent-bg rounded px-1">{chat.vendedor}</span>
            )}
          </div>
          {chat.last_message_preview && (
            <p className="mt-1 text-[12px] text-ink-muted leading-snug line-clamp-2">
              {chat.last_message_from_me ? (
                <span className="text-accent">Você: </span>
              ) : null}
              {chat.last_message_preview}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${meta.cor}22`, color: meta.cor }}
            >
              {meta.label}
            </span>
            {aguardando ? (
              <span className="text-[10px] font-semibold text-warning">↙ aguardando</span>
            ) : chat.last_message_from_me ? (
              <span className="text-[10px] text-ink-faint">↗ você</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  )
}

function ResumoTemperatura({ chats }: { chats: WaChat[] }) {
  const r = resumoColuna(chats)
  const itens: { cor: string; n: number; t: string }[] = [
    { cor: TEMP_META.fresco.cor, n: r.fresco, t: 'Hoje' },
    { cor: TEMP_META.recente.cor, n: r.recente, t: 'Recente' },
    { cor: TEMP_META.morno.cor, n: r.morno, t: 'Morno' },
    { cor: TEMP_META.parado.cor, n: r.parado, t: 'Parado' },
  ].filter(i => i.n > 0)
  if (r.aguardando === 0 && itens.length === 0) return null
  return (
    <div className="flex items-center gap-2 px-3 pb-2 text-[11px] tabular-nums flex-wrap">
      {r.aguardando > 0 && (
        <span className="text-warning font-semibold" title="Cliente aguardando resposta">
          ↙ {r.aguardando}
        </span>
      )}
      {itens.map(i => (
        <span key={i.t} className="inline-flex items-center gap-0.5 text-ink-muted" title={i.t}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: i.cor }} />
          {i.n}
        </span>
      ))}
    </div>
  )
}

function ChatDrawer({
  chat,
  etiquetas,
  vendedor,
  onClose,
}: {
  chat: WaChat
  etiquetas: { nome: string; cor: string }[]
  vendedor: string
  onClose: () => void
}) {
  const { data: movimentos = [] } = useWaMovimentos(vendedor, chat.phone)
  const nome = chat.contact_name || chat.phone
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-[400px] overflow-y-auto border-l border-border bg-surface p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={nome} size="md" />
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-ink truncate">{nome}</h2>
              <div className="text-[12px] font-mono text-ink-muted">{chat.phone}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-xl leading-none px-1">×</button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {etiquetas.map(e => (
            <span
              key={e.nome}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: `${e.cor}22`, color: e.cor, border: `1px solid ${e.cor}55` }}
            >
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

        <a
          href={`https://wa.me/${chat.phone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-md bg-accent-bg border border-accent/30 text-accent text-center text-[13px] font-semibold py-2 hover:brightness-110 transition"
        >
          Abrir conversa no WhatsApp ↗
        </a>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">
            Histórico de etiquetas
          </div>
          {movimentos.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Nenhuma movimentação registrada.</p>
          ) : (
            <ul className="space-y-2">
              {movimentos.map((m, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-ink-faint tabular-nums shrink-0">
                    {tempoRelativo(m.detectado_em)}
                  </span>
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
  // colunas escondidas (persistido); vazio = todas visíveis
  const [escondidas, setEscondidas] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wa-funil-cols-hidden')
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })
  const salvarEscondidas = (s: Set<string>) => {
    setEscondidas(s)
    try {
      localStorage.setItem('wa-funil-cols-hidden', JSON.stringify([...s]))
    } catch {
      /* ignore */
    }
  }
  const toggleColuna = (nome: string) => {
    const s = new Set(escondidas)
    s.has(nome) ? s.delete(nome) : s.add(nome)
    salvarEscondidas(s)
  }

  // Vendedor logado vê só o próprio quadro (match por nome em uppercase)
  const vendedorTravado = useMemo(() => {
    if (profile?.role !== 'vendor' || !profile?.vendor_id) return null
    const v = (vendorsData ?? []).find(v => v.id === profile.vendor_id)
    if (!v) return null
    const upper = v.name.toUpperCase().trim()
    return (
      vendedores.find(w => w === upper) ??
      vendedores.find(w => w.split(/\s+/)[0] === upper.split(/\s+/)[0]) ??
      null
    )
  }, [profile, vendorsData, vendedores])

  const vendedor = vendedorTravado ?? vendedorSel ?? (vendedores.length ? TODOS : null)
  const modoTodos = vendedor === TODOS
  const { data, isLoading, error } = useWaKanban(vendedor)

  const filtro = busca.trim().toLowerCase()
  const aplicaFiltro = (chats: WaChat[]) =>
    !filtro
      ? chats
      : chats.filter(
          c =>
            (c.contact_name ?? '').toLowerCase().includes(filtro) ||
            c.phone.includes(filtro.replace(/\D/g, '') || ' ')
        )

  // Todas as colunas disponíveis (SEM ETIQUETA + etiquetas não-internas)
  const colunasTodas = useMemo(() => {
    if (!data) return []
    const visiveis = data.colunas.filter(c => !c.oculta)
    const semEtiqueta = { nome: 'SEM ETIQUETA', cor: '#f59e0b', oculta: false, chats: data.semEtiqueta }
    return [semEtiqueta, ...visiveis]
  }, [data])

  // Colunas escolhidas pelo usuário (persistido). Vazio = mostrar todas.
  const colunas = useMemo(
    () => (escondidas.size === 0 ? colunasTodas : colunasTodas.filter(c => !escondidas.has(c.nome))),
    [colunasTodas, escondidas]
  )

  const etiquetasDoChat = useMemo(() => {
    if (!chatAberto || !data) return []
    return data.colunas
      .filter(c => c.chats.includes(chatAberto))
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

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {vendedorTravado ? (
          <span className="h-9 px-3 rounded-md bg-accent-bg border border-accent/30 text-accent text-[13px] font-semibold inline-flex items-center">
            {vendedorTravado}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setVendedorSel(TODOS)}
              className={
                modoTodos
                  ? 'h-9 px-3 rounded-md bg-accent-bg text-accent border border-accent/30 text-[13px] font-semibold'
                  : 'h-9 px-3 rounded-md bg-surface text-ink-muted border border-border text-[13px] hover:text-ink hover:border-border-strong'
              }
            >
              Todos
            </button>
            {vendedores.map(v => (
              <button
                key={v}
                onClick={() => setVendedorSel(v)}
                className={
                  v === vendedor
                    ? 'h-9 px-3 rounded-md bg-accent-bg text-accent border border-accent/30 text-[13px] font-semibold'
                    : 'h-9 px-3 rounded-md bg-surface text-ink-muted border border-border text-[13px] hover:text-ink hover:border-border-strong'
                }
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar cliente ou telefone…"
          className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink focus:border-accent outline-none w-64"
        />

        {/* Seletor de colunas */}
        <div className="relative">
          <button
            onClick={() => setSeletorAberto(o => !o)}
            className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink-muted hover:text-ink hover:border-border-strong inline-flex items-center gap-1.5"
          >
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
                  <button
                    onClick={() => salvarEscondidas(new Set())}
                    className="text-[11px] text-accent hover:underline"
                  >
                    Todas
                  </button>
                  <span className="text-ink-faint">·</span>
                  <button
                    onClick={() => salvarEscondidas(new Set(colunasTodas.map(c => c.nome)))}
                    className="text-[11px] text-ink-muted hover:text-ink hover:underline"
                  >
                    Nenhuma
                  </button>
                  <span className="text-ink-faint">·</span>
                  <button
                    onClick={() =>
                      salvarEscondidas(new Set(colunasTodas.filter(c => !FUNIL_ATIVO.has(c.nome)).map(c => c.nome)))
                    }
                    className="text-[11px] text-ink-muted hover:text-ink hover:underline"
                    title="Só Prospecção → Orçamento Enviado"
                  >
                    Funil ativo
                  </button>
                </div>
                {colunasTodas.map(c => {
                  const visivel = !escondidas.has(c.nome)
                  return (
                    <button
                      key={c.nome}
                      onClick={() => toggleColuna(c.nome)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 text-left"
                    >
                      <span
                        className={
                          'h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] ' +
                          (visivel ? 'bg-accent border-accent text-white' : 'border-border text-transparent')
                        }
                      >
                        ✓
                      </span>
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
              const chats = aplicaFiltro(col.chats)
              const limite = limites[col.nome] ?? LIMITE_INICIAL
              const visiveis = chats.slice(0, limite)
              return (
                <div key={col.nome} className="flex h-full w-[280px] shrink-0 flex-col rounded-xl border border-border bg-surface-2/50">
                  <div className="border-b border-border shrink-0">
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.cor }} />
                      <span className="text-[12px] font-bold tracking-wide text-ink truncate">{col.nome}</span>
                      <span className="ml-auto text-[11px] tabular-nums text-ink-muted bg-surface border border-border rounded-full px-2 py-0.5">
                        {chats.length}
                      </span>
                    </div>
                    <ResumoTemperatura chats={chats} />
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {visiveis.map(c => (
                      <ChatCard key={`${c.vendedor ?? ''}:${c.phone}`} chat={c} mostrarVendedor={modoTodos} onClick={() => setChatAberto(c)} />
                    ))}
                    {chats.length > limite && (
                      <button
                        onClick={() => setLimites(l => ({ ...l, [col.nome]: limite + 50 }))}
                        className="w-full rounded-md border border-border bg-surface py-1.5 text-[12px] text-ink-muted hover:text-ink hover:border-border-strong"
                      >
                        Mostrar mais ({chats.length - limite} restantes)
                      </button>
                    )}
                    {chats.length === 0 && (
                      <p className="text-center text-[12px] text-ink-faint py-4">Vazio</p>
                    )}
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
