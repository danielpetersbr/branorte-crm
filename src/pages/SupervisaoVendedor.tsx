import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertTriangle, ArrowLeft, Ban, CalendarClock, Check, ExternalLink, Eye,
  Inbox, MessageCircle, Phone, ShieldAlert, ThumbsDown, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'
import { useWaMensagens, type WaMensagem } from '@/hooks/useWaKanban'
import {
  MOTIVOS_FEEDBACK, TIPOS_INTERACAO,
  useAchadosDoVendedor, useCarteiraDoVendedor, useChatInfo, useEncerrarAchado,
  useRegistrarInteracao, useRegrasSupervisao, useReportarIaErrada, useVendedoresComAchados,
  type MotivoFeedback, type Severidade, type SupervisaoAchado, type TipoInteracao,
} from '@/hooks/useSupervisaoVendedor'
import { cn, formatPhone, whatsappLink } from '@/lib/utils'

// ============================================================================
// Supervisão de UM vendedor — a IA prestando contas.
//
// A tela SÓ MOSTRA. Ela nunca responde cliente e nunca envia mensagem: quem
// fala é o vendedor, no WhatsApp dele. Aqui o gestor lê o apontamento, vê a
// evidência e registra o que decidiu (resolvido / não se aplica / a IA errou).
//
// Regra de honestidade da tela: nenhum número aparece sozinho.
//   - "55 situações" vem sempre com "em 55 conversas" ao lado, porque uma
//     conversa pode gerar mais de um apontamento e somar tudo infla o problema.
//   - "sem apontamento" é contado em CONVERSAS, não em situações — e está
//     rotulado como tal.
// ============================================================================

// ─── Toast local (padrão do repo — não existe provider global) ──────────────
interface ToastMsg { id: number; texto: string; tone: 'success' | 'danger' | 'info' }

function useToast(): [ToastMsg[], (texto: string, tone?: ToastMsg['tone']) => void] {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const push = (texto: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }
  return [toasts, push]
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[1100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border backdrop-blur bg-surface/95 max-w-[92vw] text-center',
          t.tone === 'success' && 'border-success/30 text-success',
          t.tone === 'danger' && 'border-danger/30 text-danger',
          t.tone === 'info' && 'border-border text-ink',
        )}>{t.texto}</div>
      ))}
    </div>
  )
}

// ─── Cores por severidade (o desenho aprovado) ──────────────────────────────
// vermelho = precisa de ação · laranja = risco · azul = melhoria (leitura da
// IA) · VERDE = oportunidade comercial. Verde aqui NÃO quer dizer "está em dia".
interface CfgSeveridade {
  key: Severidade
  titulo: string
  contagem: string
  subtitulo: string
  texto: string
  fundo: string
  barra: string
  ponto: string
}

const SEVERIDADES: CfgSeveridade[] = [
  {
    key: 'acao', titulo: 'Precisa de ação', contagem: 'precisam de ação',
    subtitulo: 'Alguém está esperando. Não é opinião da IA: é fato na conversa.',
    texto: 'text-danger', fundo: 'bg-danger-bg', barra: 'border-l-danger', ponto: 'bg-danger',
  },
  {
    key: 'risco', titulo: 'Risco comercial', contagem: 'de risco',
    subtitulo: 'Ainda não travou, mas o negócio pode escorrer se ficar assim.',
    texto: 'text-warning', fundo: 'bg-warning-bg', barra: 'border-l-warning', ponto: 'bg-warning',
  },
  {
    key: 'oportunidade', titulo: 'Oportunidade', contagem: 'de oportunidade',
    subtitulo: 'Chance comercial aberta — verde aqui é dinheiro na mesa, não "em dia".',
    texto: 'text-success', fundo: 'bg-success-bg', barra: 'border-l-success', ponto: 'bg-success',
  },
  {
    key: 'melhoria', titulo: 'Melhoria de condução', contagem: 'de melhoria de condução',
    subtitulo: 'Interpretação da IA sobre como a conversa foi conduzida. Não é erro comprovado.',
    texto: 'text-info', fundo: 'bg-info-bg', barra: 'border-l-info', ponto: 'bg-info',
  },
]

const CFG: Record<Severidade, CfgSeveridade> = SEVERIDADES.reduce((acc, s) => {
  acc[s.key] = s
  return acc
}, {} as Record<Severidade, CfgSeveridade>)

const ROTULO_CAMADA: Record<string, string> = {
  deterministica: 'regra determinística',
  heuristica: 'heurística',
  ia: 'leitura da IA',
}

const ROTULO_FONTE: Record<string, string> = {
  mensagem: 'mensagem da conversa',
  orcamento: 'orçamento emitido',
  crm: 'registro do CRM',
  interacao: 'contato registrado',
  compromisso: 'compromisso combinado',
  estruturado: 'dado estruturado',
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) } catch { return '—' }
}

function fmtCurto(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'dd/MM HH:mm', { locale: ptBR }) } catch { return '—' }
}

function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos
}

// ============================================================================
// Página
// ============================================================================
export function SupervisaoVendedor() {
  const { vendedorId } = useParams<{ vendedorId: string }>()
  const { session } = useAuth()
  const usuarioId = session?.user?.id ?? null

  const { data: vendors, isLoading: carregandoVendors } = useVendors({ incluirInativos: true })
  const vendedor = useMemo(
    () => (vendors ?? []).find(v => v.id === vendedorId) ?? null,
    [vendors, vendedorId],
  )

  const { data: achados, isLoading: carregandoAchados, error: erroAchados } =
    useAchadosDoVendedor(vendedor?.id)
  const { data: carteira, isError: erroCarteira } = useCarteiraDoVendedor(vendedor?.name)
  const { data: regras } = useRegrasSupervisao()

  const [toasts, push] = useToast()
  const [chatAberto, setChatAberto] = useState<{ chatId: string; titulo: string } | null>(null)
  const [modalLigacao, setModalLigacao] = useState<SupervisaoAchado | null>(null)
  const [modalIaErrada, setModalIaErrada] = useState<SupervisaoAchado | null>(null)

  const encerrar = useEncerrarAchado(vendedor?.id)
  const registrar = useRegistrarInteracao(vendedor?.id)
  const reportar = useReportarIaErrada(vendedor?.id)

  // ─── Contas do cabeçalho de auditoria ────────────────────────────────────
  const resumo = useMemo(() => {
    const lista = achados ?? []
    const porSeveridade: Record<Severidade, number> = { acao: 0, risco: 0, melhoria: 0, oportunidade: 0 }
    const chats = new Set<string>()
    let ultimaLeitura: string | null = null
    for (const a of lista) {
      porSeveridade[a.severidade] = (porSeveridade[a.severidade] ?? 0) + 1
      chats.add(a.chat_id)
      if (!ultimaLeitura || a.atualizado_em > ultimaLeitura) ultimaLeitura = a.atualizado_em
    }
    return {
      total: lista.length,
      chatsComAchado: chats.size,
      porSeveridade,
      ultimaLeitura,
    }
  }, [achados])

  const grupos = useMemo(() => {
    const lista = achados ?? []
    return SEVERIDADES
      .map(cfg => ({ cfg, itens: lista.filter(a => a.severidade === cfg.key) }))
      .filter(g => g.itens.length > 0)
  }, [achados])

  // ─── Estados de borda ────────────────────────────────────────────────────
  if (carregandoVendors) return <PageLoading />

  if (!vendedor) {
    return <EscolherVendedor idProcurado={vendedorId ?? null} />
  }

  async function acaoEncerrar(achado: SupervisaoAchado, como: 'resolvida' | 'nao_se_aplica') {
    try {
      await encerrar.mutateAsync({ achadoId: achado.id, como, usuarioId })
      push(como === 'resolvida' ? 'Apontamento marcado como resolvido.' : 'Apontamento marcado como "não se aplica".', 'success')
    } catch (e) {
      push(`Não deu pra encerrar: ${(e as Error).message}`, 'danger')
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">

        {/* Cabeçalho da página */}
        <div className="mb-5">
          <Link
            to="/supervisao"
            className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Central de supervisão
          </Link>
          <h1 className="text-[18px] font-semibold text-ink">Supervisão de {vendedor.name}</h1>
          <p className="text-[12px] text-ink-muted">
            A IA leu as conversas e listou o que ficou por fazer. Ela não responde cliente e nada
            daqui é enviado — quem fala é o vendedor, no WhatsApp dele.
          </p>
        </div>

        {/* Cabeçalho de auditoria */}
        <CabecalhoAuditoria
          nome={vendedor.name}
          carregando={carregandoAchados}
          erro={erroAchados as Error | null}
          carteira={carteira ?? null}
          erroCarteira={erroCarteira}
          total={resumo.total}
          chatsComAchado={resumo.chatsComAchado}
          porSeveridade={resumo.porSeveridade}
          ultimaLeitura={resumo.ultimaLeitura}
        />

        {/* Grupos de achados */}
        {carregandoAchados ? (
          <p className="mt-6 text-[13px] text-ink-muted">Carregando os apontamentos…</p>
        ) : erroAchados ? null : grupos.length === 0 ? (
          <Card className="mt-5">
            <CardContent className="py-10 text-center">
              <Inbox className="h-7 w-7 mx-auto text-ink-faint mb-2" />
              <p className="text-[14px] font-medium text-ink">Nenhum apontamento aberto</p>
              <p className="text-[12px] text-ink-muted mt-1">
                A IA varreu a carteira de {vendedor.name} e não achou nada pendente.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-6 space-y-8">
            {grupos.map(({ cfg, itens }) => (
              <GrupoSeveridade
                key={cfg.key}
                cfg={cfg}
                itens={itens}
                regras={regras}
                ocupado={encerrar.isPending || registrar.isPending || reportar.isPending}
                onVerConversa={(a) => setChatAberto({ chatId: a.chat_id, titulo: a.titulo })}
                onResolvido={(a) => acaoEncerrar(a, 'resolvida')}
                onNaoSeAplica={(a) => acaoEncerrar(a, 'nao_se_aplica')}
                onRegistrarLigacao={(a) => setModalLigacao(a)}
                onIaErrada={(a) => setModalIaErrada(a)}
                onAgendar={() => push(
                  'Agendar retorno ainda não grava: falta a função supervisao_agendar no banco. Se você já falou com o cliente, use "Registrar ligação".',
                  'info',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Conversa */}
      <ConversaDrawer
        vendedorNome={vendedor.name}
        chatId={chatAberto?.chatId ?? null}
        titulo={chatAberto?.titulo ?? ''}
        onClose={() => setChatAberto(null)}
      />

      {/* Registrar ligação */}
      {modalLigacao && (
        <ModalLigacao
          achado={modalLigacao}
          salvando={registrar.isPending}
          onCancelar={() => setModalLigacao(null)}
          onConfirmar={async (tipo, ocorridoEm, observacao) => {
            try {
              await registrar.mutateAsync({
                achadoId: modalLigacao.id,
                chatId: modalLigacao.chat_id,
                vendedorId: modalLigacao.vendedor_id,
                tipo, ocorridoEm, observacao, usuarioId,
              })
              setModalLigacao(null)
              push('Contato registrado. O apontamento foi encerrado.', 'success')
            } catch (e) {
              push(`Não deu pra registrar: ${(e as Error).message}`, 'danger')
            }
          }}
        />
      )}

      {/* A IA está errada */}
      {modalIaErrada && (
        <ModalIaErrada
          achado={modalIaErrada}
          salvando={reportar.isPending}
          onCancelar={() => setModalIaErrada(null)}
          onConfirmar={async (motivo, detalhe) => {
            try {
              await reportar.mutateAsync({ achado: modalIaErrada, motivo, detalhe, usuarioId })
              setModalIaErrada(null)
              push('Obrigado. O motivo foi gravado e entra na revisão da regra.', 'success')
            } catch (e) {
              push(`Não deu pra gravar o retorno: ${(e as Error).message}`, 'danger')
            }
          }}
        />
      )}

      <ToastStack toasts={toasts} />
    </div>
  )
}

// ============================================================================
// Cabeçalho de auditoria — a IA prestando contas
// ============================================================================
function CabecalhoAuditoria(props: {
  nome: string
  carregando: boolean
  erro: Error | null
  carteira: number | null
  erroCarteira: boolean
  total: number
  chatsComAchado: number
  porSeveridade: Record<Severidade, number>
  ultimaLeitura: string | null
}) {
  const { nome, carregando, erro, carteira, erroCarteira, total, chatsComAchado, porSeveridade, ultimaLeitura } = props

  if (erro) {
    return (
      <Card className="border-danger/30">
        <CardContent className="py-4">
          <p className="text-[13px] font-medium text-danger">Não consegui carregar os apontamentos.</p>
          <p className="text-[12px] text-ink-muted mt-1">{erro.message}</p>
        </CardContent>
      </Card>
    )
  }

  const semApontamento = carteira != null ? Math.max(carteira - chatsComAchado, 0) : null

  return (
    <Card>
      <CardContent className="py-5">
        {/* A frase */}
        <p className="text-[15px] leading-relaxed text-ink">
          {carregando ? (
            <span className="text-ink-muted">Lendo as conversas de {nome}…</span>
          ) : carteira != null ? (
            <>
              Analisei <strong className="font-semibold">{carteira.toLocaleString('pt-BR')}</strong>{' '}
              {plural(carteira, 'conversa', 'conversas')} de <strong className="font-semibold">{nome}</strong>{' '}
              e encontrei <strong className="font-semibold">{total.toLocaleString('pt-BR')}</strong>{' '}
              {plural(total, 'situação relevante', 'situações relevantes')}.
            </>
          ) : (
            <>
              Encontrei <strong className="font-semibold">{total.toLocaleString('pt-BR')}</strong>{' '}
              {plural(total, 'situação relevante', 'situações relevantes')} nas conversas de{' '}
              <strong className="font-semibold">{nome}</strong>.
            </>
          )}
        </p>

        {/* A separação obrigatória: situações ≠ conversas */}
        {!carregando && total > 0 && (
          <p className="text-[12.5px] text-ink-muted mt-1.5">
            São <strong className="font-medium text-ink">{total.toLocaleString('pt-BR')}</strong>{' '}
            {plural(total, 'situação', 'situações')} em{' '}
            <strong className="font-medium text-ink">{chatsComAchado.toLocaleString('pt-BR')}</strong>{' '}
            {plural(chatsComAchado, 'conversa', 'conversas')}
            {total !== chatsComAchado
              ? ' — a mesma conversa pode gerar mais de uma situação, por isso os dois números não batem.'
              : ' — uma situação por conversa nesta leitura.'}
          </p>
        )}
        {erroCarteira && (
          <p className="text-[12px] text-warning mt-1.5">
            Não consegui contar a carteira agora, então o total de conversas analisadas está de fora.
          </p>
        )}

        {/* A quebra */}
        {!carregando && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 pt-4 border-t border-border">
            {SEVERIDADES.map(cfg => {
              const n = porSeveridade[cfg.key] ?? 0
              return (
                <span
                  key={cfg.key}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap',
                    n > 0 ? cfg.texto : 'text-ink-faint',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full shrink-0', n > 0 ? cfg.ponto : 'bg-ink-faint/40')} />
                  <strong className="font-semibold">{n}</strong>
                  <span className={n > 0 ? '' : 'opacity-80'}>{cfg.contagem}</span>
                </span>
              )
            })}
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted whitespace-nowrap">
              <span className="h-2 w-2 rounded-full bg-ink-faint/40 shrink-0" />
              <strong className="font-semibold">
                {semApontamento != null ? semApontamento.toLocaleString('pt-BR') : '—'}
              </strong>
              <span>{plural(semApontamento ?? 0, 'conversa sem apontamento', 'conversas sem apontamento')}</span>
            </span>
          </div>
        )}

        {/* De onde vem o número */}
        <p className="text-[11px] text-ink-faint mt-3 leading-relaxed">
          As quatro primeiras contagens são de <em>situações</em>; a última é de <em>conversas</em>.
          A carteira é o espelho do WhatsApp de {nome} (wa_chat_labels) — é o universo que a varredura percorre.
          {ultimaLeitura && <> Última leitura da IA: {fmtDataHora(ultimaLeitura)}.</>}
        </p>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Grupo por severidade
// ============================================================================
const PAGINA = 15

function GrupoSeveridade(props: {
  cfg: CfgSeveridade
  itens: SupervisaoAchado[]
  regras: Record<string, { descricao: string }> | undefined
  ocupado: boolean
  onVerConversa: (a: SupervisaoAchado) => void
  onResolvido: (a: SupervisaoAchado) => void
  onNaoSeAplica: (a: SupervisaoAchado) => void
  onRegistrarLigacao: (a: SupervisaoAchado) => void
  onIaErrada: (a: SupervisaoAchado) => void
  onAgendar: (a: SupervisaoAchado) => void
}) {
  const { cfg, itens, regras } = props
  const [visiveis, setVisiveis] = useState(PAGINA)
  const mostrando = itens.slice(0, visiveis)
  const restam = itens.length - mostrando.length

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', cfg.ponto)} />
        <h2 className={cn('text-[14px] font-semibold', cfg.texto)}>{cfg.titulo}</h2>
        <span className="text-[12px] text-ink-muted">
          {itens.length} {plural(itens.length, 'situação', 'situações')}
        </span>
      </div>
      <p className="text-[12px] text-ink-muted mb-3 ml-[18px]">{cfg.subtitulo}</p>

      <div className="space-y-3">
        {mostrando.map(a => (
          <CardAchado
            key={a.id}
            achado={a}
            cfg={cfg}
            descricaoRegra={regras?.[a.regra_key]?.descricao}
            ocupado={props.ocupado}
            onVerConversa={() => props.onVerConversa(a)}
            onResolvido={() => props.onResolvido(a)}
            onNaoSeAplica={() => props.onNaoSeAplica(a)}
            onRegistrarLigacao={() => props.onRegistrarLigacao(a)}
            onIaErrada={() => props.onIaErrada(a)}
            onAgendar={() => props.onAgendar(a)}
          />
        ))}
      </div>

      {restam > 0 && (
        <button
          onClick={() => setVisiveis(v => v + PAGINA)}
          className="mt-3 w-full py-2.5 rounded-md border border-dashed border-border text-[12.5px] text-ink-muted hover:text-ink hover:border-border-strong transition-colors"
        >
          Mostrar mais {Math.min(restam, PAGINA)} de {restam} {plural(restam, 'situação', 'situações')}
        </button>
      )}
    </section>
  )
}

// ============================================================================
// Card do achado — responde as 4 perguntas, sempre
// ============================================================================
function CardAchado(props: {
  achado: SupervisaoAchado
  cfg: CfgSeveridade
  descricaoRegra: string | undefined
  ocupado: boolean
  onVerConversa: () => void
  onResolvido: () => void
  onNaoSeAplica: () => void
  onRegistrarLigacao: () => void
  onIaErrada: () => void
  onAgendar: () => void
}) {
  const { achado: a, cfg, descricaoRegra, ocupado } = props
  const interpretacao = a.camada === 'ia' || a.severidade === 'melhoria'

  return (
    <Card className={cn('border-l-[3px] overflow-hidden', cfg.barra)}>
      {/* Título */}
      <div className={cn('px-4 py-3 border-b border-border', cfg.fundo)}>
        <p className="text-[13.5px] font-semibold text-ink leading-snug">{a.titulo}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Badge className={cn('bg-surface', cfg.texto)}>{cfg.titulo}</Badge>
          <Badge className="bg-surface-2 text-ink-muted">{a.categoria.replace(/_/g, ' ')}</Badge>
          {(a.tags ?? []).slice(0, 3).map(t => (
            <Badge key={t} className="bg-surface-2 text-ink-faint">{t.replace(/_/g, ' ')}</Badge>
          ))}
        </div>
      </div>

      <CardContent className="px-4 py-3.5 space-y-3.5">
        <Bloco rotulo="o que aconteceu" texto={a.o_que_aconteceu} />
        <Bloco rotulo="por que estou vendo" texto={a.por_que_vendo} />
        <Bloco rotulo="próxima ação" texto={a.proxima_acao} destaque />

        {/* Evidência */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">evidência</p>
          {a.evidencias.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">
              A IA não anexou trecho neste apontamento — só o resumo acima.
            </p>
          ) : (
            <div className="rounded-md border border-border bg-surface-2 divide-y divide-border">
              {a.evidencias.map(e => (
                <div key={e.id} className="px-3 py-2">
                  <p className="text-[12.5px] text-ink leading-relaxed whitespace-pre-wrap break-words">
                    {e.trecho?.trim() ? `“${e.trecho.trim()}”` : '(sem trecho)'}
                  </p>
                  <p className="text-[10.5px] text-ink-faint mt-1">
                    {ROTULO_FONTE[e.fonte] ?? e.fonte}
                    {e.ocorrido_em && <> · {fmtDataHora(e.ocorrido_em)}</>}
                    {e.ref_tabela && <> · <span className="font-mono">{e.ref_tabela}</span></>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rodapé: confiança, camada, procedência */}
        <div className="pt-2.5 border-t border-border">
          <p className="text-[11px] text-ink-faint leading-relaxed">
            confiança {Math.round(Number(a.confianca) * 100)}% ·{' '}
            {ROTULO_CAMADA[a.camada] ?? a.camada} ·{' '}
            <span className="font-mono">{a.regra_key}</span> v{a.regra_versao}
            {a.modelo && <> · modelo {a.modelo}</>}
            {' '}· visto pela última vez em {fmtCurto(a.atualizado_em)}
          </p>
          {a.score_motivo && (
            <p className="text-[11px] text-ink-faint mt-0.5">peso {Number(a.score).toFixed(0)} — {a.score_motivo}</p>
          )}
          {interpretacao && (
            <p className={cn('text-[11.5px] mt-1.5 inline-flex items-start gap-1.5', CFG.melhoria.texto)}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              interpretação da IA, não erro comprovado
            </p>
          )}
          {descricaoRegra && (
            <details className="mt-1.5">
              <summary className="text-[11px] text-ink-muted cursor-pointer hover:text-ink select-none">
                como esta regra funciona
              </summary>
              <p className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">{descricaoRegra}</p>
            </details>
          )}
        </div>

        {/* Ações — nenhuma delas fala com o cliente */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" onClick={props.onVerConversa}>
            <Eye className="h-3.5 w-3.5" /> Ver conversa
          </Button>
          <Button size="sm" disabled={ocupado} onClick={props.onResolvido}>
            <Check className="h-3.5 w-3.5" /> Resolvido
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onAgendar}
            title="Ainda não grava: falta a função supervisao_agendar no banco (escrita direta em supervisao_achados está revogada)."
          >
            <CalendarClock className="h-3.5 w-3.5" /> Agendar retorno
            <span className="text-ink-faint">(em breve)</span>
          </Button>
          <Button size="sm" disabled={ocupado} onClick={props.onRegistrarLigacao}>
            <Phone className="h-3.5 w-3.5" /> Registrar ligação
          </Button>
          <Button size="sm" disabled={ocupado} onClick={props.onNaoSeAplica}>
            <Ban className="h-3.5 w-3.5" /> Não se aplica
          </Button>
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={props.onIaErrada}>
            <ThumbsDown className="h-3.5 w-3.5" /> A IA está errada
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Bloco({ rotulo, texto, destaque }: { rotulo: string; texto: string | null; destaque?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint mb-1">{rotulo}</p>
      <p className={cn(
        'text-[13px] leading-relaxed whitespace-pre-wrap break-words',
        destaque ? 'text-ink font-medium' : 'text-ink',
      )}>
        {texto?.trim() || '— a IA não escreveu isto neste apontamento.'}
      </p>
    </div>
  )
}

// ============================================================================
// Drawer: ver a conversa (só leitura — daqui não sai mensagem)
// ============================================================================
function ConversaDrawer(props: {
  vendedorNome: string
  chatId: string | null
  titulo: string
  onClose: () => void
}) {
  const { vendedorNome, chatId, titulo, onClose } = props
  const aberto = !!chatId
  const { data: info } = useChatInfo(vendedorNome, chatId)
  const { data: conversa, isLoading } = useWaMensagens(vendedorNome, chatId, aberto, 30)
  const mensagens = conversa?.mensagens ?? []

  return (
    <>
      {aberto && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />}
      <aside
        aria-hidden={!aberto}
        className={cn(
          'fixed top-0 right-0 h-full w-full sm:w-[520px] z-50 bg-surface border-l border-border',
          'shadow-2xl flex flex-col transition-transform duration-300 ease-out',
          aberto ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink truncate">
              {info?.contact_name?.trim() || (info?.phone ? formatPhone(info.phone) : 'Conversa')}
            </p>
            <p className="text-[11.5px] text-ink-muted line-clamp-2">{titulo}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border shrink-0 flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-faint font-mono truncate">{chatId}</p>
          {info?.phone && (
            <a
              href={whatsappLink(info.phone)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Abrir no WhatsApp
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {isLoading ? (
            <p className="text-[13px] text-ink-muted text-center py-6">Carregando a conversa…</p>
          ) : mensagens.length === 0 ? (
            <p className="text-[13px] text-ink-muted text-center py-6">
              Nenhuma mensagem gravada deste chat no espelho.
            </p>
          ) : (
            <>
              {conversa?.temMais && (
                <p className="text-[11px] text-ink-faint text-center pb-2">
                  mostrando as {mensagens.length} mensagens mais recentes
                </p>
              )}
              {mensagens.map(m => <Bolha key={m.msg_id} m={m} />)}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0">
          <p className="text-[11px] text-ink-faint">
            Só leitura. Para responder, o vendedor usa o WhatsApp dele.
          </p>
        </div>
      </aside>
    </>
  )
}

function Bolha({ m }: { m: WaMensagem }) {
  const meu = m.from_me === true
  const corpo = m.body?.trim()
    || (m.tipo === 'ptt' || m.tipo === 'audio'
      ? `[áudio${m.duracao_seg ? ` de ${m.duracao_seg}s` : ''}]`
      : m.tipo === 'image' ? '[imagem]'
      : m.tipo === 'video' ? '[vídeo]'
      : m.tipo === 'document' ? '[documento]'
      : '[sem texto]')
  return (
    <div className={cn('flex', meu ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-lg px-3 py-2',
        meu ? 'bg-accent-bg border border-accent/20' : 'bg-surface-2 border border-border',
      )}>
        <p className="text-[12.5px] text-ink leading-relaxed whitespace-pre-wrap break-words">{corpo}</p>
        <p className="text-[10px] text-ink-faint mt-1">
          {meu ? 'vendedor' : 'cliente'} · {fmtCurto(m.data_msg)}
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Modais
// ============================================================================
function ModalShell(props: { titulo: string; subtitulo?: string; onCancelar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/45" onClick={props.onCancelar} />
      <div className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">{props.titulo}</p>
            {props.subtitulo && <p className="text-[12px] text-ink-muted mt-0.5 line-clamp-2">{props.subtitulo}</p>}
          </div>
          <button
            onClick={props.onCancelar}
            aria-label="Fechar"
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{props.children}</div>
      </div>
    </div>
  )
}

function ModalLigacao(props: {
  achado: SupervisaoAchado
  salvando: boolean
  onCancelar: () => void
  onConfirmar: (tipo: TipoInteracao, ocorridoEm: string, observacao: string | null) => void
}) {
  const [tipo, setTipo] = useState<TipoInteracao>('ligacao_feita')
  const [quando, setQuando] = useState(() => paraInputLocal(new Date()))
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    const d = new Date(quando)
    if (Number.isNaN(d.getTime())) { setErro('Data inválida.'); return }
    if (d.getTime() > Date.now() + 60_000) {
      setErro('Não dá pra registrar um contato que ainda não aconteceu. Para o futuro seria "agendar retorno", que ainda não está disponível.')
      return
    }
    setErro(null)
    props.onConfirmar(tipo, d.toISOString(), observacao.trim() || null)
  }

  return (
    <ModalShell titulo="Registrar contato fora do WhatsApp" subtitulo={props.achado.titulo} onCancelar={props.onCancelar}>
      <div className="space-y-3.5">
        <div>
          <label className="text-[11px] font-medium text-ink-muted block mb-1">O que aconteceu</label>
          <Select
            className="w-full"
            value={tipo}
            onChange={e => setTipo(e.target.value as TipoInteracao)}
            options={TIPOS_INTERACAO}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-ink-muted block mb-1">Quando</label>
          <Input type="datetime-local" value={quando} onChange={e => setQuando(e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-ink-muted block mb-1">Observação (opcional)</label>
          <textarea
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            rows={3}
            placeholder="O que ficou combinado"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>

        <div className="rounded-md bg-surface-2 border border-border px-3 py-2.5">
          <p className="text-[11.5px] text-ink-muted leading-relaxed">
            <ShieldAlert className="h-3.5 w-3.5 inline-block mr-1 -mt-px text-ink-faint" />
            Registrar o contato encerra este apontamento. A varredura também passa a ignorar a
            conversa a partir desta data — por isso a data precisa ser a real.
          </p>
        </div>

        {erro && <p className="text-[12px] text-danger">{erro}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button size="sm" variant="ghost" onClick={props.onCancelar}>Cancelar</Button>
          <Button size="sm" variant="primary" loading={props.salvando} onClick={confirmar}>
            Registrar e encerrar
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

function ModalIaErrada(props: {
  achado: SupervisaoAchado
  salvando: boolean
  onCancelar: () => void
  onConfirmar: (motivo: MotivoFeedback, detalhe: string | null) => void
}) {
  const [motivo, setMotivo] = useState<MotivoFeedback | ''>('')
  const [detalhe, setDetalhe] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    if (!motivo) { setErro('Escolha o motivo — é ele que corrige a régua.'); return }
    setErro(null)
    props.onConfirmar(motivo, detalhe.trim() || null)
  }

  return (
    <ModalShell titulo="A IA está errada — por quê?" subtitulo={props.achado.titulo} onCancelar={props.onCancelar}>
      <div className="space-y-3.5">
        <div>
          <label className="text-[11px] font-medium text-ink-muted block mb-1">Motivo</label>
          <Select
            className="w-full"
            value={motivo}
            placeholder="Escolha o motivo"
            onChange={e => setMotivo(e.target.value as MotivoFeedback)}
            options={MOTIVOS_FEEDBACK}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-ink-muted block mb-1">Detalhe (opcional)</label>
          <textarea
            value={detalhe}
            onChange={e => setDetalhe(e.target.value)}
            rows={3}
            placeholder="O que a IA leu errado"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>

        <div className="rounded-md bg-surface-2 border border-border px-3 py-2.5">
          <p className="text-[11.5px] text-ink-muted leading-relaxed">
            O motivo fica gravado junto com a regra{' '}
            <span className="font-mono">{props.achado.regra_key}</span> v{props.achado.regra_versao}{' '}
            e a confiança de {Math.round(Number(props.achado.confianca) * 100)}% que ela tinha aqui.
            É assim que a régua deixa de errar de novo.
          </p>
        </div>

        {erro && <p className="text-[12px] text-danger">{erro}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button size="sm" variant="ghost" onClick={props.onCancelar}>Cancelar</Button>
          <Button size="sm" variant="primary" loading={props.salvando} onClick={confirmar}>
            Enviar e descartar
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

// ============================================================================
// Sem vendedor válido na URL — mostra quem tem apontamento aberto
// ============================================================================
function EscolherVendedor({ idProcurado }: { idProcurado: string | null }) {
  // ⚠️ `error` NÃO pode ser descartado aqui. Sem ele, uma falha de leitura
  // (RLS, rede, token expirado) deixa `data` undefined e a tela anuncia
  // "Nenhum apontamento aberto no momento" — ou seja, afirma que está tudo em
  // dia justamente quando não conseguiu verificar nada. Vazio-porque-quebrou
  // tem que ser visualmente diferente de vazio-porque-zero.
  const { data, isLoading, error } = useVendedoresComAchados()

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-[18px] font-semibold text-ink">Supervisão por vendedor</h1>
        <p className="text-[12px] text-ink-muted">
          {idProcurado
            ? 'Não achei esse vendedor. Escolha um da lista abaixo.'
            : 'Escolha o vendedor para ver o que a IA encontrou nas conversas dele.'}
        </p>

        <Card className="mt-5">
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-[13px] text-ink-muted px-5 py-6">Carregando…</p>
            ) : error ? (
              <p className="text-[13px] text-danger px-5 py-6">
                Não consegui ler a lista de vendedores: {(error as Error).message}
                <br />
                <span className="text-ink-muted">
                  Isto não quer dizer que não há apontamentos — quer dizer que não deu pra verificar.
                </span>
              </p>
            ) : !data?.length ? (
              <p className="text-[13px] text-ink-muted px-5 py-6">Nenhum apontamento aberto no momento.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.map(v => (
                  <li key={v.vendedor_id}>
                    <Link
                      to={`/supervisao/vendedor/${v.vendedor_id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-2 transition-colors"
                    >
                      <span className="text-[13.5px] font-medium text-ink">{v.nome}</span>
                      <span className="text-[12px] text-ink-muted">
                        {v.total} {plural(v.total, 'situação', 'situações')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
