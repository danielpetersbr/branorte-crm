import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface OrcRow {
  ano: number | null
  mtime_iso: string | null
  status_kanban: string | null
  vendor_id: string | null
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

export interface OrcStatusStat {
  status: string
  count: number
}

export interface OrcVendorStat {
  vendor_id: string | null  // null = sem vendedor identificado
  count: number
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const PAGE_SIZE = 1000

async function fetchAllRows(): Promise<{ rows: OrcRow[]; total: number }> {
  const all: OrcRow[] = []
  let offset = 0
  let total = 0

  while (true) {
    const { data, error, count } = await supabase
      .from('orcamentos_files')
      .select('ano, mtime_iso, status_kanban, vendor_id', { count: 'exact' })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (count != null) total = count
    const page = (data ?? []) as OrcRow[]
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return { rows: all, total }
}

export function useOrcamentoStats() {
  return useQuery({
    queryKey: ['orcamento-stats-v3'],
    queryFn: async () => {
      const { rows, total } = await fetchAllRows()

      const byYear: Record<string, number> = {}
      const byMonth: Record<string, number> = {}
      const byStatus: Record<string, number> = {}
      const byVendor: Record<string, number> = {}  // 'null' = sem vendedor

      for (const row of rows) {
        if (row.ano != null) {
          const y = String(row.ano)
          byYear[y] = (byYear[y] ?? 0) + 1
        }
        if (row.mtime_iso) {
          const monthKey = row.mtime_iso.slice(0, 7)
          byMonth[monthKey] = (byMonth[monthKey] ?? 0) + 1
        }
        if (row.status_kanban) {
          byStatus[row.status_kanban] = (byStatus[row.status_kanban] ?? 0) + 1
        }
        const vk = row.vendor_id ?? 'null'
        byVendor[vk] = (byVendor[vk] ?? 0) + 1
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

      const statusStats: OrcStatusStat[] = Object.entries(byStatus)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count)

      const vendorStats: OrcVendorStat[] = Object.entries(byVendor)
        .map(([vid, count]) => ({ vendor_id: vid === 'null' ? null : vid, count }))
        .sort((a, b) => b.count - a.count)

      return {
        total: total || rows.length,
        yearStats,
        monthStats,
        statusStats,
        vendorStats,
        hasMonthData: monthStats.length > 0,
      }
    },
    staleTime: 5 * 60_000,
  })
}
