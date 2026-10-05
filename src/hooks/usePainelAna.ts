import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { FiltroAna, PainelAnaDados } from '@/types/painel-ana'

export function usePainelAna(inicio: string, fim: string, filtro: FiltroAna, cursor: string | null) {
  const { profile } = useAuth()
  const [visivel, setVisivel] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisivel(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  const query = useQuery({
    queryKey: ['painel-ana', profile?.id, inicio, fim, filtro, cursor],
    enabled: profile?.role === 'admin' && Number.isFinite(Date.parse(inicio)) && Number.isFinite(Date.parse(fim)) && Date.parse(fim) > Date.parse(inicio) && Date.parse(fim) - Date.parse(inicio) <= 366 * 86_400_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ana_painel_consultar', {
        p_inicio: inicio, p_fim: fim, p_filtro: filtro, p_cursor: cursor, p_limite: 25,
      })
      if (error) throw error
      return data as PainelAnaDados
    },
    refetchInterval: visivel ? 30_000 : false,
    retry: 1,
  })
  // Preserve a successful reading only for the exact same query and identity.
  const ultima = useRef<{ key: string; data: PainelAnaDados } | null>(null)
  const key = JSON.stringify([profile?.id, inicio, fim, filtro, cursor])
  if (query.data) ultima.current = { key, data: query.data }
  return { ...query, data: query.data ?? (ultima.current?.key === key ? ultima.current.data : undefined) }
}
