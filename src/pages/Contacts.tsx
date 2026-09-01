import { useState, useCallback, useMemo, useEffect } from 'react'
import { useContacts, useUpdateContact, useBulkAssign } from '@/hooks/useContacts'
import { usePegarPraMim, useMeuPlacar, useRelatorioContatos, useViolacoes, useDefinirDono, MOTIVO_RECUSA_LABEL, type MotivoRecusa } from '@/hooks/useMeusContatos'
import { PainelDonos } from '@/components/contacts/PainelDonos'
import { useVendors } from '@/hooks/useVendors'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber, formatPhone, whatsappLink, formatDateTimeShort, cn } from '@/lib/utils'
import { useVendorMap } from '@/hooks/useVendorMap'
import { useContactsOrcamentos } from '@/hooks/useContactsOrcamentos'
import { useWaEtiquetasDisponiveis, type WaResumoCampos } from '@/hooks/useWaResumo'
import { canonico, corDaEtiqueta, ETIQUETAS_OCULTAS, ordemDe, statusDerivadoDaEtiqueta, tempoRelativo, temperaturaDe, TEMP_META, type Temperatura } from '@/lib/wa-funil'
import { useEtiquetasDeContatos, estiloEtiqueta } from '@/hooks/useCrmEtiquetas'
import { BarraEtiquetas } from '@/components/contacts/BarraEtiquetas'
import { FaixaAtividadeContatos } from '@/components/contacts/FaixaAtividade'
import { STATUS_CONTATO } from '@/components/contacts/BotoesStatus'
import { BotaoEtiquetar, SelosCrm } from '@/components/contacts/BotaoEtiquetar'
import { CelulaEditavel } from '@/components/contacts/CelulaEditavel'
import { BotoesStatus, type StatusContato } from '@/components/contacts/BotoesStatus'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import { Search, MessageCircle, ChevronLeft, ChevronRight, X, FileText, FileX, Copy, Check, CornerDownLeft, SearchX, AlertTriangle, UserPlus, CheckSquare, Square, Hand, Target, BarChart3, Loader2 } from 'lucide-react'
import { ESTADOS_BR, STATUS_OPTIONS, TEMPERATURA_OPTIONS, FUNIL_OPTIONS, PAGE_SIZE, CONTACT_SORT_OPTIONS } from '@/types'
import { parseCrmMeta } from '@/lib/crm-fields'
import type { ContactFilters, Contact, ContactSortKey } from '@/types'
import { ContactDetail } from '@/components/contacts/ContactDetail'

function getOrcamento(origin: string | null): string | null {
  if (!origin) return null
  const match = origin.match(/^Orcamento\s+(.+)$/)
  return match ? match[1] : null
}

/**
 * Descrição do equipamento tirada das NOTAS — último recurso da coluna
 * Equipamento, quando não há orçamento vinculado nem `descricao_orcamento`.
 *
 * ⚠️ As notas são um depósito de tudo: JSON de metadados, histórico de
 * atendimento, dump de etiqueta do ReplyAgent. Cada linha ignorada aqui é um
 * tipo de lixo que já vazou pra tela como se fosse equipamento.
 *
 * O caso do pool é o pior: quem tem orçamento SAI do pool por construção, então
 * ali a coluna cai SEMPRE neste fallback — e 86 dos 500 primeiros mostravam
 * "reply tags: 1144 | I..." (o dump de etiquetas do ReplyAgent) na coluna
 * Equipamento. Foi o que o Daniel viu no print de 18/08/2026.
 */
function getOrcDescricao(notes: string | null): string | null {
  if (!notes) return null
  const lines = notes.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('{')) continue        // Skip JSON metadata
    if (trimmed.startsWith('Orcamento')) continue // Skip "Orcamento 2026-XXXX"
    if (trimmed.startsWith('[')) continue          // Skip "[31/03/2026] Atendeu..."
    if (trimmed.startsWith('Auto-criado')) continue // Skip stub auto-link notes
    if (trimmed.startsWith('Bucket pra')) continue  // Skip bucket "[Sem cliente]"
    if (/^reply\s*tags?\s*:/i.test(trimmed)) continue // dump de etiquetas do ReplyAgent
    if (/^tags?\s*:/i.test(trimmed)) continue         // idem, forma curta
    return trimmed
  }
  return null
}

// Phones placeholder: 'ORC-...' (legacy) e 'AUTO-...' (stubs auto-link) não são fones reais.
function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return false
  return phone.startsWith('ORC-') || phone.startsWith('AUTO-')
}

// Célula vazia — o comum nesta tela, já que só ~5% dos contatos têm chat sincronizado.
const Vazio = () => <span aria-hidden className="text-[12px] text-ink-faint/60">—</span>

// Ordenar por último contato liga o JOIN com a matview na RPC: a lista deixa de
// ser "todos os contatos" e passa a ser "só quem tem conversa sincronizada".
// Está correto — ordenar por uma data que 95% não tem não significa nada — mas
// o contador despenca de ~208k pra ~10,6k, e sem aviso isso parece bug.
const SORTS_SO_WHATSAPP = new Set<ContactSortKey>(['ultimo_contato_recente', 'ultimo_contato_antigo'])

/**
 * Sentinela de "contato tem WhatsApp mas ninguem colocou etiqueta".
 * Nao e etiqueta real: `contatos_page` traduz este valor para
 * `etiqueta_principal IS NULL`, e `wa_etiquetas_disponiveis` agrupa os NULL
 * sob ele. Os dois lados TEM que usar a mesma string.
 */
const SEM_ETIQUETA = '(sem etiqueta)'

interface EtiquetaEscolhida {
  nome: string
  vendedor: string | null
}

/**
 * Escolhe QUAL etiqueta mostrar pro contato.
 *
 * O mesmo telefone costuma estar etiquetado em vários WhatsApps ao mesmo tempo
 * (até 10 vendedores). Mostrar a "principal" cegamente colocaria a etiqueta do
 * Pedro num lead que é do Gustavo. Então: se o vendedor DONO do contato no CRM
 * etiquetou esse número, é a etiqueta DELE que vale. Sem match, cai na
 * `etiqueta_principal` da RPC; se ela for oculta, na mais recente visível.
 */
function etiquetaDoContato(
  resumo: WaResumoCampos | undefined,
  vendedorDoContato: string | null,
): { escolhida: EtiquetaEscolhida; outras: EtiquetaEscolhida[]; nVendedores: number } | null {
  if (!resumo) return null
  const visiveis = (resumo.etiquetas ?? [])
    .map(e => ({ nome: canonico(e.etiqueta ?? ''), vendedor: e.vendedor ?? null, em: e.em }))
    .filter(e => e.nome && !ETIQUETAS_OCULTAS.has(e.nome))
    // mais recente primeiro — não depender da ordem que a RPC devolveu
    .sort((a, b) => (b.em ?? '').localeCompare(a.em ?? ''))
  if (visiveis.length === 0) return null

  const alvo = vendedorDoContato?.trim().toUpperCase()
  const principal = canonico(resumo.etiqueta_principal ?? '')
  // O dono pode ter mais de uma etiqueta no mesmo número (acontece: uma do
  // funil + uma de fechamento, gravadas no mesmo instante). Entre as dele,
  // prefiro a que a RPC já elegeu principal; senão a mais recente.
  const doDono = alvo ? visiveis.filter(e => e.vendedor?.trim().toUpperCase() === alvo) : []
  const escolhida =
    doDono.find(e => e.nome === principal)
    ?? doDono[0]
    ?? visiveis.find(e => e.nome === principal)
    ?? visiveis[0]

  return {
    escolhida: { nome: escolhida.nome, vendedor: escolhida.vendedor },
    outras: visiveis.filter(e => e !== escolhida).map(e => ({ nome: e.nome, vendedor: e.vendedor })),
    nVendedores: resumo.n_vendedores ?? 0,
  }
}

// Etiqueta do WhatsApp: primeira + "+N" com o resto no title (mesmo padrão da coluna Orcamento).
// Usa `estiloEtiqueta` (a MESMA fórmula do selo do CRM) em vez de repetir o
// `hex+'1f'` inline — eram duas cópias da mesma receita convivendo na mesma célula.
function EtiquetaWa({ escolhida, outras, nVendedores, quebrar }: { escolhida: EtiquetaEscolhida; outras: EtiquetaEscolhida[]; nVendedores?: number; quebrar?: boolean }) {
  const cor = corDaEtiqueta(escolhida.nome)
  return (
    // `quebrar` so no card do mobile. Na TABELA nao pode: uma celula que quebra
    // em duas linhas estica SO aquela linha, e a lista fica com altura irregular.
    <div className={cn('flex items-center gap-1 min-w-0', quebrar ? 'flex-wrap' : 'flex-nowrap')}>
      <span
        style={estiloEtiqueta(cor)}
        className="etq-soft inline-flex items-center h-[20px] px-2 rounded-md text-[10px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap max-w-[150px]"
        title={escolhida.vendedor ? `${escolhida.nome} — etiqueta no WhatsApp do ${escolhida.vendedor}` : escolhida.nome}
      >
        <span className="truncate">{escolhida.nome}</span>
      </span>
      {outras.length > 0 && (
        <span
          className="inline-flex items-center h-[20px] px-1.5 rounded-md bg-surface-2 text-ink-muted text-[10px] font-medium tabular-nums border border-border"
          title={[
            `Tambem etiquetado como:`,
            ...outras.map(o => `${o.nome}${o.vendedor ? ` (${o.vendedor})` : ''}`),
            ...(nVendedores && nVendedores > 1 ? [``, `Numero trabalhado por ${nVendedores} WhatsApps.`] : []),
          ].join('\n')}
        >
          +{outras.length}
        </span>
      )}
    </div>
  )
}

/**
 * Último contato: indicador de temperatura + tempo relativo.
 *
 * A data inteira era pintada de âmbar quando o cliente falava por último — cor
 * forte num texto longo, e o pior contraste da tela (2,14:1). Agora o STATUS
 * é o indicador (pontinho de temperatura + selo de "aguardando"), e o tempo
 * fica em texto normal. A dívida continua saltando, sem gritar.
 *
 * Os tons saem dos TOKENS, não do hex de TEMP_META: `#22c55e` como bolinha
 * sobre branco dá 1,98:1 e não vale como indicador. TEMP_META segue intacto
 * (ainda dá o rótulo aqui e pinta o resumo das colunas do /funil).
 */
const TEMP_TOM: Record<Temperatura, string> = {
  fresco: 'bg-success',
  recente: 'bg-info',
  morno: 'bg-warning',
  parado: 'bg-danger',
  'sem-dado': 'bg-ink-faint',
}

function UltimoContatoWa({ resumo, compacto }: { resumo: WaResumoCampos; compacto?: boolean }) {
  const iso = resumo.ultimo_contato
  const temp = temperaturaDe(iso)
  const meta = TEMP_META[temp]
  const aguardando = resumo.quem_falou === 'cliente'
  const quemLabel = aguardando ? 'Cliente respondeu por ultimo — aguardando o vendedor'
    : resumo.quem_falou === 'vendedor' ? `Ultima mensagem foi do vendedor${resumo.ultimo_vendedor ? ` (${resumo.ultimo_vendedor})` : ''}`
    : resumo.quem_falou === 'sistema' ? 'Ultima mensagem foi automatica (sistema)'
    : 'Sem registro de quem falou por ultimo'
  // formatDateTimeShort é "dd/MM HH:mm" (sem ano) — pra chat parado o ano é
  // justamente o que falta, então anexo quando não for do ano corrente.
  const ano = iso ? new Date(iso).getFullYear() : null
  const dataFull = ano && ano !== new Date().getFullYear()
    ? `${formatDateTimeShort(iso)} · ${ano}`
    : formatDateTimeShort(iso)

  return (
    <div
      className={`flex items-center gap-1.5 min-w-0 ${compacto ? 'text-[11px]' : 'text-[12px]'}`}
      title={`${dataFull} · ${meta.label}\n${quemLabel}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', TEMP_TOM[temp])} aria-hidden />
      <span className="text-ink-muted tabular-nums truncate">{tempoRelativo(iso)}</span>
      {aguardando && (
        // Ícone + selo: quem sinaliza a dívida não é só a cor (WCAG 1.4.1).
        <span
          className="inline-flex items-center shrink-0 h-[18px] px-1 rounded border border-warning/30 bg-warning-bg text-warning"
          title="Cliente respondeu por ultimo — aguardando o vendedor"
        >
          <CornerDownLeft className="h-3 w-3" aria-hidden />
          <span className="sr-only">aguardando resposta do vendedor</span>
        </span>
      )}
    </div>
  )
}

// Botão pequeno que copia o telefone (formato +55XXXXXXXXXXX ou só dígitos) pro clipboard.
// No desktop ele só aparece no hover/foco da linha — sem isso eram 50 ícones
// permanentes competindo com o número, que é o dado.
function CopyPhoneButton({ phone, sempreVisivel }: { phone: string; sempreVisivel?: boolean }) {
  const [copied, setCopied] = useState(false)
  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation()  // Não dispara onClick da row
    try {
      await navigator.clipboard.writeText(phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copie o telefone:', phone)
    }
  }
  return (
    <button
      onClick={handle}
      title={copied ? 'Copiado!' : `Copiar ${phone}`}
      aria-label={copied ? 'Telefone copiado' : `Copiar telefone ${phone}`}
      className={cn(
        'shrink-0 p-1 rounded-md transition-all duration-150 motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:opacity-100',
        copied
          ? 'text-success bg-success-bg opacity-100'
          : 'text-ink-faint hover:text-ink hover:bg-surface-2',
        /* Aparecer-no-hover so vale onde EXISTE hover. Em touch com >=1024px
           (iPad em paisagem, notebook com tela sensivel) o ponteiro nunca passa
           e o botao ficava invisivel pra sempre — e como o telefone tambem
           trunca, nao havia como ler NEM copiar o numero pela lista. */
        sempreVisivel || copied
          ? 'opacity-100'
          : 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100',
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

/**
 * Toggle de filtro do WhatsApp.
 *
 * Era `Button variant="primary"` — bloco sólido de cor cheia (verde num,
 * âmbar no outro, com branco por cima em 2,14:1). Agora é um chip de filtro:
 * neutro quando desligado, tinta suave quando ligado. O "Esperando resposta"
 * mantém o âmbar de propósito: é a MESMA cor com que a coluna marca a dívida,
 * e trocar por verde cortaria essa ligação.
 */
function ChipFiltro({
  ativo, onClick, title, tom = 'accent', children,
}: {
  ativo: boolean
  onClick: () => void
  title: string
  tom?: 'accent' | 'warning'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={ativo}
      className={cn(
        'inline-flex items-center gap-2 h-9 px-3 rounded-md border text-[13px] shrink-0',
        'transition-colors duration-150 motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        ativo
          ? tom === 'warning'
            ? 'border-warning/40 bg-warning-bg text-warning font-medium'
            : 'border-accent/40 bg-accent-bg text-accent font-medium'
          : 'border-border bg-surface text-ink-muted hover:text-ink hover:bg-surface-2 hover:border-border-strong',
      )}
    >
      {children}
    </button>
  )
}

export function Contacts() {
  const currentYear = new Date().getFullYear()
  const orcamentoAnos = Array.from({ length: currentYear - 2011 }, (_, i) => String(currentYear - i))

  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const [filters, setFilters] = useState<ContactFilters>({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, sem_orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', com_whatsapp: false, etiqueta: '', esperando_resposta: false, faixa: '', sort: 'interacao_recente', page: 0 })
  const [searchInput, setSearchInput] = useState('')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  // Atribuicao em massa — veio da tela /atribuir, removida em 2026-08-17. Ela era
  // este mesmo grid travado em vendor_id='unassigned'; aqui o filtro "Vendedor: Nao
  // atribuido" faz o mesmo recorte e sobra o resto dos filtros de brinde.
  // MODO OPT-IN de proposito: a tabela e `table-fixed` com larguras somadas em 100%
  // e medidas em 5 resolucoes (ver comentario do <thead>). Coluna fixa de checkbox
  // custaria 3% de TODO mundo o tempo todo, pra uma acao que e ocasional.
  const [modoAtribuir, setModoAtribuir] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetVendor, setTargetVendor] = useState('')
  const bulkAssign = useBulkAssign()
  const can = useCan()
  const podeAtribuir = can('menu.atribuir')

  /*
   * PEGAR PRA MIM.
   *
   * Nao usa permKey: a condicao e ter um vendedor ligado ao usuario. Quem nao
   * tem (admin puro, marketing, visualizador) nao tem no que carimbar — a RPC
   * devolveria 'sem_vendedor' e o botao seria uma promessa falsa.
   *
   * O motor e o pool de prospecao que ja existia no banco (claims + 5 travas
   * anti-colisao); a tela /prospeccao saiu em 17/08 e ele ficou orfao. Aqui ele
   * volta onde o vendedor ja esta.
   */
  const pegar = usePegarPraMim()
  const resultadoPegar = pegar.data ?? null
  /** Agrupa as recusas por motivo — 30 linhas de "ja tem dono" nao ajudam ninguem. */
  const recusasPorMotivo = useMemo(() => {
    const rs = resultadoPegar?.recusados ?? []
    const conta = new Map<string, number>()
    for (const r of rs) conta.set(r.motivo, (conta.get(r.motivo) ?? 0) + 1)
    return [...conta.entries()]
      .map(([motivo, qtd]) => ({
        motivo,
        qtd,
        label: MOTIVO_RECUSA_LABEL[motivo as MotivoRecusa] ?? motivo,
      }))
      .sort((a, b) => b.qtd - a.qtd)
  }, [resultadoPegar])

  const { data: vendorsData } = useVendors()
  const { data, isLoading, isFetching, isError, dataUpdatedAt, isPlaceholderData, isPaused } = useContacts(filters)
  /*
   * Só troca a lista pela tela de erro quando NÃO HÁ dado em mãos.
   *
   * `isError` sozinho seria uma regressão séria aqui: o React Query mantém `data`
   * quando um refetch falha (vira status 'error' com a lista intacta), e esta tela
   * refaz a busca a cada 60s e ao voltar pra aba. Numa aba aberta o dia todo são
   * ~480 refetches — um JWT expirando, um 500 pontual do Supabase ou o Wi-Fi
   * piscando apagaria a lista inteira e a paginação, com os 50 contatos ainda na
   * memória. Antes deste trabalho não havia ramo de erro e a lista simplesmente
   * ficava na tela, que é o comportamento certo.
   */
  const semDado = !data
  const mostrarErro = isError && semDado
  const updateContact = useUpdateContact()
  /*
   * Qual linha esta gravando e qual falhou. Por ID, e nao um booleano global:
   * com 50 linhas na tela e o refetch de 60s rodando, um spinner global piscaria
   * a tela inteira porque UMA celula salvou.
   */
  const [gravando, setGravando] = useState<Record<string, true>>({})
  const [falhou, setFalhou] = useState<Record<string, true>>({})
  const salvarCampo = useCallback((id: string, campo: 'name' | 'city' | 'status', valor: string | null) => {
    setGravando(g => ({ ...g, [id]: true }))
    setFalhou(({ [id]: _, ...resto }) => resto)
    updateContact.mutate({ id, [campo]: valor }, {
      onError: () => setFalhou(f => ({ ...f, [id]: true })),
      onSettled: () => setGravando(({ [id]: _g, ...resto }) => resto),
    })
  }, [updateContact])
  const vendorMap = useVendorMap()
  const { profile } = useAuth()
  const { data: etiquetasDisponiveis } = useWaEtiquetasDisponiveis()

  /**
   * Opções do filtro de Etiqueta, vindas do DADO (RPC) e não de `ETIQUETA_COR`.
   *
   * A constante só conhece as 18 etiquetas do funil oficial, então etiquetas que
   * existem de verdade — FEIRA, SUPORTE TECNICO, AGENDAMENTO, IMPORTANTES —
   * apareciam na COLUNA mas não no dropdown: dava pra ver, não dava pra filtrar.
   * A contagem ao lado do nome mostra onde tem gente antes de gastar um clique.
   *
   * `value` vai CRU: `contatos_page` compara `p_etiqueta` com `etiqueta_principal`
   * por igualdade EXATA. `canonico()` entra só pra ordenar e pra checar ocultas.
   *
   * As ocultas (BRANORTE, TRANSPORTADORAS, FUNCIONARIO...) continuam fora — e é
   * o MESMO `ETIQUETAS_OCULTAS` que a coluna usa, de propósito: filtrar por uma
   * etiqueta que a coluna esconde devolveria uma lista inteira com a coluna
   * Etiqueta vazia. Filtro e coluna precisam concordar sobre o que existe.
   *
   * ⚠️ A contagem SÓ pode vir de uma fonte que enxergue o mesmo que o filtro.
   * A 1a versao da RPC contava linhas da matview, sem escopo de vendedor: o
   * dropdown dizia "VENDIDO (164)" e o filtro devolvia 70. Errado pra 13 dos 16
   * usuarios — e, pior, o vendedor lia a distribuicao de funil da empresa toda.
   * Hoje a RPC junta com `contacts` e aplica o mesmo predicado de RLS, entao
   * dropdown e cabecalho batem. Se mexer numa, meça a outra.
   *
   * "(sem etiqueta)" vem da propria RPC (o COALESCE agrupa os NULL) e e o
   * sentinela que `contatos_page` traduz de volta pra `IS NULL`: sao contatos
   * COM conversa no WhatsApp que ninguem classificou.
   */
  const etiquetaOptions = useMemo(() => (etiquetasDisponiveis ?? [])
    .filter(e => e.etiqueta === SEM_ETIQUETA || !ETIQUETAS_OCULTAS.has(canonico(e.etiqueta)))
    .sort((a, b) =>
      Number(b.etiqueta === SEM_ETIQUETA) - Number(a.etiqueta === SEM_ETIQUETA)  // sem etiqueta primeiro
      || ordemDe(canonico(a.etiqueta)) - ordemDe(canonico(b.etiqueta))
      || b.contatos - a.contatos          // fora do funil conhecido: maior primeiro
      || a.etiqueta.localeCompare(b.etiqueta))
    .map(e => ({
      value: e.etiqueta,
      label: e.etiqueta === SEM_ETIQUETA
        ? `Sem etiqueta (${formatNumber(e.contatos)})`
        : `${e.etiqueta} (${formatNumber(e.contatos)})`,
    })),
  [etiquetasDisponiveis])

  // Aviso de "a lista encolheu" — ver SORTS_SO_WHATSAPP.
  const soComWhatsapp = SORTS_SO_WHATSAPP.has(filters.sort)

  /** Tem vendedor ligado ao usuário → pode carimbar contato no próprio nome. */
  const podePegar = !!profile?.vendor_id
  const { data: placar } = useMeuPlacar(podePegar)
  const ehAdmin = profile?.role === 'admin'
  const { data: relatorio } = useRelatorioContatos(!!profile)
  const [verViolacoes, setVerViolacoes] = useState(false)
  const { data: violacoes, isLoading: carregandoViolacoes } = useViolacoes(verViolacoes)
  const definirDono = useDefinirDono()

  // Vendor só vê dropdown com ele mesmo + "não atribuído". Admin vê todos.
  const isVendor = profile?.role === 'vendor'
  const vendors = isVendor && profile?.vendor_id
    ? (vendorsData ?? []).filter(v => v.id === profile.vendor_id)
    : (vendorsData ?? [])
  /*
   * "Não atribuído" NÃO é mais só `vendor_id IS NULL`.
   *
   * Regra ditada pelo Daniel em 18/08/2026: tem que ser contato que NINGUÉM
   * nunca conversou e não é de outro — sem etiqueta, sem conversa no WhatsApp,
   * sem orçamento, sem ser duplicata de um cliente que já tem dono. É o que o
   * vendedor pode puxar sem risco de ligar pro cliente do colega.
   *
   * Quem quiser o número cru (para auditoria) tem "Sem vendedor (todos)".
   * Esconder os 5.085 que ficaram de fora sem oferecer jeito de vê-los seria
   * trocar um problema por outro.
   */
  const vendorSelectOptions = [
    { value: 'unassigned', label: 'Não atribuído (livre)' },
    { value: 'unassigned_all', label: 'Sem vendedor (todos)' },
    ...vendors.map(v => ({ value: v.id, label: v.name })),
  ]
  const contacts = data?.contacts ?? []

  // Selecao morre quando a LISTA muda (pagina/filtro/ordem). Sem isto o usuario
  // filtra, some da tela quem estava marcado, e o "Atribuir" leva junto contato
  // que ele nao esta mais vendo — o pior tipo de acao em massa.
  // O RESULTADO do "pegar" morre junto: sem isto ele sobrevive a troca de
  // filtro/pagina/ordenacao e o vendedor le "3 contatos agora sao seus" achando
  // que e do clique novo.
  useEffect(() => { setSelectedIds(new Set()); pegar.reset() }, [filters])
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // `null` = o COUNT falhou mas a PAGINA veio (ver useContacts). Nao e zero:
  // zero significa "nao ha contatos", null significa "nao sei quantos ha".
  const total = data?.total ?? null
  const totalPages = total === null ? 0 : Math.ceil(total / PAGE_SIZE)
  const totalDesconhecido = !!data && total === null
  // Sem total nao da pra saber se existe proxima pagina; o sinal disponivel e
  // "a pagina veio cheia", que erra so no ultimo lote exato.
  const podeAvancar = totalDesconhecido ? contacts.length === PAGE_SIZE : filters.page < totalPages - 1

  /*
   * O VENDEDOR ABRE JA NO PROPRIO NOME.
   *
   * Sem isto ele caia numa lista de 181.855: os dele MAIS o bolsao de 173.564
   * sem dono (a RPC deixa passar `e admin OU e meu OU nao e de ninguem` —
   * contatos_page, predicado reimplementado la dentro porque a funcao e
   * SECURITY DEFINER e a RLS nao valeria sozinha). Nao era vazamento — contato
   * de outro vendedor ele nunca alcanca — mas achar o proprio cliente no meio
   * de 173 mil e trabalho.
   *
   * PRE-SELECIONA, nao tranca: o filtro Vendedor aparece preenchido com o nome
   * dele e um clique em limpar devolve o bolsao inteiro, que e onde mora a
   * prospeccao. Esconder aqueles 173 mil sem ele saber que existem seria pior
   * que mostrar demais.
   *
   * Roda UMA vez: `preFiltrado` fecha a porta pra este efeito nao desfazer a
   * escolha do usuario num rerender.
   */
  const [preFiltrado, setPreFiltrado] = useState(false)
  useEffect(() => {
    if (preFiltrado || !profile) return
    setPreFiltrado(true)
    // admin ve tudo por padrao; quem nao tem vendor_id nao tem no que filtrar
    if (profile.role === 'admin' || !profile.vendor_id) return
    setFilters(f => (f.vendor_id ? f : { ...f, vendor_id: profile.vendor_id as string, page: 0 }))
  }, [profile, preFiltrado])

  /*
   * Prende a pagina dentro do total. Os filtros ja resetam `page: 0`, entao so
   * se chega aqui quando o total ENCOLHE num refetch de fundo (alguem atribuiu
   * contatos, a matview atualizou). Sem isto a tela dizia "Pagina 6 de 2" e
   * mandava "afrouxar os filtros" — conselho errado pra uma pagina que nao
   * existe mais. Converge: apos o ajuste a condicao fica falsa.
   */
  useEffect(() => {
    if (totalPages > 0 && filters.page > totalPages - 1) {
      setFilters(f => ({ ...f, page: totalPages - 1 }))
    }
  }, [totalPages, filters.page])

  // Cruzamento com orcamentos_files: traz nº dos orçamentos pra cada contato visível.
  const contactIds = contacts.map(c => c.id)
  const { data: orcamentosMap } = useContactsOrcamentos(contactIds)

  // Etiquetas do CRM dos contatos desta página, numa consulta só.
  const { data: etiqCrmMap } = useEtiquetasDeContatos(contactIds)

  // O resumo do WhatsApp (etiquetas, último contato, quem falou) já vem embutido
  // em cada linha de `contatos_page` — nada de lookup por telefone aqui.

  const handleSearch = useCallback(() => {
    setFilters(f => ({ ...f, search: searchInput, page: 0 }))
  }, [searchInput])

  const clearFilters = () => {
    setFilters({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, sem_orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', com_whatsapp: false, etiqueta: '', esperando_resposta: false, faixa: '', sort: 'interacao_recente' as ContactSortKey, page: 0 })
    setSearchInput('')
  }

  const hasFilters = filters.search || filters.estado || filters.vendor_id || filters.status || filters.orcamento || filters.sem_orcamento || filters.orcamento_ano || filters.orcamento_mes || filters.temperatura || filters.com_whatsapp || filters.etiqueta || filters.esperando_resposta || filters.faixa

  // Só pra MOSTRAR "N filtros" — o que liga/desliga o botão Limpar continua
  // sendo `hasFilters`, intocado.
  // ⚠️ As duas listas tinham que ser a MESMA e nao eram: `hasFilters` esquecia
  // `orcamento_mes` e o contador esquecia `faixa` — ligar a faixa de atividade
  // recortava a lista sem o badge contar. Mesmos campos nas duas agora.
  const nFiltros = [
    filters.search, filters.estado, filters.vendor_id, filters.status,
    filters.orcamento, filters.sem_orcamento, filters.orcamento_ano, filters.orcamento_mes,
    filters.temperatura, filters.com_whatsapp, filters.etiqueta, filters.esperando_resposta,
    filters.faixa,
  ].filter(Boolean).length

  /**
   * O ATALHO QUE O DANIEL PEDIU: um clique e a tela mostra só quem não tem
   * vendedor E não tem orçamento — o bolsão de prospecção de verdade.
   *
   * "Sem dono" sozinho traz 172.829, e dentro deles há 1.795 que TÊM orçamento:
   * esses não são pool, são cliente de alguém cujo dono se perdeu. Chamar um
   * deles é ligar pra cliente que outro vendedor já atendeu.
   *
   * Zera busca, faixa e etiqueta de propósito: é um recorte inteiro, não um
   * filtro que se soma ao que estava.
   */
  /*
   * O pool agora e o proprio sentinela 'unassigned' (a RPC ja exclui quem tem
   * conversa/etiqueta/orcamento/duplicata), entao nao precisa mais somar
   * `sem_orcamento` — que era o que fazia o card e o Select discordarem.
   */
  const poolAtivo = filters.vendor_id === 'unassigned'
  /*
   * DESLIGAR devolve o usuario para onde ele estava, nao para "vazio".
   *
   * A 1a versao jogava vendor_id para '' e o vendedor, que abre a tela
   * pre-filtrado no proprio nome, caia numa lista de 180 mil ao clicar duas
   * vezes no card. Guardo o recorte anterior e restauro.
   */
  const [antesDoPool, setAntesDoPool] = useState<Partial<ContactFilters> | null>(null)
  const irParaPool = () => {
    if (poolAtivo) {
      const volta = antesDoPool
      setAntesDoPool(null)
      setSearchInput(volta?.search ?? '')
      setFilters(f => ({ ...f, ...(volta ?? { vendor_id: '' }), page: 0 }))
      return
    }
    setAntesDoPool({
      vendor_id: filters.vendor_id, sem_orcamento: filters.sem_orcamento,
      orcamento: filters.orcamento, orcamento_ano: filters.orcamento_ano,
      orcamento_mes: filters.orcamento_mes, search: filters.search,
      faixa: filters.faixa, etiqueta: filters.etiqueta,
      estado: filters.estado, status: filters.status, temperatura: filters.temperatura,
    })
    setSearchInput('')
    // Recorte INTEIRO: zera tambem estado/status/temperatura, senao o card diz
    // 167.741 e a lista abre 43 mil por causa de um "SP" que ficou de pe.
    setFilters(f => ({ ...f, vendor_id: 'unassigned', sem_orcamento: false, orcamento: false,
      orcamento_ano: '', orcamento_mes: '', search: '', faixa: '', etiqueta: '',
      estado: '', status: '', temperatura: '', page: 0 }))
  }

  // Busca só aplica no submit (Enter). Sem uma dica, o usuário digitava e
  // achava que a lista não respondia.
  const buscaPendente = searchInput !== filters.search

  return (
    <div className="p-4 lg:p-8">
      {/* ── CABEÇALHO ─────────────────────────────────────────────────────── */}
      <header className="mb-5 lg:mb-6">
        <h1 className="text-[24px] lg:text-[28px] font-semibold tracking-[-0.02em] text-ink">Contatos</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
          <span>
            <span className="font-medium text-ink tabular-nums">
              {total === null ? '—' : formatNumber(total)}
            </span>
            {' '}contatos encontrados
          </span>
          {soComWhatsapp && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted"
              title="Ordenar por ultimo contato so faz sentido pra quem tem conversa sincronizada, entao a lista fica restrita a esses contatos. Troque a ordenacao pra ver a base inteira."
            >
              <MessageCircle className="h-3 w-3 shrink-0" aria-hidden />
              mostrando so quem tem conversa no WhatsApp
            </span>
          )}
        </p>
      </header>

      {/* Quem e dono de quem, e o placar de quem prospectou. Vem ANTES da faixa
          de atividade de proposito: a primeira pergunta e "esse contato tem
          dono?", e so depois "faz quanto tempo que ninguem fala com ele". */}
      <PainelDonos
        relatorio={relatorio}
        placar={placar}
        violacoes={violacoes}
        carregandoViolacoes={carregandoViolacoes}
        verViolacoes={verViolacoes}
        onVerViolacoes={setVerViolacoes}
        poolAtivo={poolAtivo}
        onPool={irParaPool}
        podeResolver={ehAdmin}
        definirDono={definirDono}
      />

      {/* Pedido do Daniel: entre o titulo e a area de busca. Reage aos filtros
          atuais (a RPC recebe os mesmos parametros da lista) e clicar num card
          SOMA um filtro, sem apagar vendedor/estado/etiqueta/temperatura. */}
      <FaixaAtividadeContatos
        filters={filters}
        onEscolher={faixa => setFilters(f => ({ ...f, faixa, page: 0 }))}
      />

      {/* ── FILTROS ───────────────────────────────────────────────────────── */}
      <Card className="p-3 lg:p-4">
        {/* LINHA 1 — busca larga + ordenação + recortes do CRM */}
        <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2">
          <div className="relative flex-1 lg:min-w-[240px]">
            <form onSubmit={e => { e.preventDefault(); handleSearch() }}>
              <Input placeholder="Buscar por nome ou telefone..." leftIcon={<Search className="h-4 w-4" />}
                aria-label="Buscar por nome ou telefone"
                className={buscaPendente ? 'pr-20' : undefined}
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            </form>
            {buscaPendente && (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                <CornerDownLeft className="h-3 w-3" aria-hidden /> Enter
              </span>
            )}
          </div>

          <Select options={CONTACT_SORT_OPTIONS} placeholder="Ordenar" aria-label="Ordenar"
            value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value as ContactSortKey, page: 0 }))} className="w-full lg:w-44" />
          <Select options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))} placeholder="Estado" aria-label="Estado"
            value={filters.estado} onChange={e => setFilters(f => ({ ...f, estado: e.target.value, page: 0 }))} className="w-full lg:w-[92px]" />
          <Select options={vendorSelectOptions} placeholder="Vendedor" aria-label="Vendedor"
            value={filters.vendor_id} onChange={e => setFilters(f => ({ ...f, vendor_id: e.target.value, page: 0 }))} className="w-full lg:w-40" />
          {/* TEMPERATURA REMOVIDA (31/08/2026). Mesmo motivo do Status logo abaixo:
              gaveta vazia num filtro e promessa que a lista nao cumpre.
              A temperatura vive dentro do TEXTO LIVRE de `contacts.notes`
              (`'%"temp":"X"%'`) e existem 6 registros em 211.951 na base inteira
              (1 quente, 5 vendido) — ZERO visiveis ao ALVARO. As 5 opcoes
              devolviam "Nenhum contato com esses filtros", 0 de 0, e ele lia isso
              como tela quebrada.
              O predicado `$9` continua na RPC de proposito: nao quebra nada, serve
              admin, e volta de graca se alguem popular o campo. Pra reverter,
              basta este <Select>. */}
          {/* Status: SO os 3 que a coluna do fim escreve. O STATUS_OPTIONS antigo
              oferece 6, mas 4 deles nao existem em contato nenhum do banco —
              gaveta vazia num filtro e promessa que a lista nao cumpre. */}
          <Select
            options={STATUS_CONTATO.map(o => ({ value: o.v, label: o.label }))}
            placeholder="Status" aria-label="Status do contato"
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 0 }))}
            className="w-full lg:w-36"
          />
          <Select
            options={orcamentoAnos.map(y => ({ value: y, label: y }))}
            placeholder="Ano"
            aria-label="Ano do orçamento"
            value={filters.orcamento_ano}
            /* `sem_orcamento: false` tambem: escolher um ANO com "Sem orcamento"
               ligado pede contatos que tem orcamento naquele ano E nao tem
               orcamento nenhum — lista vazia, os dois chips acesos e nada na tela
               explicando. Escolher o ano E pedir orcamento; desliga o oposto. */
            onChange={e => setFilters(f => ({ ...f, orcamento_ano: e.target.value, orcamento_mes: '', orcamento: false, sem_orcamento: false, page: 0 }))}
            className="w-full lg:w-[86px]"
          />
          {filters.orcamento_ano && (
            <Select
              options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
              placeholder="Mês"
              aria-label="Mês do orçamento"
              value={filters.orcamento_mes}
              onChange={e => setFilters(f => ({ ...f, orcamento_mes: e.target.value, page: 0 }))}
              className="w-full lg:w-[86px]"
            />
          )}

          {/* O recorte com mais peso da linha: é o que separa "base" de "pipeline".
              ⚠️ Até 18/08/2026 este chip filtrava `origin ILIKE 'Orcamento%'` — a
              ORIGEM da importação, não o orçamento. Deixava de fora 1.300 contatos
              com orçamento de verdade e trazia 1.423 que não tinham arquivo nenhum.
              Hoje olha o vínculo real em orcamentos_files. */}
          {/* ⚠️ O chip acende por DOIS filtros (`orcamento` e `orcamento_ano`) mas o
              clique alternava so UM. Vindo do Ano, o onChange acima ja zerou
              `orcamento`, entao clicar no chip ACESO pra apagar fazia ele LIGAR: o
              ano sumia, o chip continuava aceso e a lista pulava de 202 pra 3.021
              (15x). So o segundo clique desligava. Agora o toggle olha o mesmo
              estado que a luz — se esta aceso por qualquer um dos dois, apaga os
              dois. Idempotente, igual ao chip "Sem orcamento" logo abaixo. */}
          <ChipFiltro
            ativo={!!(filters.orcamento || filters.orcamento_ano)}
            onClick={() => setFilters(f => {
              const ligado = !!(f.orcamento || f.orcamento_ano)
              return { ...f, orcamento: !ligado, sem_orcamento: false, orcamento_ano: '', orcamento_mes: '', page: 0 }
            })}
            title="So contatos que tem orcamento vinculado."
          >
            <FileText className="h-4 w-4" aria-hidden />
            <span className="font-medium">Orcamentos</span>
          </ChipFiltro>

          {/* O oposto. Exclusivo com o de cima: marcar os dois devolveria zero. */}
          <ChipFiltro
            ativo={!!filters.sem_orcamento}
            onClick={() => setFilters(f => ({ ...f, sem_orcamento: !f.sem_orcamento, orcamento: false, orcamento_ano: '', orcamento_mes: '', page: 0 }))}
            title="So contatos que NAO tem nenhum orcamento vinculado."
          >
            <FileX className="h-4 w-4" aria-hidden />
            <span className="font-medium">Sem orcamento</span>
          </ChipFiltro>

          <div className="flex items-center gap-2 lg:ml-auto">
            {nFiltros > 0 && (
              <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-accent/25 bg-accent-bg text-[11.5px] font-medium text-accent tabular-nums">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                {nFiltros} filtro{nFiltros > 1 ? 's' : ''}
              </span>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-ink-muted">
                <X className="h-3.5 w-3.5" aria-hidden /> Limpar
              </Button>
            )}
          </div>
        </div>

        {/* LINHA 2 — filtros de WhatsApp. Separados porque todos dependem de chat
            sincronizado: ligar qualquer um corta a lista pros ~10,6k contatos que
            têm conversa, e agrupá-los deixa isso explícito. */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 mt-3 pt-3 border-t border-border">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint shrink-0 lg:mr-1">WhatsApp</span>

          {/* O filtro mais valioso da tela: o cliente falou e ninguém respondeu. */}
          <ChipFiltro
            ativo={!!filters.esperando_resposta}
            tom="warning"
            onClick={() => setFilters(f => ({ ...f, esperando_resposta: !f.esperando_resposta, page: 0 }))}
            title="Contatos em que a ULTIMA mensagem foi do cliente — ninguem respondeu ainda."
          >
            <CornerDownLeft className="h-4 w-4" aria-hidden />
            Esperando resposta
          </ChipFiltro>

          <ChipFiltro
            ativo={!!filters.com_whatsapp}
            onClick={() => setFilters(f => ({ ...f, com_whatsapp: !f.com_whatsapp, page: 0 }))}
            title="So contatos que tem conversa de WhatsApp sincronizada."
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            So com WhatsApp
          </ChipFiltro>

          <Select
            options={etiquetaOptions}
            placeholder="Etiqueta"
            aria-label="Etiqueta"
            value={filters.etiqueta ?? ''}
            onChange={e => setFilters(f => ({ ...f, etiqueta: e.target.value, page: 0 }))}
            className="w-full lg:w-56"
          />
        </div>
      </Card>

      {/* Chips com a contagem POR etiqueta, respeitando os filtros de cima.
          Clicar num chip é o mesmo que escolher no Select de Etiqueta. */}
      <div className="mt-4">
        <BarraEtiquetas
          filters={filters}
          onEscolher={etiqueta => setFilters(f => ({ ...f, etiqueta, page: 0 }))}
        />
      </div>

      <div className="mt-4">
        {/*
          Falhou o refetch mas a lista está em mãos: mostra a lista E avisa.
          Sem este aviso, trocar "tela em branco" por "lista velha" só troca um
          erro barulhento por um silencioso — e aqui isso dói em cima do motivo
          desta tela existir: o refetch de 60s foi posto pra resolver "não
          atualizou a etiqueta que ele colocou". Com o JWT expirado a lista
          congela e o vendedor volta a ver etiqueta velha, sem saber.
        */}
        {isError && !semDado && (
          <div role="status"
            className="mb-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Nao consegui atualizar — esta lista e de {formatDateTimeShort(new Date(dataUpdatedAt).toISOString())}.
          </div>
        )}
        {isLoading ? <PageLoading /> : mostrarErro ? (
          /* Sem isto, RPC quebrada era pixel por pixel igual a "não achei nada":
             o usuário lia "0 contatos encontrados" e concluía que a busca falhou. */
          <Card className="p-8 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-danger" aria-hidden />
            <p className="mt-3 text-[14px] font-medium text-ink">Não consegui carregar os contatos</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              A consulta falhou — isto não é "nenhum resultado". Recarregue a página; se insistir, avise o time.
            </p>
            {/* Sem isto o usuário fica preso: a paginação some junto com a lista,
                e "recarregue a página" devolve ele pra página 1 sem os filtros.
                Páginas fundas (offset alto em 208k linhas) são justamente as que
                mais estouram timeout, então o beco tem tráfego. */}
            {filters.page > 0 && (
              <Button variant="secondary" size="sm" className="mt-4 mx-auto"
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Voltar para a pagina {filters.page}
              </Button>
            )}
          </Card>
        ) : contacts.length === 0 ? (
          <Card className="p-8 text-center">
            {/* O resultado do "Pegar pra mim" tem que sobreviver a lista ficar
                vazia: no Pool, pegar um contato TIRA ele do filtro — quem marca
                os ultimos 4 da pagina ve a lista esvaziar e, sem isto, nunca le
                quantos entraram nem por que os outros nao entraram. */}
            {resultadoPegar && (
              <div className="mb-4 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-left text-[12.5px]" aria-live="polite">
                <span className="font-medium text-ink">
                  {resultadoPegar.n_pegos ?? 0} contato{(resultadoPegar.n_pegos ?? 0) === 1 ? '' : 's'} agora {(resultadoPegar.n_pegos ?? 0) === 1 ? 'é seu' : 'são seus'}.
                </span>
                {!!recusasPorMotivo.length && (
                  <span className="text-ink-muted">
                    {' '}Não deu pra pegar {recusasPorMotivo.reduce((s, r) => s + r.qtd, 0)}:{' '}
                    {recusasPorMotivo.map(r => `${r.qtd} ${r.label}`).join('; ')}.
                  </span>
                )}
              </div>
            )}
            <SearchX className="h-8 w-8 mx-auto text-ink-faint" aria-hidden />
            <p className="mt-3 text-[14px] font-medium text-ink">
              {isPaused ? 'Sem conexão' : 'Nenhum contato com esses filtros'}
            </p>
            {/* Offline o React Query PAUSA a busca: fetchStatus vira 'paused', e
                isLoading/isFetching/isError ficam todos falsos com data undefined.
                Sem este ramo a tela caia no vazio e AFIRMAVA "a lista está vazia"
                — dizer que a base está vazia é pior que não dizer nada. */}
            <p className="mt-1 text-[13px] text-ink-muted">
              {isPaused
                ? 'A busca está pausada até a internet voltar. Nada foi perdido.'
                : hasFilters ? 'Tente afrouxar um dos recortes acima.' : 'A lista está vazia.'}
            </p>
            {hasFilters && (
              <Button variant="secondary" size="sm" onClick={clearFilters} className="mt-4 mx-auto">
                <X className="h-3.5 w-3.5" aria-hidden /> Limpar filtros
              </Button>
            )}
          </Card>
        ) : (
          <div
            aria-busy={isFetching}
            className={cn('transition-opacity duration-150 motion-reduce:transition-none',
              /*
               * `isPlaceholderData` e NAO `isFetching`.
               *
               * O sinal existe pra dizer "estes dados sao do filtro ANTERIOR" —
               * isso e exatamente o que `isPlaceholderData` significa. Com
               * `isFetching` ele disparava tambem no refetch automatico de 60s,
               * que nao troca nada na tela: a lista inteira piscava esmaecida a
               * cada minuto. E `opacity` compoe o glifo: o nome caia de 15,93:1
               * pra 4,27:1 e o telefone de 7,40:1 pra 2,84:1 — abaixo ate dos
               * 3:1 de objeto grafico. Era a mesma regra que este trabalho
               * aplicou nos chips ao remover `opacity-70` deles.
               */
              isPlaceholderData && 'opacity-60')}
          >
            {/* ── TABELA (desktop) ───────────────────────────────────────────
                `table-fixed` + larguras em % + truncate/title: as 10 colunas
                cabem sem esmagar. Etiqueta e Ultimo contato saíram do
                `hidden xl:table-cell` e agora aparecem já no lg — são o motivo
                desta tela existir e ficavam invisíveis num notebook 1366.
                Data do orcamento passou pro xl no lugar delas.

                O cabeçalho é `sticky top-0` de VERDADE: nada aqui é um
                scrollport (o Card não leva overflow-hidden, senão a sticky
                ancoraria num container que nunca rola e ficaria parada). */}
            {/* O modo de selecao serve DUAS acoes: o vendedor pegar pra si e o
                admin atribuir a alguem. Uma coluna de checkbox so, porque a
                tabela e `table-fixed` com larguras medidas somando 100% — uma
                segunda reescalaria todas e desalinharia o cabecalho. */}
            {(podeAtribuir || podePegar) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Button
                  variant={modoAtribuir ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => { setModoAtribuir(m => !m); setSelectedIds(new Set()); setTargetVendor(''); pegar.reset() }}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden />
                  {modoAtribuir ? 'Sair da selecao' : 'Selecionar contatos'}
                </Button>
                {modoAtribuir && (
                  <>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => setSelectedIds(prev =>
                        prev.size === contacts.length ? new Set() : new Set(contacts.map(c => c.id)))}
                    >
                      {selectedIds.size === contacts.length && contacts.length > 0
                        ? <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                        : <Square className="h-3.5 w-3.5" aria-hidden />}
                      Selecionar esta pagina
                    </Button>
                    <span className="text-[13px] text-ink-muted" aria-live="polite">
                      {selectedIds.size} selecionado{selectedIds.size === 1 ? '' : 's'}
                    </span>

                    {/* PEGAR PRA MIM — carimba o proprio nome no contato pra
                        nenhum colega ligar pro mesmo cliente. A recusa vem com
                        motivo: o backend tem 5 travas e o silencio seria pior
                        que o "nao". */}
                    {podePegar && (
                      <Button
                        variant="primary" size="sm"
                        loading={pegar.isPending}
                        disabled={selectedIds.size === 0}
                        title="Marca estes contatos como seus. Quem ja tem dono, ja tem conversa no WhatsApp de outro vendedor ou esta em atendimento e recusado — e a tela diz por que."
                        onClick={() => {
                          if (selectedIds.size === 0) return
                          pegar.mutate(Array.from(selectedIds), {
                            // Limpa SO o que entrou. Se a RPC recusou todos, a
                            // selecao fica de pe: o vendedor acabou de marcar 30
                            // contatos e vai querer fazer outra coisa com eles,
                            // nao remarcar um por um.
                            onSuccess: (r) => {
                              const pegos = new Set(r.pegos ?? [])
                              if (!pegos.size) return
                              setSelectedIds(prev => new Set([...prev].filter(id => !pegos.has(id))))
                            },
                          })
                        }}
                      >
                        <Hand className="h-3.5 w-3.5" aria-hidden />
                        Pegar pra mim
                      </Button>
                    )}

                    {podeAtribuir && (
                      <>
                        <Select
                          options={(vendorsData ?? []).map(v => ({ value: v.id, label: v.name }))}
                          placeholder="Vendedor" aria-label="Vendedor que vai receber"
                          value={targetVendor} onChange={e => setTargetVendor(e.target.value)}
                          className="w-full sm:w-48"
                        />
                        <Button
                          variant="secondary" size="sm"
                          loading={bulkAssign.isPending}
                          disabled={!targetVendor || selectedIds.size === 0}
                          onClick={() => {
                            if (!targetVendor || selectedIds.size === 0) return
                            bulkAssign.mutate(
                              { contactIds: Array.from(selectedIds), vendorId: targetVendor },
                              { onSuccess: () => { setSelectedIds(new Set()); setTargetVendor('') } },
                            )
                          }}
                        >
                          Atribuir
                        </Button>
                      </>
                    )}
                    {bulkAssign.isError && (
                      <span className="text-[13px] text-danger">Nao deu pra atribuir. Tente de novo.</span>
                    )}
                  </>
                )}

                {/* Resultado do "pegar": quantos entraram e, um a um, por que os
                    outros nao entraram. */}
                {resultadoPegar && (
                  <div className="w-full mt-1 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[12.5px]" aria-live="polite">
                    {resultadoPegar.ok === false ? (
                      <span className="text-danger">{resultadoPegar.msg ?? 'Nao deu pra pegar.'}</span>
                    ) : (
                      <>
                        <span className="font-medium text-ink">
                          {resultadoPegar.n_pegos ?? 0} contato{(resultadoPegar.n_pegos ?? 0) === 1 ? '' : 's'} agora {(resultadoPegar.n_pegos ?? 0) === 1 ? 'e seu' : 'sao seus'}.
                        </span>
                        {!!recusasPorMotivo.length && (
                          <span className="text-ink-muted">
                            {' '}Nao deu pra pegar {recusasPorMotivo.reduce((s, r) => s + r.qtd, 0)}:{' '}
                            {recusasPorMotivo.map(r => `${r.qtd} ${r.label}`).join('; ')}.
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
                {pegar.isError && (
                  <span className="text-[13px] text-danger">Nao deu pra pegar. Tente de novo.</span>
                )}
              </div>
            )}

            <div className="hidden lg:block rounded-lg border border-border bg-surface">
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10">
                  {/* `overflow-hidden` + `text-ellipsis` sao OBRIGATORIOS junto com
                      `table-fixed` + `whitespace-nowrap`: sem eles o texto do th nao
                      respeita a largura da celula e escapa por cima do vizinho. Medido
                      em Chrome: em 1024px lia-se "ULTIMO CONTAORCAMENTO" e o "O" de
                      EQUIPAMENTO saia pra fora da borda do card. So parava em 1920. */}
                  <tr className="[&>th]:bg-surface-2 [&>th]:text-left [&>th]:text-[10px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.06em] [&>th]:text-ink-muted [&>th]:px-2.5 [&>th]:py-2.5 [&>th]:whitespace-nowrap [&>th]:overflow-hidden [&>th]:text-ellipsis [&>th]:border-b [&>th]:border-border">
                    {/*
                      Larguras e rotulos MEDIDOS em navegador com o CSS real, nas 5
                      larguras uteis (1024/1280/1366/1600/1920). Antes: 6 cabecalhos
                      transbordavam em 1024 e 2 ainda em 1600. Agora: zero em todas.

                      O rotulo encolhe abaixo de xl porque e o texto, nao a coluna,
                      que nao cabia — e `title` guarda o nome por extenso.
                      Soma das larguras = 100%.
                    */}
                    {modoAtribuir && <th className="w-[3%] rounded-tl-[11px]"><span className="sr-only">Selecionar</span></th>}
                    {/* Em modo selecao o Nome cede os 3% da coluna de checkbox, pra
                        soma continuar em 100% — `table-fixed` com soma > 100 reescala
                        TODAS as colunas e desalinha o cabecalho medido acima. */}
                    <th className={cn(modoAtribuir ? 'w-[10%]' : 'w-[13%] rounded-tl-[11px]')}>Nome</th>
                    {/* 14%: o telefone formatado ocupa 139px e so cabia inteiro em 1920. */}
                    <th className="w-[12%]">Telefone</th>
                    <th className="w-[7%]">Cidade</th>
                    {/* 5%: em 4% sobravam 9px de texto pra uma sigla de 2 letras (px-2.5 come 20). */}
                    <th className="w-[4%]">UF</th>
                    <th className="w-[7%]" title="Vendedor dono do contato">
                      <span className="2xl:hidden">Vend.</span><span className="hidden 2xl:inline">Vendedor</span>
                    </th>
                    {/* 12%: sobravam 165px aqui em 1920 enquanto os vizinhos estouravam. */}
                    <th className="w-[10%]" title="Etiqueta do contato no WhatsApp. Prioriza a etiqueta posta pelo vendedor dono do contato.">Etiqueta</th>
                    <th className="w-[9%]" title="Ultima mensagem trocada no WhatsApp. O selo ambar marca que o cliente falou por ultimo (aguardando resposta).">
                      <span className="2xl:hidden">Ult. msg</span><span className="hidden 2xl:inline">Ultimo contato</span>
                    </th>
                    <th className="w-[8%]" title="Numero do orcamento mais recente">
                      <span className="2xl:hidden">Orc.</span><span className="hidden 2xl:inline">Orcamento</span>
                    </th>
                    <th className="hidden xl:table-cell w-[9%]" title="Equipamento do orcamento">
                      <span className="2xl:hidden">Equip.</span><span className="hidden 2xl:inline">Equipamento</span>
                    </th>
                    {/* `lg` e nao `xl`: entre 1024 e 1279 a data sumia da tabela E do card
                        mobile — o dado nao existia em lugar nenhum.
                        O title abaixo promete "mais recente" e agora CUMPRE: mostra o
                        mesmo `ultimo_orcamento_em` por onde a RPC ordena. */}
                    <th className="hidden lg:table-cell w-[8%]" title="Data do orcamento mais recente deste contato.">
                      <span className="2xl:hidden">Data</span><span className="hidden 2xl:inline">Data orc.</span>
                    </th>
                    {/* Coluna nova (06/08). Grava so em `status`; `is_closed` continua
                        vindo de etiqueta e nao e tocado aqui. Soma = 100%. */}
                    <th className="w-[13%] rounded-tr-[11px]" title="Aberto ou Fechado. Clique pra mudar.">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(c => {
                    const placeholder = isPlaceholderPhone(c.phone)
                    const tel = placeholder ? '' : (c.telefone_normalizado || c.phone || '')
                    const orc = getOrcamento(c.origin)
                    const orcsLinkados = orcamentosMap?.get(c.id) ?? []
                    const meta = parseCrmMeta(c.notes)
                    const tempOpt = TEMPERATURA_OPTIONS.find(t => t.value === meta.temp)
                    const funilOpt = FUNIL_OPTIONS.find(f => f.value === meta.funil)
                    const etiquetaWa = etiquetaDoContato(c, c.vendor_id ? vendorMap[c.vendor_id] ?? null : null)
                    // Quem decide o status é a etiqueta (job recompute-contact-status-5min).
                    // Aqui só descobrimos QUAL, pra travar o botão e explicar.
                    const statusDerivado = statusDerivadoDaEtiqueta(c.etiquetas, c.vendor_id ? vendorMap[c.vendor_id] ?? null : null)
                    const etiquetasCrmDoContato = etiqCrmMap?.get(c.id) ?? []
                    const equipamento = orcsLinkados[0]?.equipamento || c.descricao_orcamento || getOrcDescricao(c.notes)
                    return (
                      <tr
                        key={c.id}
                        // A linha inteira abre a ficha. Antes só no clique: agora
                        // também no teclado (WCAG 2.1.1) e com foco visível.
                        tabIndex={0}
                        aria-label={modoAtribuir
                          ? `Selecionar ${c.name || 'contato sem nome'}`
                          : `Abrir ${c.name || 'contato sem nome'}`}
                        onKeyDown={e => {
                          if (e.target !== e.currentTarget) return
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); modoAtribuir ? toggleSelect(c.id) : setSelectedContact(c) }
                        }}
                        className={cn(
                          // `h-[56px]` trava a altura: sem isto, QUALQUER celula que
                          // quebre em duas linhas estica so a sua linha e a lista fica
                          // serrilhada. Com as celulas em flex-nowrap acima, nada
                          // quebra — a altura fixa e o cinto de seguranca pro proximo
                          // conteudo que alguem adicionar.
                          'group h-[56px] border-b border-border/60 last:border-b-0 cursor-pointer',
                          'transition-colors duration-100 motion-reduce:transition-none hover:bg-surface-2/60',
                          'focus-visible:outline-none focus-visible:bg-surface-2/60 focus-visible:shadow-[inset_2px_0_0_0_hsl(var(--accent))]',
                        )}
                        onClick={() => modoAtribuir ? toggleSelect(c.id) : setSelectedContact(c)}>
                        {modoAtribuir && (
                          /* stopPropagation: sem ele o clique sobe pro <tr> e o
                             toggle roda DUAS vezes (aqui e la), anulando a marcacao. */
                          <td className="px-2.5 py-3.5" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-[hsl(var(--accent))]"
                              checked={selectedIds.has(c.id)}
                              onChange={() => toggleSelect(c.id)}
                              aria-label={`Selecionar ${c.name || 'contato sem nome'}`}
                            />
                          </td>
                        )}
                        <td className="px-2.5 py-3.5">
                          <CelulaEditavel
                            valor={c.name}
                            placeholder="(sem nome)"
                            ariaLabel={`Nome do contato ${c.name || 'sem nome'}`}
                            className="text-[13.5px] font-medium text-ink"
                            salvando={!!gravando[c.id]}
                            erro={!!falhou[c.id]}
                            onSalvar={v => salvarCampo(c.id, 'name', v)}
                          />
                        </td>
                        <td className="px-2.5 py-3.5">
                          {tel ? (
                            <div className="flex items-center gap-0.5 min-w-0">
                              {/* `title` porque a celula trunca: o numero formatado ocupa
                                   139px e so cabe inteiro a partir de ~1920. Era a unica
                                   celula truncada sem title na tabela. */}
                              <span className="truncate text-[12.5px] text-ink-muted font-mono tabular-nums" title={formatPhone(tel)}>{formatPhone(tel)}</span>
                              <CopyPhoneButton phone={tel} />
                            </div>
                          ) : <Vazio />}
                        </td>
                        <td className="px-2.5 py-3.5">
                          <CelulaEditavel
                            valor={c.city}
                            placeholder="—"
                            ariaLabel={`Cidade de ${c.name || 'contato sem nome'}`}
                            className="text-[13px] text-ink-muted"
                            salvando={!!gravando[c.id]}
                            erro={!!falhou[c.id]}
                            onSalvar={v => salvarCampo(c.id, 'city', v)}
                          />
                        </td>
                        <td className="px-2.5 py-3.5">
                          {c.state ? (
                            <Badge className="bg-info-bg text-info ring-info/15">{c.state}</Badge>
                          ) : <Vazio />}
                        </td>
                        <td className="px-2.5 py-3.5">
                          {(c.vendor_id ? vendorMap[c.vendor_id] : null)
                            ? <span className="block truncate text-[13px] text-ink-muted" title={vendorMap[c.vendor_id!]}>{vendorMap[c.vendor_id!]}</span>
                            : <Vazio />}
                        </td>
                        <td className="px-2.5 py-3.5">
                          {/* WhatsApp e CRM lado a lado: as do CRM levam um ponto
                              e nunca substituem a da conversa real. */}
                          <div className="flex items-center gap-1 flex-nowrap min-w-0 overflow-hidden">
                            {etiquetaWa
                              ? <EtiquetaWa escolhida={etiquetaWa.escolhida} outras={etiquetaWa.outras} nVendedores={etiquetaWa.nVendedores} />
                              : (!etiquetasCrmDoContato.length && <Vazio />)}
                            <SelosCrm etiquetas={etiquetasCrmDoContato} />
                            <BotaoEtiquetar contactId={c.id} aplicadas={etiquetasCrmDoContato} compacto />
                          </div>
                        </td>
                        <td className="px-2.5 py-3.5">
                          {c.ultimo_contato ? <UltimoContatoWa resumo={c} /> : <Vazio />}
                        </td>
                        <td className="px-2.5 py-3.5">
                          {orcsLinkados.length > 0 ? (
                            <div className="flex items-center gap-1 flex-nowrap min-w-0 overflow-hidden">
                              <span
                                className="inline-flex items-center gap-1 h-[22px] max-w-full px-1.5 rounded-md border border-border bg-surface-2 text-[11px] font-medium text-ink tabular-nums whitespace-nowrap"
                                /* O equipamento entra aqui porque a coluna Equipamento
                                   se esconde abaixo de 1280 (a Status ocupou o lugar).
                                   Sem isto o dado sumiria da tela nessa faixa. */
                                title={[orcsLinkados[0].cliente, equipamento, orcsLinkados[0].path_principal].filter(Boolean).join(' · ')}
                              >
                                <FileText className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
                                <span className="truncate">{orcsLinkados[0].ano}-{orcsLinkados[0].numero}</span>
                              </span>
                              {orcsLinkados.length > 1 && (
                                <span
                                  className="inline-flex items-center h-[22px] px-1.5 rounded-md border border-border bg-surface text-[10px] font-medium text-ink-muted tabular-nums"
                                  title={orcsLinkados.slice(1).map(o => `${o.ano}-${o.numero}${o.equipamento ? ' · ' + o.equipamento : ''}`).join('\n')}
                                >
                                  +{orcsLinkados.length - 1}
                                </span>
                              )}
                            </div>
                          ) : orc ? (
                            <span className="inline-flex items-center gap-1 h-[22px] max-w-full px-1.5 rounded-md border border-border bg-surface-2 text-[11px] font-medium text-ink whitespace-nowrap" title={orc}>
                              <FileText className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
                              <span className="truncate">{orc}</span>
                            </span>
                          ) : <Vazio />}
                        </td>
                        {/* MESMO breakpoint do <th>. Escondida abaixo de 1280 porque a
                            coluna Status entrou e 11 colunas nao cabem — mas o dado NAO
                            some: o equipamento entra no title da celula Orcamento logo
                            acima, que continua visivel. */}
                        <td className="hidden xl:table-cell px-2.5 py-3.5">
                          {equipamento
                            ? <span className="block truncate text-[13px] text-ink-muted" title={equipamento}>{equipamento}</span>
                            : <Vazio />}
                        </td>
                        {/* MESMO breakpoint do <th> (lg): td em xl e th em lg desalinharia
                            todas as colunas entre 1024 e 1279. */}
                        <td className="hidden lg:table-cell px-2.5 py-3.5">
                          {(() => {
                            /* ⚠️ Era `orcsLinkados[0]?.mtime_iso || c.data_orcamento` — e a
                               RPC ordenava por `c.data_orcamento`. A célula mostrava uma
                               data e a lista era ordenada por outra: divergiam em 60% dos
                               contatos com orçamento (média de 193 dias), o que dava 167
                               inversões nas 500 primeiras linhas. Parecia lista embaralhada
                               porque era.
                               Pior: `orcsLinkados[0]` é o de maior (ano, numero), não o de
                               maior data — número maior não é data maior, e em 131 casos
                               mostrava o orçamento errado como "o mais novo".
                               Agora lê o MESMO campo por onde a RPC ordenou. */
                            const dateStr = c.ultimo_orcamento_em
                            if (!dateStr) return <Vazio />
                            const d = new Date(dateStr)
                            if (isNaN(d.getTime())) return <Vazio />
                            const dd = String(d.getDate()).padStart(2, '0')
                            const mm = String(d.getMonth() + 1).padStart(2, '0')
                            const yy = d.getFullYear()
                            return <span className="text-[12px] text-ink-muted font-mono tabular-nums whitespace-nowrap">{`${dd}/${mm}/${yy}`}</span>
                          })()}
                        </td>
                        <td className="px-2.5 py-3.5">
                          <BotoesStatus
                            valor={c.status}
                            salvando={!!gravando[c.id]}
                            erro={!!falhou[c.id]}
                            derivadoDe={statusDerivado}
                            onEscolher={(v: StatusContato) => salvarCampo(c.id, 'status', v)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── CARDS (mobile / tablet) ─────────────────────────────────── */}
            <div className="lg:hidden space-y-2">
              {contacts.map(c => {
                const placeholder2 = isPlaceholderPhone(c.phone)
                const tel = placeholder2 ? '' : (c.telefone_normalizado || c.phone || '')
                const orc = getOrcamento(c.origin)
                const orcsLinkadosM = orcamentosMap?.get(c.id) ?? []
                const mobileM = parseCrmMeta(c.notes)
                const mobileTempOpt = TEMPERATURA_OPTIONS.find(t => t.value === mobileM.temp)
                const mobileFunilOpt = FUNIL_OPTIONS.find(f => f.value === mobileM.funil)
                const etiquetaWaM = etiquetaDoContato(c, c.vendor_id ? vendorMap[c.vendor_id] ?? null : null)
                const statusDerivadoM = statusDerivadoDaEtiqueta(c.etiquetas, c.vendor_id ? vendorMap[c.vendor_id] ?? null : null)
                return (
                  <Card key={c.id} hover onClick={() => modoAtribuir ? toggleSelect(c.id) : setSelectedContact(c)} className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      {modoAtribuir && (
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--accent))]"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          onClick={e => e.stopPropagation()}
                          aria-label={`Selecionar ${c.name || 'contato sem nome'}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium text-ink truncate">{c.name || <span className="text-ink-faint font-normal">(sem nome)</span>}</p>
                        {tel ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <p className="text-[13px] text-ink-muted font-mono tabular-nums truncate">{formatPhone(tel)}</p>
                            <CopyPhoneButton phone={tel} sempreVisivel />
                          </div>
                        ) : (
                          <p className="text-[13px] text-ink-faint mt-0.5">—</p>
                        )}

                        {(c.city || (c.vendor_id && vendorMap[c.vendor_id])) && (
                          <p className="mt-1 text-[12px] text-ink-faint truncate">
                            {[c.city, c.vendor_id ? vendorMap[c.vendor_id] : null].filter(Boolean).join(' · ')}
                          </p>
                        )}

                        {/* Paridade com o desktop: sem isto o status viraria funcao
                            exclusiva de quem esta no computador, e a coluna nova nao
                            existiria pro vendedor no celular — que e onde ele esta
                            quando fecha ou perde a venda. */}
                        <div className="mt-2">
                          <BotoesStatus
                            valor={c.status}
                            salvando={!!gravando[c.id]}
                            erro={!!falhou[c.id]}
                            compacto
                            derivadoDe={statusDerivadoM}
                            onEscolher={(v: StatusContato) => salvarCampo(c.id, 'status', v)}
                          />
                        </div>

                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {mobileTempOpt && <Badge className={mobileTempOpt.color}>{mobileTempOpt.icon}</Badge>}
                          {c.state && <Badge className="bg-info-bg text-info ring-info/15">{c.state}</Badge>}
                          {mobileFunilOpt && <Badge className={mobileFunilOpt.color}>{mobileFunilOpt.label}</Badge>}
                          {etiquetaWaM && <EtiquetaWa escolhida={etiquetaWaM.escolhida} outras={etiquetaWaM.outras} nVendedores={etiquetaWaM.nVendedores} quebrar />}
                          <SelosCrm etiquetas={etiqCrmMap?.get(c.id) ?? []} />
                          {/* stopPropagation: o card inteiro abre o contato — o menu de
                              etiqueta não pode abrir a ficha por baixo. */}
                          <span onClick={e => e.stopPropagation()}>
                            <BotaoEtiquetar contactId={c.id} aplicadas={etiqCrmMap?.get(c.id) ?? []} compacto />
                          </span>
                          {orcsLinkadosM.length > 0 ? (
                            <span
                              className="inline-flex items-center gap-1 h-[22px] max-w-full px-1.5 rounded-md border border-border bg-surface-2 text-[11px] font-medium text-ink tabular-nums"
                              title={orcsLinkadosM[0].equipamento ?? orcsLinkadosM.slice(1, 4).map(o => `${o.ano}-${o.numero}`).join(', ')}
                            >
                              <FileText className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden /> {orcsLinkadosM[0].ano}-{orcsLinkadosM[0].numero}
                              {orcsLinkadosM[0].equipamento && (
                                <span className="ml-0.5 text-[10px] text-ink-muted truncate max-w-[130px] inline-block align-bottom">
                                  · {orcsLinkadosM[0].equipamento}
                                </span>
                              )}
                              {orcsLinkadosM.length > 1 && <span className="ml-0.5 text-[10px] text-ink-faint">+{orcsLinkadosM.length - 1}</span>}
                            </span>
                          ) : orc ? (
                            <span className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md border border-border bg-surface-2 text-[11px] font-medium text-ink">
                              <FileText className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden /> {orc}
                            </span>
                          ) : null}
                          {c.ultimo_contato && <UltimoContatoWa resumo={c} compacto />}
                        </div>
                      </div>
                      {tel && (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <a href={whatsappLink(tel)} target="_blank" rel="noopener"
                            aria-label={`Abrir conversa no WhatsApp com ${c.name || formatPhone(tel)}`}
                            title="Abrir no WhatsApp"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success-bg text-success transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                            <MessageCircle className="h-5 w-5" aria-hidden />
                          </a>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ── PAGINAÇÃO ─────────────────────────────────────────────────── */}
        {!isLoading && !mostrarErro && (totalPages > 1 || (totalDesconhecido && (filters.page > 0 || podeAvancar))) && (
          /*
           * `pb-20` (e `pr-32` no mobile) por causa do RoadmapFAB: ele e
           * `fixed bottom-4 right-4 z-[9997]` (RoadmapFAB.tsx:156) e vive em
           * TODAS as paginas logadas. Como a paginacao desta tela e o unico
           * conteudo que encosta no canto inferior direito, o botao "Anterior"
           * ficava por baixo do "Feedback" e nao dava pra clicar. Resolvido
           * afastando o conteudo, e nao escondendo o FAB: ele e por onde os
           * vendedores reportam bug.
           */
          <div className="flex items-center justify-between gap-3 pt-4 pb-20 sm:pb-16 pr-0 sm:pr-36">
            <p className="text-[12.5px] text-ink-muted tabular-nums">
              Pagina <span className="font-medium text-ink">{filters.page + 1}</span>
              {/* Sem o total, "de N" seria invencao. Some o denominador, fica a posicao. */}
              {!totalDesconhecido && <> de {formatNumber(totalPages)}</>}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={filters.page === 0}
                aria-label="Pagina anterior"
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
              </Button>
              <Button variant="secondary" size="sm" disabled={!podeAvancar}
                aria-label="Proxima pagina"
                onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                Proxima <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectedContact && (
        <ContactDetail contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}
    </div>
  )
}
