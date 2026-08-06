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
  resolverEscopo, ehGateErro, pedidoNoEscopo, ehGestor,
  lerControle, lerConferencias, agregarPedido, resumoKpis, agrupar, hojeSP, crmAdmin,
  COLS_PEDIDO, COLS_PARCELA, COLS_RECEIPT,
  type PedidoRaw, type ParcelaRaw, type ReceiptRaw, type PedidoFinanceiro,
} from './_lib/financeiro-core.js'

/** Item 10: acompanhamento por vendedor, só para quem enxerga a base toda. */
function porVendedor(rows: PedidoFinanceiro[]) {
  const m = new Map<string, {
    vendedor: string; pedidos: number; vendido: number; recebido: number; aReceber: number
    vencido: number; parcelasVencidas: number; semComprovante: number; aConferir: number
    boletosPendentes: number; semPlano: number; divergentes: number
  }>()
  for (const r of rows) {
    if (r.status === 'CANCELADO') continue
    const nome = (r.vendedor || '(sem vendedor)').trim().toUpperCase()
    let a = m.get(nome)
    if (!a) {
      a = { vendedor: nome, pedidos: 0, vendido: 0, recebido: 0, aReceber: 0, vencido: 0,
        parcelasVencidas: 0, semComprovante: 0, aConferir: 0, boletosPendentes: 0, semPlano: 0, divergentes: 0 }
      m.set(nome, a)
    }
    a.pedidos++
    a.vendido += r.valorTotal
    a.recebido += r.recebido
    a.aReceber += r.aReceber
    a.vencido += r.vencido
    a.parcelasVencidas += r.parcelasVencidas
    a.semComprovante += r.pagamentosSemComprovante
    a.aConferir += r.comprovantesAConferir
    a.boletosPendentes += r.boletosPendentes
    if (r.status === 'SEM_PLANO') a.semPlano++
    if (Math.abs(r.divergenciaPlano) > 0.01) a.divergentes++
  }
  return [...m.values()].sort((a, b) => b.vencido - a.vencido || b.aReceber - a.aReceber)
}

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
      const [parcelas, receipts, confs] = await Promise.all([
        lerControle<ParcelaRaw>('order_installments', COLS_PARCELA, ordFiltro),
        lerControle<ReceiptRaw>('receipts', COLS_RECEIPT, ordFiltro),
        lerConferencias([pedidoId]),
      ])

      // Linha do tempo do pedido (item 14)
      const { data: hist } = await crmAdmin()
        .from('fin_auditoria')
        .select('id, acao, motivo, ator_nome, ator_papel, created_at, antes, depois')
        .eq('order_id', pedidoId)
        .order('created_at', { ascending: false })
        .limit(100)

      return res.status(200).json({
        ok: true,
        hoje,
        escopo: { role: esc.role, vendedores: esc.vendedores, gestor: ehGestor(esc.role) },
        pedido: agregarPedido(pedido, parcelas, receipts, hoje, confs),
        historico: hist ?? [],
      })
    }

    // ── Lista ─────────────────────────────────────────────────────────────
    const [pedidosTodos, parcelas, receipts] = await Promise.all([
      lerControle<PedidoRaw>('pedidos_venda', COLS_PEDIDO),
      lerControle<ParcelaRaw>('order_installments', COLS_PARCELA),
      lerControle<ReceiptRaw>('receipts', COLS_RECEIPT),
    ])

    const pedidos = pedidosTodos.filter(p => pedidoNoEscopo(p, esc))
    const confs = await lerConferencias(pedidos.map(p => p.id))
    const porPedido = agrupar(parcelas, p => p.order_id)
    const porPedidoRec = agrupar(receipts, r => r.order_id)

    const linhas = pedidos.map(p => {
      const { parcelas: _omitido, ...resto } = agregarPedido(
        p, porPedido.get(p.id) ?? [], porPedidoRec.get(p.id) ?? [], hoje, confs,
      )
      return resto
    })

    linhas.sort((a, b) => b.vencido - a.vencido || b.aReceber - a.aReceber)

    const gestor = ehGestor(esc.role)
    return res.status(200).json({
      ok: true,
      hoje,
      escopo: { role: esc.role, vendedores: esc.vendedores, gestor },
      kpis: resumoKpis(linhas),
      pedidos: linhas,
      // Item 10: a visão por vendedor só existe para quem enxerga todos.
      vendedores: gestor ? porVendedor(linhas) : null,
    })
  } catch (e) {
    return res.status(502).json({ error: 'controle_indisponivel', detail: (e as Error).message })
  }
}
