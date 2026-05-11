// Busca matriz Vendedor × Etiqueta direto do endpoint Supabase Edge Function
// que lê da tabela `cards` (fonte real de TODOS vendedores, não só os que
// usaram a extensão antiga que populava wa_chat_labels).
//
// Endpoint: /functions/v1/vendedor-x-etiqueta
// Filtros: ?incluir_sem_cards=1, ?dias=30
import { useQuery } from '@tanstack/react-query'

export interface CelulaVE {
  total: number
  fresco: number
  recente: number
  parado: number
  sem_dado: number
}

export interface LinhaVE {
  vendedor_id: string
  vendedor: string
  total: number
  celulas: Record<string, CelulaVE>
}

export interface ColunaVE {
  stage_id: string
  etiqueta: string
  position: number
  total: number
}

export interface VendedorXEtiquetaData {
  ok: boolean
  gerado_em: string
  total_geral: number
  filtros: { incluir_sem_cards: boolean; periodo_dias: number | 'all' }
  colunas: ColunaVE[]
  linhas: LinhaVE[]
}

const ENDPOINT = 'https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/vendedor-x-etiqueta'

export function useVendedorXEtiqueta(opts: { incluirSemCards?: boolean; dias?: number } = {}) {
  return useQuery<VendedorXEtiquetaData>({
    queryKey: ['vendedor-x-etiqueta', opts.incluirSemCards, opts.dias],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (opts.incluirSemCards) params.set('incluir_sem_cards', '1')
      if (opts.dias) params.set('dias', String(opts.dias))
      const url = params.toString() ? `${ENDPOINT}?${params}` : ENDPOINT
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error || 'falha no endpoint')
      return j as VendedorXEtiquetaData
    },
    staleTime: 2 * 60_000,  // 2min
    refetchOnWindowFocus: false,
  })
}
