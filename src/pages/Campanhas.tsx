import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Megaphone, Info } from 'lucide-react'

// Análise de campanhas — 18/09/2026.
// Junta as quatro leituras que existem hoje, da mais confiável pra menos:
//   1. por ORIGEM        -> de onde o lead veio (Meta, WhatsApp direto, etc.)
//   2. por CÓDIGO &nn    -> tem histórico desde 24/04, mas o código sai do TEXTO da
//                           mensagem, então &88/&90/&50 se misturam (mesmo texto).
//   3. por CAMPANHA      -> precisa de meta_anuncio_mapa preenchido (token/CSV do Meta)
//   4. por ANÚNCIO REAL  -> ad_id que a Reply captura no clique; só enche a partir de agora
// As seções 3 e 4 mostram o motivo quando estão vazias, em vez de fingir que não há dado.

type Origem = {
  origem: string; leads: number; qualificou: number; pct_qualif: number | null
  orcamentos: number; vendas: number; leads_por_orcamento: number | null; rastreado: boolean
}
type Criativo = {
  criativo: string; anuncio: string | null; ad_id_meta: string | null
  leads: number; qualificou: number; pct_qualif: number | null
  orcamentos: number; vendas: number; valor_vendido: number
  leads_por_orcamento: number | null; ativo_ultimos_7d: boolean
}
type Campanha = {
  campanha: string; conjunto: string; anuncios: number
  leads: number; orcamentos: number; vendas: number; faturamento: number
}
type AnuncioReal = {
  ad_id: string; titulo: string | null; anuncio: string | null
  conjunto: string | null; campanha: string | null
  anuncio_catalogo: string | null; criativo_deduzido: string | null
  leads: number; orcamentos: number; vendas: number; faturamento: number
}

const PERIODOS = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '6 meses' },
]

const fmtN = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR').format(n)

const fmtR$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
  }).format(n)

const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`)

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 ${className}`}>{children}</div>
  )
}

function Secao({ titulo, subtitulo, children }: {
  titulo: string; subtitulo?: string; children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{titulo}</h2>
        {subtitulo && <p className="text-sm text-muted-foreground mt-0.5">{subtitulo}</p>}
      </div>
      {children}
    </section>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <Card className="flex gap-3 items-start">
      <Info className="w-5 h-5 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="text-sm leading-relaxed">{children}</div>
    </Card>
  )
}

function Tabela({ cabecalho, children }: { cabecalho: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {cabecalho.map((h, i) => (
              <th key={h} className={`px-4 py-3 font-medium text-muted-foreground whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Campanhas() {
  const [dias, setDias] = useState(30)

  const origens = useQuery({
    queryKey: ['painel-origens', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('painel_origens', { p_dias: dias })
      if (error) throw error
      return (data ?? []) as Origem[]
    },
  })

  const criativos = useQuery({
    queryKey: ['painel-criativos', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('painel_criativos', { p_dias: dias })
      if (error) throw error
      return (data ?? []) as Criativo[]
    },
  })

  const campanhas = useQuery({
    queryKey: ['painel-por-campanha', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('painel_por_campanha', { p_dias: dias })
      if (error) throw error
      return (data ?? []) as Campanha[]
    },
  })

  const reais = useQuery({
    queryKey: ['anuncio-real-do-lead', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('anuncio_real_do_lead', { p_dias: dias })
      if (error) throw error
      return (data ?? []) as AnuncioReal[]
    },
  })

  const meta = (origens.data ?? []).find(o => o.origem === 'Meta ADS')
  const totalLeads = (origens.data ?? []).reduce((s, o) => s + Number(o.leads || 0), 0)
  const totalOrc = (origens.data ?? []).reduce((s, o) => s + Number(o.orcamentos || 0), 0)
  const totalVendas = (origens.data ?? []).reduce((s, o) => s + Number(o.vendas || 0), 0)

  const carregando = origens.isLoading || criativos.isLoading
  const erro = origens.error || criativos.error || campanhas.error || reais.error

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5" />
            <h1 className="text-xl font-semibold">Análise de Campanhas</h1>
          </div>
        </div>
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
          {PERIODOS.map(p => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                dias === p.dias ? 'bg-accent text-accent-fg font-medium' : 'hover:bg-surface-2'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {erro && (
        <Aviso>Não consegui carregar: {String((erro as Error).message).slice(0, 200)}</Aviso>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <p className="text-sm text-muted-foreground">Leads no período</p>
          <p className="text-2xl font-semibold mt-1">{carregando ? '…' : fmtN(totalLeads)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Vieram de anúncio</p>
          <p className="text-2xl font-semibold mt-1">{carregando ? '…' : fmtN(meta?.leads ?? 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Chegaram a orçamento</p>
          <p className="text-2xl font-semibold mt-1">{carregando ? '…' : fmtN(totalOrc)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Viraram venda</p>
          <p className="text-2xl font-semibold mt-1">{carregando ? '…' : fmtN(totalVendas)}</p>
        </Card>
      </div>

      <Secao
        titulo="De onde vem o cliente"
        subtitulo="Todo lead cai em uma linha. “WhatsApp direto” é quem escreveu para o número de alguém da casa."
      >
        <Tabela cabecalho={['Origem', 'Leads', 'Qualificou', '%', 'Orçamentos', 'Vendas', 'Leads por orçamento']}>
          {(origens.data ?? []).map(o => (
            <tr key={o.origem} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium">
                {o.origem}
                {!o.rastreado && <span className="ml-2 text-xs text-muted-foreground">(sem rastreio)</span>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(o.leads)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(o.qualificou)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtPct(o.pct_qualif)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(o.orcamentos)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(o.vendas)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(o.leads_por_orcamento)}</td>
            </tr>
          ))}
        </Tabela>
      </Secao>

      <Secao
        titulo="Por código do anúncio"
        subtitulo="O código sai do texto da primeira mensagem. Serve para produto, mas anúncios do MESMO produto se misturam num código só."
      >
        <Tabela cabecalho={['Código / anúncio', 'Leads', 'Qualificou', '%', 'Orçamentos', 'Vendas', 'Vendido']}>
          {(criativos.data ?? []).map(c => (
            <tr key={c.criativo} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <span className="font-medium">{c.criativo}</span>
                {c.anuncio && <span className="text-muted-foreground"> · {c.anuncio}</span>}
                {c.ativo_ultimos_7d && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-surface-2">ativo</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.leads)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.qualificou)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtPct(c.pct_qualif)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.orcamentos)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.vendas)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtR$(c.valor_vendido)}</td>
            </tr>
          ))}
        </Tabela>
      </Secao>

      <Secao
        titulo="Por campanha e conjunto"
        subtitulo="Soma o dinheiro por campanha do Meta."
      >
        {(campanhas.data ?? []).length === 0 ? (
          <Aviso>
            <b>Ainda sem dado aqui.</b> Duas coisas alimentam esta seção: o clique no anúncio
            (já está ligado na Reply desde 18/09 — enche sozinho conforme os clientes chegam)
            e o mapa <i>anúncio → conjunto → campanha</i>, que vem do Meta e ainda precisa ser
            carregado, por token da API ou pela exportação do Gerenciador.
          </Aviso>
        ) : (
          <Tabela cabecalho={['Campanha', 'Conjunto', 'Anúncios', 'Leads', 'Orçamentos', 'Vendas', 'Faturamento']}>
            {(campanhas.data ?? []).map((c, i) => (
              <tr key={`${c.campanha}-${c.conjunto}-${i}`} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{c.campanha}</td>
                <td className="px-4 py-3 text-right">{c.conjunto}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.anuncios)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.leads)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.orcamentos)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(c.vendas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtR$(c.faturamento)}</td>
              </tr>
            ))}
          </Tabela>
        )}
      </Secao>

      <Secao
        titulo="Por anúncio de verdade"
        subtitulo="Aqui cada anúncio fica separado — é o número do anúncio no Meta, não o código deduzido do texto."
      >
        {(reais.data ?? []).length === 0 ? (
          <Aviso>
            <b>Começa a encher a partir de agora.</b> A automação “Anúncio clicado” foi publicada
            em 18/09 e grava o anúncio no momento em que a pessoa clica e chama no WhatsApp.
            Quem chegou antes disso não tem como ser recuperado — aparece só na seção por código.
          </Aviso>
        ) : (
          <Tabela cabecalho={['Anúncio', 'Conjunto', 'Campanha', 'Leads', 'Orçamentos', 'Vendas', 'Faturamento']}>
            {(reais.data ?? []).map(r => (
              <tr key={r.ad_id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium">{r.anuncio || r.anuncio_catalogo || r.titulo || r.ad_id}</span>
                  {r.criativo_deduzido && (
                    <span className="text-muted-foreground"> · {r.criativo_deduzido}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{r.conjunto || '—'}</td>
                <td className="px-4 py-3 text-right">{r.campanha || '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(r.leads)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(r.orcamentos)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtN(r.vendas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtR$(r.faturamento)}</td>
              </tr>
            ))}
          </Tabela>
        )}
      </Secao>

      <p className="text-xs text-muted-foreground pb-6">
        Orçamento e venda são casados pelo telefone do cliente. Lead sem telefone não entra em
        nenhuma conta — antes de 18/09/2026 ele casava com qualquer outro lead sem telefone.
      </p>
    </div>
  )
}
