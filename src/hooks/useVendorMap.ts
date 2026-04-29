import { useMemo } from 'react'
import { useVendors } from './useVendors'

/**
 * Usado pra exibir nome do vendedor a partir de vendor_id em listagens.
 * Inclui inativos (ex: Lucas) pra orçamentos históricos não aparecerem como '-'.
 */
export function useVendorMap() {
  const { data: vendors } = useVendors({ incluirInativos: true })
  return useMemo(() => {
    const map: Record<string, string> = {}
    for (const v of vendors ?? []) {
      map[v.id] = v.name
    }
    return map
  }, [vendors])
}
