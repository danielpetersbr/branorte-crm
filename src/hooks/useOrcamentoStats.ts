import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface OrcRow {
  origin: string | null
  vendor_id: string | null
  data_orcamento: string | null
}

export interface OrcYearStat {
  year: string
  count: number
}

export interface OrcMonthStat {
  month: string  // 'YYYY-MM'
  label: string  // 'Jan/2024'
  count: number
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function useOrcamentoStats(vendorFilter?: string) {
  return useQuery({
    queryKey: ['orcamento-stats', vendorFilter],
    queryFn: async () => {
      let query = supabase
        .from('contacts')
        .select('origin, vendor_id, data_orcamento')
        .like('origin', 'Orcamento%')

      if (vendorFilter && vendorFilter !== 'todos') {
        query = query.eq('vendor_id', vendorFilter)
      }

      let result = await query

      // data_orcamento column may not exist yet — fall back without it
      if (result.error) {
        let q2 = supabase
          .from('contacts')
          .select('origin, vendor_id')
          .like('origin', 'Orcamento%')
        if (vendorFilter && vendorFilter !== 'todos') {
          q2 = q2.eq('vendor_id', vendorFilter)
        }
        result = await q2
        if (result.error) throw result.error
      }

      const rows = (result.data ?? []) as OrcRow[]

      const byYear: Record<string, number> = {}
      const byMonth: Record<string, number> = {}
      let hasMonthData = false

      for (const row of rows) {
        // Extract year from "Orcamento YYYY-NNNN"
        const yearMatch = row.origin?.match(/Orca(?:mento)? (\d{4})-/)
        const year = yearMatch?.[1]
        if (year) {
          byYear[year] = (byYear[year] ?? 0) + 1
        }

        if (row.data_orcamento) {
          hasMonthData = true
          const monthKey = row.data_orcamento.slice(0, 7) // 'YYYY-MM'
          byMonth[monthKey] = (byMonth[monthKey] ?? 0) + 1
        }
      }

      const yearStats: OrcYearStat[] = Object.entries(byYear)
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year.localeCompare(b.year))

      const monthStats: OrcMonthStat[] = Object.entries(byMonth)
        .map(([month, count]) => {
          const [y, m] = month.split('-')
          const label = `${MONTHS[parseInt(m) - 1]}/${y}`
          return { month, label, count }
        })
        .sort((a, b) => a.month.localeCompare(b.month))

      return {
        total: rows.length,
        yearStats,
        monthStats,
        hasMonthData,
      }
    },
    staleTime: 300_000,
  })
}
