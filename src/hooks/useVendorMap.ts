import { useMemo } from 'react'
import { useVendors } from './useVendors'

export function useVendorMap() {
  const { data: vendors } = useVendors()
  return useMemo(() => {
    const map: Record<string, string> = {}
    for (const v of vendors ?? []) {
      map[v.id] = v.name
    }
    return map
  }, [vendors])
}
