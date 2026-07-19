import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface FunilEtiquetaRow { stage: string; ord: number; phones: number }

// Funil pelas ETIQUETAS REAIS do WhatsApp (snapshot atual, sem período):
// Entrou → Prospecção → Novo lead → Follow up → Lead quente → Orçamento enviado → Vendido.
// Cada telefone no seu estágio MAIS AVANÇADO (dedup por telefone canônico).
export function useFunilEtiquetas() {
  return useQuery({
    queryKey: ['funil-etiquetas-v1'],
    queryFn: async (): Promise<FunilEtiquetaRow[]> => {
      const { data, error } = await supabase.rpc('dashboard_funil_etiquetas')
      if (error) throw error
      return (data ?? []).map((r: { stage: string; ord: number; phones: number }) => ({
        stage: String(r.stage), ord: Number(r.ord), phones: Number(r.phones) || 0,
      }))
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
