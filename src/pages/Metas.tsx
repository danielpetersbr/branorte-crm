import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { useMetas, isoMenos, type MetaVendedor } from '@/hooks/useMetas'
import { Target, PhoneCall, FileText, Trophy, Flame } from 'lucide-react'

const BRL = (v: number) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const d2br = (s?: string) => (s ? s.split('-').reverse().join('/') : '')

/** verde bateu · âmbar chegou perto (60% do alvo) · vermelho longe */
function tom(pct: number | null, alvo: number): 'ok' | 'meio' | 'ruim' | 'n' {
  if (pct === null || pct === undefined) return 'n'
  if (pct >= alvo) return 'ok'
  if (pct >= alvo * 0.6) return 'meio'
  return 'ruim'
}

const COR_TEXTO: Record<string, string> = {
  ok: 'text-emerald-500',
  meio: 'text-amber-500',
  ruim: 'text-rose-500',
  n: 'text-ink-muted',
}

const COR_BARRA: Record<string, string> = {
  ok: 'bg-emerald-500',
  meio: 'bg-amber-500',
  ruim: 'bg-rose-500',
  n: 'bg-border',
}

function CardMeta({ tag, titulo, icone, pct, alvo, linha, rodape }: {
  tag: string; titulo: string; icone: React.ReactNode
  pct: number | null; alvo: number; linha: React.ReactNode; rodape: React.ReactNode
}) {
  const t = tom(pct, alvo)
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-ink-muted uppercase">
        {icone} {tag}
      </div>
      <div className="text-[15px] font-semibold text-ink mt-1 mb-2">{titulo}</div>
      <div className="flex items-baseline gap-3">
        <span className={`text-5xl font-extrabold tracking-tight tabular-nums ${COR_TEXTO[t]}`}>
          {pct === null ? '—' : `${pct}%`}
        </span>
        <span className="text-[13px] font-semibold text-ink-muted">meta {alvo}%</span>
      </div>
      <div className="relative h-2 bg-surface-2 rounded-full my-3">
        <div className={`absolute inset-y-0 left-0 rounded-full ${COR_BARRA[t]}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
        <div className="absolute -top-1 w-0.5 h-4 bg-ink/40" style={{ left: `${alvo}%` }} />
      </div>
      <div className="text-[13.5px] text-ink">{linha}</div>
      <div className="text-[12px] text-ink-muted mt-1">{rodape}</div>
    </Card>
  )
}

export function Metas() {
  // padrão: os últimos 7 dias encerrados — aberto numa segunda, é a semana passada
  const [de, setDe] = useState(isoMenos(7))
  const [ate, setAte] = useState(isoMenos(1))
  const { data, isLoading, error } = useMetas(de, ate)

  const periodos = [
    { label: 'Últimos 7 dias', de: isoMenos(7), ate: isoMenos(1) },
    { label: 'Semana anterior', de: isoMenos(14), ate: isoMenos(8) },
    { label: 'Mês inteiro', de: `${isoMenos(1).slice(0, 8)}01`, ate: isoMenos(1) },
  ]

  if (isLoading) return <PageLoading />
  if (error || !data) {
    return (
      <div className="p-4 max-w-7xl mx-auto">
        <Card className="p-5 text-rose-500">Não consegui carregar o placar: {String((error as Error)?.message ?? 'sem dados')}</Card>
      </div>
    )
  }

  const e = data.empresa
  const m = data.metas
  const quenteAlvo = m.quente_alvo_por_time * 3
  const m3pct = e.m3_propostas ? Math.round((100 * e.m3_trabalhadas) / e.m3_propostas) : null

  const linhaVend = (v: MetaVendedor) => {
    const t1 = tom(v.m1_pct, m.m1_alvo_pct)
    const t2 = tom(v.m2_pct, m.m2_alvo_pct)
    const t3 = v.m3_trabalhadas >= m.m3_alvo_por_vendedor ? 'ok' : v.m3_trabalhadas === 0 ? 'ruim' : 'meio'
    const tq = v.lead_quente >= 2 ? 'ok' : v.lead_quente === 0 ? 'ruim' : 'meio'
    return (
      <tr key={v.vendedor} className="border-t border-border">
        <td className="px-3 py-3">
          <div className="font-bold text-ink text-[15px]">{v.vendedor}</div>
          <div className="text-[11px] text-ink-muted">{v.time}</div>
        </td>
        <td className={`px-3 py-3 text-center font-bold tabular-nums ${COR_TEXTO[t1]}`}>
          {v.m1_pct === null ? '—' : `${v.m1_pct}%`}
          <div className="text-[11px] font-medium text-ink-muted">{v.m1_resgatados}/{v.m1_calaram}</div>
        </td>
        <td className={`px-3 py-3 text-center font-bold tabular-nums ${COR_TEXTO[t2]}`}>
          {v.m2_pct === null ? '—' : `${v.m2_pct}%`}
          <div className="text-[11px] font-medium text-ink-muted">{v.m2_3d}/{v.m2_propostas}</div>
        </td>
        <td className={`px-3 py-3 text-center font-bold tabular-nums ${COR_TEXTO[t3]}`}>
          {v.m3_trabalhadas}
          <div className="text-[11px] font-medium text-ink-muted">de {v.m3_propostas}</div>
        </td>
        <td className={`px-3 py-3 text-center font-bold tabular-nums ${COR_TEXTO[tq]}`}>
          {v.lead_quente}
          <div className="text-[11px] font-medium text-ink-muted">FU {v.follow_up}</div>
        </td>
        <td className="px-3 py-3 text-center font-bold tabular-nums text-rose-500 text-[13px]">
          {v.m2_rs_abandonado > 0 ? BRL(v.m2_rs_abandonado) : '—'}
        </td>
        <td className="px-3 py-3 text-center font-bold tabular-nums text-ink">
          {v.vendas_mes || '—'}
          <div className="text-[11px] font-medium text-ink-muted">{v.rs_mes > 0 ? BRL(v.rs_mes) : ''}</div>
        </td>
      </tr>
    )
  }

  return (
    <div className="p-4 space-y-5 max-w-7xl mx-auto">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Target className="h-6 w-6 text-accent" /> Placar de Metas
          </h1>
          <p className="text-ink-muted text-sm">
            Semana {d2br(data.periodo.de)} a {d2br(data.periodo.ate)} · atualizado {data.periodo.gerado_em}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1 flex-wrap">
          {periodos.map(p => (
            <button
              key={p.label}
              onClick={() => { setDe(p.de); setAte(p.ate) }}
              className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition-colors ${
                de === p.de && ate === p.ate ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-3'
              }`}
            >{p.label}</button>
          ))}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <CardMeta
          tag="Meta 1" titulo="Cliente calou, vendedor voltou a chamar"
          icone={<PhoneCall className="h-3.5 w-3.5" />}
          pct={e.m1_pct} alvo={m.m1_alvo_pct}
          linha={<><b>{e.m1_resgatados}</b> de <b>{e.m1_calaram}</b> clientes que pararam de responder foram chamados de novo</>}
          rodape="conta mensagem de verdade (ou áudio) entre 12h e 3 dias depois do silêncio"
        />
        <CardMeta
          tag="Meta 2" titulo="Voltou no cliente depois do orçamento"
          icone={<FileText className="h-3.5 w-3.5" />}
          pct={e.m2_pct} alvo={m.m2_alvo_pct}
          linha={<><b>{e.m2_3d}</b> de <b>{e.m2_propostas}</b> propostas tiveram retorno ({e.m2_d1} já no dia seguinte)</>}
          rodape={<>deixado pra trás na semana: <b className="text-rose-500">{BRL(e.m2_rs_abandonado)}</b></>}
        />
        <CardMeta
          tag="Meta 3" titulo="Negócio grande trabalhado (mês)"
          icone={<Trophy className="h-3.5 w-3.5" />}
          pct={m3pct} alvo={80}
          linha={<><b>{e.m3_trabalhadas}</b> de <b>{e.m3_propostas}</b> propostas acima de R$ 100 mil tiveram resposta do cliente</>}
          rodape={<>total em jogo: {BRL(e.m3_rs)} · alvo {m.m3_alvo_por_vendedor} por vendedor no mês</>}
        />
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-ink-muted uppercase mb-3">
          <Flame className="h-3.5 w-3.5" /> Termômetro — o que fecha nos próximos dias
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <div className={`text-4xl font-extrabold tabular-nums ${e.lead_quente >= quenteAlvo ? 'text-emerald-500' : 'text-rose-500'}`}>
              {e.lead_quente}
            </div>
            <div className="text-[13px] text-ink">Lead Quente vivos <span className="text-ink-muted">(alvo {quenteAlvo} — {m.quente_alvo_por_time} por time)</span></div>
          </div>
          <div>
            <div className="text-4xl font-extrabold tabular-nums text-ink">{e.follow_up}</div>
            <div className="text-[13px] text-ink">Follow Up</div>
          </div>
          <div>
            <div className="text-4xl font-extrabold tabular-nums text-emerald-500">{BRL(e.rs_mes)}</div>
            <div className="text-[13px] text-ink">vendido no mês — {e.vendas_mes} vendas</div>
          </div>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-3 text-left font-semibold">Time</th>
              <th className="px-3 py-3 font-semibold">M1 resgate</th>
              <th className="px-3 py-3 font-semibold">M2 pós-orçamento</th>
              <th className="px-3 py-3 font-semibold">M3 grandes</th>
              <th className="px-3 py-3 font-semibold">Quentes</th>
              <th className="px-3 py-3 font-semibold">Vendido no mês</th>
            </tr>
          </thead>
          <tbody>
            {data.times.map(t => (
              <tr key={t.time} className="border-t border-border">
                <td className="px-3 py-3 font-bold text-ink">{t.time}</td>
                <td className={`px-3 py-3 text-center font-bold tabular-nums ${COR_TEXTO[tom(t.m1_pct, m.m1_alvo_pct)]}`}>
                  {t.m1_pct === null ? '—' : `${t.m1_pct}%`}
                  <div className="text-[11px] font-medium text-ink-muted">{t.m1_resgatados}/{t.m1_calaram}</div>
                </td>
                <td className={`px-3 py-3 text-center font-bold tabular-nums ${COR_TEXTO[tom(t.m2_pct, m.m2_alvo_pct)]}`}>
                  {t.m2_pct === null ? '—' : `${t.m2_pct}%`}
                  <div className="text-[11px] font-medium text-ink-muted">{t.m2_3d}/{t.m2_propostas}</div>
                </td>
                <td className="px-3 py-3 text-center font-bold tabular-nums text-ink">
                  {t.m3_trabalhadas}
                  <div className="text-[11px] font-medium text-ink-muted">de {t.m3_propostas}</div>
                </td>
                <td className={`px-3 py-3 text-center font-bold tabular-nums ${t.lead_quente >= m.quente_alvo_por_time ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {t.lead_quente}
                  <div className="text-[11px] font-medium text-ink-muted">alvo {m.quente_alvo_por_time}</div>
                </td>
                <td className="px-3 py-3 text-center font-bold tabular-nums text-ink">{BRL(t.rs_mes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-3 text-left font-semibold">Vendedor</th>
              <th className="px-3 py-3 font-semibold">M1 resgate</th>
              <th className="px-3 py-3 font-semibold">M2 pós-orçamento</th>
              <th className="px-3 py-3 font-semibold">M3 grandes</th>
              <th className="px-3 py-3 font-semibold">Quentes</th>
              <th className="px-3 py-3 font-semibold">Deixou pra trás</th>
              <th className="px-3 py-3 font-semibold">Vendas do mês</th>
            </tr>
          </thead>
          <tbody>{data.vendedores.map(linhaVend)}</tbody>
        </table>
      </Card>

      <Card className="p-5 text-[12.5px] text-ink-muted leading-relaxed">
        <div className="font-bold text-ink mb-2">Como cada número é contado</div>
        <p><b className="text-ink">M1</b> — de todos os clientes que mandaram a última mensagem no período e ficaram no silêncio, quantos receberam nova mensagem do vendedor entre 12h e 3 dias depois. Só conta mensagem com conteúdo (40+ caracteres) ou áudio: "oi" não pontua. Só entram silêncios que já completaram 3 dias.</p>
        <p><b className="text-ink">M2</b> — de todas as propostas emitidas no período, quantas tiveram mensagem do vendedor pro mesmo telefone num dia posterior, dentro de 3 dias. Só entram propostas com 3 dias completos.</p>
        <p><b className="text-ink">M3</b> — propostas acima de R$ 100 mil emitidas no mês (1 por cliente, a mais recente); "trabalhada" = o cliente respondeu alguma coisa depois. Proposta no vácuo não conta.</p>
        <p><b className="text-ink">Quentes</b> — etiqueta LEAD QUENTE viva no WhatsApp agora. <b className="text-ink">Vendas do mês</b> — pedidos do controle (valor + ajuste, sem os de valor zero).</p>
        <p className="mt-2">Daniel fica fora de todas as contas. A cobertura depende da extensão WA Sync do vendedor estar ligada.</p>
      </Card>
    </div>
  )
}
