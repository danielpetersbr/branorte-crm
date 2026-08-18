import { lazy, Suspense, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboard } from '@/hooks/useDashboard'
import { DashboardFilterProvider, usePresetFilter } from './dashboard/DashboardFilterContext'
import { DashboardHeader } from './dashboard/DashboardHeader'
import { useDashboardTab } from './dashboard/tabs'
import { TabVisaoGeral } from './dashboard/TabVisaoGeral'

// As 4 abas secundárias entram por lazy: quem abre o dashboard e fica na Visão
// geral (a maioria) não baixa o Leaflet da Geografia nem as tabelas do
// Marketing. Antes tudo isso vinha no bundle inicial, sempre.
const TabFunil     = lazy(() => import('./dashboard/TabFunil').then(m => ({ default: m.TabFunil })))
const TabMarketing = lazy(() => import('./dashboard/TabMarketing').then(m => ({ default: m.TabMarketing })))
const TabEquipe    = lazy(() => import('./dashboard/TabEquipe').then(m => ({ default: m.TabEquipe })))
const TabGeografia = lazy(() => import('./dashboard/TabGeografia').then(m => ({ default: m.TabGeografia })))

function CarregandoAba() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Carregando">
      <div className="h-[180px] animate-pulse rounded-xl bg-surface-2" />
      <div className="h-[320px] animate-pulse rounded-xl bg-surface-2" />
    </div>
  )
}

/**
 * SHELL do dashboard.
 *
 * Só cuida de: período, aba ativa e cabeçalho. Zero lógica de negócio, zero
 * bloco visual. Cada aba busca os próprios dados (react-query devolve do cache
 * quando o hook já rodou, então trocar de aba não refaz rede).
 *
 * Antes este arquivo tinha 3.696 linhas e renderizava tudo de uma vez:
 * 9.631px de altura (10,2 telas) e 4.272 elementos no DOM.
 */
export function Dashboard() {
  const [preset, setPreset] = usePresetFilter()
  const [tab, setTab] = useDashboardTab()
  const qc = useQueryClient()
  const [atualizando, setAtualizando] = useState(false)

  // O header precisa da contagem e do horário; é o mesmo hook que as abas usam,
  // então vem do cache e não gera fetch extra.
  const { data, dataUpdatedAt } = useDashboard({ preset })

  const atualizar = useCallback(async () => {
    setAtualizando(true)
    try {
      // Só o que é do dashboard — não invalidar o app inteiro.
      await qc.invalidateQueries({
        predicate: q => {
          const k = q.queryKey?.[0]
          return typeof k === 'string' && (
            k.startsWith('dashboard') || k.startsWith('funil') || k.startsWith('vendas') ||
            k.startsWith('orcamentos') || k.startsWith('propostas') || k.startsWith('vendedor') ||
            k.startsWith('ciclo') || k.startsWith('motivos') || k.startsWith('negociacao') ||
            k.startsWith('orfaos') || k.startsWith('etiquetas') || k.startsWith('resumo') ||
            k.startsWith('heatmap') || k.startsWith('cobertura') || k.startsWith('ligacoes')
          )
        },
      })
    } finally {
      setAtualizando(false)
    }
  }, [qc])

  return (
    <DashboardFilterProvider preset={preset} setPreset={setPreset}>
      {/* bsb-page dispara a entrada em cascata (definida no index.css).
          pb-20 reserva a faixa do botão flutuante de Feedback, pra ele nunca
          ficar em cima do último bloco quando a página chega no fim. */}
      <div className="bsb-page flex flex-col gap-5 p-4 pb-20 lg:p-6 lg:pb-20">
        <DashboardHeader
          preset={preset}
          setPreset={setPreset}
          tab={tab}
          setTab={setTab}
          totalLeads={data?.totalLeads}
          atualizadoEm={dataUpdatedAt}
          atualizando={atualizando}
          onAtualizar={atualizar}
        />

        <div
          role="tabpanel"
          id={`painel-${tab}`}
          aria-labelledby={`aba-${tab}`}
          tabIndex={-1}
          className="focus-visible:outline-none"
        >
          <Suspense fallback={<CarregandoAba />}>
            {tab === 'geral'     && <TabVisaoGeral />}
            {tab === 'funil'     && <TabFunil />}
            {tab === 'marketing' && <TabMarketing />}
            {tab === 'equipe'    && <TabEquipe />}
            {tab === 'geografia' && <TabGeografia />}
          </Suspense>
        </div>
      </div>
    </DashboardFilterProvider>
  )
}
