import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseCustomRange, type DashboardPreset } from './useDashboard'

// Cobertura por vendedor: de TODOS os clientes passados pra ele (responsável no
// atendimento), quantos ele etiquetou (entraram no funil) e quantos ficaram SEM
// ETIQUETA nenhuma — o buraco de acompanhamento que tem que ficar destacado.
// Fonte: RPC dashboard_vendedor_cobertura. Chaveado pelo nome do responsável.
export interface VendedorCobertura {
  vendedor: string
  total_passado: number
  com_etiqueta: number
  sem_etiqueta: number
}

function rangeFromPreset(preset: DashboardPreset): { from: string | null; to: string | null } {
  const _custom = parseCustomRange(preset)
  if (_custom) return { from: _custom.from.toISOString(), to: _custom.to.toISOString() }
  const now = new Date()
  const sod = (back: number) => { const x = new Date(now); x.setDate(x.getDate() - back); x.setHours(0, 0, 0, 0); return x.toISOString() }
  const eod = new Date(now); eod.setHours(23, 59, 59, 999)
  if (preset === 'hoje') { const x = new Date(now); x.setHours(0, 0, 0, 0); return { from: x.toISOString(), to: eod.toISOString() } }
  if (preset === 'ontem') return { from: sod(1), to: sod(0) }
  if (preset === '7d') return { from: sod(6), to: eod.toISOString() }
  if (preset === '30d') return { from: sod(29), to: eod.toISOString() }
  if (preset === 'mes') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: eod.toISOString() }
  return { from: null, to: null } // Tudo
}

export function useVendedorCobertura(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['vendedor-cobertura-v1', preset],
    queryFn: async (): Promise<VendedorCobertura[]> => {
      const { from, to } = rangeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_vendedor_cobertura', { p_from: from, p_to: to })
      if (error) throw error
      return (data ?? []) as VendedorCobertura[]
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
