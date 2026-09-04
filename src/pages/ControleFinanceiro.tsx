import { useState, useMemo, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  useControleFinanceiro, useControleFinanceiroPedido, useAcaoFinanceiro, lerArquivo, FinanceiroErro,
  LIMITE_UPLOAD_BYTES,
  type PedidoFinanceiro, type StatusPedido, type StatusParcela, type Parcela, type Recebimento,
  type ArquivoUpload, type ResumoVendedor, type EventoAuditoria, type EtapaFabrica, type Kpis,
} from '@/hooks/useControleFinanceiro'
import {
  Wallet, TrendingDown, CheckCircle2, Search, AlertTriangle, FileWarning,
  CalendarClock, X, Paperclip, Receipt, ShieldAlert, Clock, Upload, Send,
  ThumbsUp, ThumbsDown, History, Users, Plus, Loader2, Pencil, Trash2, Undo2,
  Factory, Truck, PackageCheck, HelpCircle, Camera, Archive, HandCoins,
} from 'lucide-react'

const PAGE_SIZE = 60

type Atalho = 'todos' | 'vencidos' | 'receber' | 'quitados' | 'sem_comprovante'
  | 'a_conferir' | 'boleto_pendente' | 'sem_plano' | 'divergente'
  | 'falta_lancar' | 'na_fabrica' | 'carregado_devendo' | 'regularizar'

function brl(v: number, casas = 0): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: casas })
}
function dataBR(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : '—'
}
function dataHoraBR(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── vocabulário visual (item 15) ─────────────────────────────────────────────

const PEDIDO_ROTULO: Record<StatusPedido, string> = {
  QUITADO: 'Quitado', EM_DIA: 'Em dia', PARCIAL: 'Pagamento parcial',
  AGUARDANDO_CONFERENCIA: 'Aguardando conferência',
  VENCIDO: 'Com parcela vencida', SEM_PLANO: 'Sem condição de pagamento', CANCELADO: 'Cancelado',
  REGULARIZADO: 'Regularizado (histórico)',
}
const PEDIDO_COR: Record<StatusPedido, string> = {
  QUITADO: 'bg-success-bg text-success',
  EM_DIA: 'bg-info-bg text-info',
  PARCIAL: 'bg-warning-bg text-warning',
  AGUARDANDO_CONFERENCIA: 'bg-warning-bg text-warning',
  VENCIDO: 'bg-danger-bg text-danger',
  SEM_PLANO: 'bg-surface-2 text-text-muted',
  CANCELADO: 'bg-surface-2 text-text-muted',
  REGULARIZADO: 'bg-surface-2 text-text-secondary',
}

// ── fábrica: onde o equipamento está ────────────────────────────────────────
// Vem do kanban do Controle de Produção. O financeiro só LÊ — quem move o card
// é a produção. O que o vendedor marca aqui é outra coisa: a entrega ao cliente.

const FABRICA_ROTULO: Record<EtapaFabrica, string> = {
  ANTES_DO_CHAO: 'Em projeto',
  FABRICANDO: 'Em fabricação',
  PRONTO: 'Pronto, esperando sair',
  CARREGADO: 'Já carregou',
  CANCELADO: 'Produção cancelada',
  SEM_CARD: 'Sem card',
}
const FABRICA_COR: Record<EtapaFabrica, string> = {
  ANTES_DO_CHAO: 'bg-surface-2 text-text-secondary',
  FABRICANDO: 'bg-info-bg text-info',
  PRONTO: 'bg-warning-bg text-warning',
  CARREGADO: 'bg-success-bg text-success',
  CANCELADO: 'bg-surface-2 text-text-muted',
  SEM_CARD: 'bg-surface-2 text-text-muted',
}
const FABRICA_ICONE: Record<EtapaFabrica, typeof Wallet> = {
  ANTES_DO_CHAO: Factory, FABRICANDO: Factory, PRONTO: Archive,
  CARREGADO: Truck, CANCELADO: X, SEM_CARD: HelpCircle,
}

/**
 * Pedido regularizado (ou cancelado) guarda o valor que devia antes da baixa.
 * Mostrar isso em vermelho encheu a tela de cobrança que já foi resolvida — no
 * dia do mutirão eram R$ 10,1 mi de vermelho em 313 pedidos. Aqui o número
 * some de vista, mas continua no title pra quem precisar conferir.
 */
function resolvido(r: { status: StatusPedido }): boolean {
  return r.status === 'REGULARIZADO' || r.status === 'CANCELADO'
}

function EtiquetaFabrica({ etapa, desde }: { etapa: EtapaFabrica; desde: string | null }) {
  const Icone = FABRICA_ICONE[etapa]
  const dica = etapa === 'SEM_CARD'
    ? 'Este pedido não tem card no Controle de Produção — não dá pra saber onde está.'
    : `Etapa no Controle de Produção${desde ? ` desde ${dataBR(desde)}` : ''}`
  return (
    <Badge className={FABRICA_COR[etapa]} title={dica}>
      <Icone className="h-3 w-3" /> {FABRICA_ROTULO[etapa]}
    </Badge>
  )
}
const PARCELA_ROTULO: Record<StatusParcela, string> = {
  PAGO: 'Pago', AGUARDANDO_CONFERENCIA: 'Aguardando conferência',
  AGUARDANDO_COMPROVANTE: 'Aguardando comprovante', PARCIAL: 'Parcial',
  VENCIDO: 'Vencido', VENCE_HOJE: 'Vence hoje', BOLETO_ENVIADO: 'Boleto enviado',
  PENDENTE: 'Pendente', CANCELADA: 'Cancelada',
}
const PARCELA_COR: Record<StatusParcela, string> = {
  PAGO: 'bg-success-bg text-success',
  AGUARDANDO_CONFERENCIA: 'bg-warning-bg text-warning',
  AGUARDANDO_COMPROVANTE: 'bg-warning-bg text-warning',
  PARCIAL: 'bg-warning-bg text-warning',
  VENCIDO: 'bg-danger-bg text-danger',
  VENCE_HOJE: 'bg-warning-bg text-warning',
  BOLETO_ENVIADO: 'bg-info-bg text-info',
  PENDENTE: 'bg-surface-2 text-text-muted',
  CANCELADA: 'bg-surface-2 text-text-muted',
}
const ACAO_ROTULO: Record<string, string> = {
  pagamento_lancado_com_comprovante: 'lançou um pagamento com comprovante',
  pagamento_lancado_sem_comprovante: 'lançou um pagamento sem comprovante',
  comprovante_anexado: 'anexou um comprovante',
  comprovante_aprovado: 'aprovou o comprovante',
  comprovante_rejeitado: 'rejeitou o comprovante',
  boleto_enviado: 'confirmou o envio do boleto',
  pagamento_editado: 'alterou um pagamento',
  pagamento_excluido: 'excluiu um pagamento',
  regularizacao_proposta: 'marcou como já pago e mandou pro gestor confirmar',
  regularizacao_confirmada: 'confirmou a regularização do pedido antigo',
  regularizacao_recusada: 'recusou a regularização',
  regularizacao_desfeita: 'desfez a regularização — o pedido voltou pra cobrança',
  entrega_confirmada: 'confirmou que o cliente recebeu',
}

/** Filtros de segundo plano — vivem atrás de "mais filtros". */
const SECUNDARIOS: {
  chave: Atalho; label: string; tone: 'danger' | 'warning' | 'info' | 'muted'
  icon: typeof Wallet; n: (k: Kpis, faltaLancar: number) => number
}[] = [
  { chave: 'na_fabrica', label: 'ainda está na fábrica', tone: 'info', icon: Factory,
    n: k => k.pedidosNaFabrica },
  { chave: 'sem_comprovante', label: 'pagamentos sem comprovante', tone: 'warning', icon: FileWarning,
    n: k => k.pagamentosSemComprovante },
  { chave: 'a_conferir', label: 'comprovantes a conferir', tone: 'warning', icon: ShieldAlert,
    n: k => k.comprovantesAConferir },
  { chave: 'boleto_pendente', label: 'boletos a enviar', tone: 'info', icon: Send,
    n: k => k.boletosPendentes },
  { chave: 'sem_plano', label: 'sem condição de pagamento', tone: 'muted', icon: FileWarning,
    n: k => k.pedidosSemPlano },
  { chave: 'divergente', label: 'plano ≠ valor do pedido', tone: 'warning', icon: AlertTriangle,
    n: k => k.planosDivergentes },
]

const ACEITA = '.pdf,.jpg,.jpeg,.png,.webp'
const MIMES_OK = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']

// ── blocos ───────────────────────────────────────────────────────────────────

function Botao({ children, onClick, tone = 'neutro', disabled, tipo = 'button', title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; tipo?: 'button' | 'submit'
  tone?: 'neutro' | 'accent' | 'danger' | 'success'; title?: string
}) {
  const cores = {
    neutro: 'border-border text-text-secondary hover:bg-surface-2',
    accent: 'border-accent/40 bg-accent text-white hover:brightness-110',
    danger: 'border-danger/40 text-danger hover:bg-danger-bg',
    success: 'border-success/40 text-success hover:bg-success-bg',
  }[tone]
  return (
    <button type={tipo} onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cores}`}>
      {children}
    </button>
  )
}

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label={titulo}
        className="relative w-full max-w-md rounded-lg border border-border bg-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-text-primary">{titulo}</h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-text-muted hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

/**
 * Comprovante: da câmera, do arquivo, ou colado (Ctrl+V do print do PIX).
 *
 * Foto de celular passa de 4 MB fácil e a Vercel corta o corpo em 4,5 MB — por
 * isso `lerArquivo` reduz a imagem no navegador antes de enviar. O aviso de
 * tamanho só aparece para o que não dá pra reduzir (PDF).
 */
function EscolherArquivo({ arquivo, onArquivo, obrigatorio }: {
  arquivo: ArquivoUpload | null; onArquivo: (a: ArquivoUpload | null) => void; obrigatorio?: boolean
}) {
  const refArquivo = useRef<HTMLInputElement>(null)
  const refCamera = useRef<HTMLInputElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)

  const aceitar = async (f: File | null | undefined) => {
    if (!f) return
    setErro(null)
    if (!MIMES_OK.includes(f.type)) { setErro('Formato não aceito. Use PDF, JPG, PNG ou WEBP.'); return }
    setLendo(true)
    try {
      const lido = await lerArquivo(f)
      // A imagem já veio reduzida daqui; se ainda está grande, é PDF.
      const bytes = Math.floor(lido.base64.length * 0.75)
      if (bytes > LIMITE_UPLOAD_BYTES) {
        setErro('Esse arquivo é grande demais para enviar. Se for PDF, mande um menor; se for foto, tire de novo.')
        return
      }
      onArquivo(lido)
    } catch (x) {
      setErro((x as Error).message)
    } finally {
      setLendo(false)
    }
  }

  // Colar print direto do WhatsApp/banco. Ouve na janela porque o modal não tem
  // um campo de texto focado quando o vendedor dá Ctrl+V.
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))
      if (item) { e.preventDefault(); void aceitar(item.getAsFile()) }
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [])

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-secondary">
        Comprovante {obrigatorio ? '' : '(opcional)'} — foto, PDF ou print colado com Ctrl+V
      </label>
      <input ref={refArquivo} type="file" accept={ACEITA} className="hidden"
        onChange={e => void aceitar(e.target.files?.[0])} />
      <input ref={refCamera} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => void aceitar(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={() => refCamera.current?.click()} disabled={lendo}>
          <Camera className="h-3.5 w-3.5" /> Tirar foto
        </Botao>
        <Botao onClick={() => refArquivo.current?.click()} disabled={lendo}>
          {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Escolher arquivo
        </Botao>
        {arquivo && (
          <span className="flex items-center gap-1 text-xs text-text-secondary truncate">
            <Paperclip className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[180px]">{arquivo.nome}</span>
            <button onClick={() => onArquivo(null)} className="text-text-muted hover:text-danger" aria-label="Remover">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {erro && <p className="mt-1 text-xs text-danger">{erro}</p>}
    </div>
  )
}

function KpiCard({ title, value, sub, icon: Icon, tone }: {
  title: string; value: string; sub?: string; icon: typeof Wallet; tone?: 'accent' | 'danger' | 'warning'
}) {
  const cor = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning'
    : tone === 'accent' ? 'text-accent' : 'text-text-primary'
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{title}</span>
        <Icon className={`h-4 w-4 ${tone ? cor : 'text-text-muted'}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${cor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-text-muted">{sub}</p>}
    </Card>
  )
}

function ChipPendencia({ n, label, ativo, onClick, icon: Icon, tone }: {
  n: number; label: string; ativo: boolean; onClick: () => void; icon: typeof Wallet
  tone: 'danger' | 'warning' | 'info' | 'muted'
}) {
  const cores = {
    danger: 'text-danger border-danger/30 bg-danger-bg',
    warning: 'text-warning border-warning/30 bg-warning-bg',
    info: 'text-info border-info/30 bg-info-bg',
    muted: 'text-text-muted border-border bg-surface-2',
  }[tone]
  return (
    <button onClick={onClick} aria-pressed={ativo}
      className={`flex items-center gap-2 rounded-md border px-3 h-9 text-xs font-medium transition-all
        ${cores} ${ativo ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : 'hover:brightness-110'}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="tabular-nums font-bold">{n}</span>
      <span className="font-normal opacity-90">{label}</span>
    </button>
  )
}

// ── recebimento (com conferência) ────────────────────────────────────────────

function LinhaRecebimento({ r, gestor, orderId, onErro }: {
  r: Recebimento; gestor: boolean; orderId: string; onErro: (m: string) => void
}) {
  const acao = useAcaoFinanceiro()
  const [rejeitando, setRejeitando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [anexando, setAnexando] = useState(false)
  const [arq, setArq] = useState<ArquivoUpload | null>(null)
  const [editando, setEditando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [eValor, setEValor] = useState('')
  const [eData, setEData] = useState('')
  const [eMeio, setEMeio] = useState('PIX')
  const [eObs, setEObs] = useState('')
  const [justificativa, setJustificativa] = useState('')

  // Espelha a trava do servidor (podeAlterarRecebimento): pagamento já aprovado
  // é do gestor. Aqui é só cortesia visual — quem barra de verdade é o endpoint.
  const podeMexer = gestor || r.conferencia !== 'APROVADO'
  const exigeJustificativa = r.conferencia === 'APROVADO'

  const abrirEdicao = () => {
    setEValor(String(r.valor.toFixed(2)))
    setEData(r.pagoEm.slice(0, 10))
    setEMeio(r.meio)
    setEObs(r.observacao || '')
    setJustificativa('')
    setEditando(true)
  }

  const conferir = (status: 'APROVADO' | 'REJEITADO', just?: string) =>
    acao.mutate({ acao: 'conferir', order_id: orderId, receipt_id: r.id, status, motivo: just },
      { onError: e => onErro((e as FinanceiroErro).message), onSuccess: () => setRejeitando(false) })

  const cor = r.conferencia === 'APROVADO' ? 'bg-success-bg text-success'
    : r.conferencia === 'REJEITADO' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'
  const rotulo = r.conferencia === 'APROVADO' ? 'aprovado'
    : r.conferencia === 'REJEITADO' ? 'rejeitado' : 'aguardando conferência'

  return (
    <div className="rounded border border-border/60 bg-surface-2/40 p-2">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <Receipt className="h-3 w-3 text-text-muted shrink-0" />
        <span className="tabular-nums font-medium text-text-secondary">{brl(r.valor, 2)}</span>
        <span className="text-text-muted">· {r.meio} · {dataBR(r.pagoEm)}</span>
        <Badge className={cor}>{rotulo}</Badge>
        {r.comprovanteUrl ? (
          <a href={r.comprovanteUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
            <Paperclip className="h-3 w-3" /> ver comprovante
          </a>
        ) : (
          <span className="ml-auto text-warning">sem comprovante</span>
        )}
      </div>

      {r.observacao && <p className="mt-1 text-xs text-text-muted">{r.observacao}</p>}
      {r.conferencia === 'REJEITADO' && r.motivoRejeicao && (
        <p className="mt-1 text-xs text-danger">Motivo: {r.motivoRejeicao}</p>
      )}
      {r.conferidoPor && r.conferencia !== 'AGUARDANDO' && (
        <p className="mt-0.5 text-[11px] text-text-muted">
          por {r.conferidoPor} em {dataHoraBR(r.conferidoEm)}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!anexando && (
          <Botao onClick={() => setAnexando(true)}>
            <Upload className="h-3.5 w-3.5" /> {r.comprovanteUrl ? 'Enviar outro' : 'Anexar comprovante'}
          </Botao>
        )}
        {!editando && !excluindo && (
          <Botao onClick={abrirEdicao} disabled={!podeMexer}
            title={podeMexer ? undefined : 'Pagamento aprovado — só o gestor edita'}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Botao>
        )}
        {!editando && !excluindo && (
          <Botao tone="danger" onClick={() => { setJustificativa(''); setExcluindo(true) }} disabled={!podeMexer}
            title={podeMexer ? undefined : 'Pagamento aprovado — só o gestor exclui'}>
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </Botao>
        )}
        {gestor && r.conferencia !== 'APROVADO' && !rejeitando && (
          <Botao tone="success" disabled={!r.comprovanteUrl || acao.isPending}
            onClick={() => conferir('APROVADO')}>
            <ThumbsUp className="h-3.5 w-3.5" /> Aprovar
          </Botao>
        )}
        {gestor && r.conferencia !== 'REJEITADO' && !rejeitando && (
          <Botao tone="danger" disabled={acao.isPending} onClick={() => setRejeitando(true)}>
            <ThumbsDown className="h-3.5 w-3.5" /> Rejeitar
          </Botao>
        )}
      </div>

      {!podeMexer && (
        <p className="mt-1 text-[11px] text-text-muted">
          Pagamento já conferido e aprovado — alterar ou excluir só pelo gestor.
        </p>
      )}

      {editando && (
        <div className="mt-2 space-y-2 rounded border border-border p-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Valor</label>
              <Input value={eValor} onChange={e => setEValor(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Data</label>
              <Input type="date" value={eData} onChange={e => setEData(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Forma</label>
            <select value={eMeio} onChange={e => setEMeio(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary">
              {['PIX', 'BOLETO', 'TRANSFERENCIA', 'CARTAO', 'DINHEIRO', 'OUTRO'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Observação</label>
            <Input value={eObs} onChange={e => setEObs(e.target.value)} />
          </div>
          {exigeJustificativa && (
            <>
              <label className="block text-xs font-medium text-text-secondary">Por que está alterando?</label>
              <Input value={justificativa} onChange={e => setJustificativa(e.target.value)}
                placeholder="Fica no histórico do pedido" />
              <p className="rounded border border-warning/30 bg-warning-bg p-2 text-[11px] text-warning">
                Este pagamento já estava aprovado. Mudar valor, data ou forma devolve ele para conferência.
              </p>
            </>
          )}
          <div className="flex gap-2">
            <Botao tone="accent" disabled={acao.isPending || !(Number(eValor.replace(',', '.')) > 0) || !eData}
              onClick={() => acao.mutate({
                acao: 'editar_pagamento', order_id: orderId, receipt_id: r.id,
                valor: Number(eValor.replace(',', '.')), pago_em: eData, meio: eMeio,
                observacao: eObs, motivo: justificativa || undefined,
              }, { onError: e => onErro((e as FinanceiroErro).message), onSuccess: () => setEditando(false) })}>
              {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Salvar
            </Botao>
            <Botao onClick={() => setEditando(false)}>Cancelar</Botao>
          </div>
        </div>
      )}

      {excluindo && (
        <div className="mt-2 space-y-2 rounded border border-danger/30 bg-danger-bg/40 p-2">
          <p className="text-xs text-danger">
            Excluir o recebimento de <strong>{brl(r.valor, 2)}</strong> de {dataBR(r.pagoEm)}? A parcela volta a ficar em aberto.
          </p>
          {r.comprovanteUrl && (
            <p className="text-[11px] text-text-muted">
              O arquivo do comprovante continua guardado no servidor — a exclusão remove o lançamento, não o anexo.
            </p>
          )}
          <Input value={justificativa} onChange={e => setJustificativa(e.target.value)}
            placeholder={exigeJustificativa ? 'Justificativa (obrigatória)' : 'Motivo (opcional, fica no histórico)'} />
          <div className="flex gap-2">
            <Botao tone="danger" disabled={acao.isPending || (exigeJustificativa && !justificativa.trim())}
              onClick={() => acao.mutate({
                acao: 'excluir_pagamento', order_id: orderId, receipt_id: r.id, motivo: justificativa.trim() || undefined,
              }, { onError: e => onErro((e as FinanceiroErro).message), onSuccess: () => setExcluindo(false) })}>
              {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Confirmar exclusão
            </Botao>
            <Botao onClick={() => setExcluindo(false)}>Cancelar</Botao>
          </div>
        </div>
      )}

      {anexando && (
        <div className="mt-2 space-y-2 rounded border border-border p-2">
          <EscolherArquivo arquivo={arq} onArquivo={setArq} obrigatorio />
          <div className="flex gap-2">
            <Botao tone="accent" disabled={!arq || acao.isPending}
              onClick={() => acao.mutate({ acao: 'anexar_comprovante', order_id: orderId, receipt_id: r.id, arquivo: arq! },
                { onError: e => onErro((e as FinanceiroErro).message), onSuccess: () => { setAnexando(false); setArq(null) } })}>
              {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Enviar
            </Botao>
            <Botao onClick={() => { setAnexando(false); setArq(null) }}>Cancelar</Botao>
          </div>
        </div>
      )}

      {rejeitando && (
        <div className="mt-2 space-y-2 rounded border border-danger/30 p-2">
          <label className="block text-xs font-medium text-text-secondary">
            Por que está rejeitando? (o vendedor vai ler isto)
          </label>
          <Input value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Ex.: imagem ilegível, valor diferente da parcela..." />
          <div className="flex flex-wrap gap-1">
            {['Imagem ilegível.', 'Valor diferente da parcela.', 'Comprovante não corresponde ao cliente.', 'Pagamento ainda não foi identificado.'].map(s => (
              <button key={s} onClick={() => setMotivo(s)}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-2">{s}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <Botao tone="danger" disabled={!motivo.trim() || acao.isPending} onClick={() => conferir('REJEITADO', motivo.trim())}>
              {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />} Confirmar rejeição
            </Botao>
            <Botao onClick={() => setRejeitando(false)}>Cancelar</Botao>
          </div>
        </div>
      )}
    </div>
  )
}

// ── parcela ──────────────────────────────────────────────────────────────────

function LinhaParcela({ p, orderId, gestor, onErro }: {
  p: Parcela; orderId: string; gestor: boolean; onErro: (m: string) => void
}) {
  const acao = useAcaoFinanceiro()
  const [modal, setModal] = useState<null | 'pagamento' | 'boleto'>(null)
  const [arq, setArq] = useState<ArquivoUpload | null>(null)
  const [valor, setValor] = useState('')
  const [pagoEm, setPagoEm] = useState('')
  const [meioPg, setMeioPg] = useState('PIX')
  const [obs, setObs] = useState('')
  const [meioBol, setMeioBol] = useState('WHATSAPP')

  const abrirPagamento = () => {
    setValor(String(p.saldo.toFixed(2)))
    setPagoEm(new Date().toISOString().slice(0, 10))
    setArq(null); setObs(''); setMeioPg('PIX'); setModal('pagamento')
  }

  return (
    <div className={`rounded-md border border-border p-3 ${p.cancelada ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-text-muted">{p.numero}/{p.totalParcelas}</span>
            <span className="text-sm font-medium text-text-primary">{p.descricao}</span>
            <Badge className={PARCELA_COR[p.status]}>{PARCELA_ROTULO[p.status]}</Badge>
            {p.boletoEnviado && p.status !== 'BOLETO_ENVIADO' && <Badge className="bg-info-bg text-info">boleto enviado</Badge>}
            {p.temRejeitado && <Badge className="bg-danger-bg text-danger">comprovante rejeitado</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-text-muted flex-wrap">
            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> vence {dataBR(p.vencimento)}</span>
            {p.diasAtraso > 0 && <span className="font-medium text-danger">{p.diasAtraso} dia{p.diasAtraso > 1 ? 's' : ''} em atraso</span>}
            {p.boletoEnviadoEm && <span>boleto em {dataBR(p.boletoEnviadoEm)}</span>}
            {p.cancelada && p.motivoCancelamento && <span>cancelada: {p.motivoCancelamento}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-text-primary">{brl(p.valor, 2)}</p>
          {p.recebido > 0.01 && <p className="text-xs tabular-nums text-success">recebido {brl(p.recebido, 2)}</p>}
          {p.saldo > 0.01 && p.recebido > 0.01 && <p className="text-xs tabular-nums text-danger">falta {brl(p.saldo, 2)}</p>}
        </div>
      </div>

      {!p.cancelada && (
        <div className="mt-2 flex flex-wrap gap-2">
          {p.saldo > 0.01 && (
            <Botao tone="accent" onClick={abrirPagamento}><Plus className="h-3.5 w-3.5" /> Lançar pagamento</Botao>
          )}
          {!p.boletoEnviado && p.saldo > 0.01 && (
            <Botao onClick={() => setModal('boleto')}><Send className="h-3.5 w-3.5" /> Confirmar envio do boleto</Botao>
          )}
        </div>
      )}

      {p.recebimentos.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          {p.recebimentos.map(r => (
            <LinhaRecebimento key={r.id} r={r} gestor={gestor} orderId={orderId} onErro={onErro} />
          ))}
        </div>
      )}

      {modal === 'pagamento' && (
        <Modal titulo={`Lançar pagamento — parcela ${p.numero}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Valor recebido</label>
                <Input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Data do recebimento</label>
                <Input type="date" value={pagoEm} onChange={e => setPagoEm(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Forma</label>
              <select value={meioPg} onChange={e => setMeioPg(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary">
                {['PIX', 'BOLETO', 'TRANSFERENCIA', 'CARTAO', 'DINHEIRO', 'OUTRO'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Observação (opcional)</label>
              <Input value={obs} onChange={e => setObs(e.target.value)} />
            </div>
            <EscolherArquivo arquivo={arq} onArquivo={setArq} />
            <p className="rounded border border-warning/30 bg-warning-bg p-2 text-[11px] text-warning">
              Lançar o valor não quita a parcela. Ela fica aguardando comprovante e conferência do gestor.
            </p>
            <div className="flex justify-end gap-2">
              <Botao onClick={() => setModal(null)}>Cancelar</Botao>
              <Botao tone="accent" disabled={acao.isPending || !(Number(valor.replace(',', '.')) > 0) || !pagoEm}
                onClick={() => acao.mutate({
                  acao: 'lancar_pagamento', order_id: orderId, installment_id: p.id,
                  valor: Number(valor.replace(',', '.')), pago_em: pagoEm, meio: meioPg,
                  observacao: obs || undefined, arquivo: arq || undefined,
                }, { onError: e => onErro((e as FinanceiroErro).message), onSuccess: () => setModal(null) })}>
                {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Lançar
              </Botao>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'boleto' && (
        <Modal titulo={`Confirmar envio do boleto — parcela ${p.numero}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <p className="text-xs text-text-muted">Vencimento {dataBR(p.vencimento)} · {brl(p.valor, 2)}</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Enviado por qual meio?</label>
              <select value={meioBol} onChange={e => setMeioBol(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary">
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">E-mail</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Observação (opcional)</label>
              <Input value={obs} onChange={e => setObs(e.target.value)} />
            </div>
            <EscolherArquivo arquivo={arq} onArquivo={setArq} />
            <p className="rounded border border-info/30 bg-info-bg p-2 text-[11px] text-info">
              Confirmar o envio não marca a parcela como paga — só registra que o boleto saiu.
            </p>
            <div className="flex justify-end gap-2">
              <Botao onClick={() => setModal(null)}>Cancelar</Botao>
              <Botao tone="accent" disabled={acao.isPending}
                onClick={() => acao.mutate({
                  acao: 'confirmar_boleto', order_id: orderId, installment_id: p.id,
                  meio: meioBol, observacao: obs || undefined, arquivo: arq || undefined,
                }, { onError: e => onErro((e as FinanceiroErro).message), onSuccess: () => setModal(null) })}>
                {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Confirmar envio
              </Botao>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── lançar pagamento direto da lista ─────────────────────────────────────────
//
// Antes só dava pra lançar abrindo o pedido, rolando até a parcela e clicando
// no modal dela — três telas antes de digitar o primeiro número. Aqui o pedido
// é carregado por baixo e a parcela em aberto mais próxima já vem escolhida e
// preenchida, que é o caso normal: o cliente pagou a que estava vencendo.

function LancarRapidoModal({ pedido, onClose, onErro }: {
  pedido: PedidoFinanceiro; onClose: () => void; onErro: (m: string) => void
}) {
  const { data, isLoading } = useControleFinanceiroPedido(pedido.id)
  const acao = useAcaoFinanceiro()
  const [parcelaId, setParcelaId] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [pagoEm, setPagoEm] = useState(() => new Date().toISOString().slice(0, 10))
  const [meio, setMeio] = useState('PIX')
  const [obs, setObs] = useState('')
  const [arq, setArq] = useState<ArquivoUpload | null>(null)
  const [tocouValor, setTocouValor] = useState(false)

  const abertas = useMemo(
    () => (data?.pedido.parcelas ?? []).filter(p => !p.cancelada && p.saldo > 0.01),
    [data],
  )

  // Sugestão: a parcela em aberto que vence primeiro (vencida ou a vencer).
  useEffect(() => {
    if (parcelaId || abertas.length === 0) return
    const alvo = [...abertas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0]
    setParcelaId(alvo.id)
    setValor(alvo.saldo.toFixed(2))
  }, [abertas, parcelaId])

  const escolhida = abertas.find(p => p.id === parcelaId) ?? null

  const trocarParcela = (id: string) => {
    setParcelaId(id)
    const p = abertas.find(x => x.id === id)
    if (p && !tocouValor) setValor(p.saldo.toFixed(2))
  }

  const semPlano = !isLoading && abertas.length === 0

  return (
    <Modal titulo={`Lançar pagamento — ${pedido.cliente || 'pedido ' + (pedido.pedidoNumero || '')}`} onClose={onClose}>
      {isLoading ? (
        <div className="py-6"><PageLoading /></div>
      ) : semPlano ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Este pedido não tem parcela em aberto para receber.
          </p>
          <p className="text-xs text-text-muted">
            Se ainda falta dinheiro, a condição de pagamento precisa ser cadastrada no
            controle.branorte.com, na tela do pedido.
          </p>
          <div className="flex justify-end"><Botao onClick={onClose}>Fechar</Botao></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Qual parcela</label>
            <select value={parcelaId ?? ''} onChange={e => trocarParcela(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary">
              {abertas.map(p => (
                <option key={p.id} value={p.id}>
                  {p.numero}/{p.totalParcelas} · vence {dataBR(p.vencimento)} · falta {brl(p.saldo, 2)}
                  {p.status === 'VENCIDO' ? ' · VENCIDA' : ''}
                </option>
              ))}
            </select>
            {escolhida?.descricao && (
              <p className="mt-1 text-xs text-text-muted">{escolhida.descricao}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Valor recebido</label>
              <Input value={valor} inputMode="decimal"
                onChange={e => { setTocouValor(true); setValor(e.target.value) }} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Data do recebimento</label>
              <Input type="date" value={pagoEm} onChange={e => setPagoEm(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Forma</label>
            <select value={meio} onChange={e => setMeio(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary">
              {['PIX', 'BOLETO', 'TRANSFERENCIA', 'CARTAO', 'DINHEIRO', 'OUTRO'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Observação (opcional)</label>
            <Input value={obs} onChange={e => setObs(e.target.value)} />
          </div>

          <EscolherArquivo arquivo={arq} onArquivo={setArq} />

          <p className="rounded border border-warning/30 bg-warning-bg p-2 text-[11px] text-warning">
            Lançar o valor não quita a parcela. Ela fica aguardando a conferência do gestor.
          </p>

          <div className="flex justify-end gap-2">
            <Botao onClick={onClose}>Cancelar</Botao>
            <Botao tone="accent"
              disabled={acao.isPending || !parcelaId || !(Number(valor.replace(',', '.')) > 0) || !pagoEm}
              onClick={() => acao.mutate({
                acao: 'lancar_pagamento', order_id: pedido.id, installment_id: parcelaId,
                valor: Number(valor.replace(',', '.')), pago_em: pagoEm, meio,
                observacao: obs || undefined, arquivo: arq || undefined,
              }, { onError: e => onErro((e as FinanceiroErro).message), onSuccess: onClose })}>
              {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Lançar
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── mutirão: pedido antigo que já foi pago fora do sistema ──────────────────

function RegularizarModal({ pedido, gestor, onClose, onErro }: {
  pedido: PedidoFinanceiro; gestor: boolean; onClose: () => void; onErro: (m: string) => void
}) {
  const acao = useAcaoFinanceiro()
  const [motivo, setMotivo] = useState('')

  const prontas = [
    'Pedido antigo, pago integralmente antes deste controle existir.',
    'Cliente pagou em dinheiro na entrega, sem comprovante guardado.',
    'Acerto feito direto com a fábrica, fora do sistema.',
  ]

  return (
    <Modal titulo="Marcar como já pago" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded border border-border bg-surface-2 p-2 text-xs text-text-secondary">
          <p className="font-medium text-text-primary">{pedido.cliente || '(sem nome)'}</p>
          <p className="mt-0.5">
            Pedido {pedido.pedidoNumero || '—'} · venda em {dataBR(pedido.dataVenda)} · {brl(pedido.valorTotal)}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            O que aconteceu com esse pedido?
          </label>
          <Input value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Fica no histórico, com seu nome e a data" />
          <div className="mt-1 flex flex-wrap gap-1">
            {prontas.map(s => (
              <button key={s} onClick={() => setMotivo(s)}
                className="rounded border border-border px-2 py-0.5 text-left text-[11px] text-text-muted hover:bg-surface-2">
                {s}
              </button>
            ))}
          </div>
        </div>

        <p className={`rounded border p-2 text-[11px] ${gestor
          ? 'border-warning/30 bg-warning-bg text-warning'
          : 'border-info/30 bg-info-bg text-info'}`}>
          {gestor
            ? 'Como gestor, isso já vale na hora: o pedido sai da cobrança e fica marcado como regularizado — separado do dinheiro que tem comprovante.'
            : 'Isso não some com a dívida sozinho: vai para o gestor confirmar. Enquanto isso o pedido fica marcado como esperando confirmação.'}
        </p>

        <div className="flex justify-end gap-2">
          <Botao onClick={onClose}>Cancelar</Botao>
          <Botao tone="accent" disabled={acao.isPending || motivo.trim().length < 5}
            onClick={() => acao.mutate({ acao: 'propor_regularizacao', order_id: pedido.id, motivo: motivo.trim() },
              { onError: e => onErro((e as FinanceiroErro).message), onSuccess: onClose })}>
            {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandCoins className="h-3.5 w-3.5" />}
            {gestor ? 'Regularizar' : 'Mandar pro gestor'}
          </Botao>
        </div>
      </div>
    </Modal>
  )
}

// ── o elo que faltava: o cliente recebeu ────────────────────────────────────

function ConfirmarEntregaModal({ pedido, onClose, onErro }: {
  pedido: PedidoFinanceiro; onClose: () => void; onErro: (m: string) => void
}) {
  const acao = useAcaoFinanceiro()
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [obs, setObs] = useState('')

  return (
    <Modal titulo="Cliente recebeu o equipamento" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          A produção marca quando o equipamento <b>saiu da fábrica</b>. Quem sabe quando ele
          <b> chegou no cliente</b> é o senhor.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Data em que o cliente recebeu</label>
          <Input type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Observação (opcional)</label>
          <Input value={obs} onChange={e => setObs(e.target.value)}
            placeholder="Ex.: recebido pelo filho, faltou o painel..." />
        </div>
        <div className="flex justify-end gap-2">
          <Botao onClick={onClose}>Cancelar</Botao>
          <Botao tone="accent" disabled={acao.isPending || !data}
            onClick={() => acao.mutate({ acao: 'confirmar_entrega', order_id: pedido.id, entregue_em: data, observacao: obs || undefined },
              { onError: e => onErro((e as FinanceiroErro).message), onSuccess: onClose })}>
            {acao.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />} Confirmar
          </Botao>
        </div>
      </div>
    </Modal>
  )
}

// ── painel do pedido ─────────────────────────────────────────────────────────

function LinhaDoTempo({ eventos }: { eventos: EventoAuditoria[] }) {
  if (eventos.length === 0) {
    return <p className="text-xs text-text-muted">Nenhuma ação registrada ainda neste pedido.</p>
  }
  return (
    <ol className="space-y-2">
      {eventos.map(e => (
        <li key={e.id} className="flex gap-2 text-xs">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <div>
            <span className="text-text-muted">{dataHoraBR(e.created_at)} — </span>
            <span className="font-medium text-text-primary">{e.ator_nome || 'Alguém'}</span>{' '}
            <span className="text-text-secondary">{ACAO_ROTULO[e.acao] || e.acao}</span>
            {e.motivo && <span className="text-text-muted"> — {e.motivo}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function PainelPedido({ pedidoId, onClose }: { pedidoId: string; onClose: () => void }) {
  const { data, isLoading, error } = useControleFinanceiroPedido(pedidoId)
  const acaoPedido = useAcaoFinanceiro()
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)
  const [lancando, setLancando] = useState(false)
  const [regularizando, setRegularizando] = useState(false)
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(false)
  const [motivoRecusaReg, setMotivoRecusaReg] = useState('')
  const [motivoDesfazer, setMotivoDesfazer] = useState('')
  const p = data?.pedido
  const gestor = !!data?.escopo.gestor

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Detalhe financeiro do pedido"
        className="relative w-full max-w-2xl overflow-y-auto border-l border-border bg-bg">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-sm text-text-muted">{p?.pedidoNumero || '...'}</p>
            <h2 className="truncate text-lg font-bold text-text-primary">{p?.cliente || 'Carregando…'}</h2>
            {p && <p className="mt-0.5 text-xs text-text-muted">{p.vendedor} · venda em {dataBR(p.dataVenda)}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {isLoading && <PageLoading />}
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              {error instanceof FinanceiroErro ? error.message : 'Falha ao carregar o pedido.'}
            </div>
          )}
          {erroAcao && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">{erroAcao}</div>
              <button onClick={() => setErroAcao(null)} aria-label="Fechar aviso"><X className="h-4 w-4" /></button>
            </div>
          )}

          {p && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-[11px] uppercase tracking-wider text-text-muted">Valor do pedido</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">{brl(p.valorTotal)}</p></div>
                <div><p className="text-[11px] uppercase tracking-wider text-text-muted">Recebido</p>
                  <p className="text-lg font-bold tabular-nums text-success">{brl(p.recebido)}</p></div>
                <div><p className="text-[11px] uppercase tracking-wider text-text-muted">A receber</p>
                  <p className="text-lg font-bold tabular-nums text-danger">{brl(p.aReceber)}</p></div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge className={PEDIDO_COR[p.status]}>{PEDIDO_ROTULO[p.status]}</Badge>
                <EtiquetaFabrica etapa={p.producao.etapa} desde={p.producao.desde} />
                {p.entrega && (
                  <Badge className="bg-success-bg text-success" title={p.entrega.observacao || undefined}>
                    <PackageCheck className="h-3 w-3" /> cliente recebeu em {dataBR(p.entrega.entregueEm)}
                  </Badge>
                )}
                {p.proximoVencimento && (
                  <Badge className="bg-surface-2 text-text-secondary">próximo vencimento {dataBR(p.proximoVencimento)}</Badge>
                )}
                <button onClick={() => setVerHistorico(v => !v)}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  <History className="h-3.5 w-3.5" /> {verHistorico ? 'ocultar' : 'ver'} histórico
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {p.aReceber > 0.01 && p.status !== 'REGULARIZADO' && (
                  <Botao tone="accent" onClick={() => setLancando(true)}>
                    <Plus className="h-3.5 w-3.5" /> Lançar pagamento
                  </Botao>
                )}
                {!p.entrega && (
                  <Botao onClick={() => setConfirmandoEntrega(true)}>
                    <PackageCheck className="h-3.5 w-3.5" /> Cliente recebeu
                  </Botao>
                )}
                {p.aReceber > 0.01 && !p.regularizacao && p.status !== 'REGULARIZADO' && (
                  <Botao onClick={() => setRegularizando(true)}
                    title="Pedido antigo que já foi pago fora do sistema">
                    <HandCoins className="h-3.5 w-3.5" /> Já foi pago, é histórico
                  </Botao>
                )}
              </div>

              {p.regularizacao && (
                <div className={`rounded-md border p-3 ${p.regularizacao.status === 'PROPOSTA'
                  ? 'border-warning/30 bg-warning-bg'
                  : p.regularizacao.status === 'RECUSADA'
                    ? 'border-danger/30 bg-danger-bg'
                    : 'border-border bg-surface-2'}`}>
                  <p className={`text-xs font-semibold ${p.regularizacao.status === 'PROPOSTA' ? 'text-warning'
                    : p.regularizacao.status === 'RECUSADA' ? 'text-danger' : 'text-text-primary'}`}>
                    {p.regularizacao.status === 'PROPOSTA' ? 'Esperando o gestor confirmar que já foi pago'
                      : p.regularizacao.status === 'RECUSADA' ? 'Regularização recusada — o pedido continua em aberto'
                        : 'Pedido regularizado — dado como pago sem comprovante'}
                  </p>
                  {p.regularizacao.motivo && (
                    <p className="mt-1 text-xs text-text-secondary">{p.regularizacao.motivo}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    proposto por {p.regularizacao.propostoPor || 'alguém'} em {dataHoraBR(p.regularizacao.propostoEm)}
                    {p.regularizacao.decididoPor && ` · decidido por ${p.regularizacao.decididoPor} em ${dataHoraBR(p.regularizacao.decididoEm)}`}
                  </p>
                  {p.regularizacao.motivoRecusa && (
                    <p className="mt-1 text-xs text-danger">Motivo da recusa: {p.regularizacao.motivoRecusa}</p>
                  )}
                  {gestor && p.regularizacao.status === 'CONFIRMADA' && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input value={motivoDesfazer} onChange={e => setMotivoDesfazer(e.target.value)}
                        placeholder="Por que está voltando pra cobrança?" className="h-8 max-w-[280px] text-xs" />
                      <Botao tone="danger" disabled={acaoPedido.isPending || !motivoDesfazer.trim()}
                        onClick={() => acaoPedido.mutate({
                          acao: 'desfazer_regularizacao', order_id: p.id, motivo: motivoDesfazer.trim(),
                        }, { onError: e => setErroAcao((e as FinanceiroErro).message), onSuccess: () => setMotivoDesfazer('') })}>
                        {acaoPedido.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                        Isso não estava pago
                      </Botao>
                    </div>
                  )}
                  {gestor && p.regularizacao.status === 'PROPOSTA' && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Botao tone="success" disabled={acaoPedido.isPending}
                        onClick={() => acaoPedido.mutate({ acao: 'decidir_regularizacao', order_id: p.id, status: 'CONFIRMADA' },
                          { onError: e => setErroAcao((e as FinanceiroErro).message) })}>
                        <ThumbsUp className="h-3.5 w-3.5" /> Confirmar
                      </Botao>
                      <Input value={motivoRecusaReg} onChange={e => setMotivoRecusaReg(e.target.value)}
                        placeholder="Motivo, se for recusar" className="h-8 max-w-[240px] text-xs" />
                      <Botao tone="danger" disabled={acaoPedido.isPending || !motivoRecusaReg.trim()}
                        onClick={() => acaoPedido.mutate({
                          acao: 'decidir_regularizacao', order_id: p.id, status: 'RECUSADA', motivo: motivoRecusaReg.trim(),
                        }, { onError: e => setErroAcao((e as FinanceiroErro).message), onSuccess: () => setMotivoRecusaReg('') })}>
                        <ThumbsDown className="h-3.5 w-3.5" /> Recusar
                      </Botao>
                    </div>
                  )}
                </div>
              )}

              {verHistorico && (
                <Card className="p-3"><LinhaDoTempo eventos={data.historico} /></Card>
              )}

              {Math.abs(p.divergenciaPlano) > 0.01 && (
                <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-bg p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="text-xs text-warning">
                    <p className="font-semibold">A soma da condição de pagamento está diferente do valor total do pedido.</p>
                    <p className="mt-1 opacity-90">
                      Parcelas somam <strong>{brl(p.somaParcelas)}</strong> e o pedido vale <strong>{brl(p.valorTotal)}</strong> —
                      diferença de <strong>{brl(Math.abs(p.divergenciaPlano))}</strong>{p.divergenciaPlano > 0 ? ' a mais' : ' a menos'}.
                    </p>
                  </div>
                </div>
              )}

              {p.parcelas.length === 0 ? (
                <div className="rounded-md border border-border bg-surface-2 p-4 text-center">
                  <FileWarning className="mx-auto h-5 w-5 text-text-muted" />
                  <p className="mt-2 text-sm text-text-secondary">Este pedido não tem condição de pagamento cadastrada.</p>
                  <p className="mt-1 text-xs text-text-muted">
                    As parcelas são criadas no controle.branorte.com, na tela do pedido.
                  </p>
                </div>
              ) : (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Parcelas ({p.parcelas.length})
                  </h3>
                  <div className="space-y-2">
                    {p.parcelas.map(pc => (
                      <LinhaParcela key={pc.id} p={pc} orderId={p.id} gestor={gestor} onErro={setErroAcao} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {p && lancando && (
          <LancarRapidoModal pedido={p} onClose={() => setLancando(false)} onErro={setErroAcao} />
        )}
        {p && regularizando && (
          <RegularizarModal pedido={p} gestor={gestor} onClose={() => setRegularizando(false)} onErro={setErroAcao} />
        )}
        {p && confirmandoEntrega && (
          <ConfirmarEntregaModal pedido={p} onClose={() => setConfirmandoEntrega(false)} onErro={setErroAcao} />
        )}
      </aside>
    </div>
  )
}

// ── visão do gestor por vendedor (item 10) ───────────────────────────────────

function PorVendedor({ linhas, onEscolher }: { linhas: ResumoVendedor[]; onEscolher: (v: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              {['Vendedor', 'Pedidos', 'Vendido', 'Recebido', 'Carregou e deve', 'Nada lançado', 'A receber', 'Vencido', 'S/ compr.', 'A conferir', 'Boletos', 'S/ plano'].map((h, i) => (
                <th key={h} className={`px-3 py-2.5 text-xs font-medium text-text-muted ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map(v => (
              <tr key={v.vendedor} onClick={() => onEscolher(v.vendedor)}
                className="cursor-pointer transition-colors hover:bg-surface-2/60">
                <td className="px-3 py-2.5 text-sm font-medium text-text-primary">{v.vendedor}</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-text-secondary">{v.pedidos}</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-text-primary">{brl(v.vendido)}</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-success">{brl(v.recebido)}</td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.carregadoAReceber > 0.01 ? 'font-semibold text-danger' : 'text-text-muted'}`}
                  title="equipamento já saiu da fábrica e o cliente ainda deve">
                  {v.carregadoAReceber > 0.01 ? brl(v.carregadoAReceber) : '—'}
                </td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.semLancamento ? 'text-warning' : 'text-text-muted'}`}
                  title="pedidos sem nenhum pagamento registrado">
                  {v.semLancamento || '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-text-primary">{brl(v.aReceber)}</td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.vencido > 0.01 ? 'font-semibold text-danger' : 'text-text-muted'}`}>
                  {v.vencido > 0.01 ? brl(v.vencido) : '—'}
                </td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.semComprovante ? 'text-warning' : 'text-text-muted'}`}>{v.semComprovante || '—'}</td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.aConferir ? 'text-warning' : 'text-text-muted'}`}>{v.aConferir || '—'}</td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.boletosPendentes ? 'text-info' : 'text-text-muted'}`}>{v.boletosPendentes || '—'}</td>
                <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${v.semPlano ? 'text-warning' : 'text-text-muted'}`}>{v.semPlano || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── página ───────────────────────────────────────────────────────────────────

export function ControleFinanceiro() {
  const { data, isLoading, error } = useControleFinanceiro()
  // O vendedor abre na fila DELE (o que falta registrar); o gestor abre na
  // cobrança. Antes todo mundo caía em "vencidos" — tela de bronca pra quem
  // entrou pra alimentar.
  const [atalho, setAtalho] = useState<Atalho | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [aberto, setAberto] = useState<string | null>(null)
  const [lancandoNa, setLancandoNa] = useState<PedidoFinanceiro | null>(null)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [aba, setAba] = useState<'pedidos' | 'vendedores'>('pedidos')
  const [ocultarCarregados, setOcultarCarregados] = useState(false)
  const [maisFiltros, setMaisFiltros] = useState(false)

  const gestor = !!data?.escopo.gestor
  const escopado = data?.escopo.vendedores != null
  const atual: Atalho = atalho ?? (escopado ? 'falta_lancar' : 'vencidos')

  const filtra = (r: PedidoFinanceiro): boolean => {
    switch (atual) {
      case 'vencidos': return r.vencido > 0.01
      case 'receber': return r.aReceber > 0.01 && r.status !== 'CANCELADO' && r.status !== 'REGULARIZADO'
      case 'quitados': return r.status === 'QUITADO'
      case 'sem_comprovante': return r.pagamentosSemComprovante > 0
      case 'a_conferir': return r.comprovantesAConferir > 0
      case 'boleto_pendente': return r.boletosPendentes > 0
      case 'sem_plano': return r.status === 'SEM_PLANO'
      case 'divergente': return Math.abs(r.divergenciaPlano) > 0.01
      // fila de quem alimenta: nada lançado e ainda tem saldo
      case 'falta_lancar': return r.semLancamento && r.aReceber > 0.01 && r.status !== 'CANCELADO'
      case 'na_fabrica':
        return ['ANTES_DO_CHAO', 'FABRICANDO', 'PRONTO'].includes(r.producao.etapa)
          && r.aReceber > 0.01 && r.status !== 'CANCELADO'
      case 'carregado_devendo':
        return r.producao.etapa === 'CARREGADO' && r.aReceber > 0.01
          && r.status !== 'CANCELADO' && r.status !== 'REGULARIZADO'
      case 'regularizar': return r.regularizacao?.status === 'PROPOSTA'
      default: return true
    }
  }

  // Filtro pedido pelo Daniel em 04/09/2026: "deixa só o que realmente está em
  // produção na empresa". Não basta esconder o que carregou — pedido cancelado
  // na produção e pedido sem card também não estão sendo tocados pela fábrica.
  // Então o botão MOSTRA só as três etapas em que o equipamento está aqui dentro.
  const soNaFabrica = ocultarCarregados && atual !== 'carregado_devendo'
  const NA_FABRICA: EtapaFabrica[] = ['ANTES_DO_CHAO', 'FABRICANDO', 'PRONTO']

  const rows = useMemo(() => {
    let r = (data?.pedidos ?? []).filter(filtra)
    if (soNaFabrica) r = r.filter(x => NA_FABRICA.includes(x.producao.etapa))
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x => (x.cliente || '').toLowerCase().includes(q)
        || (x.pedidoNumero || '').toLowerCase().includes(q)
        || (x.vendedor || '').toLowerCase().includes(q))
    }
    // Nas filas de trabalho, o mais recente primeiro: é o que o vendedor lembra.
    if (atual === 'falta_lancar' || atual === 'na_fabrica') {
      r = [...r].sort((a, b) => (b.dataVenda || '').localeCompare(a.dataVenda || ''))
    }
    return r
  }, [data, atual, search, soNaFabrica])

  // Quantos o botão está escondendo agora — o usuário precisa saber o que sumiu.
  const escondidos = useMemo(() => {
    if (!soNaFabrica) return 0
    let r = (data?.pedidos ?? []).filter(filtra).filter(x => !NA_FABRICA.includes(x.producao.etapa))
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x => (x.cliente || '').toLowerCase().includes(q)
        || (x.pedidoNumero || '').toLowerCase().includes(q)
        || (x.vendedor || '').toLowerCase().includes(q))
    }
    return r.length
  }, [data, atual, search, soNaFabrica])

  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const k = data?.kpis
  const ir = (a: Atalho) => { setAtalho(a); setPage(0); setAba('pedidos') }

  // Quantos pedidos meus ainda não têm nenhum pagamento registrado — o número
  // que o vendedor precisa ver encolher.
  const faltaLancar = (data?.pedidos ?? [])
    .filter(r => r.semLancamento && r.aReceber > 0.01 && r.status !== 'CANCELADO').length
  const meusPedidos = (data?.pedidos ?? []).filter(r => r.status !== 'CANCELADO').length

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <Wallet className="h-7 w-7 text-accent" /> Financeiro · Recebíveis
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Parcelas e recebimentos ao vivo do controle.branorte.com, com a etapa de fábrica do Controle de Produção
          {escopado && data && <> · mostrando <strong>{data.escopo.vendedores?.join(', ')}</strong></>}
        </p>
        {escopado && faltaLancar > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-bg px-3 py-1.5 text-sm text-warning">
            <FileWarning className="h-4 w-4 shrink-0" />
            <span>
              <strong>{faltaLancar}</strong> dos seus {meusPedidos} pedidos ainda não têm nenhum pagamento registrado.
            </span>
          </p>
        )}
      </div>

      {error && (
        <Card className="border-danger/30 p-4">
          <div className="flex gap-2 text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Não deu pra carregar o financeiro.</p>
              <p className="mt-0.5 opacity-90">{error instanceof FinanceiroErro ? error.message : (error as Error).message}</p>
            </div>
          </div>
        </Card>
      )}

      {isLoading && !data ? <PageLoading /> : data && k && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard title="Total Vendido" value={brl(k.totalVendido)} icon={Wallet}
              sub={`${data.pedidos.length} pedido${data.pedidos.length !== 1 ? 's' : ''}`} />
            <KpiCard title="Recebido" value={brl(k.totalRecebido)} icon={CheckCircle2} tone="accent"
              sub={`${k.pedidosQuitados} quitado${k.pedidosQuitados !== 1 ? 's' : ''} · ${k.pedidosAguardandoConferencia} a conferir`} />
            <KpiCard title="Já carregou e não pagou" value={brl(k.carregadoAReceber)} icon={Truck} tone="danger"
              sub={`saiu da fábrica · ${k.pedidosCarregadosEmAberto} pedido${k.pedidosCarregadosEmAberto !== 1 ? 's' : ''}`} />
            <KpiCard title="Ainda na fábrica" value={brl(k.naFabricaAReceber)} icon={Factory}
              sub={`em aberto · ${k.pedidosNaFabrica} pedido${k.pedidosNaFabrica !== 1 ? 's' : ''}`} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard title="A Receber (total)" value={brl(k.totalAReceber)} icon={TrendingDown} />
            <KpiCard title="Vencido" value={brl(k.totalVencido)} icon={Clock} tone="danger"
              sub={`em ${k.pedidosComVencido} pedido${k.pedidosComVencido !== 1 ? 's' : ''}`} />
            <KpiCard title="Regularizado" value={brl(k.valorRegularizado)} icon={HandCoins}
              sub={`${k.pedidosRegularizados} pedido${k.pedidosRegularizados !== 1 ? 's' : ''} antigo${k.pedidosRegularizados !== 1 ? 's' : ''} · sem comprovante`} />
            <KpiCard title="Sem card de produção" value={String(k.pedidosSemCard)} icon={HelpCircle} tone="warning"
              sub="não dá pra saber se já carregou" />
          </div>

          {/* Eram 9 chips lado a lado e o Daniel resumiu: "essas coisa aqui só
              confunde". Ficam à vista os três que geram trabalho — a fila de
              quem alimenta, quem já levou o equipamento e não pagou, e quem
              está vencido. O resto é detalhe: entra atrás de "mais filtros",
              e reaparece sozinho quando está ativo, pra ninguém ficar com um
              filtro ligado sem enxergar qual é. */}
          <div className="flex flex-wrap items-center gap-2">
            <ChipPendencia n={faltaLancar} label="sem nenhum pagamento lançado" tone="warning"
              icon={FileWarning} ativo={atual === 'falta_lancar'} onClick={() => ir('falta_lancar')} />
            <ChipPendencia n={k.pedidosCarregadosEmAberto} label="carregou e ainda deve" tone="danger"
              icon={Truck} ativo={atual === 'carregado_devendo'} onClick={() => ir('carregado_devendo')} />
            <ChipPendencia n={k.pedidosComVencido} label="com parcela vencida" tone="danger"
              icon={Clock} ativo={atual === 'vencidos'} onClick={() => ir('vencidos')} />

            {/* do gestor, e só quando tem alguém esperando */}
            {gestor && k.regularizacoesAConfirmar > 0 && (
              <ChipPendencia n={k.regularizacoesAConfirmar} label="esperando você confirmar" tone="warning"
                icon={HandCoins} ativo={atual === 'regularizar'} onClick={() => ir('regularizar')} />
            )}
            {gestor && k.comprovantesAConferir > 0 && (
              <ChipPendencia n={k.comprovantesAConferir} label="comprovantes a conferir" tone="warning"
                icon={ShieldAlert} ativo={atual === 'a_conferir'} onClick={() => ir('a_conferir')} />
            )}

            {SECUNDARIOS.map(({ chave, label, tone, icon, n }) => {
              // "comprovantes a conferir" já está lá em cima pro gestor
              if (chave === 'a_conferir' && gestor && k.comprovantesAConferir > 0) return null
              if (!maisFiltros && atual !== chave) return null
              return (
                <ChipPendencia key={chave} n={n(k, faltaLancar)} label={label} tone={tone}
                  icon={icon} ativo={atual === chave} onClick={() => ir(chave)} />
              )
            })}

            <button onClick={() => setMaisFiltros(v => !v)}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-dashed border-border px-2.5
                text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary">
              {maisFiltros ? 'menos filtros' : 'mais filtros'}
            </button>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
                {([['falta_lancar', 'Falta lançar'], ['receber', 'A Receber'], ['quitados', 'Quitados'], ['todos', 'Todos']] as [Atalho, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => ir(key)}
                    className={`h-7 rounded px-3 text-xs font-medium transition-colors ${
                      atual === key && aba === 'pedidos' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {data.vendedores && (
                <button onClick={() => setAba(a => a === 'vendedores' ? 'pedidos' : 'vendedores')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
                    aba === 'vendedores' ? 'border-accent bg-accent text-white' : 'border-border text-text-secondary hover:bg-surface-2'}`}>
                  <Users className="h-3.5 w-3.5" /> Por vendedor
                </button>
              )}
              <button onClick={() => { setOcultarCarregados(v => !v); setPage(0) }}
                disabled={atual === 'carregado_devendo'}
                aria-pressed={soNaFabrica}
                title={atual === 'carregado_devendo'
                  ? 'Este filtro já mostra só os que carregaram — não dá pra combinar com este botão.'
                  : 'Deixa só os pedidos que a fábrica está tocando agora: em projeto, em fabricação ou prontos pra sair'}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed ${
                  soNaFabrica ? 'border-accent bg-accent text-white' : 'border-border text-text-secondary hover:bg-surface-2'}`}>
                <Factory className="h-3.5 w-3.5" /> Só o que está aqui dentro
              </button>
              <Input placeholder="Buscar cliente, pedido ou vendedor..." leftIcon={<Search className="h-4 w-4" />}
                value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} className="lg:w-80" />
              <span className="ml-auto text-sm text-text-muted">
                {rows.length.toLocaleString('pt-BR')} pedido{rows.length !== 1 ? 's' : ''}
                {escondidos > 0 && (
                  <span className="text-text-muted/70"> · {escondidos} escondido{escondidos !== 1 ? 's' : ''}</span>
                )}
              </span>
            </div>
          </Card>

          {aba === 'vendedores' && data.vendedores ? (
            <PorVendedor linhas={data.vendedores} onEscolher={v => { setSearch(v); setAtalho('todos'); setAba('pedidos'); setPage(0) }} />
          ) : (
            <>
              <Card className="hidden overflow-hidden lg:block">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-surface-2">
                        <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Pedido</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Cliente</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Vendedor</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Total</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Recebido</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">A Receber</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Vencido</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Fábrica</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Próx. venc.</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Situação</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map(r => (
                        <tr key={r.id} onClick={() => setAberto(r.id)}
                          className="cursor-pointer transition-colors hover:bg-surface-2/60">
                          <td className="px-4 py-3"><span className="font-mono text-sm font-medium text-text-primary">{r.pedidoNumero || '—'}</span></td>
                          <td className="px-4 py-3"><span className="block max-w-[200px] truncate text-sm text-text-primary" title={r.cliente || ''}>{r.cliente || '(sem nome)'}</span></td>
                          <td className="px-4 py-3"><span className="text-sm text-text-secondary">{r.vendedor || '—'}</span></td>
                          <td className="px-4 py-3 text-right"><span className="text-sm tabular-nums text-text-primary">{brl(r.valorTotal)}</span></td>
                          <td className="px-4 py-3 text-right"><span className={`text-sm tabular-nums ${r.recebido > 0.01 ? 'text-success' : 'text-text-muted'}`}>{brl(r.recebido)}</span></td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-sm tabular-nums ${resolvido(r) ? 'text-text-muted/60' : 'font-semibold text-text-primary'}`}
                              title={resolvido(r) ? `Antes da baixa: ${brl(r.aReceber)} em aberto` : undefined}>
                              {resolvido(r) ? '—' : brl(r.aReceber)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-sm tabular-nums ${resolvido(r) ? 'text-text-muted/60'
                              : r.vencido > 0.01 ? 'font-semibold text-danger' : 'text-text-muted'}`}
                              title={resolvido(r) && r.vencido > 0.01 ? `Antes da baixa: ${brl(r.vencido)} vencido` : undefined}>
                              {resolvido(r) ? '—' : r.vencido > 0.01 ? brl(r.vencido) : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3"><EtiquetaFabrica etapa={r.producao.etapa} desde={r.producao.desde} /></td>
                          <td className="px-4 py-3"><span className="text-sm text-text-secondary">{dataBR(r.proximoVencimento)}</span></td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge className={PEDIDO_COR[r.status]}>{PEDIDO_ROTULO[r.status]}</Badge>
                              {r.semLancamento && r.aReceber > 0.01 && r.status !== 'CANCELADO' && (
                                <Badge className="bg-warning-bg text-warning" title="nenhum pagamento registrado neste pedido">
                                  nada lançado
                                </Badge>
                              )}
                              {r.regularizacao?.status === 'PROPOSTA' && (
                                <Badge className="bg-warning-bg text-warning" title="esperando o gestor confirmar que já foi pago">
                                  <HandCoins className="h-3 w-3" /> a confirmar
                                </Badge>
                              )}
                              {r.comprovantesAConferir > 0 && (
                                <Badge className="bg-warning-bg text-warning" title="comprovante esperando conferência">
                                  <ShieldAlert className="h-3 w-3" />{r.comprovantesAConferir}
                                </Badge>
                              )}
                              {Math.abs(r.divergenciaPlano) > 0.01 && (
                                <Badge className="bg-warning-bg text-warning" title="a soma das parcelas não fecha com o valor do pedido">
                                  <AlertTriangle className="h-3 w-3" />
                                </Badge>
                              )}
                            </div>
                          </td>
                          {/* o clique aqui não pode abrir o painel do pedido por baixo */}
                          <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                            {r.aReceber > 0.01 && r.status !== 'CANCELADO' && r.status !== 'REGULARIZADO' && (
                              <Botao tone="accent" onClick={() => setLancandoNa(r)}>
                                <Plus className="h-3.5 w-3.5" /> Lançar
                              </Botao>
                            )}
                          </td>
                        </tr>
                      ))}
                      {pageRows.length === 0 && (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-text-muted">
                          {escondidos > 0
                            ? `Nenhum pedido deste filtro está na fábrica agora — os ${escondidos} outros já carregaram, foram cancelados na produção ou não têm card. Desligue "Só o que está aqui dentro" para vê-los.`
                            : atual === 'falta_lancar'
                              ? 'Nenhum pedido esperando lançamento. Fila zerada.'
                              : 'Nenhum pedido neste filtro.'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="space-y-2 lg:hidden">
                {pageRows.map(r => (
                  <Card key={r.id} className="p-3">
                    <div className="flex items-start justify-between gap-2" onClick={() => setAberto(r.id)}>
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-text-muted">{r.pedidoNumero || '—'}</p>
                        <p className="truncate text-sm font-medium text-text-primary">{r.cliente || '(sem nome)'}</p>
                        <p className="text-xs text-text-muted">{r.vendedor || '—'}</p>
                      </div>
                      <Badge className={PEDIDO_COR[r.status]}>{PEDIDO_ROTULO[r.status]}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1" onClick={() => setAberto(r.id)}>
                      <EtiquetaFabrica etapa={r.producao.etapa} desde={r.producao.desde} />
                      {r.semLancamento && r.aReceber > 0.01 && r.status !== 'CANCELADO' && (
                        <Badge className="bg-warning-bg text-warning">nada lançado</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 text-center"
                      onClick={() => setAberto(r.id)}>
                      <div><p className="text-[10px] uppercase text-text-muted">Total</p>
                        <p className="text-xs font-semibold tabular-nums text-text-primary">{brl(r.valorTotal)}</p></div>
                      <div><p className="text-[10px] uppercase text-text-muted">Recebido</p>
                        <p className="text-xs font-semibold tabular-nums text-success">{brl(r.recebido)}</p></div>
                      <div><p className="text-[10px] uppercase text-text-muted">Vencido</p>
                        <p className={`text-xs font-semibold tabular-nums ${resolvido(r) ? 'text-text-muted/60'
                          : r.vencido > 0.01 ? 'text-danger' : 'text-text-muted'}`}>
                          {resolvido(r) || r.vencido <= 0.01 ? '—' : brl(r.vencido)}</p></div>
                    </div>
                    {r.aReceber > 0.01 && r.status !== 'CANCELADO' && r.status !== 'REGULARIZADO' && (
                      <div className="mt-2 border-t border-border pt-2">
                        <Botao tone="accent" onClick={() => setLancandoNa(r)}>
                          <Plus className="h-3.5 w-3.5" /> Lançar pagamento
                        </Botao>
                      </div>
                    )}
                  </Card>
                ))}
                {pageRows.length === 0 && (
                  <Card className="p-6 text-center text-sm text-text-muted">
                    {escondidos > 0
                      ? `Nenhum pedido deste filtro está na fábrica agora — os ${escondidos} outros já carregaram, foram cancelados na produção ou não têm card. Desligue "Só o que está aqui dentro" para vê-los.`
                      : 'Nenhum pedido neste filtro.'}
                  </Card>
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                    className="h-8 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-2 disabled:opacity-40">Anterior</button>
                  <span className="text-sm text-text-secondary">{page + 1} / {totalPages}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                    className="h-8 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-2 disabled:opacity-40">Próxima</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {aberto && <PainelPedido pedidoId={aberto} onClose={() => setAberto(null)} />}

      {lancandoNa && (
        <LancarRapidoModal pedido={lancandoNa} onClose={() => setLancandoNa(null)} onErro={setErroLista} />
      )}
      {erroLista && (
        <div className="fixed bottom-4 left-1/2 z-[70] flex max-w-md -translate-x-1/2 items-start gap-2
          rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger shadow-lg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">{erroLista}</div>
          <button onClick={() => setErroLista(null)} aria-label="Fechar aviso"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  )
}
