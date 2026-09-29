import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { EscritorioPainel } from './EscritorioPainel'
import { EscritorioMapa } from './EscritorioMapa'
import { useEscritorioPainel } from '@/hooks/useEscritorioPainel'
import { foraDoRanking } from '@/lib/vendedores-fora-do-ranking'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof EscritorioMapa> & { cadastroCarregando?: boolean; cadastroErro?: boolean }

function Indicadores({ vendedores, live, cadastroCarregando, cadastroErro, onEscritorio }: Props & { onEscritorio: () => void }) {
  const dados = useEscritorioPainel(vendedores, live ?? {})
  return <EscritorioPainel {...dados} carregando={dados.carregando || !!cadastroCarregando} erro={dados.erro || !!cadastroErro} onEscritorio={onEscritorio}
    avisoMensal="Acumulado registrado: o histórico de atendimentos pode incluir valores repetidos na virada do dia. Leads e orçamentos seguem os registros do mês." />
}

export function PainelEscritorio({ vendedores, live, cadastroCarregando, cadastroErro }: Props) {
  const [mapa, setMapa] = useState(false)
  const equipe = vendedores.filter(v => !foraDoRanking(v.vendedor_nome))
  if (!mapa) return <Indicadores vendedores={equipe} live={live} cadastroCarregando={cadastroCarregando} cadastroErro={cadastroErro} onEscritorio={() => setMapa(true)} />
  return <div>
    <button type="button" onClick={() => setMapa(false)} className="mb-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm text-ink">
      <ArrowLeft size={16} /> Voltar ao painel do time
    </button>
    <EscritorioMapa vendedores={equipe} live={live} />
  </div>
}
