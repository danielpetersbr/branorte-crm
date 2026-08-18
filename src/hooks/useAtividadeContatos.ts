import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ContactFilters } from '@/types'

/**
 * Contagem por faixa de tempo desde a última interação, para a faixa
 * "Atividade dos contatos" no topo de /contatos.
 *
 * Vem de `contatos_atividade_resumo`, que repete PALAVRA POR PALAVRA o WHERE da
 * `contatos_page_count`. Se os dois divergirem, o card promete um número e a
 * lista entrega outro — foi o motivo de não calcular isto no navegador.
 *
 * `p_faixa` NÃO entra aqui de propósito: ela é a própria faceta. Se entrasse,
 * escolher um card zeraria os outros cinco e não daria pra trocar sem limpar.
 * Mesmo raciocínio do `p_etiqueta` em `contatos_etiquetas_resumo`.
 */
export type FaixaAtividade = 'd30' | 'd60' | 'd100' | 'd365' | 'mais' | 'sem'

export interface LinhaAtividade {
  faixa: FaixaAtividade
  contatos: number
}

export function useAtividadeContatos(filters: ContactFilters) {
  // A faixa escolhida fica FORA da chave: trocar de card não deve refazer a
  // contagem dos cards, só a da lista.
  const { faixa: _faixa, page: _page, ...semFaceta } = filters

  return useQuery({
    queryKey: ['contatos_atividade', semFaceta],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('contatos_atividade_resumo', {
        p_search:             semFaceta.search || null,
        p_estado:             semFaceta.estado || null,
        p_vendor_id:          semFaceta.vendor_id || null,
        p_status:             semFaceta.status || null,
        p_orcamento_ano:      semFaceta.orcamento_ano ? Number(semFaceta.orcamento_ano) : null,
        p_orcamento_mes:      semFaceta.orcamento_mes ? Number(semFaceta.orcamento_mes) : null,
        p_orcamento:          !!semFaceta.orcamento,
        p_sem_orcamento:      !!semFaceta.sem_orcamento,
        p_temperatura:        semFaceta.temperatura || null,
        p_com_whatsapp:       !!semFaceta.com_whatsapp,
        p_etiqueta:           semFaceta.etiqueta || null,
        p_esperando_resposta: !!semFaceta.esperando_resposta,
        p_sort:               semFaceta.sort || 'recente',
      })
      if (error) throw error
      return (data ?? []) as LinhaAtividade[]
    },
    // Mesma cadência da lista: o dado muda sozinho (cron de 1 min alimenta
    // ultima_interacao_em), então a faixa não pode ficar no retrato do primeiro
    // carregamento enquanto a lista atualiza.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: prev => prev,
  })
}
