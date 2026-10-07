import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Route, ArrowLeft } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { QueryNotice } from '@/components/ui/QueryNotice'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import { useControleRastreio, type RastreioVenda } from '@/hooks/useControleRastreio'
import {
  ORIGEM_NAO_INFORMADA, origemFinalVenda, rotuloOrigemVenda, chaveOrigemRastreada,
  type OrigemFinal, type BaseOrigem,
} from '@/lib/vendas-origem'

// ───────────────────────────────────────────────────────────────────────────
// Rastreio de Origem das Vendas (/controle/rastreio) — pedido do Daniel, 07/10/2026.
//
// Uma linha por venda do mês com os dois lados à vista: como o telefone do cliente
// chegou de verdade (o que o banco registrou) e o que o vendedor marcou no pedido.
// A coluna "Origem que vale" é a mesma regra do Painel de Vendas
// (lib/vendas-origem → origemFinalVenda): os chips de lá somam exatamente estas linhas.
//
// A tela só mostra. Quem recorta o acesso é a RPC controle_vendas_rastreio (devolve
// zero linha pra quem não tem menu.controle) — o guard daqui só escolhe a mensagem.
// ───────────────────────────────────────────────────────────────────────────

type Situacao = 'todas' | 'rastreio' | 'diverge' | 'vendedor' | 'sem_origem'

const SITUACOES: { key: Situacao; label: string; title: string }[] = [
  { key: 'todas', label: 'Todas', title: 'Todas as vendas do mês' },
  { key: 'rastreio', label: 'Pelo rastreio', title: 'O telefone bateu com um lead, repasse ou anúncio com origem identificada' },
  { key: 'diverge', label: 'Rastreio ≠ vendedor', title: 'O rastreio achou uma origem e o vendedor marcou outra' },
  { key: 'vendedor', label: 'Só o vendedor', title: 'O rastreio não achou origem; vale o que o vendedor marcou' },
  { key: 'sem_origem', label: 'Sem origem', title: 'Nem rastreio, nem vendedor' },
]

function fmtBRL(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}
/** 'YYYY-MM-DD' → 'DD/MM/AAAA' sem passar por Date (data de venda não tem fuso). */
function fmtDia(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}
function fmtQuando(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

const ROTULO_FONTE: Record<string, string> = {
  lead: 'lead registrado no atendimento',
  repasse: 'lead entregue a vendedor',
  clique: 'clique em anúncio',
}
const ROTULO_VIA: Record<string, string> = {
  pedido: 'telefone do pedido',
  orcamento: 'telefone do orçamento',
}

const SELO_BASE: Record<BaseOrigem, { texto: string; classe: string; title: string }> = {
  rastreio: { texto: 'Rastreio', classe: 'bg-green-500/15 text-green-600', title: 'O telefone bateu com um registro de chegada com origem identificada' },
  vendedor: { texto: 'Vendedor', classe: 'bg-surface-tertiary text-text-secondary', title: 'O rastreio não achou origem; vale o que o vendedor marcou no pedido' },
  historico: { texto: 'Pedido anterior', classe: 'bg-blue-500/15 text-blue-600', title: 'Sem rastreio e sem origem marcada, mas o cliente já tinha pedido antes' },
  porta: { texto: 'Porta de entrada', classe: 'bg-amber-500/15 text-amber-600', title: 'Só se sabe por onde ele entrou (WhatsApp da empresa), não como achou a empresa' },
  nenhuma: { texto: 'Sem origem', classe: 'bg-red-500/10 text-red-500', title: 'Nem rastreio, nem vendedor' },
}

interface Linha { v: RastreioVenda; o: OrigemFinal }

function situacaoDe(o: OrigemFinal): Exclude<Situacao, 'todas'> | 'outras' {
  if (o.conferencia === 'diverge') return 'diverge'
  if (o.base === 'rastreio') return 'rastreio'
  if (o.base === 'vendedor') return 'vendedor'
  if (o.base === 'nenhuma') return 'sem_origem'
  return 'outras'
}

function ComoChegou({ v }: { v: RastreioVenda }) {
  const temOrigem = chaveOrigemRastreada(v.chegada_origem) !== null
  return (
    <div className="space-y-0.5">
      {temOrigem ? (
        <>
          <p className="font-medium text-text-primary">
            {rotuloOrigemVenda(chaveOrigemRastreada(v.chegada_origem) as string)}
            <span className="font-normal text-text-muted"> · {fmtQuando(v.chegada_em)}</span>
          </p>
          {(v.chegada_anuncio || v.chegada_criativo) && (
            <p className="text-text-secondary">
              Anúncio: {v.chegada_anuncio ?? '(sem nome)'}{v.chegada_criativo ? ` (${v.chegada_criativo})` : ''}
            </p>
          )}
          <p className="text-text-muted">
            Bateu pelo {ROTULO_VIA[v.chegada_via ?? ''] ?? 'telefone'} · {ROTULO_FONTE[v.chegada_fonte ?? ''] ?? 'registro de chegada'}
            {v.chegadas_com_origem > 1 && (
              <> · {v.chegadas_com_origem} contatos{v.ultima_chegada_origem ? `, último ${fmtQuando(v.ultima_chegada_em)} (${rotuloOrigemVenda(chaveOrigemRastreada(v.ultima_chegada_origem) ?? ORIGEM_NAO_INFORMADA)})` : ''}</>
            )}
          </p>
        </>
      ) : v.contato_sem_origem_em ? (
        <p className="text-text-secondary">
          Contato em {fmtQuando(v.contato_sem_origem_em)} <span className="text-text-muted">sem origem identificada (escreveu direto, sem clique rastreável)</span>
        </p>
      ) : !v.telefone_pedido && !v.telefone_orcamento ? (
        <p className="text-text-muted">Pedido e orçamento sem telefone: não há o que cruzar.</p>
      ) : (
        <p className="text-text-muted">Nenhum registro de chegada com este telefone.</p>
      )}
      {v.pedido_anterior_data && (
        <p className="text-blue-600">Já tinha pedido antes: {v.pedido_anterior_numero ?? 'pedido'} em {fmtDia(v.pedido_anterior_data)}</p>
      )}
      {v.na_base_desde && !temOrigem && (
        <p className="text-text-muted">No cadastro de contatos desde {fmtQuando(v.na_base_desde)}</p>
      )}
    </div>
  )
}

export default function ControleRastreio() {
  const { profile, loading } = useAuth()
  const can = useCan()
  const [mes, setMes] = useState<Date>(() => startOfMonth(new Date()))
  const [situacao, setSituacao] = useState<Situacao>('todas')
  const from = format(startOfMonth(mes), 'yyyy-MM-dd')
  const to = format(endOfMonth(mes), 'yyyy-MM-dd')
  const q = useControleRastreio(from, to)

  const linhas = useMemo<Linha[]>(
    () => (q.data ?? []).map(v => ({ v, o: origemFinalVenda(v) })),
    [q.data],
  )
  const resumo = useMemo(() => {
    const r = { total: linhas.length, valor: 0, rastreio: 0, confere: 0, diverge: 0, vendedor: 0, sem_origem: 0, outras: 0 }
    for (const { v, o } of linhas) {
      r.valor += Number(v.valor) || 0
      if (o.base === 'rastreio') r.rastreio += 1
      if (o.conferencia === 'confere') r.confere += 1
      if (o.conferencia === 'diverge') r.diverge += 1
      if (o.base === 'vendedor') r.vendedor += 1
      if (o.base === 'nenhuma') r.sem_origem += 1
      if (o.base === 'historico' || o.base === 'porta') r.outras += 1
    }
    return r
  }, [linhas])
  const visiveis = useMemo(() => {
    if (situacao === 'todas') return linhas
    if (situacao === 'rastreio') return linhas.filter(l => l.o.base === 'rastreio')
    return linhas.filter(l => situacaoDe(l.o) === situacao)
  }, [linhas, situacao])

  if (loading) return <PageLoading />
  if (!profile?.approved_at || !can('menu.controle')) {
    return <div role="alert" className="p-6 text-text-primary">Sem permissão para ver o rastreio de origem das vendas.</div>
  }

  const mesAtual = startOfMonth(new Date()).getTime() === mes.getTime()
  const contagem: Record<Situacao, number> = {
    todas: resumo.total, rastreio: resumo.rastreio, diverge: resumo.diverge, vendedor: resumo.vendedor, sem_origem: resumo.sem_origem,
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/controle" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
            <ArrowLeft className="h-3 w-3" /> Painel de Vendas
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-text-primary flex items-center gap-2">
            <Route className="h-7 w-7 text-accent" />
            Rastreio de Origem das Vendas
          </h1>
          <p className="text-sm text-text-muted mt-1 max-w-3xl">
            O telefone do pedido e o do orçamento que virou pedido são cruzados com os registros de chegada (lead, repasse a
            vendedor e clique em anúncio). Achou origem, vale o rastreio. Não achou, vale o que o vendedor marcou.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-surface-border bg-surface-secondary p-0.5">
          <button type="button" aria-label="Mês anterior" onClick={() => setMes(m => addMonths(m, -1))}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-muted hover:text-text-primary">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-xs font-semibold text-text-primary min-w-[7.5rem] text-center">
            {format(mes, "MMMM 'de' yyyy", { locale: ptBR }).replace(/^./, c => c.toUpperCase())}
          </span>
          <button type="button" aria-label="Próximo mês" disabled={mesAtual} onClick={() => setMes(m => addMonths(m, 1))}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-muted hover:text-text-primary disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {q.error ? (
        <QueryNotice error={q.error} loading={q.isFetching} onRetry={() => { void q.refetch() }} message="Não foi possível carregar o rastreio das vendas." />
      ) : q.isLoading ? <PageLoading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { t: 'Vendas no mês', n: String(resumo.total), s: fmtBRL(resumo.valor) },
              { t: 'Pelo rastreio', n: String(resumo.rastreio), s: resumo.total ? `${Math.round((resumo.rastreio / resumo.total) * 100)}% das vendas` : '—' },
              { t: 'Rastreio = vendedor', n: String(resumo.confere), s: 'os dois dizem o mesmo canal' },
              { t: 'Rastreio ≠ vendedor', n: String(resumo.diverge), s: 'vale o rastreio' },
              { t: 'Só o vendedor', n: String(resumo.vendedor), s: resumo.sem_origem ? `${resumo.sem_origem} sem origem nenhuma` : 'nenhuma sem origem' },
            ].map(k => (
              <Card key={k.t} className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{k.t}</span>
                <p className="mt-1 text-2xl font-bold text-text-primary tabular-nums">{k.n}</p>
                <p className="text-[11px] text-text-muted">{k.s}</p>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SITUACOES.map(s => {
              const ativo = situacao === s.key
              return (
                <button key={s.key} type="button" aria-pressed={ativo} title={s.title} onClick={() => setSituacao(s.key)}
                  className={`inline-flex items-center gap-1 px-2.5 h-7 text-xs font-medium rounded-full border transition-colors ${
                    ativo ? 'bg-accent border-accent text-white' : 'border-surface-border bg-surface-secondary text-text-secondary hover:text-text-primary'
                  }`}>
                  {s.label}
                  <span className={`tabular-nums ${ativo ? 'text-white/80' : 'text-text-muted'}`}>{contagem[s.key]}</span>
                </button>
              )
            })}
          </div>

          <Card className="overflow-x-auto">
            {visiveis.length === 0 ? (
              <p className="text-center py-10 text-sm text-text-muted">
                {resumo.total === 0 ? 'Nenhuma venda neste mês.' : 'Nenhuma venda nesta situação.'}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-surface-border">
                    <th className="px-3 py-2 font-medium">Pedido</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium text-right">Valor</th>
                    <th className="px-3 py-2 font-medium">Telefone</th>
                    <th className="px-3 py-2 font-medium">Como chegou de verdade</th>
                    <th className="px-3 py-2 font-medium">Vendedor marcou</th>
                    <th className="px-3 py-2 font-medium">Origem que vale</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(({ v, o }) => {
                    const selo = SELO_BASE[o.base]
                    const foneOrcDiferente = v.telefone_orcamento && v.telefone_orcamento.replace(/\D/g, '') !== (v.telefone_pedido ?? '').replace(/\D/g, '')
                    return (
                      <tr key={v.pedido_id} className="border-b border-surface-border last:border-0 align-top">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link to={`/controle/pedidos/${encodeURIComponent(v.pedido_id)}`} className="font-semibold text-accent hover:underline">
                            {v.pedido_numero ?? '—'}
                          </Link>
                          <p className="text-text-muted">{fmtDia(v.data_venda)}</p>
                          {v.numero_orcamento && <p className="text-text-muted">Orç. {v.numero_orcamento}</p>}
                        </td>
                        <td className="px-3 py-2 max-w-[14rem]">
                          <p className="font-medium text-text-primary truncate" title={v.cliente ?? ''}>{v.cliente ?? '—'}</p>
                          <p className="text-text-muted">{[v.vendedor, v.vendedor_2].filter(Boolean).join(' + ') || '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-text-primary">{fmtBRL(Number(v.valor) || 0)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-text-secondary">
                          <p>{v.telefone_pedido ?? <span className="text-text-muted">sem telefone no pedido</span>}</p>
                          {foneOrcDiferente && <p className="text-text-muted" title="Telefone que está no orçamento ligado a este pedido">orçamento: {v.telefone_orcamento}</p>}
                        </td>
                        <td className="px-3 py-2 min-w-[16rem] max-w-[24rem]"><ComoChegou v={v} /></td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.declarada === ORIGEM_NAO_INFORMADA
                            ? <span className="text-text-muted">não informou</span>
                            : <span className="text-text-secondary">{rotuloOrigemVenda(o.declarada)}</span>}
                          {/^\d{4}-\d{2}-\d{2}/.test(v.data_primeiro_contato ?? '') && <p className="text-text-muted" title="Data do primeiro contato que o vendedor informou no pedido">1º contato: {fmtDia(v.data_primeiro_contato)}</p>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <p className="font-semibold text-text-primary">{o.rotulo}</p>
                          <span title={selo.title} className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${selo.classe}`}>{selo.texto}</span>
                          {o.conferencia === 'confere' && <span title="O vendedor marcou o mesmo canal" className="ml-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-500/15 text-green-600">confere</span>}
                          {o.conferencia === 'diverge' && <span title="O vendedor marcou outro canal; vale o rastreio" className="ml-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600">vendedor marcou outro</span>}
                          {o.base === 'vendedor' && o.chave === 'ja_era_cliente' && v.pedido_anterior_data && (
                            <span title={`Pedido anterior ${v.pedido_anterior_numero ?? ''} em ${fmtDia(v.pedido_anterior_data)}`} className="ml-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/15 text-blue-600">pedido anterior confirma</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <p className="text-[11px] text-text-muted max-w-4xl">
            Só conta chegada registrada até o dia da venda. Para quem já tinha pedido antes, só conta o que veio depois daquele pedido
            (o anúncio que trouxe a primeira compra não é a origem da segunda). "WhatsApp da empresa" é a porta por onde o cliente
            entrou, não como ele achou a empresa, e por isso não passa por cima do que o vendedor marcou. Garantia e pedido cancelado
            ficam fora, como no Painel de Vendas.
          </p>
        </>
      )}
    </div>
  )
}
