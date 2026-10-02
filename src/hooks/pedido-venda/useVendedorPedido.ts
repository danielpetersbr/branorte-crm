import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { identificarVendedorPedido } from '@/lib/pedido-venda/vendedorPedido'

/** Autoria de pedidos novos: o vínculo cadastrado é a fonte, sem fallback no nome de exibição. */
export function useVendedorPedido() {
  const { profile } = useAuth()
  const vendorId = profile?.vendor_id ?? null
  const cadastro = useQuery({
    queryKey: ['pedido-vendedor-nome', profile?.id, vendorId],
    enabled: profile?.role === 'vendor' && !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('name').eq('id', vendorId!).maybeSingle()
      if (error) throw error
      return data?.name ?? ''
    },
    staleTime: 10 * 60_000,
  })
  return identificarVendedorPedido({
    role: profile?.role,
    vendorId,
    nomeCadastro: cadastro.data,
    carregando: cadastro.isPending,
    erro: cadastro.isError,
  })
}
