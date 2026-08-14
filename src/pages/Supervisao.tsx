import { Link } from 'react-router-dom'
import { ScanEye, AlertTriangle, ArrowRight, Sparkles, CheckCircle2, WifiOff, RefreshCw } from 'lucide-react'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import {
  useSupervisaoResumo, useSupervisaoPorVendedor, useSupervisaoAchados,
  ROTULO_SEVERIDADE,
  type SupervisaoSeveridade, type VendedorSupervisao,
  type SupervisaoAchadoDetalhe, type Varredura, type EstadoConexao,
} from '@/hooks/useSupervisao'

// ============================================================================
// Central de Supervisão — a home do gestor.
//
// A IA lê as conversas dos vendedores e aponta o que ficou por fazer. Ela
// NUNCA responde cliente e NUNCA envia mensagem: esta tela só mostra. Quem
// fala com o cliente é o vendedor, no WhatsApp dele.
//
// São TRÊS BLOCOS E UM CAMPO. De propósito não é dashboard: sem gráfico, sem
// grade de cartão colorido. O gestor abre, lê três coisas e sabe o que fazer.
//
//   1. quantas situações existem hoje  (+ quando a IA passou por aqui)
//   2. quem precisa de atenção         (número SEMPRE decomposto)
//   3. principais situações do dia     (maior score, com o porquê)
//   4. pergunte à IA                   (campo desligado, entra depois)
//
// Regra de ouro daqui: número sem contexto é ruído, e SILÊNCIO NÃO PODE
// PARECER SAÚDE. Se a varredura está velha, se ninguém sabe quando ela rodou,
// ou se foi a REDE DE QUEM ESTÁ OLHANDO que caiu, a tela fala isso em cima —
// antes de qualquer contagem.
// ============================================================================

/**
 * Acima disto a tela avisa que o número pode estar velho.
 *
 * ⚠️ É mais rígido que o `sinal: 'fresco'` do hook (60 min de propósito, pra
 * não gritar a cada soluço do motor). Aqui a régua é a do gestor: meia hora
 * sem varrer já muda a decisão dele, então a home avisa antes.
 */
const AVISO_MIN = 30

const COR_SEVERIDADE: Record<SupervisaoSeveridade, { ponto: string; texto: string; borda: string }> = {
  acao:         { ponto: 'bg-danger',  texto: 'text-danger',  borda: 'border-l-danger' },
  risco:        { ponto: 'bg-warning', texto: 'text-warning', borda: 'border-l-warning' },
  melhoria:     { ponto: 'bg-info',    texto: 'text-info',    borda: 'border-l-info' },
  oportunidade: { ponto: 'bg-success', texto: 'text-success', borda: 'border-l-success' },
}

const num = (n: number) => n.toLocaleString('pt-BR')

/** minutos (float) → "há 4 min" / "há 2 h" / "há 3 dias" */
function idadeEmTexto(idadeMin: number | null): string {
  if (idadeMin === null) return 'não sei quando'
  const m = Math.floor(idadeMin)
  if (m < 1) return 'agora há pouco'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
}

// ─── Bloco 1: o número do dia + a idade do dado ─────────────────────────────

function Cabecalho({
  total, agendadas, truncado, conversasComAchado, varredura, conexao, atualizar,
}: {
  total: number
  agendadas: number
  truncado: boolean
  conversasComAchado: number
  varredura: Varredura
  conexao: EstadoConexao
  atualizar: () => void
}) {
  const quando = idadeEmTexto(varredura.idadeMin)
  const semRegistro = varredura.sinal === 'sem-registro'
  const velho = varredura.idadeMin !== null && varredura.idadeMin > AVISO_MIN
  // Rede caída ≠ motor parado. O React Query segura o último dado quando o
  // refetch falha, então a idade sobe sozinha e a tela acusaria o motor de ter
  // morrido quando quem caiu foi o navegador. Este caso vem PRIMEIRO.
  const offline = conexao === 'offline'

  return (
    <div className="mb-6">
      <div className="flex items-start gap-2 mb-1.5">
        <ScanEye className="w-5 h-5 text-accent shrink-0 mt-1" />
        <h1 className="text-[22px] sm:text-[26px] font-semibold text-ink leading-tight">
          {total === 0
            ? 'Hoje não há situações em aberto'
            : <>Hoje {total === 1 ? 'existe' : 'existem'} <span className="tabular-nums">{truncado ? 'mais de ' : ''}{num(total)}</span> {total === 1 ? 'situação importante' : 'situações importantes'}</>}
        </h1>
      </div>

      <div className="pl-7 flex items-center gap-2 flex-wrap">
        <p className="text-[12px] text-ink-muted">
          {/* O denominador só aparece quando existe de verdade. Sem ele a frase
              honesta é "em N conversas", não um percentual inventado. */}
          {varredura.conversasAnalisadas !== null
            ? <>A IA analisou <span className="tabular-nums font-medium text-ink">{num(varredura.conversasAnalisadas)}</span> conversas</>
            : <>Apontamentos em <span className="tabular-nums font-medium text-ink">{num(conversasComAchado)}</span> {conversasComAchado === 1 ? 'conversa' : 'conversas'}</>}
          {' · '}
          {semRegistro ? 'não sei quando foi a última varredura' : `última varredura ${quando}`}
          {varredura.fonte === 'achados' && ' (estimado)'}
          {varredura.rodando && ' · varrendo agora'}
          {agendadas > 0 && <> · <span className="tabular-nums">{num(agendadas)}</span> {agendadas === 1 ? 'já agendada' : 'já agendadas'}</>}
        </p>
        <button
          onClick={atualizar}
          className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> atualizar
        </button>
      </div>

      {offline ? (
        <Aviso tone="danger" icone={<WifiOff className="w-4 h-4 text-danger shrink-0 mt-px" />}>
          <span className="font-medium">Perdi a conexão com o servidor.</span>{' '}
          O que está na tela é o último retrato que consegui carregar — pode não ser o de agora.
          Isto é a <span className="font-medium">sua rede</span>, não a supervisão: não dá pra afirmar que o motor parou.
        </Aviso>
      ) : semRegistro ? (
        <Aviso tone="warning">
          <span className="font-medium">Não sei quando a IA passou por aqui.</span>{' '}
          Sem isso não dá pra afirmar que os números abaixo são de agora. Trate como estimativa
          até a varredura voltar a registrar.
        </Aviso>
      ) : velho ? (
        <Aviso tone={varredura.sinal === 'mudo' ? 'danger' : 'warning'}>
          <span className="font-medium">
            {varredura.sinal === 'mudo' ? 'A supervisão parou de varrer.' : 'Este número pode estar velho.'}
          </span>{' '}
          A última varredura foi {quando} — acima dos {AVISO_MIN} minutos esperados.
          Conversa que entrou depois disso ainda não foi lida.
          {varredura.erro && <> Último erro do motor: {varredura.erro}</>}
        </Aviso>
      ) : null}

      {!varredura.jobsAcessivel && varredura.jobsMotivo && (
        <Aviso tone="warning">
          <span className="font-medium">Não consigo ler o registro de varreduras.</span>{' '}
          A idade acima é estimada pelo carimbo dos próprios achados. {varredura.jobsMotivo}
        </Aviso>
      )}
    </div>
  )
}

function Aviso({ tone, icone, children }: {
  tone: 'warning' | 'danger'
  icone?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cn(
      'mt-3 ml-7 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5',
      tone === 'danger' ? 'border-danger/40 bg-danger-bg' : 'border-warning/40 bg-warning-bg',
    )}>
      {icone ?? <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-px', tone === 'danger' ? 'text-danger' : 'text-warning')} />}
      <p className="text-[12px] text-ink leading-relaxed">{children}</p>
    </div>
  )
}

// ─── Bloco 2: quem precisa de atenção ───────────────────────────────────────

function LinhaDoVendedor({ v }: { v: VendedorSupervisao }) {
  // O número sozinho não diz nada: "9" pode ser 9 clientes esperando resposta
  // ou 9 follow-ups que venceram ontem. SEMPRE quebrado por categoria.
  const detalhe = v.porCategoria.map(c => `${num(c.n)} ${c.rotulo}`).join(' · ')
  const desconhecido = v.nome === '—'

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-surface-2/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={cn('text-[14px] font-semibold truncate', desconhecido ? 'text-ink-muted italic' : 'text-ink')}>
            {desconhecido ? 'vendedor não identificado' : v.nome}
          </span>
          <span className="text-[14px] font-semibold text-ink tabular-nums">{num(v.total)}</span>
          <span className="text-[11px] text-ink-faint">
            em {num(v.conversasComAchado)} {v.conversasComAchado === 1 ? 'conversa' : 'conversas'}
          </span>
        </div>
        <p className="text-[12px] text-ink-muted mt-0.5 truncate" title={detalhe}>{detalhe}</p>
      </div>

      <Link
        to={`/supervisao/vendedor/${v.vendedorId}`}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 h-7 text-[12px] font-medium text-ink-muted hover:text-ink hover:border-border-strong transition-colors"
      >
        abrir <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  )
}

// ─── Bloco 3: principais situações do dia ───────────────────────────────────

function LinhaDaSituacao({ a }: { a: SupervisaoAchadoDetalhe }) {
  const cor = COR_SEVERIDADE[a.severidade] ?? { ponto: 'bg-ink-faint', texto: 'text-ink-muted', borda: 'border-l-border-strong' }
  const conf = Math.round(Number(a.confianca) * 100)

  return (
    <div className={cn('border-l-2 pl-3.5 pr-4 py-3 border-b border-border last:border-b-0', cor.borda)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink leading-snug">{a.titulo}</p>
        <span className="shrink-0 text-[11px] text-ink-faint tabular-nums" title="Score do achado">
          {Number(a.score).toFixed(0)}
        </span>
      </div>

      {/* O porquê. Sem isto o gestor lê uma frase e não sabe se pode confiar. */}
      {a.score_motivo && (
        <p className="text-[12px] text-ink-muted mt-1 leading-relaxed">{a.score_motivo}</p>
      )}

      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ink-faint flex-wrap">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', cor.ponto)} />
        <span className={cor.texto}>{ROTULO_SEVERIDADE[a.severidade] ?? a.severidade}</span>
        <span>·</span>
        <Link
          to={`/supervisao/vendedor/${a.vendedor_id}`}
          className="truncate max-w-[10rem] hover:text-ink transition-colors"
        >
          {a.vendedorNome === '—' ? 'vendedor não identificado' : a.vendedorNome}
        </Link>
        <span>·</span>
        <span>{a.camada}</span>
        <span>·</span>
        <span>{conf}% de confiança</span>
        {a.qtd_evidencias > 0 && (
          <><span>·</span><span>{a.qtd_evidencias} {a.qtd_evidencias === 1 ? 'evidência' : 'evidências'}</span></>
        )}
      </div>
    </div>
  )
}

// ─── Bloco 4: o campo que ainda não funciona ────────────────────────────────

function PergunteAIa() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[13px] font-semibold text-ink">Pergunte à IA</h2>
        <span className="text-[10px] uppercase tracking-wider text-ink-faint border border-border rounded px-1.5 py-0.5">
          em breve
        </span>
      </div>
      <div className="relative">
        <Sparkles className="w-4 h-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          disabled
          placeholder="Ex.: quem não respondeu nenhum cliente hoje?"
          className="w-full h-10 pl-9 pr-3 rounded-md bg-surface-2 border border-border text-[13px] text-ink placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>
      <p className="text-[11px] text-ink-faint mt-1.5">
        O campo ainda não responde. Entra numa próxima etapa.
      </p>
    </section>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────

export function Supervisao() {
  const resumo = useSupervisaoResumo()
  const vendedores = useSupervisaoPorVendedor()
  // Já vem ordenado por score desc com desempate estável pelo hook.
  const top = useSupervisaoAchados({ limite: 8 })

  const carregando = resumo.carregando || vendedores.carregando
  const erro = resumo.erro ?? vendedores.erro
  const r = resumo.dados

  function atualizarTudo() {
    resumo.atualizar()
    vendedores.atualizar()
    top.atualizar()
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {carregando ? (
          <PageLoading />
        ) : erro ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-[13px] text-danger">
            Não consegui carregar a supervisão: {erro.message ?? 'falha de rede'}
          </div>
        ) : (
          <>
            <Cabecalho
              total={r?.total ?? 0}
              agendadas={r?.agendadas ?? 0}
              truncado={r?.truncado ?? false}
              conversasComAchado={r?.conversasComAchado ?? 0}
              varredura={resumo.varredura}
              conexao={resumo.conexao}
              atualizar={atualizarTudo}
            />

            {(r?.total ?? 0) === 0 ? (
              // Vazio de verdade ≠ tela em branco. Mas também não é elogio: pode
              // ser que a varredura não tenha rodado — o aviso do topo cobre isso.
              <div className="rounded-lg border border-border bg-surface px-5 py-8 text-center">
                <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-2" />
                <p className="text-[14px] font-medium text-ink">Nenhuma situação em aberto</p>
                <p className="text-[12px] text-ink-muted mt-1 max-w-md mx-auto leading-relaxed">
                  A IA leu as conversas e não encontrou nada esperando ação. Se a última varredura
                  estiver velha, confira antes de comemorar.
                </p>
              </div>
            ) : (
              <div className="space-y-7">
                {/* ─── 2. quem precisa de atenção ─── */}
                <section>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h2 className="text-[13px] font-semibold text-ink">Quem precisa de atenção</h2>
                    <span className="text-[11px] text-ink-faint">
                      {vendedores.dados?.length ?? 0} {(vendedores.dados?.length ?? 0) === 1 ? 'vendedor' : 'vendedores'} · ordenado por volume
                    </span>
                  </div>
                  <div className="rounded-lg border border-border bg-surface overflow-hidden">
                    {(vendedores.dados ?? []).map(v => (
                      <LinhaDoVendedor key={v.vendedorId} v={v} />
                    ))}
                  </div>
                </section>

                {/* ─── 3. principais situações do dia ─── */}
                <section>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h2 className="text-[13px] font-semibold text-ink">Principais situações do dia</h2>
                    <span className="text-[11px] text-ink-faint">
                      {top.dados?.itens.length ?? 0} de {num(r?.total ?? 0)} · maior score primeiro
                    </span>
                  </div>
                  <div className="rounded-lg border border-border bg-surface overflow-hidden">
                    {top.carregando ? (
                      <div className="px-4 py-6 text-[12px] text-ink-muted text-center">carregando…</div>
                    ) : top.erro ? (
                      <div className="px-4 py-6 text-[12px] text-danger text-center">
                        Não consegui carregar as situações: {top.erro.message}
                      </div>
                    ) : (
                      (top.dados?.itens ?? []).map(a => <LinhaDaSituacao key={a.id} a={a} />)
                    )}
                  </div>
                </section>

                {/* ─── 4. pergunte à IA ─── */}
                <PergunteAIa />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
