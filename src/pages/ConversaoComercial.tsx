import { useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { RefreshCw, Search, TrendingUp, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { QueryNotice } from '@/components/ui/QueryNotice'
import { ClienteWhatsAppOrcamento } from '@/components/orcamento/ClienteWhatsAppOrcamento'
import { useConversaoComercial, type AjusteConversao, type ClienteSemClassificacao, type DadosConversaoComercial, type VendaSemVinculo } from '@/hooks/useConversaoComercial'
import type { ConversaoClientDetail, ConversaoMetrics } from '@/lib/conversao-comercial'

const campo = 'min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50'
const acao = campo + ' inline-flex items-center justify-center gap-2 hover:border-border-strong'
const caixa = 'rounded-xl border border-border bg-surface p-4 sm:p-5'
const numero = new Intl.NumberFormat('pt-BR')
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const percentual = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const rotulos = {
  pending: 'Em acompanhamento', buyer: 'Comprou na janela', not_buyer: 'Sem compra na janela',
  unclassified: 'Classificação pendente', recurrent: 'Cliente recorrente',
} as const
const pendencias: Record<string, string> = {
  classificacao_conflitante: 'Há classificações diferentes para o mesmo cliente.',
  data_de_atendimento_invalida: 'Há atendimentos com data inválida.',
  identificador_de_pedido_ausente: 'Há pedidos sem identificação.',
  data_de_venda_invalida: 'Há pedidos com data de venda inválida.',
  pedido_com_vinculo_conflitante: 'Há pedidos vinculados a cadastros diferentes.',
  vendas_sem_vinculo_confirmado: 'Há pedidos que ainda precisam ser vinculados ao cliente.',
  data_de_compra_anterior_invalida: 'É preciso conferir a data de uma compra anterior.',
  clientes_sem_classificacao: 'Há contatos que precisam ser classificados como clientes comerciais ou internos.',
  compra_no_mesmo_dia_sem_ordem_confirmada: 'Há compras no dia do atendimento sem confirmação de que a conversa veio antes da venda.',
  captura_ainda_nao_verificada: 'A continuidade da captura de conversas ainda não foi conferida.',
  inicio_da_captura_nao_confirmado: 'A data de início da captura completa ainda não foi confirmada.',
  coorte_anterior_ao_inicio_da_captura: 'O período selecionado começa antes da captura acompanhada pelo sistema.',
  identidades_ausentes: 'Há registros sem cadastro de cliente resolvido.',
}
const textoPendencia = (s: string) => pendencias[s] ?? s.replace(/_/g, ' ')
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const dia = (s: string | null | undefined) => !s ? '—' : new Date(s.length === 10 ? `${s}T12:00:00-03:00` : s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
const instante = (s: string | null | undefined) => !s ? 'Não registrado' : new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

function hojeSP(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora)
  const parte = (tipo: string) => p.find(x => x.type === tipo)!.value
  return `${parte('year')}-${parte('month')}-${parte('day')}`
}
function diaSeguinte(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
/** to é exclusivo, como no servidor; o ano corrente termina amanhã no calendário de SP. */
export function periodoConversao(ano: number, mes: string, agora = new Date()) {
  const hoje = hojeSP(agora)
  const from = `${ano}-${mes || '01'}-01`
  const proximo = mes ? new Date(Date.UTC(ano, Number(mes), 1)).toISOString().slice(0, 10) : `${ano + 1}-01-01`
  return { from, to: proximo < diaSeguinte(hoje) ? proximo : diaSeguinte(hoje) }
}

export function ConversaoComercial() {
  const hoje = hojeSP(), anoAtual = Number(hoje.slice(0, 4))
  const [ano, setAno] = useState(anoAtual), [mes, setMes] = useState('')
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(60)
  const filtro = useMemo(() => ({ ...periodoConversao(ano, mes), windowDays }), [ano, mes, windowDays])
  const query = useConversaoComercial(filtro)
  if (query.authLoading) return <PageLoading />
  if (!query.autorizado) return <p className="p-6 text-ink">Seu acesso não permite consultar a conversão comercial.</p>
  return <div className="min-w-0 space-y-5 p-4 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink"><TrendingUp className="h-6 w-6 text-accent" aria-hidden />Conversão comercial</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">Quantos clientes conversados se tornam compradores, por vendedor e no total.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Link to="/vendidos" className={acao}>Ver pedidos vendidos</Link><button type="button" className={acao} disabled={query.isFetching} onClick={() => { void query.refetch() }}><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden />Atualizar</button></div>
    </header>

    <section aria-label="Período e prazo da conversão" className={`${caixa} flex flex-wrap items-end gap-3`}>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">Ano do primeiro atendimento registrado
        <select className={campo} value={ano} onChange={e => { setAno(Number(e.target.value)); setMes('') }}>{Array.from({ length: Math.max(3, anoAtual - 2022) }, (_, i) => anoAtual - i).map(a => <option key={a} value={a}>{a}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">Mês do primeiro atendimento
        <select className={campo} value={mes} onChange={e => setMes(e.target.value)}><option value="">Ano acumulado</option>{Array.from({ length: ano === anoAtual ? Number(hoje.slice(5, 7)) : 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => <option key={m} value={m}>{new Date(`${ano}-${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' })}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">Prazo para comprar após a conversa
        <select className={campo} value={windowDays} onChange={e => setWindowDays(Number(e.target.value) as 30 | 60 | 90)}>{[30, 60, 90].map(d => <option key={d} value={d}>{d} dias</option>)}</select>
      </label>
      <p className="max-w-lg pb-1 text-xs leading-relaxed text-ink-muted">O mês seleciona a entrada dos clientes. A compra pode ocorrer nos {windowDays} dias seguintes. Quem ainda está nesse prazo fica em acompanhamento.</p>
    </section>
    {query.error ? <QueryNotice error={query.error} loading={query.isFetching} onRetry={() => { void query.refetch() }} message={query.error instanceof Error ? query.error.message : 'Não foi possível consultar a conversão comercial.'} /> : query.isPending || !query.data ? <PageLoading /> : <ConteudoConversao key={`${query.identityKey}:${filtro.from}:${filtro.to}:${filtro.windowDays}`} data={query.data} salvar={query.salvar} salvando={query.salvando} />}
  </div>
}

type ConsultaProps = { data: DadosConversaoComercial; salvar: (a: AjusteConversao) => Promise<unknown>; salvando: boolean }
type Conferencia = { type: 'sale'; sale: VendaSemVinculo } | { type: 'classification'; client: ClienteSemClassificacao }

export function ConteudoConversao({ data, salvar, salvando }: ConsultaProps) {
  const [seller, setSeller] = useState(''), [status, setStatus] = useState(''), [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1), [evidencia, setEvidencia] = useState<ConversaoClientDetail | null>(null)
  const [conferencia, setConferencia] = useState<Conferencia | null>(null)
  const vendedor = data.scope.sellers.find(v => v.key === seller)
  const metrica = seller ? data.sellers.find(v => v.key === seller) : data.summary
  const nomes = new Map(data.scope.sellers.map(v => [v.key, v.name]))
  const clientes = useMemo(() => data.clients.filter(c => (!seller || c.sellerKey === seller) && (!status || c.status === status)
    && (!busca.trim() || norm(`${c.name} ${c.phone}`).includes(norm(busca.trim())) || (!!busca.replace(/\D/g, '') && (c.phone ?? '').replace(/\D/g, '').includes(busca.replace(/\D/g, ''))))), [data.clients, seller, status, busca])
  const paginas = Math.max(1, Math.ceil(clientes.length / 50)), atual = Math.min(pagina, paginas)
  const alterar = (f: () => void) => { f(); setPagina(1) }
  const parcial = data.quality.status !== 'verified'
  return <>
    <section className={`${caixa} border-warning/30 bg-warning/5`} aria-label="Qualidade dos registros">
      <h2 className="font-semibold text-ink">{parcial ? 'Taxa observada · captura parcial' : 'Captura conferida no período'}</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{parcial ? 'Este cálculo considera os registros disponíveis. Lacunas no histórico, clientes sem classificação ou pedidos sem vínculo podem alterar o resultado.' : 'A captura e os vínculos deste período passaram pela conferência indicada no sistema.'}</p>
      <p className="mt-2 text-xs text-ink-muted">{numero.format(data.quality.unlinkedSales)} pedido(s) sem vínculo · {numero.format(data.quality.missingIdentity)} registro(s) sem identidade resolvida{data.quality.captureSince ? ` · início da captura: ${dia(data.quality.captureSince)}` : ' · início de captura completa ainda não confirmado'}.</p>
      {data.quality.gaps.length > 0 && <details className="mt-3 text-xs text-ink-muted"><summary className="cursor-pointer font-medium text-ink">Ver pendências da captura ({data.quality.gaps.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{data.quality.gaps.map((gap, i) => <li key={i}>{textoPendencia(gap)}</li>)}</ul></details>}
    </section>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-ink">{vendedor?.name ?? (data.scope.canManage ? 'Total da equipe' : 'Sua conversão')}</h2><p className="mt-1 text-xs text-ink-muted">Entrada de {dia(data.cohort.from)} até {dia(diaAnterior(data.cohort.to))} · acompanhamento de {data.cohort.windowDays} dias · corte: {instante(data.cutoffAt)}.</p></div>
      {data.scope.canManage && <label className="flex items-center gap-2 text-sm text-ink-muted">Vendedor<select aria-label="Filtrar vendedor da conversão" className={campo} value={seller} onChange={e => alterar(() => setSeller(e.target.value))}><option value="">Toda a equipe</option>{data.scope.sellers.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>}
    </div>
    {metrica ? <MetricasConversao value={metrica} windowDays={data.cohort.windowDays} /> : <p role="alert" className={caixa}>Não foi possível localizar as métricas deste vendedor.</p>}
    <p className="text-xs leading-relaxed text-ink-muted">A taxa usa compradores entre os clientes comerciais novos cujo prazo já terminou. Clientes recorrentes e classificações pendentes aparecem separados. O total deduplica clientes entre vendedores e pode ser diferente da soma das linhas.</p>

    {data.scope.canManage && <section className={`${caixa} min-w-0`} aria-label="Conversão por vendedor">
      <h2 className="mb-3 font-semibold text-ink">Por vendedor</h2>
      <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm"><thead className="border-b border-border text-xs text-ink-muted"><tr>{['Vendedor', 'Atendidos', 'Prazo concluído', 'Compradores', 'Taxa observada', 'Clientes / comprador', 'Em acompanhamento', 'Recorrentes', 'A classificar'].map(h => <th key={h} className="px-3 py-3 text-right first:text-left">{h}</th>)}</tr></thead><tbody className="divide-y divide-border text-ink">{data.sellers.map(v => <tr key={v.key} className="hover:bg-surface-2/50"><td className="px-3 py-3"><button type="button" className="rounded font-medium underline decoration-border underline-offset-4 focus-visible:ring-2 focus-visible:ring-accent" onClick={() => alterar(() => setSeller(v.key))}>{v.name}</button></td>{[v.attended, v.mature, v.buyers].map((n, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{numero.format(n)}</td>)}<td className="px-3 py-3 text-right tabular-nums">{taxa(v.ratePct)}</td><td className="px-3 py-3 text-right tabular-nums">{razao(v.clientsPerBuyer)}</td>{[v.pending, v.recurrent, v.unclassified].map((n, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{numero.format(n)}</td>)}</tr>)}</tbody></table></div>
      {!data.sellers.length && <p className="py-4 text-sm text-ink-muted">Nenhum vendedor disponível neste período.</p>}
    </section>}

    <section className={`${caixa} min-w-0`} aria-label="Conferência dos atendimentos">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-ink">Conferir os atendimentos</h2><p className="mt-1 text-xs text-ink-muted">Cada linha mostra o cliente no atendimento de um vendedor. Abra a origem para conferir conversa, ligação e pedido.</p></div></div>
      <div className="mb-4 flex flex-wrap gap-2"><label className="relative min-w-0 flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-faint" aria-hidden /><input aria-label="Buscar atendimentos por cliente ou WhatsApp" placeholder="Cliente ou WhatsApp" className={`${campo} w-full pl-9`} value={busca} onChange={e => alterar(() => setBusca(e.target.value))} /></label><select aria-label="Situação do atendimento na conversão" className={campo} value={status} onChange={e => alterar(() => setStatus(e.target.value))}><option value="">Todas as situações</option>{Object.entries(rotulos).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-xs text-ink-muted"><tr>{['Cliente / WhatsApp', 'Vendedor', 'Primeiro atendimento', 'Prazo até', 'Situação', 'Pedidos na janela', 'Origem'].map(h => <th key={h} className="whitespace-nowrap px-3 py-3 text-left">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{clientes.slice((atual - 1) * 50, atual * 50).map(c => <tr key={c.id} className="text-ink hover:bg-surface-2/50"><td className="px-3 py-3"><span className="mb-1 block font-medium">{c.name || 'Cliente sem nome'}</span><ClienteWhatsAppOrcamento cliente={{ cliente_nome: c.name, cliente_fone: c.phone, vendedor_nome: c.sellerKey, numero: c.id }} /></td><td className="px-3 py-3 text-xs">{nomes.get(c.sellerKey) ?? c.sellerKey}</td><td className="whitespace-nowrap px-3 py-3 text-xs">{dia(c.firstAttendedAt)}</td><td className="whitespace-nowrap px-3 py-3 text-xs">{dia(diaAnterior(c.maturesAt))}</td><td className="px-3 py-3"><span className="inline-flex whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 py-1 text-xs">{rotulos[c.status]}</span></td><td className="px-3 py-3 text-xs">{c.sales.length ? c.sales.map(s => s.orderNumber || 'Sem número').join(' · ') : '—'}</td><td className="px-3 py-3"><button type="button" className={acao + ' whitespace-nowrap text-xs'} onClick={() => setEvidencia(c)}>Ver origem</button></td></tr>)}{!clientes.length && <tr><td colSpan={7} className="py-8 text-center text-sm text-ink-muted">Nenhum atendimento corresponde aos filtros.</td></tr>}</tbody></table></div>
      <Paginacao atual={atual} paginas={paginas} total={clientes.length} onPage={setPagina} label="atendimentos" />
    </section>

    {data.scope.canManage && <Pendencias data={data} onConferir={setConferencia} />}
    <p className="text-xs text-ink-faint">Consulta em {instante(data.generatedAt)}. Etiqueta “Vendido” ou orçamento aprovado, sozinhos, não comprovam uma compra neste cálculo.</p>
    {evidencia && <OrigemDialog client={evidencia} sellerName={nomes.get(evidencia.sellerKey) ?? evidencia.sellerKey} onClose={() => setEvidencia(null)} />}
    {conferencia && <ConferenciaDialog key={conferencia.type === 'sale' ? conferencia.sale.id : conferencia.client.id} target={conferencia} clients={data.allClients} salvar={salvar} salvando={salvando} onClose={() => setConferencia(null)} />}
  </>
}

function diaAnterior(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
const taxa = (v: number | null) => v === null ? '—' : `${percentual.format(v)}%`
const razao = (v: number | null) => v === null ? '—' : decimal.format(v)

export function MetricasConversao({ value: m, windowDays }: { value: ConversaoMetrics; windowDays: number }) {
  const cards = [
    { label: 'Clientes atendidos', value: numero.format(m.attended), note: `${numero.format(m.recurrent)} recorrente(s) · ${numero.format(m.unclassified)} a classificar` },
    { label: 'Prazo concluído', value: numero.format(m.mature), note: `Clientes novos com ${windowDays} dias completos` },
    { label: 'Compradores', value: numero.format(m.buyers), note: `${numero.format(m.linkedOrders)} pedido(s) na base com prazo concluído` },
    { label: 'Taxa observada', value: taxa(m.ratePct), note: m.mature ? `${numero.format(m.buyers)} ÷ ${numero.format(m.mature)} clientes com prazo concluído` : 'Aguardando clientes elegíveis com prazo concluído' },
    { label: 'Clientes por comprador', value: razao(m.clientsPerBuyer), note: m.buyers ? 'Clientes com prazo concluído ÷ compradores' : 'Sem compradores na base com prazo concluído' },
    { label: 'Em acompanhamento', value: numero.format(m.pending), note: 'Ainda fora da taxa: prazo aberto ou sequência a conferir' },
  ]
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(c => <div key={c.label} className={caixa}><h3 className="text-sm text-ink-muted">{c.label}</h3><p className="mt-2 text-3xl font-semibold tabular-nums text-ink">{c.value}</p><p className="mt-2 text-xs leading-relaxed text-ink-faint">{c.note}</p></div>)}</div>
}

function Paginacao({ atual, paginas, total, onPage, label }: { atual: number; paginas: number; total: number; onPage: (p: number) => void; label: string }) {
  return <nav aria-label={`Paginação de ${label}`} className="mt-4 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-ink-muted">{numero.format(total)} registro(s) · página {atual} de {paginas}</p><div className="flex gap-2"><button type="button" className={acao} disabled={atual <= 1} onClick={() => onPage(atual - 1)}>Anterior</button><button type="button" className={acao} disabled={atual >= paginas} onClick={() => onPage(atual + 1)}>Próxima</button></div></nav>
}

function Pendencias({ data, onConferir }: { data: DadosConversaoComercial; onConferir: (c: Conferencia) => void }) {
  const [tipo, setTipo] = useState<'sales' | 'clients'>('sales'), [busca, setBusca] = useState(''), [pagina, setPagina] = useState(1)
  const vendas = data.unlinkedSales.filter(s => norm(`${s.orderNumber} ${s.clientName} ${s.phone}`).includes(norm(busca)))
  const clientes = data.unclassifiedClients.filter(c => norm(`${c.name} ${c.phone}`).includes(norm(busca)))
  const total = tipo === 'sales' ? vendas.length : clientes.length, paginas = Math.max(1, Math.ceil(total / 25)), atual = Math.min(pagina, paginas)
  return <section className={`${caixa} min-w-0`} aria-label="Pendências de conferência">
    <h2 className="font-semibold text-ink">Pendências de conferência</h2><p className="mt-1 text-xs text-ink-muted">Vínculos e classificações são registrados com justificativa. A conferência pode mudar os resultados observados.</p>
    <div className="my-4 flex flex-wrap gap-2"><button type="button" className={acao} aria-pressed={tipo === 'sales'} onClick={() => { setTipo('sales'); setPagina(1) }}>Pedidos a conferir ({data.unlinkedSales.length})</button><button type="button" className={acao} aria-pressed={tipo === 'clients'} onClick={() => { setTipo('clients'); setPagina(1) }}>Clientes a classificar ({data.unclassifiedClients.length})</button><input aria-label="Buscar pendências de conferência" className={`${campo} min-w-0 flex-1`} placeholder="Buscar cliente, pedido ou WhatsApp" value={busca} onChange={e => { setBusca(e.target.value); setPagina(1) }} /></div>
    <ul className="divide-y divide-border">{tipo === 'sales' ? vendas.slice((atual - 1) * 25, atual * 25).map(s => <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium text-ink">Pedido {s.orderNumber || 'sem número'} · {s.clientName || 'Cliente sem nome'}</p><p className="mt-1 text-xs text-ink-muted">{dia(s.date)} · {s.phone || 'Sem WhatsApp'} · {textoPendencia(s.reason)}</p></div><button type="button" className={acao} onClick={() => onConferir({ type: 'sale', sale: s })}>Conferir pedido</button></li>) : clientes.slice((atual - 1) * 25, atual * 25).map(c => <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div><p className="text-sm font-medium text-ink">{c.name || 'Cliente sem nome'}</p><p className="mt-1 text-xs text-ink-muted">{c.phone || 'Sem WhatsApp'}</p></div><button type="button" className={acao} onClick={() => onConferir({ type: 'classification', client: c })}>Classificar</button></li>)}</ul>
    {!total && <p className="py-5 text-sm text-ink-muted">Nenhuma pendência corresponde a esta busca.</p>}
    <Paginacao atual={atual} paginas={paginas} total={total} onPage={setPagina} label="pendências" />
  </section>
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-ink shadow-xl focus:outline-none"><Dialog.Title className="pr-8 text-lg font-semibold">{title}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</Dialog.Description><Dialog.Close className="absolute right-3 top-3 rounded-lg p-2 text-ink-muted focus-visible:ring-2 focus-visible:ring-accent" aria-label="Fechar conferência"><X className="h-5 w-5" aria-hidden /></Dialog.Close><div className="mt-5">{children}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function OrigemDialog({ client: c, sellerName, onClose }: { client: ConversaoClientDetail; sellerName: string; onClose: () => void }) {
  return <Modal title={c.name || 'Cliente sem nome'} description={`Atendimento de ${sellerName}. Situação: ${rotulos[c.status]}.`} onClose={onClose}>
    <dl className="grid gap-4 text-sm sm:grid-cols-2">{[
      ['Primeiro atendimento registrado', instante(c.firstAttendedAt)], ['Último dia do prazo de compra', dia(diaAnterior(c.maturesAt))],
      ['Mensagem recebida', instante(c.evidence.inboundAt)], ['Mensagem enviada', instante(c.evidence.outboundAt)],
      ['Ligação atendida', instante(c.evidence.answeredCallAt)], ['Fonte do registro', c.evidence.source === 'tracked' ? 'Captura acompanhada pelo sistema' : 'Histórico recuperado'],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words text-ink">{value}</dd></div>)}</dl>
    <h3 className="mt-5 text-sm font-semibold">Pedidos vinculados na janela</h3>{c.sales.length ? <ul className="mt-2 space-y-2 text-sm">{c.sales.map(s => <li key={s.id}>Pedido {s.orderNumber || 'sem número'} · {dia(s.date)}</li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">Nenhum pedido vinculado nesta janela.</p>}
  </Modal>
}

function ConferenciaDialog({ target, clients, salvar, salvando, onClose }: { target: Conferencia; clients: DadosConversaoComercial['allClients']; salvar: ConsultaProps['salvar']; salvando: boolean; onClose: () => void }) {
  const venda = target.type === 'sale' ? target.sale : null
  const [busca, setBusca] = useState(venda?.phone || venda?.clientName || ''), [selected, setSelected] = useState('')
  const [classification, setClassification] = useState<'commercial' | 'internal'>('commercial')
  const [reason, setReason] = useState(''), [sameDayConfirmed, setSameDayConfirmed] = useState(false), [error, setError] = useState('')
  const candidatos = clients.filter(c => c.classification !== 'internal' && (norm(`${c.name} ${c.phone}`).includes(norm(busca.trim())) || (!!busca.replace(/\D/g, '') && (c.phone ?? '').replace(/\D/g, '').includes(busca.replace(/\D/g, '')))))
  const escolhido = clients.find(c => c.id === selected && c.classification !== 'internal')
  return <Modal title={venda ? `Conferir pedido ${venda.orderNumber || 'sem número'}` : 'Classificar cliente'} description={venda ? 'Selecione o cadastro da mesma pessoa ou empresa. Confira o vínculo quando o telefone mudou ou falta identificação. Nas compras do mesmo dia, confira também se a conversa aconteceu antes da venda.' : `Informe se ${target.type === 'classification' ? target.client.name || target.client.phone || 'este cadastro' : ''} é um cliente comercial ou um contato interno.`} onClose={onClose}>
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); setError('')
      if (reason.trim().length < 8 || reason.trim().length > 1000 || (venda && !escolhido)) return
      try {
        await salvar(venda ? { action: 'link_sale', saleId: venda.id, clientId: escolhido!.id, reason: reason.trim(), sameDayConfirmed } : { action: 'classify_client', clientId: target.type === 'classification' ? target.client.id : '', classification, reason: reason.trim() })
        onClose()
      } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a conferência.') }
    }}>
      {venda ? <>
        <p className="rounded-lg bg-surface-2 p-3 text-sm">{venda.clientName || 'Cliente sem nome'} · {venda.phone || 'Sem telefone'} · venda em {dia(venda.date)}</p>
        <label className="flex flex-col gap-1 text-sm">Buscar cadastro por nome ou WhatsApp<input className={campo} value={busca} onChange={e => setBusca(e.target.value)} /></label>
        {escolhido && <p className="text-sm text-ink">Selecionado: <strong>{escolhido.name || 'Cliente sem nome'}</strong> · {escolhido.phone || 'Sem telefone'}</p>}
        <fieldset className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-border p-3"><legend className="px-1 text-xs text-ink-muted">Cadastros encontrados ({candidatos.length})</legend>{candidatos.slice(0, 30).map(c => <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded p-2 text-sm hover:bg-surface-2"><input type="radio" name="cliente-vinculo" value={c.id} checked={selected === c.id} onChange={() => setSelected(c.id)} className="mt-0.5" /><span>{c.name || 'Cliente sem nome'}<span className="block text-xs text-ink-muted">{c.phone || 'Sem telefone'}</span></span></label>)}{!candidatos.length && <p className="text-sm text-ink-muted">Nenhum cadastro encontrado. Ajuste a busca.</p>}{candidatos.length > 30 && <p className="text-xs text-ink-muted">Mostrando os primeiros 30. Refine a busca para localizar o cadastro.</p>}</fieldset>
        <label className="flex items-start gap-2 text-sm leading-relaxed"><input type="checkbox" className="mt-1" checked={sameDayConfirmed} onChange={e => setSameDayConfirmed(e.target.checked)} /><span>Confirmo que a conversa aconteceu antes da venda.<span className="block text-xs text-ink-muted">Marque somente após conferir a sequência. Necessário para contar uma venda do mesmo dia sem horário registrado.</span></span></label>
      </> : <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Classificação</legend><label className="flex gap-2 text-sm"><input type="radio" name="classificacao" checked={classification === 'commercial'} onChange={() => setClassification('commercial')} />Cliente comercial</label><label className="flex gap-2 text-sm"><input type="radio" name="classificacao" checked={classification === 'internal'} onChange={() => setClassification('internal')} />Contato interno · equipe, uso pessoal ou operação</label></fieldset>}
      <label className="flex flex-col gap-1 text-sm">Justificativa da conferência<textarea className={`${campo} min-h-24`} required minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Descreva o que você conferiu para fazer este ajuste." /><span className="text-xs text-ink-muted">Mínimo de 8 caracteres. O ajuste fica registrado para auditoria.</span></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={acao} disabled={salvando} onClick={onClose}>Cancelar</button><button type="submit" className={`${acao} bg-accent text-white`} disabled={salvando || reason.trim().length < 8 || (venda !== null && !escolhido)}>{salvando ? 'Salvando conferência…' : 'Salvar conferência'}</button></div>
    </form>
  </Modal>
}
