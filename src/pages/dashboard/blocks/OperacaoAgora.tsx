import { useMemo, type ReactNode } from 'react'
import { Card } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { CHART } from '../ui/chart-tokens'
import { brl, n } from '../ui/format'
import { useJanela } from '../DashboardFilterContext'
import {
  ETAPAS_ABERTAS, useAtendimentosAbertos, useGastoAnuncios, useLigacoesPeriodo,
  type AbertosConta, type AtendimentosAbertos, type EtapaAberta, type GastoAnuncios, type LigacoesPeriodo, type Projecao,
} from '@/hooks/useOperacaoAgora'

/**
 * OPERAÇÃO AGORA — ao lado da Meta do mês (21/10/2026, pedido do Daniel: "quantos atendimentos a gente está em aberto, da
 * etiqueta prospecção até lead quente… quantos cada vendedor tá com atendimento aberto… quantos clientes em follow-up e a
 * projeção… lead quente também… o gasto com anúncio no Google e no Meta… e quantas ligações, tentativa e conversado").
 *
 * Duas janelas no mesmo card, cada uma com o seu carimbo: as etiquetas são o ESTADO DE AGORA (o WhatsApp de cada conta,
 * relido pela extensão a cada minuto); anúncio e ligação seguem o FILTRO do topo.
 */

// frio → quente: as tentativas são o mesmo azul da entrada, mais claro; follow up âmbar (em jogo); lead quente verde (avanço)
const COR_ETAPA: Record<EtapaAberta, { cor: string; opacidade: number }> = {
  prospeccao: { cor: CHART.s2, opacidade: 0.35 },
  t2: { cor: CHART.s2, opacidade: 0.55 },
  t3: { cor: CHART.s2, opacidade: 0.75 },
  novo_lead: { cor: CHART.s2, opacidade: 1 },
  follow_up: { cor: CHART.s3, opacidade: 1 },
  lead_quente: { cor: CHART.s1, opacidade: 1 },
}

const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null
const nomeConta = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ')

export function OperacaoAgora() {
  const { preset, periodoLabel } = useJanela()
  const a = useAtendimentosAbertos()
  const g = useGastoAnuncios(preset)
  const l = useLigacoesPeriodo(preset)
  return (
    <OperacaoAgoraView
      periodoLabel={periodoLabel}
      ab={a.data ?? null} abPendente={a.isPending} abErro={a.isError}
      gasto={g.data ?? null} gastoPendente={g.isPending || g.isPlaceholderData} gastoErro={g.isError}
      lig={l.data ?? null} ligPendente={l.isPending || l.isPlaceholderData} ligErro={l.isError}
    />
  )
}

/** A parte visual, sem busca: o container acima liga nos hooks (separado pra dar pra ver o bloco com dado de teste). */
export function OperacaoAgoraView({ periodoLabel, ab, abPendente, abErro, gasto, gastoPendente, gastoErro, lig, ligPendente, ligErro }: {
  periodoLabel: string
  ab: AtendimentosAbertos | null; abPendente: boolean; abErro: boolean
  gasto: GastoAnuncios | null; gastoPendente: boolean; gastoErro: boolean
  lig: LigacoesPeriodo | null; ligPendente: boolean; ligErro: boolean
}) {
  const contas = useMemo(() => {
    const lista = ab?.porConta ?? []
    return {
      vendedores: lista.filter(c => c.vendedor !== 'ANA'),
      ana: lista.find(c => c.vendedor === 'ANA') ?? null,
      maior: Math.max(1, ...lista.map(c => c.abertos)),
    }
  }, [ab])
  const totalEtapas = ab ? ETAPAS_ABERTAS.reduce((s, e) => s + ab.porEtapa[e.k], 0) : 0

  return (
    <Card className="h-full 2xl:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 2xl:mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-title text-ink">Atendimentos em aberto</h3>
          <JanelaBadge tipo="snapshot" label="agora" />
        </div>
        {ab?.atualizadoEm && (
          <span className="text-micro tabular-nums text-ink-faint" title="Hora da última leitura das etiquetas do WhatsApp (a extensão relê a cada minuto)">
            etiquetas lidas às {hora(ab.atualizadoEm)}
          </span>
        )}
      </div>

      {abPendente ? (
        <div className="h-[170px] animate-pulse rounded-lg bg-surface-2" aria-label="Carregando atendimentos em aberto" />
      ) : abErro || !ab ? (
        <p className="text-body text-ink-faint">Não deu para ler as etiquetas agora. Use Atualizar dados.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-kpi tabular-nums text-ink">{n(ab.contatos)}</span>
            <span
              className="text-label text-ink-faint"
              title="Contato distinto com etiqueta de PROSPECÇÃO, 2ª TENTATIVA, 3ª TENTATIVA, NOVO LEAD, FOLLOW UP ou LEAD QUENTE (inclui CLIENTE QUENTE) em algum WhatsApp da casa (a Ana entra). ORÇAMENTO ENVIADO não entra. O mesmo cliente em duas contas conta uma vez, na etapa mais avançada. Conversa com etiqueta de fechamento junto (vendido, perdido, resolvido) não conta, nem número da casa (etiqueta BRANORTE ou telefone de vendedor)."
            >
              contatos de Prospecção a Lead quente
            </span>
          </div>

          {totalEtapas > 0 && (
            <div
              className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2 2xl:mt-2"
              role="img"
              aria-label={ETAPAS_ABERTAS.map(e => `${e.rotulo} ${ab.porEtapa[e.k]}`).join(', ')}
            >
              {ETAPAS_ABERTAS.map(e => ab.porEtapa[e.k] > 0 && (
                <div
                  key={e.k}
                  className="h-full"
                  style={{ width: `${(ab.porEtapa[e.k] / totalEtapas) * 100}%`, background: COR_ETAPA[e.k].cor, opacity: COR_ETAPA[e.k].opacidade }}
                  title={`${e.rotulo}: ${n(ab.porEtapa[e.k])}`}
                />
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-muted">
            {ETAPAS_ABERTAS.map(e => (
              <span key={e.k} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: COR_ETAPA[e.k].cor, opacity: COR_ETAPA[e.k].opacidade }} aria-hidden="true" />
                {e.rotulo} <b className="font-semibold tabular-nums text-ink">{n(ab.porEtapa[e.k])}</b>
              </span>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 2xl:mt-3 2xl:grid-cols-3 2xl:gap-x-5 2xl:gap-y-1" aria-label="Atendimentos em aberto por conta">
            {contas.vendedores.map(c => <LinhaConta key={c.vendedor} c={c} maior={contas.maior} />)}
            {contas.ana && <LinhaConta c={contas.ana} maior={contas.maior} rotulo="Ana (IA)" fraco />}
          </div>
        </>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4 lg:grid-cols-4 2xl:mt-3 2xl:pt-3">
        <MiniProjecao titulo="Follow up" p={ab?.followUp} pendente={abPendente} erro={abErro} />
        <MiniProjecao titulo="Lead quente" p={ab?.leadQuente} pendente={abPendente} erro={abErro} />
        <Mini
          titulo="Anúncios"
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
          pendente={gastoPendente}
          ajuda="Gasto no período do filtro: Meta (carga pelo Chrome do Gerenciador) + Google (script diário da conta BRANORTE-ADS). É tão novo quanto a última carga de cada um."
          valor={gastoPendente ? '…' : gastoErro || !gasto ? '—' : brl(gasto.meta + gasto.google)}
          linha1={gasto ? `Meta ${brl(gasto.meta)} · Google ${brl(gasto.google)}` : undefined}
          linha2={gasto && (gasto.metaAtualizadoEm || gasto.googleAtualizadoEm)
            ? `carga: Meta ${hora(gasto.metaAtualizadoEm) ?? '—'} · Google ${hora(gasto.googleAtualizadoEm) ?? '—'}`
            : undefined}
        />
        <Mini
          titulo="Ligações"
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
          pendente={ligPendente}
          ajuda="Todas as ligações do WhatsApp no período, feitas e recebidas (tentativas), e quantas foram atendidas nos dois sentidos (conversadas): não importa se quem ligou foi o cliente ou o vendedor. Ligação entre números da casa (um vendedor ligando pro outro) e o eco que o WhatsApp grava sem contato não contam. Mesma base da tela Ligações."
          valor={ligPendente ? '…' : ligErro || !lig ? '—' : `${n(lig.conversadas)} conversadas`}
          linha1={lig ? `${n(lig.tentativas)} tentativas` : undefined}
          linha2={lig ? `${n(lig.feitas)} feitas · ${n(lig.recebidas)} recebidas` : undefined}
        />
      </div>
    </Card>
  )
}

function LinhaConta({ c, maior, rotulo, fraco = false }: { c: AbertosConta; maior: number; rotulo?: string; fraco?: boolean }) {
  const nome = rotulo ?? nomeConta(c.vendedor)
  if (!c.leitura_ok) {
    return (
      <div className="grid grid-cols-[96px_1fr] items-center gap-2" title={`O WhatsApp de ${nome} não está sendo lido agora (vê ${n(c.conversas_lidas)} conversas): o número dele não é confiável.`}>
        <span className="truncate text-micro text-ink-muted">{nome}</span>
        <span className="text-micro text-warning">sem leitura do WhatsApp</span>
      </div>
    )
  }
  const detalhe = ETAPAS_ABERTAS.map(e => `${e.rotulo} ${c[e.k]}`).join(' · ')
  return (
    <div className="grid grid-cols-[96px_1fr_auto] items-center gap-2" title={`${nome}: ${detalhe}`}>
      <span className={`truncate text-micro ${fraco ? 'text-ink-faint' : 'text-ink-muted'}`}>{nome}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (c.abertos / maior) * 100)}%`, opacity: fraco ? 0.45 : 1 }} />
      </div>
      <span className="min-w-[28px] text-right text-micro font-semibold tabular-nums text-ink">{n(c.abertos)}</span>
    </div>
  )
}

function Mini({ titulo, janela, valor, linha1, linha2, ajuda, pendente = false }: {
  titulo: string; janela: ReactNode; valor: string; linha1?: string; linha2?: string; ajuda: string; pendente?: boolean
}) {
  return (
    <div className={`min-w-0 transition-opacity duration-200 ${pendente ? 'opacity-50' : ''}`} aria-busy={pendente} title={ajuda}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-label text-ink-faint">{titulo}</span>
        {janela}
      </div>
      <div className="mt-1 text-kpi-sm tabular-nums text-ink">{valor}</div>
      {linha1 && <div className="text-micro tabular-nums text-ink-muted">{linha1}</div>}
      {linha2 && <div className="text-micro tabular-nums text-ink-faint">{linha2}</div>}
    </div>
  )
}

function MiniProjecao({ titulo, p, pendente, erro }: { titulo: string; p: Projecao | undefined; pendente: boolean; erro: boolean }) {
  return (
    <Mini
      titulo={titulo}
      janela={<JanelaBadge tipo="snapshot" label="agora" />}
      pendente={pendente}
      ajuda={`Clientes com a etiqueta ${titulo.toUpperCase()} agora (o mesmo cliente em duas contas conta uma vez) e a soma do orçamento MAIS NOVO de cada um (últimos 180 dias, sem rascunho). Quem não tem orçamento entra na contagem e não soma.`}
      valor={pendente ? '…' : erro || !p ? '—' : `${n(p.clientes)} ${p.clientes === 1 ? 'cliente' : 'clientes'}`}
      linha1={p ? `${brl(p.brl)} em proposta` : undefined}
      linha2={p ? `${n(p.comProposta)} com orçamento` : undefined}
    />
  )
}
