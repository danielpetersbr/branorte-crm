import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { contasDoEspelho, finalDoNumero, type ContaWhatsApp } from '@/lib/whatsapp-espelho'
import { useAuth } from './useAuth'

/**
 * Contas que têm espelho no CRM: quem tem catálogo de etiquetas sincronizado
 * pela extensão (o mesmo critério do quadro do funil). O final do número vem
 * do WhatsApp que a extensão VIU conectado (`wid_observado`); o `telefone`
 * cadastrado só entra quando ainda não houve leitura — eles divergem quando o
 * vendedor troca de chip.
 */
export function useEspelhoContas(habilitado: boolean) {
  const userId = useAuth().session?.user.id
  return useQuery<ContaWhatsApp[]>({
    queryKey: ['whatsapp-espelho-contas', userId],
    enabled: habilitado && !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [etiquetas, vendedores] = await Promise.all([
        supabase.from('wascript_etiquetas').select('vendedor_nome'),
        supabase.from('vendors').select('name, telefone, wid_observado').eq('ativo', true),
      ])
      if (etiquetas.error) throw etiquetas.error
      if (vendedores.error) throw vendedores.error
      const finais: Record<string, string | null> = {}
      for (const v of vendedores.data ?? []) finais[v.name] = finalDoNumero(v.wid_observado) ?? finalDoNumero(v.telefone)
      return contasDoEspelho((etiquetas.data ?? []).map(r => r.vendedor_nome as string), finais)
    },
  })
}
