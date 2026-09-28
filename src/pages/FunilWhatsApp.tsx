import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Copy, Check, Clock, Mic, Image as ImageIcon, Video, FileText, Sticker,
  MapPin, Contact2, Ban, PhoneCall,
  Search, SlidersHorizontal, Columns3, BarChart3, ListFilter, Users,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'
import {
  useWaKanban, useWaVendedores, useWaMovimentos, useWaMensagens, useWaAgendadas,
  lookupAgendada, TODOS, MSGS_PAGINA_INICIAL, MSGS_PAGINA_INCREMENTO,
  type WaChat, type WaMensagem, type WaAgendada,
} from '@/hooks/useWaKanban'
import { useOrcamentosPorTelefone, lookupOrcamento, foneCanon } from '@/hooks/useAtendimentos'
import {
  tempoRelativo, temperaturaDe, TEMP_META, resumoColuna, corDaEtiqueta,
  formatarTelefone, nomeContato, ordenarChats, ORDENACAO_LABEL,
  corpoVisivel, idCanonicoMsg, digitosDaBusca, FUNIL_ATIVO, canonico,
  type Temperatura,
} from '@/lib/wa-funil'
import { estiloEtiqueta } from '@/hooks/useCrmEtiquetas'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import './FunilWhatsApp.css'

// vendedor_nome do chip da IA em wascript_etiquetas — todo vendedor enxerga esse quadro.
const VENDEDOR_ANA = 'ANA'

// Kanban WhatsApp — espelho fiel do quadro de etiquetas que cada vendedor
// vê no Wascript, sincronizado pela extensão Branorte WA Sync (30s).
// Colunas = etiquetas na ordem oficial do funil; cards = clientes com a
// última mensagem; painel lateral com detalhes + histórico.

const LIMITE_INICIAL = 30

// Colunas de negociação: mostram o valor do orçamento no card + total no topo
// (cruzado por telefone via orcamentos_gerados / RPC orcamentos_por_telefone_canon).
// ORÇAMENTO ENVIADO é a etapa mais perto do fechamento — é onde o dono MAIS quer ver R$.
const COLUNAS_COM_VALOR = new Set(['FOLLOW UP', 'LEAD QUENTE', 'ORCAMENTO ENVIADO'])

// Colunas cujo histórico de conversa (últimas 10 msgs) é sincronizado pela
// extensão e aparece no drawer. Estendido aos 5 estágios do funil (a LEITURA no
// CRM já é agnóstica ao estágio — filtra só por vendedor+chat_id; a captura na
// extensão é que define quais chats têm msgs sincronizadas).
const COLUNAS_COM_CONVERSA = new Set(['PROSPECCAO', '2A TENTATIVA', 'NOVO LEAD', 'FOLLOW UP', 'LEAD QUENTE'])

const NOMES_ETAPAS: Record<string, string> = {
  PROSPECCAO: 'Prospecção', '2A TENTATIVA': '2ª tentativa', '3A TENTATIVA': '3ª tentativa', '4A TENTATIVA': '4ª tentativa',
  'NOVO LEAD': 'Novo lead', 'FOLLOW UP': 'Follow-up', 'LEAD QUENTE': 'Lead quente',
  'ORCAMENTO ENVIADO': 'Orçamento enviado', 'INTERESSE FUTURO': 'Interesse futuro',
  'SEM ETIQUETA': 'Sem etiqueta',
}
const nomeEtapa = (nome: string) => NOMES_ETAPAS[nome] ?? nome.charAt(0) + nome.slice(1).toLocaleLowerCase('pt-BR')
const nomeVendedor = (nome: string) => nome.toLocaleLowerCase('pt-BR').replace(/(^|\s)\S/g, letra => letra.toLocaleUpperCase('pt-BR'))

const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

// dias inteiros desde uma data ISO (pra "parado há Nd" no card)
const diasDesde = (iso: string | null): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

const fmtDataHora = (s: string | null) => {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const fmtDuracao = (seg: number | null) => {
  if (!seg || seg <= 0) return ''
  const m = Math.floor(seg / 60), s = seg % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function BotaoCopiarNumero({ phone, completo = false }: { phone: string; completo?: boolean }) {
  const [copiado, setCopiado] = useState(false)
  const numero = phone.replace(/\D/g, '')
  useEffect(() => {
    if (!copiado) return
    const timer = window.setTimeout(() => setCopiado(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copiado])

  return (
    <button
      type="button"
      disabled={!numero}
      onClick={async e => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(numero)
          setCopiado(true)
          toast.success('Número copiado')
        } catch {
          toast.error('Não foi possível copiar. Selecione o número e copie manualmente.')
        }
      }}
      title={copiado ? 'Número copiado' : 'Copiar número'}
      aria-label={copiado ? 'Número copiado' : 'Copiar número'}
      className={completo
        ? 'flex w-full items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent-bg py-2.5 text-[13px] font-semibold text-accent transition hover:brightness-110'
        : 'funil-copy-phone'}
    >
      {copiado ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {completo && <span>{copiado ? 'Número copiado' : 'Copiar número'}</span>}
    </button>
  )
}

function ChatCard({
  chat, onClick, mostrarVendedor, compacto, valorOrcamento, agendada,
}: { chat: WaChat; onClick: () => void; mostrarVendedor?: boolean; compacto?: boolean; valorOrcamento?: number | null; agendada?: WaAgendada | null }) {
  const temp = temperaturaDe(chat.last_message_at)
  const meta = TEMP_META[temp]
  const parado = temp === 'parado'
  const dias = diasDesde(chat.last_message_at)
  const nome = nomeContato(chat.contact_name, chat.phone)
  const tel = formatarTelefone(chat.phone)
  const temValor = valorOrcamento != null && valorOrcamento > 0

  const preview = corpoVisivel(chat.last_message_preview)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      }}
      className={`funil-card ${compacto ? 'funil-card--compact' : ''}`}
    >
      <div className="funil-card-identity">
        <Avatar name={nome} src={chat.foto_url ?? undefined} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="funil-card-name" title={nome}>{nome}</div>
          <div className="funil-card-phone">{tel}</div>
        </div>
        <BotaoCopiarNumero phone={chat.phone} />
      </div>

      {temValor && (
        <div className="funil-card-value" title="Valor bruto do último orçamento gerado para este telefone, antes dos descontos">
          <span>Orçamento</span><strong>{brl(valorOrcamento as number)}</strong>
        </div>
      )}
      {!compacto && preview && (
        <p className="funil-card-preview">
          {chat.last_message_from_me && <span>Você: </span>}{preview}
        </p>
      )}

      <div className="funil-card-meta">
        {mostrarVendedor && chat.vendedor && <span className="funil-card-owner">{nomeVendedor(chat.vendedor)}</span>}
        <span className={parado ? 'funil-card-age funil-card-age--stale' : 'funil-card-age'} title={meta.label}>
          <Clock size={12} aria-hidden />{parado && dias != null ? `Parado há ${dias}d` : tempoRelativo(chat.last_message_at)}
        </span>
      </div>
      {agendada && (
        <div className="funil-scheduled" title={`Mensagem agendada para ${fmtDataHora(agendada.scheduled_at)}${agendada.body ? `: ${agendada.body.slice(0, 180)}` : ''}`}>
          <Clock size={13} aria-hidden />Agendado para {fmtDataHora(agendada.scheduled_at)}
        </div>
      )}
    </div>
  )
}

function ResumoTemperatura({
  chats, filtroTemp, onToggleTemp,
}: { chats: WaChat[]; filtroTemp: Temperatura | null; onToggleTemp: (t: Temperatura) => void }) {
  const r = resumoColuna(chats)
  const itens: { n: number; t: Temperatura; label: string; title: string }[] = [
    { n: r.fresco, t: 'fresco', label: 'Hoje', title: 'Hoje' },
    { n: r.recente, t: 'recente', label: '1–3d', title: 'Recentes, de 1 a 3 dias' },
    { n: r.morno, t: 'morno', label: '3–7d', title: 'De 3 a 7 dias' },
    { n: r.parado, t: 'parado', label: '+7d', title: 'Parados há mais de 7 dias' },
  ]
  return (
    <div className="funil-temperature" aria-label="Filtrar por tempo desde a última mensagem">
      {itens.map(i => (
        <button key={i.t} onClick={() => onToggleTemp(i.t)} aria-pressed={filtroTemp === i.t}
          disabled={i.n === 0 && filtroTemp !== i.t} title={`${i.title}: ${i.n} conversas`}
          aria-label={`${i.title}: ${i.n} conversas`}
          className={`funil-temperature-item funil-temperature-item--${i.t}`}>
          <span>{i.label}</span><strong>{i.n}</strong>
        </button>
      ))}
    </div>
  )
}

// Ícone + rótulo por tipo de mensagem (null = texto comum, sem cabeçalho)
function metaTipoMsg(tipo: string): { Icon: typeof Mic; label: string } | null {
  switch (tipo) {
    case 'ptt':
    case 'audio': return { Icon: Mic, label: 'Áudio' }
    case 'image': return { Icon: ImageIcon, label: 'Foto' }
    case 'video': return { Icon: Video, label: 'Vídeo' }
    case 'document': return { Icon: FileText, label: 'Documento' }
    case 'sticker': return { Icon: Sticker, label: 'Figurinha' }
    case 'location': return { Icon: MapPin, label: 'Localização' }
    case 'vcard':
    case 'multi_vcard': return { Icon: Contact2, label: 'Contato' }
    case 'call_log': return { Icon: PhoneCall, label: 'Chamada' }
    default: return null
  }
}

// Lightbox: imagem em tela cheia sobre um backdrop escuro (fecha no clique/Esc)
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const focoAnterior = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return (
    <Dialog.Root open onOpenChange={aberto => { if (!aberto) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 outline-none"
          onClick={e => { if (e.target === e.currentTarget) onClose() }}
          onCloseAutoFocus={e => {
            e.preventDefault()
            if (focoAnterior.current?.isConnected) focoAnterior.current.focus()
          }}
        >
      <Dialog.Title className="sr-only">Imagem da conversa</Dialog.Title>
      <img src={src} alt="Imagem da conversa" className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
      <button
        onClick={onClose}
        aria-label="Fechar imagem"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white text-xl leading-none hover:bg-white/20"
      >×</button>
      <a
        href={src} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/20"
      >Abrir original ↗</a>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// mídia (áudio/foto) sem binário há mais de ~10 dias provavelmente expirou no aparelho
// (a extensão ainda tenta baixar até ~10-14d; antes disso é só "sincronizando", não expirado).
function midiaExpirada(m: WaMensagem): boolean {
  if (m.media_url) return false
  if (!m.data_msg) return false
  return Date.now() - new Date(m.data_msg).getTime() > 10 * 86_400_000
}

function BolhaMensagem({ m }: { m: WaMensagem }) {
  const [zoom, setZoom] = useState(false)
  // mídia sem legenda traz o thumbnail base64 no body — não é texto pra ler
  const texto = corpoVisivel(m.body)
  const meta = metaTipoMsg(m.tipo)
  const fromMe = m.from_me === true
  const autoriaIndef = m.from_me == null // null/undefined = extensão não determinou quem falou
  const ehAudio = m.tipo === 'ptt' || m.tipo === 'audio'
  const ehImagem = m.tipo === 'image'
  const temFoto = ehImagem && m.media_url && m.media_url !== 'unavailable'
  const expirou = midiaExpirada(m)
  const align = autoriaIndef ? 'justify-center' : fromMe ? 'justify-end' : 'justify-start'
  return (
    <div className={`flex ${align}`}>
      <div
        className={[
          'max-w-[86%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug',
          autoriaIndef
            ? 'rounded-md bg-surface-2/60 text-ink-muted ring-1 ring-inset ring-border/60'
            : fromMe
              ? 'rounded-br-md bg-[hsl(var(--accent)/0.13)] text-ink ring-1 ring-inset ring-[hsl(var(--accent)/0.2)]'
              : 'rounded-bl-md bg-surface-2 text-ink ring-1 ring-inset ring-border',
        ].join(' ')}
      >
        {/* cabeçalho de tipo — some pra imagem com preview (o próprio thumb já diz que é foto) */}
        {meta && !temFoto && (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
            <meta.Icon className="h-3.5 w-3.5" />
            {meta.label}
            {ehAudio && m.duracao_seg ? <span className="tabular-nums">· {fmtDuracao(m.duracao_seg)}</span> : null}
          </div>
        )}

        {ehAudio && (
          m.media_url === 'unavailable' || expirou ? (
            <div className="mt-0.5 text-[11px] italic text-ink-faint">áudio indisponível (expirou no aparelho)</div>
          ) : m.media_url ? (
            <audio controls preload="none" src={m.media_url} className="mt-1.5 h-9 w-[240px] max-w-full" />
          ) : (
            <div className="mt-0.5 text-[11px] italic text-ink-faint">áudio sincronizando…</div>
          )
        )}

        {ehImagem && (
          temFoto ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="mt-0.5 block overflow-hidden rounded-lg ring-1 ring-inset ring-black/10 transition hover:brightness-95"
              title="Clique pra ampliar"
            >
              <img
                src={m.media_url as string}
                alt={texto || 'Foto'}
                loading="lazy"
                className="max-h-52 w-auto max-w-full cursor-zoom-in object-cover"
              />
            </button>
          ) : m.media_url === 'unavailable' || expirou ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] italic text-ink-faint">
              <ImageIcon className="h-3.5 w-3.5" /> foto indisponível (expirou no aparelho)
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] italic text-ink-faint">
              <ImageIcon className="h-3.5 w-3.5 animate-pulse" /> foto sincronizando…
            </div>
          )
        )}

        {m.tipo === 'revoked' ? (
          <div className="flex items-center gap-1 italic text-ink-faint"><Ban className="h-3 w-3" /> Mensagem apagada</div>
        ) : texto ? (
          <p className={`${(meta && !temFoto) || temFoto ? 'mt-1.5 ' : ''}whitespace-pre-wrap break-words`}>{texto}</p>
        ) : (!meta && !ehAudio && !ehImagem) ? (
          <p className="italic text-ink-faint">({m.tipo})</p>
        ) : null}

        <div className={`mt-1 text-right text-[10px] tabular-nums ${fromMe ? 'text-[hsl(var(--accent)/0.8)]' : 'text-ink-faint'}`}>
          {fromMe && <span className="mr-1 font-medium not-italic">Você</span>}
          {autoriaIndef && <span className="mr-1 not-italic" title="Autoria não identificada">autoria?</span>}
          {fmtDataHora(m.data_msg)}
        </div>
      </div>
      {zoom && temFoto && <Lightbox src={m.media_url as string} onClose={() => setZoom(false)} />}
    </div>
  )
}

function ChatDrawer({
  chat, etiquetas, vendedor, onClose, agendada,
}: { chat: WaChat; etiquetas: { nome: string; cor: string }[]; vendedor: string; onClose: () => void; agendada?: WaAgendada | null }) {
  // Coluna de captura ativa = estágio em que a extensão sincroniza a conversa.
  // A LEITURA é habilitada sempre que há chat_id: o histórico já gravado continua
  // visível mesmo se o lead avançou pra VENDIDO — esconder isso é perda aparente de dado.
  const colunaAtiva = etiquetas.some(e => COLUNAS_COM_CONVERSA.has(e.nome))
  const { data: movimentos = [] } = useWaMovimentos(vendedor, chat.phone)
  const [limiteMsgs, setLimiteMsgs] = useState(MSGS_PAGINA_INICIAL)
  const {
    data: conversa, isLoading: carregandoMsgs, isFetching: buscandoMsgs,
    isError: erroMsgs, error: erroMsgsDetalhe, refetch: recarregarMsgs,
  } = useWaMensagens(vendedor, chat.chat_id, !!chat.chat_id, limiteMsgs)
  const mensagens = conversa?.mensagens
  const temMsgs = !!mensagens && mensagens.length > 0
  const temMaisAntigas = !!conversa?.temMais
  // sem chat_id não há como localizar a conversa — é um estado distinto de "não sincronizada"
  const semChatId = !chat.chat_id
  const nome = nomeContato(chat.contact_name, chat.phone)
  const [fotoAberta, setFotoAberta] = useState(false)
  const focoAnterior = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const botaoFechar = useRef<HTMLButtonElement>(null)
  return (
    <Dialog.Root open onOpenChange={aberto => { if (!aberto) onClose() }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
      <Dialog.Content
        aria-describedby={undefined}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[460px] flex-col border-l border-border bg-surface outline-none"
        onOpenAutoFocus={e => { e.preventDefault(); botaoFechar.current?.focus() }}
        onCloseAutoFocus={e => {
          e.preventDefault()
          if (focoAnterior.current?.isConnected) focoAnterior.current.focus()
        }}
      >
      {fotoAberta && chat.foto_url && <Lightbox src={chat.foto_url} onClose={() => setFotoAberta(false)} />}
        {/* Cabeçalho fixo */}
        <div className="shrink-0 border-b border-border bg-gradient-to-b from-surface-2/80 to-surface px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {chat.foto_url ? (
                <button onClick={() => setFotoAberta(true)} title="Ver foto" className="rounded-full transition hover:ring-2 hover:ring-accent/40">
                  <Avatar name={nome} src={chat.foto_url} size="xl" />
                </button>
              ) : (
                <Avatar name={nome} src={undefined} size="xl" />
              )}
              <div className="min-w-0">
                <Dialog.Title className="truncate text-[16px] font-semibold text-ink">{nome}</Dialog.Title>
                <div className="font-mono text-[12px] text-ink-muted">{formatarTelefone(chat.phone)}</div>
                {chat.vendedor && <div className="text-[11px] font-semibold text-accent">{chat.vendedor}</div>}
              </div>
            </div>
            <button ref={botaoFechar} onClick={onClose} aria-label="Fechar conversa" className="px-1 text-xl leading-none text-ink-muted hover:text-ink">×</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {etiquetas.map(e => (
              /* `.etq-soft` no lugar do hex cru: o mesmo par claro/escuro que a
                 /contatos usa. Pintar `color: e.cor` direto deixava TODAS as 24
                 etiquetas abaixo de 4,5:1 no tema escuro (a pior, 1,99:1). */
              <span key={e.nome} className="etq-soft rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={estiloEtiqueta(e.cor)}>
                {e.nome}
              </span>
            ))}
            {etiquetas.length === 0 && (
              <span className="rounded-full border border-warning/30 bg-warning-bg px-2.5 py-0.5 text-[11px] font-semibold text-warning">
                SEM ETIQUETA
              </span>
            )}
          </div>
        </div>

        {/* Corpo rolável */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* Mensagem agendada pendente (construtor da extensão) */}
          {agendada && (
            <div className="rounded-xl border border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.07)] p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                <Clock className="h-3.5 w-3.5" /> Mensagem agendada · {fmtDataHora(agendada.scheduled_at)}
              </div>
              {agendada.body ? (
                <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug text-ink">{agendada.body.slice(0, 500)}</p>
              ) : (
                <p className="text-[12px] italic text-ink-faint">{agendada.media_type ? `Mídia (${agendada.media_type})` : 'Sem texto'}</p>
              )}
            </div>
          )}

          {/* Conversa — histórico já gravado (não depende do WhatsApp Web estar aberto agora).
              Estados distintos e honestos: erro ≠ vazio ≠ carregando ≠ nunca sincronizada. */}
          {erroMsgs ? (
            <div className="rounded-xl border border-danger/40 bg-danger-bg p-4 text-center">
              <p className="text-[12px] font-medium text-danger">Não foi possível carregar a conversa.</p>
              <p className="mt-1 break-words text-[11px] text-ink-faint">
                {(erroMsgsDetalhe as Error | null)?.message || 'Falha ao consultar o histórico.'}
              </p>
              <button
                onClick={() => { void recarregarMsgs() }}
                disabled={buscandoMsgs}
                className="mt-2.5 rounded-lg border border-border px-3 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {buscandoMsgs ? 'Tentando…' : 'Tentar novamente'}
              </button>
            </div>
          ) : temMsgs ? (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                  Conversa · {mensagens!.length} mensagens{temMaisAntigas ? ' (mais recentes)' : ''}
                </div>
                {chat.last_message_at && <div className="text-[10px] tabular-nums text-ink-faint">{tempoRelativo(chat.last_message_at)}</div>}
              </div>
              {!colunaAtiva && (
                <p className="mb-2 text-[10.5px] text-ink-faint">Estágio sem captura ativa — o histórico pode estar desatualizado.</p>
              )}
              {temMaisAntigas && (
                <button
                  onClick={() => setLimiteMsgs(l => l + MSGS_PAGINA_INCREMENTO)}
                  disabled={buscandoMsgs}
                  className="mb-2 w-full rounded-lg border border-border py-1.5 text-[11px] font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                >
                  {buscandoMsgs ? 'Carregando…' : 'Carregar mensagens anteriores'}
                </button>
              )}
              <div className="space-y-2.5 rounded-xl border border-border bg-gradient-to-b from-surface-2/50 to-surface-2/15 p-3 shadow-inner">
                {mensagens!.map(m => <BolhaMensagem key={idCanonicoMsg(m.msg_id)} m={m} />)}
              </div>
            </div>
          ) : carregandoMsgs ? (
            <p className="py-3 text-center text-[12px] text-ink-faint">Carregando conversa…</p>
          ) : semChatId ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center">
              <p className="text-[12px] text-ink-muted">Contato sem conversa vinculada.</p>
              <p className="mt-1 text-[11px] text-ink-faint">Este card não tem chat do WhatsApp associado, então não há histórico pra buscar.</p>
            </div>
          ) : colunaAtiva ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center">
              <p className="text-[12px] text-ink-muted">Nenhuma mensagem sincronizada ainda.</p>
              <p className="mt-1 text-[11px] text-ink-faint">
                A captura roda no WhatsApp Web do vendedor. Assim que ele abrir o WhatsApp, o histórico
                aparece aqui — e depois disso fica salvo, mesmo com o WhatsApp fechado.
              </p>
              <button
                onClick={() => { void recarregarMsgs() }}
                disabled={buscandoMsgs}
                className="mt-2.5 rounded-lg border border-border px-3 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {buscandoMsgs ? 'Verificando…' : 'Verificar agora'}
              </button>
            </div>
          ) : (
            /* Sem histórico capturado ainda: só o preview da última mensagem */
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
                Última mensagem · {tempoRelativo(chat.last_message_at)}
              </div>
              {corpoVisivel(chat.last_message_preview) ? (
                <p className="text-[13px] leading-snug text-ink">
                  {chat.last_message_from_me ? <span className="font-medium text-accent">Você: </span> : null}
                  {corpoVisivel(chat.last_message_preview)}
                </p>
              ) : (
                <p className="text-[13px] text-ink-faint">Sem preview disponível.</p>
              )}
              <p className="mt-2 text-[10.5px] text-ink-faint">A conversa completa aparece quando o vendedor estiver com o WhatsApp Web aberto.</p>
            </div>
          )}


          {/* Histórico de etiquetas */}
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">Histórico de etiquetas</div>
            {movimentos.length === 0 ? (
              <p className="text-[12px] text-ink-faint">Nenhuma movimentação registrada.</p>
            ) : (
              <ul className="space-y-0">
                {movimentos.map((m, i) => (
                  <li key={i} className="relative flex items-baseline gap-2.5 pb-2.5 pl-4 text-[12px]">
                    <span aria-hidden className="absolute left-0 top-[5px] h-2 w-2 rounded-full bg-[hsl(var(--accent)/0.6)]" />
                    {i < movimentos.length - 1 && (
                      <span aria-hidden className="absolute bottom-0 left-[3.5px] top-[13px] w-px bg-border" />
                    )}
                    <span className="shrink-0 tabular-nums text-ink-faint">{tempoRelativo(m.detectado_em)}</span>
                    <span className="text-ink-muted">
                      {m.etiqueta_de ? <>{m.etiqueta_de} → </> : <>+ </>}
                      <span className="font-medium text-ink">{m.etiqueta_para ?? '(removida)'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Rodapé fixo: ação principal */}
        <div className="shrink-0 border-t border-border p-4">
          <BotaoCopiarNumero phone={chat.phone} completo />
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function FunilWhatsApp() {
  const { profile } = useAuth()
  const { data: vendedores = [], isLoading: carregandoVendedores, error: erroVendedores } = useWaVendedores()
  const { data: vendorsData, isLoading: carregandoCadastro, error: erroCadastro } = useVendors()
  const [vendedorSel, setVendedorSel] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [chatSelecionado, setChatSelecionado] = useState<Pick<WaChat, 'phone' | 'vendedor'> | null>(null)
  const [limites, setLimites] = useState<Record<string, number>>({})
  const [seletorAberto, setSeletorAberto] = useState(false)
  const [ordenacao, setOrdenacao] = useState<'recente' | 'parado'>('recente')
  const [filtroTemp, setFiltroTemp] = useState<Temperatura | null>(null)
  const [compacto, setCompacto] = useState(false)

  const [escondidas, setEscondidas] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wa-funil-cols-hidden')
      return raw ? new Set<string>((JSON.parse(raw) as string[]).map(canonico)) : new Set<string>()
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

  // O vendedor vê o PRÓPRIO quadro e o da ANA (o chip da IA que recebe o lead do
  // anúncio antes de passar pra ele) — nunca o de um colega nem o da equipe toda.
  // Sem vínculo resolvido, não mostra nenhum: nem o da Ana cai de fallback.
  const quadrosDoVendedor = useMemo(() => {
    if (!vendedorTravado) return []
    const ana = vendedores.find(w => w === VENDEDOR_ANA)
    return ana && ana !== vendedorTravado ? [vendedorTravado, ana] : [vendedorTravado]
  }, [vendedorTravado, vendedores])

  // Um perfil de vendedor sem vínculo resolvido não pode cair no quadro da equipe.
  const vendedor = profile?.role === 'vendor'
    ? (vendedorSel && quadrosDoVendedor.includes(vendedorSel) ? vendedorSel : vendedorTravado)
    : vendedorSel ?? (vendedores.length ? TODOS : null)
  const modoTodos = vendedor === TODOS
  const { data, isLoading, error } = useWaKanban(vendedor)
  const { data: agendadasMap } = useWaAgendadas(vendedor)

  useEffect(() => { setChatSelecionado(null) }, [vendedor])
  // Guardar só a identidade mantém a conversa aberta ligada ao refetch atual,
  // inclusive quando a sincronização preenche chat_id ou muda a última mensagem.
  const chatAberto = useMemo(() => {
    if (!chatSelecionado || !data) return null
    const corresponde = (chat: WaChat) => chat.phone === chatSelecionado.phone && chat.vendedor === chatSelecionado.vendedor
    return data.semEtiqueta.find(corresponde)
      ?? data.colunas.flatMap(c => c.chats).find(corresponde)
      ?? null
  }, [chatSelecionado, data])

  const filtro = busca.trim().toLowerCase()
  const filtroDigitos = digitosDaBusca(filtro)

  const colunasTodas = useMemo(() => {
    if (!data) return []
    const visiveis = data.colunas.filter(c => !c.oculta)
    const semEtiqueta = { nome: 'SEM ETIQUETA', cor: corDaEtiqueta('SEM ETIQUETA'), oculta: false, chats: data.semEtiqueta }
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
  const { data: orcMap, isLoading: carregandoOrcamentos, isError: erroOrcamentos } = useOrcamentosPorTelefone(telefonesNegociacao)

  // A contagem de temperatura acompanha a busca, antes do filtro de temperatura.
  const filtrarBase = (chats: WaChat[]): WaChat[] => {
    let cs = chats
    if (filtro) {
      cs = cs.filter(c =>
        (c.contact_name ?? '').toLowerCase().includes(filtro) ||
        (filtroDigitos && c.phone.includes(filtroDigitos))
      )
    }
    return cs
  }
  const processar = (chats: WaChat[]): WaChat[] => {
    let cs = filtrarBase(chats)
    if (filtroTemp) cs = cs.filter(c => temperaturaDe(c.last_message_at) === filtroTemp)
    return ordenarChats(cs, ordenacao)
  }
  const filtrosAtivos = !!(filtro || filtroTemp)
  const colunasExibidas = filtrosAtivos
    ? colunas.filter(col => {
        const base = filtrarBase(col.chats)
        return filtroTemp ? base.some(c => temperaturaDe(c.last_message_at) === filtroTemp) : base.length > 0
      })
    : colunas

  // KPIs sobre as colunas visíveis (panorama, ignora busca/filtros temporários)
  const kpis = useMemo(() => {
    let total = 0, parado7 = 0
    for (const col of colunas) {
      for (const c of col.chats) {
        total++
        if (temperaturaDe(c.last_message_at) === 'parado') parado7++
      }
    }
    return { total, parado7 }
  }, [colunas])

  // Valor histórico BRUTO, não previsão de vendas: a RPC não filtra status/data
  // e total_proposta não abate o campo desconto. Um orçamento por telefone.
  const resumoOrcamentos = useMemo(() => {
    const vistos = new Set<string>()
    let soma = 0, clientes = 0
    for (const col of colunas) {
      if (!COLUNAS_COM_VALOR.has(col.nome)) continue
      for (const c of col.chats) {
        const k = foneCanon(c.phone)
        if (!k || vistos.has(k)) continue
        vistos.add(k)
        const orcamento = lookupOrcamento(orcMap, c.phone)
        if (!orcamento) continue
        clientes++
        soma += orcamento.valor ?? 0
      }
    }
    return { total: soma, clientes }
  }, [colunas, orcMap])

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
    <div className="funil-page">
      <header className="funil-header">
        <div>
          <h1>Funil de vendas</h1>
          <p>Acompanhe cada conversa até o fechamento.</p>
        </div>
        <div className="funil-header-actions">
          {data?.ultimaSync && <span className="funil-sync">Atualizado {tempoRelativo(data.ultimaSync)}</span>}
          {/* O vendedor só tem /funil liberado no guard de App.tsx: os dois links o
              devolveriam pro /atendimentos. */}
          {profile?.role !== 'vendor' && <>
            <Link to="/funil/manual" className="funil-link">Funil manual</Link>
            <Link to="/funil/relatorio" className="funil-report"><BarChart3 size={15} />Relatório</Link>
          </>}
        </div>
      </header>

      {data && (
        <div className="funil-overview">
          <div className="funil-metric funil-metric--value" title="Último orçamento cadastrado de cada telefone nas colunas visíveis Follow-up, Lead quente e Orçamento enviado. Valor bruto, antes dos descontos, incluindo rascunhos e todo o histórico. Busca e temperatura não alteram este resumo. Não confirma negociação ativa nem venda.">
            <span>Orçamentos vinculados</span>
            <strong>{carregandoOrcamentos || erroOrcamentos ? '—' : brl(resumoOrcamentos.total)}</strong>
            <small className="funil-metric-note">{erroOrcamentos ? 'Não foi possível carregar os valores' : carregandoOrcamentos ? 'Carregando orçamentos…' : `${resumoOrcamentos.clientes.toLocaleString('pt-BR')} clientes · valor bruto · todo o histórico`}</small>
          </div>
          <div className="funil-metric"><span>Parados há mais de 7 dias</span><strong>{kpis.parado7.toLocaleString('pt-BR')}</strong></div>
          <div className="funil-metric"><span>Nas colunas visíveis</span><strong>{kpis.total.toLocaleString('pt-BR')}</strong></div>

        </div>
      )}

      {/* Filtros */}
      <div className="funil-filters">
        <div className="funil-vendors" aria-label="Filtrar por vendedor">
          {profile?.role === 'vendor' ? (
            quadrosDoVendedor.length > 1
              ? quadrosDoVendedor.map(v => <button key={v} onClick={() => setVendedorSel(v)} aria-pressed={v === vendedor}>{nomeVendedor(v)}</button>)
              : <span className="funil-vendor-current">{vendedorTravado && nomeVendedor(vendedorTravado)}</span>
          ) : (<>
            <button onClick={() => setVendedorSel(TODOS)} aria-pressed={modoTodos}><Users size={15} />Toda a equipe</button>
            {vendedores.map(v => <button key={v} onClick={() => setVendedorSel(v)} aria-pressed={v === vendedor}>{nomeVendedor(v)}</button>)}
          </>)}
        </div>
        <div className="funil-toolbar">
        <label className="funil-search">
          <Search size={17} aria-hidden />
          <span className="sr-only">Buscar cliente ou telefone</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente ou telefone…" />
        </label>

        {/* Ordenação */}
        <label className="relative">
          <span className="sr-only">Ordenar conversas</span>
          <select value={ordenacao} onChange={e => setOrdenacao(e.target.value === 'parado' ? 'parado' : 'recente')}
          className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none">
          {(['recente', 'parado'] as const).map(o => (
            <option key={o} value={o}>{ORDENACAO_LABEL[o]}</option>
          ))}
          </select>
        </label>

        {/* Filtro de temperatura ativo → chip pra limpar */}
        {filtroTemp && (
          <button onClick={() => setFiltroTemp(null)}
            className="h-9 px-3 rounded-lg text-[13px] border inline-flex items-center gap-1.5"
            style={{ borderColor: `${TEMP_META[filtroTemp].cor}66`, color: TEMP_META[filtroTemp].cor }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TEMP_META[filtroTemp].cor }} />
            {TEMP_META[filtroTemp].label} ✕
          </button>
        )}

        {/* Compacto */}
        <button onClick={() => setCompacto(v => !v)} aria-pressed={compacto}
          className={'h-9 px-3 rounded-lg text-[13px] border inline-flex items-center gap-1.5 ' + (compacto
            ? 'bg-accent-bg text-accent border-accent/30 font-semibold'
            : 'bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong')}>
          <ListFilter size={15} /> Compacto
        </button>

        {/* Seletor de colunas */}
        <div className="relative">
          <button onClick={() => setSeletorAberto(o => !o)} aria-expanded={seletorAberto}
            className="h-9 px-3 rounded-lg bg-surface border border-border text-[13px] text-ink-muted hover:text-ink hover:border-border-strong inline-flex items-center gap-1.5">
            <Columns3 className="h-4 w-4" /> Colunas
            {colunas.length < colunasTodas.length && (
              <span className="text-[11px] tabular-nums text-accent bg-accent-bg rounded-full px-1.5">
                {colunas.length}/{colunasTodas.length}
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
                      <span className="etq-dot h-2 w-2 rounded-full shrink-0" style={estiloEtiqueta(c.cor)} />
                      <span className="text-[12px] text-ink truncate flex-1">{nomeEtapa(c.nome)}</span>
                      <span className="text-[11px] tabular-nums text-ink-faint">{c.chats.length}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
        </div>
        {filtrosAtivos && (
          <div className="flex items-center gap-2 text-[12px] text-ink-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros ativos
            <button className="font-medium text-accent hover:underline" onClick={() => { setBusca(''); setFiltroTemp(null) }}>
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Board */}
      {profile?.role === 'vendor' && (carregandoVendedores || carregandoCadastro) ? (
        <PageLoading />
      ) : profile?.role === 'vendor' && (erroVendedores || erroCadastro) ? (
        <div className="rounded-xl border border-danger/30 bg-danger-bg p-4 text-[13px] text-danger">
          Não foi possível conferir seu vínculo com o quadro. Tente atualizar a página.
        </div>
      ) : profile?.role === 'vendor' && !vendedor ? (
        <div className="rounded-xl border border-warning/30 bg-warning-bg p-4 text-[13px] text-warning">
          Seu vendedor não está vinculado ao quadro do WhatsApp. Peça ao administrador para conferir seu cadastro.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/30 bg-danger-bg p-4 text-[13px] text-danger">
          Não foi possível carregar o funil: {String((error as Error).message)}
        </div>
      ) : isLoading || !data ? (
        <PageLoading />
      ) : colunas.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface text-center">
          <Columns3 className="h-6 w-6 text-ink-faint" />
          <p className="mt-3 text-[14px] font-medium text-ink">Nenhuma coluna visível</p>
          <button onClick={() => salvarEscondidas(new Set())} className="mt-2 text-[13px] font-medium text-accent hover:underline">Mostrar todas as colunas</button>
        </div>
      ) : colunasExibidas.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface text-center">
          <Search className="h-6 w-6 text-ink-faint" />
          <p className="mt-3 text-[14px] font-medium text-ink">Nenhuma conversa encontrada</p>
          <button onClick={() => { setBusca(''); setFiltroTemp(null) }} className="mt-2 text-[13px] font-medium text-accent hover:underline">Limpar filtros</button>
        </div>
      ) : (
        <div className="funil-board">
          <div className="funil-board-track">
            {colunasExibidas.map(col => {
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
                <section key={col.nome} aria-label={`Etapa ${nomeEtapa(col.nome)}`} className="funil-column">
                  <div className="funil-column-header">
                    <div className="funil-column-title">
                      <span className="etq-dot" style={estiloEtiqueta(col.cor)} aria-hidden />
                      <h2 title={col.nome}>{nomeEtapa(col.nome)}</h2>
                      <span className="funil-column-count">{chats.length}</span>
                    </div>
                    <div className="funil-column-summary">
                      {mostrarValor && totalValor > 0 ? <span title="Soma bruta dos últimos orçamentos vinculados nesta coluna, antes dos descontos" className="funil-column-value">{brl(totalValor)}</span> : <span>{chats.length === 1 ? '1 conversa' : `${chats.length} conversas`}</span>}
                    </div>
                    <ResumoTemperatura chats={filtrarBase(col.chats)} filtroTemp={filtroTemp}
                      onToggleTemp={t => setFiltroTemp(prev => (prev === t ? null : t))} />
                  </div>
                  <div className="funil-column-cards">
                    {visiveis.map(c => (
                      <ChatCard key={`${c.vendedor ?? ''}:${c.phone}`} chat={c} mostrarVendedor={modoTodos} compacto={compacto}
                        valorOrcamento={mostrarValor ? lookupOrcamento(orcMap, c.phone)?.valor ?? null : null}
                        agendada={lookupAgendada(agendadasMap, c.vendedor ?? (modoTodos ? null : vendedor), c.chat_id, c.phone)}
                        onClick={() => setChatSelecionado({ phone: c.phone, vendedor: c.vendedor })} />
                    ))}
                    {chats.length > limite && (
                      <button onClick={() => setLimites(l => ({ ...l, [col.nome]: limite + 50 }))}
                        className="w-full rounded-md border border-border bg-surface py-1.5 text-[12px] text-ink-muted hover:text-ink hover:border-border-strong">
                        Mostrar mais ({chats.length - limite} restantes)
                      </button>
                    )}
                    {chats.length === 0 && <p className="px-3 py-8 text-center text-[12px] text-ink-faint">Nenhuma conversa com os filtros atuais.</p>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {chatAberto && vendedor && (
        <ChatDrawer
          // remonta ao trocar de card: zera paginação/lightbox e evita estado vazando entre conversas
          key={`${chatAberto.vendedor ?? vendedor}::${chatAberto.phone}`}
          chat={chatAberto}
          etiquetas={etiquetasDoChat}
          vendedor={chatAberto.vendedor ?? vendedor}
          agendada={lookupAgendada(agendadasMap, chatAberto.vendedor ?? (modoTodos ? null : vendedor), chatAberto.chat_id, chatAberto.phone)}
          onClose={() => setChatSelecionado(null)}
        />
      )}
    </div>
  )
}
