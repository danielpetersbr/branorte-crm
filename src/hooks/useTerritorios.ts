import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DONO_POR_UF } from '@/lib/representantes'

// Território comercial editável: public.representante_territorios (uf -> rep_id).
// Se a tabela vier vazia (ou der erro de permissão), cai no padrão de
// src/lib/representantes.ts pra tela nunca aparecer em branco.

export type MapaTerritorio = Record<string, string> // uf -> rep_id

const PADRAO: MapaTerritorio = Object.fromEntries(
  Object.entries(DONO_POR_UF).map(([uf, r]) => [uf, r.id]),
)

export function useTerritorios() {
  return useQuery<MapaTerritorio>({
    queryKey: ['representante-territorios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('representante_territorios')
        .select('uf, rep_id')
      if (error) throw error
      if (!data?.length) return { ...PADRAO }
      const m: MapaTerritorio = {}
      for (const r of data as { uf: string; rep_id: string }[]) m[r.uf] = r.rep_id
      return m
    },
    placeholderData: { ...PADRAO },
  })
}

/** Grava só as UFs que mudaram (upsert por uf). */
export function useSalvarTerritorios() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (mudancas: { uf: string; rep_id: string; autor?: string | null }[]) => {
      if (!mudancas.length) return
      const { error } = await supabase
        .from('representante_territorios')
        .upsert(
          mudancas.map(m => ({
            uf: m.uf,
            rep_id: m.rep_id,
            updated_at: new Date().toISOString(),
            updated_by: m.autor ?? null,
          })),
          { onConflict: 'uf' },
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['representante-territorios'] }),
  })
}
