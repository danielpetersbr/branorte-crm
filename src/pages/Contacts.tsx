import { useState, useCallback, useMemo, useEffect } from 'react'
import { useContacts, useUpdateContact } from '@/hooks/useContacts'
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
import { canonico, corDaEtiqueta, ETIQUETAS_OCULTAS, ordemDe, tempoRelativo, temperaturaDe, TEMP_META, type Temperatura } from '@/lib/wa-funil'
import { useEtiquetasDeContatos, estiloEtiqueta } from '@/hooks/useCrmEtiquetas'
import { BarraEtiquetas } from '@/components/contacts/BarraEtiquetas'
import { BotaoEtiquetar, SelosCrm } from '@/components/contacts/BotaoEtiquetar'
import { useAuth } from '@/hooks/useAuth'
import { Search, MessageCircle, ChevronLeft, ChevronRight, X, FileText, Copy, Check, CornerDownLeft, SearchX, AlertTriangle } from 'lucide-react'
import { ESTADOS_BR, STATUS_OPTIONS, TEMPERATURA_OPTIONS, FUNIL_OPTIONS, PAGE_SIZE, CONTACT_SORT_OPTIONS } from '@/types'
import { parseCrmMeta } from '@/lib/crm-fields'
import type { ContactFilters, Contact, ContactSortKey } from '@/types'
import { ContactDetail } from '@/components/contacts/ContactDetail'

function getOrcamento(origin: string | null): string | null {
  if (!origin) return null
  const match = origin.match(/^Orcamento\s+(.+)$/)
  return match ? match[1] : null
}

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
function EtiquetaWa({ escolhida, outras, nVendedores }: { escolhida: EtiquetaEscolhida; outras: EtiquetaEscolhida[]; nVendedores?: number }) {
  const cor = corDaEtiqueta(escolhida.nome)
  return (
    <div className="flex items-center gap-1 flex-wrap min-w-0">
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
  const [filters, setFilters] = useState<ContactFilters>({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', com_whatsapp: false, etiqueta: '', esperando_resposta: false, sort: 'orcamento_recente', page: 0 })
  const [searchInput, setSearchInput] = useState('')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

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

  // Vendor só vê dropdown com ele mesmo + "não atribuído". Admin vê todos.
  const isVendor = profile?.role === 'vendor'
  const vendors = isVendor && profile?.vendor_id
    ? (vendorsData ?? []).filter(v => v.id === profile.vendor_id)
    : (vendorsData ?? [])
  const vendorSelectOptions = [
    { value: 'unassigned', label: 'Não atribuído' },
    ...vendors.map(v => ({ value: v.id, label: v.name })),
  ]
  const contacts = data?.contacts ?? []
  // `null` = o COUNT falhou mas a PAGINA veio (ver useContacts). Nao e zero:
  // zero significa "nao ha contatos", null significa "nao sei quantos ha".
  const total = data?.total ?? null
  const totalPages = total === null ? 0 : Math.ceil(total / PAGE_SIZE)
  const totalDesconhecido = !!data && total === null
  // Sem total nao da pra saber se existe proxima pagina; o sinal disponivel e
  // "a pagina veio cheia", que erra so no ultimo lote exato.
  const podeAvancar = totalDesconhecido ? contacts.length === PAGE_SIZE : filters.page < totalPages - 1

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
    setFilters({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', com_whatsapp: false, etiqueta: '', esperando_resposta: false, sort: 'orcamento_recente' as ContactSortKey, page: 0 })
    setSearchInput('')
  }

  const hasFilters = filters.search || filters.estado || filters.vendor_id || filters.status || filters.orcamento || filters.orcamento_ano || filters.temperatura || filters.com_whatsapp || filters.etiqueta || filters.esperando_resposta

  // Só pra MOSTRAR "N filtros" — o que liga/desliga o botão Limpar continua
  // sendo `hasFilters`, intocado.
  const nFiltros = [
    filters.search, filters.estado, filters.vendor_id, filters.status,
    filters.orcamento, filters.orcamento_ano, filters.orcamento_mes,
    filters.temperatura, filters.com_whatsapp, filters.etiqueta, filters.esperando_resposta,
  ].filter(Boolean).length

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
          <Select options={TEMPERATURA_OPTIONS.map(t => ({ value: t.value, label: `${t.icon} ${t.label}` }))} placeholder="Temperatura" aria-label="Temperatura"
            value={filters.temperatura} onChange={e => setFilters(f => ({ ...f, temperatura: e.target.value, page: 0 }))} className="w-full lg:w-36" />
          <Select
            options={orcamentoAnos.map(y => ({ value: y, label: y }))}
            placeholder="Ano"
            aria-label="Ano do orçamento"
            value={filters.orcamento_ano}
            onChange={e => setFilters(f => ({ ...f, orcamento_ano: e.target.value, orcamento_mes: '', orcamento: false, page: 0 }))}
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

          {/* O recorte com mais peso da linha: é o que separa "base" de "pipeline". */}
          <ChipFiltro
            ativo={!!(filters.orcamento || filters.orcamento_ano)}
            onClick={() => setFilters(f => ({ ...f, orcamento: !f.orcamento, orcamento_ano: '', page: 0 }))}
            title="So contatos que tem orcamento."
          >
            <FileText className="h-4 w-4" aria-hidden />
            <span className="font-medium">Orcamentos</span>
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
                    <th className="w-[14%] rounded-tl-[11px]">Nome</th>
                    {/* 14%: o telefone formatado ocupa 139px e so cabia inteiro em 1920. */}
                    <th className="w-[14%]">Telefone</th>
                    <th className="w-[8%]">Cidade</th>
                    {/* 5%: em 4% sobravam 9px de texto pra uma sigla de 2 letras (px-2.5 come 20). */}
                    <th className="w-[5%]">UF</th>
                    <th className="w-[9%]" title="Vendedor dono do contato">
                      <span className="xl:hidden">Vend.</span><span className="hidden xl:inline">Vendedor</span>
                    </th>
                    {/* 12%: sobravam 165px aqui em 1920 enquanto os vizinhos estouravam. */}
                    <th className="w-[12%]" title="Etiqueta do contato no WhatsApp. Prioriza a etiqueta posta pelo vendedor dono do contato.">Etiqueta</th>
                    <th className="w-[9%]" title="Ultima mensagem trocada no WhatsApp. O selo ambar marca que o cliente falou por ultimo (aguardando resposta).">
                      <span className="xl:hidden">Ult. msg</span><span className="hidden xl:inline">Ultimo contato</span>
                    </th>
                    <th className="w-[10%]" title="Numero do orcamento mais recente">
                      <span className="xl:hidden">Orc.</span><span className="hidden xl:inline">Orcamento</span>
                    </th>
                    <th className="w-[10%] rounded-tr-[11px] lg:rounded-tr-none" title="Equipamento do orcamento">
                      <span className="xl:hidden">Equip.</span><span className="hidden xl:inline">Equipamento</span>
                    </th>
                    {/* `lg` e nao `xl`: entre 1024 e 1279 a data sumia da tabela E do card
                        mobile — o dado nao existia em lugar nenhum, numa tela cuja
                        ordenacao padrao e por orcamento. */}
                    <th className="hidden lg:table-cell w-[9%] lg:rounded-tr-[11px]" title="Data do orcamento mais recente deste contato.">
                      <span className="xl:hidden">Data</span><span className="hidden xl:inline">Data orcamento</span>
                    </th>
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
                    const etiquetasCrmDoContato = etiqCrmMap?.get(c.id) ?? []
                    const equipamento = orcsLinkados[0]?.equipamento || c.descricao_orcamento || getOrcDescricao(c.notes)
                    return (
                      <tr
                        key={c.id}
                        // A linha inteira abre a ficha. Antes só no clique: agora
                        // também no teclado (WCAG 2.1.1) e com foco visível.
                        tabIndex={0}
                        aria-label={`Abrir ${c.name || 'contato sem nome'}`}
                        onKeyDown={e => {
                          if (e.target !== e.currentTarget) return
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedContact(c) }
                        }}
                        className={cn(
                          'group border-b border-border/60 last:border-b-0 cursor-pointer',
                          'transition-colors duration-100 motion-reduce:transition-none hover:bg-surface-2/60',
                          'focus-visible:outline-none focus-visible:bg-surface-2/60 focus-visible:shadow-[inset_2px_0_0_0_hsl(var(--accent))]',
                        )}
                        onClick={() => setSelectedContact(c)}>
                        <td className="px-2.5 py-3.5">
                          <span className="block truncate text-[13.5px] font-medium text-ink" title={c.name || undefined}>
                            {c.name || <span className="text-ink-faint font-normal">(sem nome)</span>}
                          </span>
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
                          {c.city
                            ? <span className="block truncate text-[13px] text-ink-muted" title={c.city}>{c.city}</span>
                            : <Vazio />}
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
                          <div className="flex items-center gap-1 flex-wrap min-w-0">
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
                            <div className="flex items-center gap-1 flex-wrap min-w-0">
                              <span
                                className="inline-flex items-center gap-1 h-[22px] max-w-full px-1.5 rounded-md border border-border bg-surface-2 text-[11px] font-medium text-ink tabular-nums whitespace-nowrap"
                                title={`${orcsLinkados[0].cliente} · ${orcsLinkados[0].path_principal}`}
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
                        <td className="px-2.5 py-3.5">
                          {equipamento
                            ? <span className="block truncate text-[13px] text-ink-muted" title={equipamento}>{equipamento}</span>
                            : <Vazio />}
                        </td>
                        {/* MESMO breakpoint do <th> (lg): td em xl e th em lg desalinharia
                            todas as colunas entre 1024 e 1279. */}
                        <td className="hidden lg:table-cell px-2.5 py-3.5">
                          {(() => {
                            const dateStr = orcsLinkados[0]?.mtime_iso || c.data_orcamento
                            if (!dateStr) return <Vazio />
                            const d = new Date(dateStr)
                            if (isNaN(d.getTime())) return <Vazio />
                            const dd = String(d.getDate()).padStart(2, '0')
                            const mm = String(d.getMonth() + 1).padStart(2, '0')
                            const yy = d.getFullYear()
                            return <span className="text-[12px] text-ink-muted font-mono tabular-nums whitespace-nowrap">{`${dd}/${mm}/${yy}`}</span>
                          })()}
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
                return (
                  <Card key={c.id} hover onClick={() => setSelectedContact(c)} className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
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

                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {mobileTempOpt && <Badge className={mobileTempOpt.color}>{mobileTempOpt.icon}</Badge>}
                          {c.state && <Badge className="bg-info-bg text-info ring-info/15">{c.state}</Badge>}
                          {mobileFunilOpt && <Badge className={mobileFunilOpt.color}>{mobileFunilOpt.label}</Badge>}
                          {etiquetaWaM && <EtiquetaWa escolhida={etiquetaWaM.escolhida} outras={etiquetaWaM.outras} nVendedores={etiquetaWaM.nVendedores} />}
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
