import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ───────────────────────────────────────────────────────────────────────────
// Financeiro (recebíveis) espelhado do controle.branorte.com.
// Deriva das colunas de mirror_pedidos_venda (valor_total, valor_pago,
// status_pagamento, data_pagamento, forma_pagamento) — o controle tem
// order_installments/receipts dedicados, mas esses NÃO são espelhados ainda;
// aqui é a visão de recebíveis por pedido (a receber = devido - pago).
// ───────────────────────────────────────────────────────────────────────────

export interface FinanceiroRow {
  id: string
  pedido_numero: string | null
  cliente: string | null
  vendedor: string | null
  devido: number
  pago: number
  aReceber: number
  status_pagamento: string | null
  forma_pagamento: string | null
  data_venda: string | null
}

export interface FinanceiroResumo {
  totalDevido: number
  totalPago: number
  totalAReceber: number
  qtdPagos: number
  qtdPendentes: number
  rows: FinanceiroRow[]
}

interface Raw {
  id: string
  pedido_numero: string | null
  cliente: string | null
  vendedor: string | null
  valor_total: number | null
  valor_pago: number | null
  ajuste_valor: number | null
  payment_plan_json: { total?: number | string } | null
  status: string | null
  status_pagamento: string | null
  forma_pagamento: string | null
  data_venda: string | null
}

function devidoDe(p: Raw): number {
  const raw = p.payment_plan_json?.total
  const pt = raw != null ? Number(raw) : 0
  const base = pt > 0 ? pt : Number(p.valor_total) || 0
  return base + (Number(p.ajuste_valor) || 0)
}

export function useControleFinanceiro() {
  return useQuery({
    queryKey: ['controle-financeiro'],
    queryFn: async (): Promise<FinanceiroResumo> => {
      const { data, error } = await supabase
        .from('mirror_pedidos_venda')
        .select('id, pedido_numero, cliente, vendedor, valor_total, valor_pago, ajuste_valor, payment_plan_json, status, status_pagamento, forma_pagamento, data_venda')
        .neq('status', 'CANCELADO')
        .limit(20000)
      if (error) throw error

      const rows: FinanceiroRow[] = (data as Raw[] ?? []).map(p => {
        const devido = devidoDe(p)
        const pago = Number(p.valor_pago) || 0
        return {
          id: p.id,
          pedido_numero: p.pedido_numero,
          cliente: p.cliente,
          vendedor: p.vendedor,
          devido,
          pago,
          aReceber: Math.max(0, devido - pago),
          status_pagamento: p.status_pagamento,
          forma_pagamento: p.forma_pagamento,
          data_venda: p.data_venda,
        }
      })

      let totalDevido = 0, totalPago = 0, totalAReceber = 0, qtdPagos = 0, qtdPendentes = 0
      for (const r of rows) {
        totalDevido += r.devido
        totalPago += r.pago
        totalAReceber += r.aReceber
        if (r.aReceber <= 0.01) qtdPagos++
        else qtdPendentes++
      }

      rows.sort((a, b) => b.aReceber - a.aReceber)
      return { totalDevido, totalPago, totalAReceber, qtdPagos, qtdPendentes, rows }
    },
    staleTime: 60_000,
  })
}
