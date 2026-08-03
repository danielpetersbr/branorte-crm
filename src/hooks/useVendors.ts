import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/types'

/**
 * Vendors ativos (default). Lucas marcado ativo=false pra não aparecer nos
 * dropdowns de atribuição, mas histórico de orçamentos linkados a ele permanece.
 */
export function useVendors(opts: { incluirInativos?: boolean } = {}) {
  return useQuery({
    queryKey: ['vendors', opts.incluirInativos ? 'all' : 'ativos'],
    queryFn: async () => {
      // Colunas explícitas em vez de `*`: a coluna `wascript_token` é credencial
      // da API de WhatsApp do vendedor e não tem por que trafegar pro browser —
      // quem usa são as edge functions, com service_role. Com a lista explícita
      // dá pra tirar o SELECT dessa coluna do papel `authenticated` no banco;
      // com `*` o PostgREST expandiria pra ela e devolveria 403 na consulta toda.
      let q = supabase
        .from('vendors')
        .select('id, key, name, ativo, telefone, email, replyagent_tag, aceita_transferencia, aceita_transferencia_at')
        .order('name')
      if (!opts.incluirInativos) q = q.eq('ativo', true)
      const { data, error } = await q
      if (error) throw error
      return data as Vendor[]
    },
    staleTime: 5 * 60 * 1000,
  })
}
