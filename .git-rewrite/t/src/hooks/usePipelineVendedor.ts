import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DIAS_FRIO } from '@/hooks/useOrcamentosFiles'

export interface PipelineVendedorStats {
  scope: 'meu' | 'todos'   // se é vendor logado vê só seu, se admin vê tudo
  vendido: number
  negociando: number
  interesseFuturo: number
  perdido: number
  semStatus: number       // sem marcação manual ainda
  frios: number           // ultimo_contato_em IS NULL OR > DIAS_FRIO
  totalAtribuido: number  // total de orçamentos com vendor_id (no escopo)
  vendidoEsteMes: number  // status_manual_at neste mês
}

/**
 * Resumo do pipeline do vendedor (ou de todos, se admin).
 * Vendedor: filtra por vendor_id próprio.
 * Admin: agrega tudo.
 */
export function usePipelineVendedor() {
  return useQuery<PipelineVendedorStats>({
    queryKey: ['pipeline-vendedor'],
    queryFn: async () => {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user.id
      if (!userId) {
        return {
          scope: 'todos', vendido: 0, negociando: 0, interesseFuturo: 0,
          perdido: 0, semStatus: 0, frios: 0, totalAtribuido: 0, vendidoEsteMes: 0,
        }
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, vendor_id')
        .eq('id', userId)
        .maybeSingle()

      const isVendor = profile?.role === 'vendor' && !!profile?.vendor_id
      const scope: 'meu' | 'todos' = isVendor ? 'meu' : 'todos'

      // Helper que aplica scope (vendor_id = X) ou nada (admin)
      const baseQ = () => {
        let q = supabase.from('orcamentos_files').select('*', { count: 'exact', head: true })
        if (isVendor) q = q.eq('vendor_id', profile!.vendor_id!)
        return q
      }

      const limiteFrio = new Date(Date.now() - DIAS_FRIO * 86400_000).toISOString()
      const inicioMes = new Date()
      inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
      const inicioMesIso = inicioMes.toISOString()

      const [
        totalRes,
        vendidoRes, negociandoRes, interesseRes, perdidoRes, semStatusRes,
        friosRes, vendidoMesRes,
      ] = await Promise.all([
        isVendor ? baseQ() : supabase.from('orcamentos_files').select('*', { count: 'exact', head: true }).not('vendor_id', 'is', null),
        baseQ().eq('status_manual', 'VENDIDO'),
        baseQ().eq('status_manual', 'NEGOCIANDO'),
        baseQ().eq('status_manual', 'INTERESSE-FUTURO'),
        baseQ().eq('status_manual', 'PERDIDO'),
        baseQ().is('status_manual', null),
        baseQ().or(`ultimo_contato_em.is.null,ultimo_contato_em.lt.${limiteFrio}`),
        baseQ().eq('status_manual', 'VENDIDO').gte('status_manual_at', inicioMesIso),
      ])

      return {
        scope,
        vendido:         vendidoRes.count ?? 0,
        negociando:      negociandoRes.count ?? 0,
        interesseFuturo: interesseRes.count ?? 0,
        perdido:         perdidoRes.count ?? 0,
        semStatus:       semStatusRes.count ?? 0,
        frios:           friosRes.count ?? 0,
        totalAtribuido:  totalRes.count ?? 0,
        vendidoEsteMes:  vendidoMesRes.count ?? 0,
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
