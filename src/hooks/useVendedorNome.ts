import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// ============================================================================
// Resolve o NOME do vendedor logado (sempre MAIÚSCULO), usado como chave da
// Agenda (agenda_itens.vendedor_nome). Caminho: profile.vendor_id → vendors.name.
// Fallback (sem vendor_id): profile.display_name. Grave/consulte sempre por esse
// nome — no filtro use ilike (case-insensitive); ao gravar use o valor já uppercase.
// ============================================================================
export function useVendedorNome(): { nome: string; isLoading: boolean } {
  const { profile } = useAuth()
  const vendorId = profile?.vendor_id ?? null
  const fallback = (profile?.display_name ?? '').trim().toUpperCase()

  const q = useQuery({
    queryKey: ['vendedor-nome', vendorId],
    enabled: !!vendorId,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase
        .from('vendors')
        .select('name')
        .eq('id', vendorId)
        .maybeSingle()
      if (error) throw error
      return (data?.name ?? '').trim().toUpperCase()
    },
    staleTime: 10 * 60 * 1000,
  })

  // Com vendor_id: SÓ usa o nome quando a query teve SUCESSO (se vier vazio, cai no
  // display_name). Em erro/timeout NÃO cai no display_name — retorna vazio pra não
  // ler/gravar a agenda sob um vendedor_nome errado (a tela mostra aviso amigável).
  // Sem vendor_id: usa direto o display_name.
  const nome = vendorId
    ? (q.isSuccess ? (q.data || fallback) : '')
    : fallback
  return { nome, isLoading: !!vendorId && q.isLoading }
}
