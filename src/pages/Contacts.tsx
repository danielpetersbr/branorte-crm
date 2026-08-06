import { useState, useCallback, useMemo } from 'react'
import { useContacts, useUpdateContact } from '@/hooks/useContacts'
import { useVendors } from '@/hooks/useVendors'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber, formatPhone, whatsappLink, formatDateTimeShort } from '@/lib/utils'
import { useVendorMap } from '@/hooks/useVendorMap'
import { useContactsOrcamentos } from '@/hooks/useContactsOrcamentos'
import { useWaEtiquetasDisponiveis, type WaResumoCampos } from '@/hooks/useWaResumo'
import { canonico, corDaEtiqueta, ETIQUETAS_OCULTAS, ordemDe, tempoRelativo, temperaturaDe, TEMP_META } from '@/lib/wa-funil'
import { useEtiquetasDeContatos } from '@/hooks/useCrmEtiquetas'
import { BarraEtiquetas } from '@/components/contacts/BarraEtiquetas'
import { BotaoEtiquetar, SelosCrm } from '@/components/contacts/BotaoEtiquetar'
import { useAuth } from '@/hooks/useAuth'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, FileText, Copy, Check, CornerDownLeft } from 'lucide-react'
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
const Vazio = () => <span className="text-[11px] text-ink-faint/40">—</span>

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
function EtiquetaWa({ escolhida, outras, nVendedores }: { escolhida: EtiquetaEscolhida; outras: EtiquetaEscolhida[]; nVendedores?: number }) {
  const cor = corDaEtiqueta(escolhida.nome)
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Badge
        style={{ backgroundColor: cor + '1f', color: cor, boxShadow: `inset 0 0 0 1px ${cor}55` }}
        title={escolhida.vendedor ? `${escolhida.nome} — etiqueta no WhatsApp do ${escolhida.vendedor}` : escolhida.nome}
      >
        {escolhida.nome}
      </Badge>
      {outras.length > 0 && (
        <Badge
          className="bg-stone-100 text-stone-600 text-[10px]"
          title={[
            `Tambem etiquetado como:`,
            ...outras.map(o => `${o.nome}${o.vendedor ? ` (${o.vendedor})` : ''}`),
            ...(nVendedores && nVendedores > 1 ? [``, `Numero trabalhado por ${nVendedores} WhatsApps.`] : []),
          ].join('\n')}
        >
          +{outras.length}
        </Badge>
      )}
    </div>
  )
}

/**
 * Último contato: pontinho de temperatura + tempo relativo.
 * Quando quem falou por último foi o CLIENTE, a bola está com o vendedor —
 * é a informação mais valiosa da coluna, então ganha cor de alerta e ícone.
 */
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
      className={`flex items-center gap-1.5 ${compacto ? 'text-xs' : 'text-sm'}`}
      title={`${dataFull} · ${meta.label}\n${quemLabel}`}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.cor }} aria-hidden />
      <span
        className={aguardando ? 'font-semibold tabular-nums' : 'text-text-secondary tabular-nums'}
        style={aguardando ? { color: 'hsl(var(--warning))' } : undefined}
      >
        {tempoRelativo(iso)}
      </span>
      {aguardando && (
        <CornerDownLeft className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--warning))' }} aria-hidden />
      )}
    </div>
  )
}

// Botão pequeno que copia o telefone (formato +55XXXXXXXXXXX ou só dígitos) pro clipboard.
function CopyPhoneButton({ phone }: { phone: string }) {
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
      className={`p-1 rounded hover:bg-surface-tertiary transition-colors ${
        copied ? 'text-green-600' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
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
  const { data, isLoading } = useContacts(filters)
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
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

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

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Contatos</h1>
          <p className="text-sm text-text-secondary">
            {formatNumber(total)} contatos encontrados
            {soComWhatsapp && (
              <span
                className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-ink-faint"
                title="Ordenar por ultimo contato so faz sentido pra quem tem conversa sincronizada, entao a lista fica restrita a esses contatos. Troque a ordenacao pra ver a base inteira."
              >
                <MessageCircle className="h-3 w-3 shrink-0" aria-hidden />
                mostrando so quem tem conversa no WhatsApp
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1">
            <form onSubmit={e => { e.preventDefault(); handleSearch() }}>
              <Input placeholder="Buscar por nome ou telefone..." leftIcon={<Search className="h-4 w-4" />}
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            </form>
          </div>
          <Select options={CONTACT_SORT_OPTIONS} placeholder="Ordenar"
            value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value as ContactSortKey, page: 0 }))} className="lg:w-48" />
          <Select options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))} placeholder="Estado"
            value={filters.estado} onChange={e => setFilters(f => ({ ...f, estado: e.target.value, page: 0 }))} className="lg:w-28" />
          <Select options={vendorSelectOptions} placeholder="Vendedor"
            value={filters.vendor_id} onChange={e => setFilters(f => ({ ...f, vendor_id: e.target.value, page: 0 }))} className="lg:w-48" />
          <Select options={TEMPERATURA_OPTIONS.map(t => ({ value: t.value, label: `${t.icon} ${t.label}` }))} placeholder="Temperatura"
            value={filters.temperatura} onChange={e => setFilters(f => ({ ...f, temperatura: e.target.value, page: 0 }))} className="lg:w-40" />
          <Button
            variant={filters.orcamento || filters.orcamento_ano ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setFilters(f => ({ ...f, orcamento: !f.orcamento, orcamento_ano: '', page: 0 }))}
            className="shrink-0"
          >
            <FileText className="h-4 w-4" />
            Orcamentos
          </Button>
          <Select
            options={orcamentoAnos.map(y => ({ value: y, label: y }))}
            placeholder="Ano"
            value={filters.orcamento_ano}
            onChange={e => setFilters(f => ({ ...f, orcamento_ano: e.target.value, orcamento_mes: '', orcamento: false, page: 0 }))}
            className="lg:w-24"
          />
          {filters.orcamento_ano && (
            <Select
              options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
              placeholder="Mês"
              value={filters.orcamento_mes}
              onChange={e => setFilters(f => ({ ...f, orcamento_mes: e.target.value, page: 0 }))}
              className="lg:w-24"
            />
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-4 w-4" /> Limpar</Button>
          )}
        </div>

        {/* Filtros de WhatsApp. Vivem numa linha separada porque todos dependem
            de chat sincronizado — ligar qualquer um corta a lista pros ~10,6k
            contatos que têm conversa, e agrupá-los deixa isso explícito. */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mt-3 pt-3 border-t border-border">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint shrink-0">WhatsApp</span>

          {/* O filtro mais valioso da tela: o cliente falou e ninguém respondeu.
              Fica em âmbar — a mesma cor que a coluna usa pra marcar essa dívida. */}
          <Button
            variant={filters.esperando_resposta ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setFilters(f => ({ ...f, esperando_resposta: !f.esperando_resposta, page: 0 }))}
            className={`shrink-0 ${filters.esperando_resposta ? 'bg-warning hover:bg-warning/90' : ''}`}
            title="Contatos em que a ULTIMA mensagem foi do cliente — ninguem respondeu ainda."
          >
            <CornerDownLeft className="h-4 w-4" />
            Esperando resposta
          </Button>

          <Button
            variant={filters.com_whatsapp ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setFilters(f => ({ ...f, com_whatsapp: !f.com_whatsapp, page: 0 }))}
            className="shrink-0"
            title="So contatos que tem conversa de WhatsApp sincronizada."
          >
            <MessageCircle className="h-4 w-4" />
            So com WhatsApp
          </Button>

          <Select
            options={etiquetaOptions}
            placeholder="Etiqueta"
            value={filters.etiqueta ?? ''}
            onChange={e => setFilters(f => ({ ...f, etiqueta: e.target.value, page: 0 }))}
            className="lg:w-56"
          />
        </div>
      </Card>

      {/* Chips com a contagem POR etiqueta, respeitando os filtros de cima.
          Clicar num chip é o mesmo que escolher no Select de Etiqueta. */}
      <BarraEtiquetas
        filters={filters}
        onEscolher={etiqueta => setFilters(f => ({ ...f, etiqueta, page: 0 }))}
      />

      {isLoading ? <PageLoading /> : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Card className="overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-secondary border-b border-surface-border">
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Nome</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Telefone</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cidade</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Estado</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="hidden xl:table-cell text-left text-xs font-medium text-text-muted px-4 py-3" title="Etiqueta do contato no WhatsApp. Prioriza a etiqueta posta pelo vendedor dono do contato.">Etiqueta</th>
                    <th className="hidden xl:table-cell text-left text-xs font-medium text-text-muted px-4 py-3" title="Ultima mensagem trocada no WhatsApp. Em ambar = cliente falou por ultimo (aguardando resposta).">Ultimo contato</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Orcamento</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Equipamento</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Data orcamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
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
                    return (
                      <tr key={c.id} className="hover:bg-surface-secondary cursor-pointer transition-colors"
                        onClick={() => setSelectedContact(c)}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-text-primary">{c.name || '(sem nome)'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {tel ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-text-secondary font-mono">{formatPhone(tel)}</span>
                              <CopyPhoneButton phone={tel} />
                            </div>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {c.city ? (
                            <span className="text-sm text-text-secondary">{c.city}</span>
                          ) : <span className="text-text-muted">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.state ? (
                            <Badge className="bg-blue-50 text-blue-700">{c.state}</Badge>
                          ) : <span className="text-text-muted">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">{(c.vendor_id ? vendorMap[c.vendor_id] : null) ?? '-'}</span>
                        </td>
                        <td className="hidden xl:table-cell px-4 py-3">
                          {/* WhatsApp e CRM lado a lado: as do CRM levam um ponto
                              e nunca substituem a da conversa real. */}
                          <div className="flex items-center gap-1 flex-wrap">
                            {etiquetaWa
                              ? <EtiquetaWa escolhida={etiquetaWa.escolhida} outras={etiquetaWa.outras} nVendedores={etiquetaWa.nVendedores} />
                              : (!etiquetasCrmDoContato.length && <Vazio />)}
                            <SelosCrm etiquetas={etiquetasCrmDoContato} />
                            <BotaoEtiquetar contactId={c.id} aplicadas={etiquetasCrmDoContato} compacto />
                          </div>
                        </td>
                        <td className="hidden xl:table-cell px-4 py-3 whitespace-nowrap">
                          {c.ultimo_contato ? <UltimoContatoWa resumo={c} /> : <Vazio />}
                        </td>
                        <td className="px-4 py-3">
                          {orcsLinkados.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge
                                className="bg-amber-50 text-amber-700 border border-amber-200 w-fit"
                                title={`${orcsLinkados[0].cliente} · ${orcsLinkados[0].path_principal}`}
                              >
                                <FileText className="h-3 w-3" /> {orcsLinkados[0].ano}-{orcsLinkados[0].numero}
                              </Badge>
                              {orcsLinkados.length > 1 && (
                                <Badge
                                  className="bg-stone-100 text-stone-600 text-[10px]"
                                  title={orcsLinkados.slice(1).map(o => `${o.ano}-${o.numero}${o.equipamento ? ' · ' + o.equipamento : ''}`).join('\n')}
                                >
                                  +{orcsLinkados.length - 1}
                                </Badge>
                              )}
                            </div>
                          ) : orc ? (
                            <Badge className="bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                              <FileText className="h-3 w-3" /> {orc}
                            </Badge>
                          ) : (
                            <span className="text-sm text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {orcsLinkados[0]?.equipamento ? (
                            <span
                              className="text-sm text-text-secondary truncate max-w-[280px] block"
                              title={orcsLinkados[0].equipamento}
                            >
                              {orcsLinkados[0].equipamento}
                            </span>
                          ) : (c.descricao_orcamento || getOrcDescricao(c.notes)) ? (
                            <span
                              className="text-sm text-text-muted truncate max-w-[280px] block"
                              title={c.descricao_orcamento || getOrcDescricao(c.notes) || ''}
                            >
                              {c.descricao_orcamento || getOrcDescricao(c.notes)}
                            </span>
                          ) : (
                            <span className="text-sm text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const dateStr = orcsLinkados[0]?.mtime_iso || c.data_orcamento
                            if (!dateStr) return <span className="text-sm text-text-muted">-</span>
                            const d = new Date(dateStr)
                            if (isNaN(d.getTime())) return <span className="text-sm text-text-muted">-</span>
                            const dd = String(d.getDate()).padStart(2, '0')
                            const mm = String(d.getMonth() + 1).padStart(2, '0')
                            const yy = d.getFullYear()
                            return <span className="text-sm text-text-secondary font-mono tabular-nums">{`${dd}/${mm}/${yy}`}</span>
                          })()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Mobile cards */}
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
                <Card key={c.id} hover onClick={() => setSelectedContact(c)} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text-primary truncate">{c.name || '(sem nome)'}</p>
                      {tel ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-sm text-text-secondary font-mono">{formatPhone(tel)}</p>
                          <CopyPhoneButton phone={tel} />
                        </div>
                      ) : (
                        <p className="text-sm text-text-muted mt-0.5">-</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {mobileTempOpt && <Badge className={mobileTempOpt.color}>{mobileTempOpt.icon}</Badge>}
                        {c.state && <Badge className="bg-blue-50 text-blue-700">{c.state}</Badge>}
                        {mobileFunilOpt && <Badge className={mobileFunilOpt.color}>{mobileFunilOpt.label}</Badge>}
                        {etiquetaWaM && <EtiquetaWa escolhida={etiquetaWaM.escolhida} outras={etiquetaWaM.outras} nVendedores={etiquetaWaM.nVendedores} />}
                        <SelosCrm etiquetas={etiqCrmMap?.get(c.id) ?? []} />
                        {/* stopPropagation: o card inteiro abre o contato — o menu de
                            etiqueta não pode abrir a ficha por baixo. */}
                        <span onClick={e => e.stopPropagation()}>
                          <BotaoEtiquetar contactId={c.id} aplicadas={etiqCrmMap?.get(c.id) ?? []} compacto />
                        </span>
                        {orcsLinkadosM.length > 0 ? (
                          <Badge
                            className="bg-amber-50 text-amber-700 border border-amber-200"
                            title={orcsLinkadosM[0].equipamento ?? orcsLinkadosM.slice(1, 4).map(o => `${o.ano}-${o.numero}`).join(', ')}
                          >
                            <FileText className="h-3 w-3" /> {orcsLinkadosM[0].ano}-{orcsLinkadosM[0].numero}
                            {orcsLinkadosM[0].equipamento && (
                              <span className="ml-1 text-[10px] opacity-80 truncate max-w-[140px] inline-block align-bottom">
                                · {orcsLinkadosM[0].equipamento}
                              </span>
                            )}
                            {orcsLinkadosM.length > 1 && <span className="ml-1 text-[10px] opacity-70">+{orcsLinkadosM.length - 1}</span>}
                          </Badge>
                        ) : orc ? (
                          <Badge className="bg-amber-50 text-amber-700 border border-amber-200"><FileText className="h-3 w-3" /> {orc}</Badge>
                        ) : null}
                        {c.vendor_id && vendorMap[c.vendor_id] && <span className="text-xs text-text-muted">{vendorMap[c.vendor_id!]}</span>}
                        {c.ultimo_contato && <UltimoContatoWa resumo={c} compacto />}
                      </div>
                    </div>
                    {tel && (
                      <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                        <a href={whatsappLink(tel)} target="_blank" rel="noopener"
                          className="p-2 rounded-lg bg-green-50 text-green-600">
                          <MessageCircle className="h-5 w-5" />
                        </a>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-text-muted">Pagina {filters.page + 1} de {formatNumber(totalPages)}</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={filters.page === 0}
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                  <ChevronLeft className="h-4 w-4" /> Anterior
                </Button>
                <Button variant="secondary" size="sm" disabled={filters.page >= totalPages - 1}
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                  Proxima <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedContact && (
        <ContactDetail contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}
    </div>
  )
}
