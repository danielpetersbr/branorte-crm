// Vercel serverless — Financeiro · Recebíveis.
//
// GET /api/financeiro                 -> lista de pedidos + KPIs (sem parcelas)
// GET /api/financeiro?pedido_id=<id>  -> um pedido COM parcelas e recebimentos
//
// Lê ao vivo do controle.branorte.com. O recorte por vendedor é decidido aqui,
// no servidor, a partir do JWT do CRM — nunca no navegador (a anon key do
// controle é pública; filtro no React seria decorativo).
//
// Env vars (Vercel):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  -> valida o JWT do CRM
//   CONTROLE_SUPABASE_URL (opcional)          -> default kfucuvwrnwrkshxpsmyq
//   CONTROLE_SERVICE_KEY / CONTROLE_ANON_KEY  -> override da key do controle
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  resolverEscopo, ehGateErro, pedidoNoEscopo,
  lerControle, agregarPedido, resumoKpis, agrupar, hojeSP,
  COLS_PEDIDO, COLS_PARCELA, COLS_RECEIPT,
  type PedidoRaw, type ParcelaRaw, type ReceiptRaw,
} from './_lib/financeiro-core.js'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Resposta varia por usuário: NUNCA cachear no CDN (a chave de cache da
  // Vercel é só a URL — `public` aqui vazaria o recorte de um vendedor pro outro).
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Vary', 'Authorization')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const esc = await resolverEscopo(req.headers.authorization)
  if (ehGateErro(esc)) {
    return res.status(esc.status).json({
      error: esc.error,
      detail: esc.error === 'sem_escopo'
        ? 'Seu usuário não está vinculado a um vendedor. Peça ao admin para vincular em /admin/usuarios.'
        : undefined,
    })
  }

  const pedidoId = typeof req.query.pedido_id === 'string' ? req.query.pedido_id : null
  const hoje = hojeSP()

  try {
    if (pedidoId) {
      // ── Detalhe de um pedido ────────────────────────────────────────────
      const filtro = `&id=eq.${encodeURIComponent(pedidoId)}`
      const [pedido] = await lerControle<PedidoRaw>('pedidos_venda', COLS_PEDIDO, filtro)
      if (!pedido) return res.status(404).json({ error: 'pedido_nao_encontrado' })

      // Autorização por objeto: o escopo é conferido no PEDIDO carregado, não
      // no filtro da query — assim um id adivinhado de outro vendedor dá 403.
      if (!pedidoNoEscopo(pedido, esc)) return res.status(403).json({ error: 'fora_do_escopo' })

      const ordFiltro = `&order_id=eq.${encodeURIComponent(pedidoId)}`
      const [parcelas, receipts] = await Promise.all([
        lerControle<ParcelaRaw>('order_installments', COLS_PARCELA, ordFiltro),
        lerControle<ReceiptRaw>('receipts', COLS_RECEIPT, ordFiltro),
      ])

      return res.status(200).json({
        ok: true,
        hoje,
        escopo: { role: esc.role, vendedores: esc.vendedores },
        pedido: agregarPedido(pedido, parcelas, receipts, hoje),
      })
    }

    // ── Lista ─────────────────────────────────────────────────────────────
    const [pedidosTodos, parcelas, receipts] = await Promise.all([
      lerControle<PedidoRaw>('pedidos_venda', COLS_PEDIDO),
      lerControle<ParcelaRaw>('order_installments', COLS_PARCELA),
      lerControle<ReceiptRaw>('receipts', COLS_RECEIPT),
    ])

    const pedidos = pedidosTodos.filter(p => pedidoNoEscopo(p, esc))
    const porPedido = agrupar(parcelas, p => p.order_id)
    const porPedidoRec = agrupar(receipts, r => r.order_id)

    const linhas = pedidos.map(p => {
      const { parcelas: _omitido, ...resto } = agregarPedido(
        p, porPedido.get(p.id) ?? [], porPedidoRec.get(p.id) ?? [], hoje,
      )
      return resto
    })

    linhas.sort((a, b) => b.vencido - a.vencido || b.aReceber - a.aReceber)

    return res.status(200).json({
      ok: true,
      hoje,
      escopo: { role: esc.role, vendedores: esc.vendedores },
      kpis: resumoKpis(linhas),
      pedidos: linhas,
    })
  } catch (e) {
    return res.status(502).json({ error: 'controle_indisponivel', detail: (e as Error).message })
  }
}
