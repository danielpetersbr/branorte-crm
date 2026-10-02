import { getValorPedido, type Pedido } from './calculos'

/** Contagens de registros monetários. Cada exclusão pertence a uma única etapa. */
export function resumoAuditoriaVendas(pedidos: Pedido[], valorMinimo: number): {
  totalCarregados: number
  totalCancelados: number
  excluidosPorValor: number
  pedidosAtivos: Pedido[]
  totalAtivos: number
} {
  let totalCancelados = 0
  let excluidosPorValor = 0
  const pedidosAtivos: Pedido[] = []
  for (const pedido of pedidos) {
    if (pedido.status === 'CANCELADO') {
      totalCancelados++
      continue
    }
    // Um split ou ajuste isolado continua usando o total integral do pedido pai.
    const totalPai = getValorPedido({ ...pedido, _valorOverride: undefined })
    if (valorMinimo > 0 && totalPai < valorMinimo) {
      excluidosPorValor++
      continue
    }
    pedidosAtivos.push(pedido)
  }
  return { totalCarregados: pedidos.length, totalCancelados, excluidosPorValor, pedidosAtivos, totalAtivos: pedidosAtivos.length }
}
