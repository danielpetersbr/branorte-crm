// Vercel serverless — ações de escrita do Financeiro.
//
// POST /api/financeiro-acao  { acao: '...', ... }
//
//   lancar_pagamento     vendedor+gestor  cria receipt no controle (+ comprovante opcional)
//   anexar_comprovante   vendedor+gestor  anexa arquivo a um recebimento existente
//   confirmar_boleto     vendedor+gestor  marca boleto enviado (quem/quando/por qual meio)
//   conferir             SÓ gestor        aprova ou rejeita um comprovante
//
// O dinheiro (receipts, order_installments) vai pro controle.branorte.com, que
// é a fonte única. A camada de gestão (conferência, log de boleto, auditoria,
// notificação) fica nas tabelas fin_* do CRM.
//
// LIMITE CONHECIDO: a anon key do controle sobe arquivo NOVO no bucket
// `comprovantes`, mas NÃO substitui nem apaga (HTTP 400 nos dois). Por isso
// "substituir" é implementado como anexar outro comprovante — que é também o
// que o spec pede ("permitir mais de um arquivo na mesma parcela"). Excluir
// arquivo depende da service_role do controle (env CONTROLE_SERVICE_KEY).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  resolverEscopo, ehGateErro, pedidoNoEscopo, ehGestor, podeAlterarRecebimento,
  lerControle, crmAdmin, auditar, notificar, idsDosGestores, idsDosVendedoresDoPedido, hojeSP,
  devidoDe, valorPassaDoPedido,
  CONTROLE_URL, CONTROLE_KEY, COLS_PEDIDO, COLS_PARCELA, COLS_RECEIPT,
  type PedidoRaw, type ParcelaRaw, type ReceiptRaw,
} from './_lib/financeiro-core.js'

type ReceiptCompleto = ReceiptRaw

/**
 * supabase-js NÃO lança: devolve `{ error }`. Sem olhar isso a ação respondia
 * `ok: true` e a conferência/regularização/entrega simplesmente não existia —
 * o mesmo tropeço que já tinha escondido o 42P10 do notificar().
 */
class CrmRecusou extends Error {}
function exigir(r: { error: { message: string } | null }, onde: string): void {
  if (r.error) throw new CrmRecusou(`${onde}: ${r.error.message}`)
}
/** Para gravação secundária: a ação principal já aconteceu, então só registra. */
function avisarSeFalhou(r: { error: { message: string } | null }, onde: string): void {
  if (r.error) console.error(`[financeiro-acao] ${onde}:`, r.error.message)
}

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const config = { api: { bodyParser: { sizeLimit: '10mb' } }, maxDuration: 30 }

const MEIOS_BOLETO = new Set(['WHATSAPP', 'EMAIL', 'OUTRO'])
const MEIOS_PAGAMENTO = new Set(['PIX', 'BOLETO', 'CARTAO', 'TRANSFERENCIA', 'DINHEIRO', 'OUTRO'])

/** Formatos aceitos no item 3 do spec. */
const TIPOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
// A Vercel corta o CORPO da requisição em 4,5 MB — o `sizeLimit: '10mb'` acima
// nunca valeu. Como o arquivo viaja em base64 (+33%), o binário útil para em
// ~3,3 MB. O limite aqui é 4 MB só para dar erro claro em vez de 413 mudo; o
// navegador já comprime foto grande antes de enviar (ver lerArquivo no hook).
const MAX_BYTES = 4 * 1024 * 1024

interface Arquivo { nome?: string; tipo?: string; base64?: string }

async function ctrl(caminho: string, init: RequestInit = {}) {
  return fetch(`${CONTROLE_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: CONTROLE_KEY,
      Authorization: `Bearer ${CONTROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

/** Sobe o comprovante e devolve a URL pública. `null` se não veio arquivo. */
async function subirComprovante(orderId: string, arq: Arquivo | undefined): Promise<string | null> {
  if (!arq?.base64) return null
  const ext = TIPOS[(arq.tipo || '').toLowerCase()]
  if (!ext) throw new Error('formato_nao_aceito')

  const bin = Buffer.from(arq.base64.replace(/^data:[^,]+,/, ''), 'base64')
  if (bin.length === 0) throw new Error('arquivo_vazio')
  if (bin.length > MAX_BYTES) throw new Error('arquivo_grande')

  // Nome único: o bucket não aceita sobrescrever com esta chave.
  const nome = `${orderId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const resp = await fetch(`${CONTROLE_URL}/storage/v1/object/comprovantes/${nome}`, {
    method: 'POST',
    headers: {
      apikey: CONTROLE_KEY,
      Authorization: `Bearer ${CONTROLE_KEY}`,
      'Content-Type': arq.tipo || 'application/octet-stream',
    },
    body: new Uint8Array(bin),
  })
  if (!resp.ok) throw new Error(`upload_falhou: ${resp.status} ${await resp.text()}`)
  return `${CONTROLE_URL}/storage/v1/object/public/comprovantes/${nome}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const esc = await resolverEscopo(req.headers.authorization)
  if (ehGateErro(esc)) return res.status(esc.status).json({ error: esc.error })

  const b = (req.body || {}) as Record<string, unknown>
  const acao = String(b.acao || '')
  const orderId = String(b.order_id || '')
  if (!orderId) return res.status(400).json({ error: 'order_id_obrigatorio' })

  // ── Autorização por objeto: o pedido é carregado e conferido contra o escopo.
  const [pedido] = await lerControle<PedidoRaw>('pedidos_venda', COLS_PEDIDO, `&id=eq.${encodeURIComponent(orderId)}`)
  if (!pedido) return res.status(404).json({ error: 'pedido_nao_encontrado' })
  if (!pedidoNoEscopo(pedido, esc)) return res.status(403).json({ error: 'fora_do_escopo' })

  const gestor = ehGestor(esc.role)
  const ator = { ator: esc.userId, ator_nome: esc.displayName, ator_papel: esc.role }
  const crm = crmAdmin()

  try {
    switch (acao) {
      // ───────────────────────────────────────────────────────────────────
      case 'lancar_pagamento': {
        const installmentId = b.installment_id ? String(b.installment_id) : null
        const valor = Number(b.valor)
        const pagoEm = String(b.pago_em || '').slice(0, 10)
        const meio = String(b.meio || 'PIX').toUpperCase()

        if (!(valor > 0)) return res.status(400).json({ error: 'valor_invalido', detail: 'Informe um valor maior que zero.' })
        if (valorPassaDoPedido(valor, devidoDe(pedido))) {
          return res.status(400).json({ error: 'valor_acima_do_pedido',
            detail: `${fmtBRL(valor)} é mais que o pedido inteiro (${fmtBRL(devidoDe(pedido))}). Confira o valor digitado.` })
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pagoEm)) return res.status(400).json({ error: 'data_invalida', detail: 'Informe a data do recebimento.' })
        if (pagoEm > hojeSP()) return res.status(400).json({ error: 'data_futura', detail: 'A data do recebimento não pode estar no futuro.' })
        if (!MEIOS_PAGAMENTO.has(meio)) return res.status(400).json({ error: 'meio_invalido' })

        let parcela: ParcelaRaw | undefined
        if (installmentId) {
          const ps = await lerControle<ParcelaRaw>('order_installments', COLS_PARCELA, `&id=eq.${encodeURIComponent(installmentId)}`)
          parcela = ps[0]
          // a parcela tem que ser DESTE pedido — senão dá pra lançar no pedido dos outros
          if (!parcela || parcela.order_id !== orderId) return res.status(400).json({ error: 'parcela_nao_e_do_pedido' })
          if (parcela.canceled) return res.status(400).json({ error: 'parcela_cancelada', detail: 'Essa parcela está cancelada.' })
        }

        const url = await subirComprovante(orderId, b.arquivo as Arquivo | undefined)

        const resp = await ctrl('receipts', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            order_id: orderId,
            installment_id: installmentId,
            installment_no: parcela?.installment_no ?? null,
            amount: valor,
            paid_at: pagoEm,
            payment_method: meio,
            notes: (b.observacao as string) || null,
            receipt_url: url,
          }),
        })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })
        const [novo] = (await resp.json()) as { id: string }[]

        // Nasce AGUARDANDO: lançar valor NÃO quita (item 2). Se esta linha falhar,
        // o recebimento continua valendo como AGUARDANDO (é o default de quem não
        // tem conferência) — por isso só registra, não derruba o lançamento.
        avisarSeFalhou(await crm.from('fin_conferencias').upsert({
          receipt_id: novo.id, order_id: orderId, installment_id: installmentId,
          status: 'AGUARDANDO', criado_por: esc.userId, criado_por_nome: esc.displayName,
          updated_at: new Date().toISOString(),
        }), 'conferencia do lancamento')

        await auditar({ order_id: orderId, installment_id: installmentId, receipt_id: novo.id,
          acao: url ? 'pagamento_lancado_com_comprovante' : 'pagamento_lancado_sem_comprovante',
          depois: { valor, pagoEm, meio, comprovante: !!url }, ...ator })

        await notificar({
          destinatarios: await idsDosGestores(), tipo: 'comprovante_a_conferir',
          titulo: url ? 'Novo comprovante para conferir' : 'Pagamento lançado sem comprovante',
          corpo: `${esc.displayName || 'Alguém'} lançou ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no pedido ${pedido.pedido_numero}.`,
          order_id: orderId, installment_id: installmentId, chave: `rec:${novo.id}`,
        })

        return res.status(200).json({ ok: true, receipt_id: novo.id, comprovante_url: url })
      }

      // ───────────────────────────────────────────────────────────────────
      case 'anexar_comprovante': {
        const receiptId = String(b.receipt_id || '')
        if (!receiptId) return res.status(400).json({ error: 'receipt_id_obrigatorio' })

        const rs = await lerControle<{ id: string; order_id: string; installment_id: string | null; receipt_url: string | null }>(
          'receipts', 'id,order_id,installment_id,receipt_url', `&id=eq.${encodeURIComponent(receiptId)}`)
        const rec = rs[0]
        if (!rec || rec.order_id !== orderId) return res.status(400).json({ error: 'recebimento_nao_e_do_pedido' })

        // Trocar o comprovante de um pagamento já aprovado devolve ele pra fila
        // e tira do recebimento o arquivo que o gestor conferiu. É alterar
        // dinheiro conferido — mesma trava do editar/excluir.
        const { data: cfAnexo, error: eCfAnexo } = await crm.from('fin_conferencias').select('status').eq('receipt_id', receiptId).maybeSingle()
        if (eCfAnexo) throw new CrmRecusou(`ler conferencia: ${eCfAnexo.message}`)
        const permAnexo = podeAlterarRecebimento(esc.role, (cfAnexo?.status as 'AGUARDANDO' | 'APROVADO' | 'REJEITADO') ?? 'AGUARDANDO')
        if (!permAnexo.ok) return res.status(403).json({ error: 'precisa_gestor', detail: permAnexo.motivo })

        const url = await subirComprovante(orderId, b.arquivo as Arquivo | undefined)
        if (!url) return res.status(400).json({ error: 'arquivo_obrigatorio' })

        const resp = await ctrl(`receipts?id=eq.${encodeURIComponent(receiptId)}`, {
          method: 'PATCH', body: JSON.stringify({ receipt_url: url }),
        })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })

        // Comprovante novo reabre a conferência — inclusive se estava rejeitado.
        avisarSeFalhou(await crm.from('fin_conferencias').upsert({
          receipt_id: receiptId, order_id: orderId, installment_id: rec.installment_id,
          status: 'AGUARDANDO', motivo: null, conferido_por: null, conferido_por_nome: null,
          conferido_em: null, updated_at: new Date().toISOString(),
        }), 'reabrir conferencia do anexo')

        await auditar({ order_id: orderId, installment_id: rec.installment_id, receipt_id: receiptId,
          acao: 'comprovante_anexado', antes: { comprovante: rec.receipt_url }, depois: { comprovante: url }, ...ator })

        await notificar({
          destinatarios: await idsDosGestores(), tipo: 'comprovante_a_conferir',
          titulo: 'Comprovante anexado',
          corpo: `${esc.displayName || 'Alguém'} anexou um comprovante no pedido ${pedido.pedido_numero}.`,
          order_id: orderId, installment_id: rec.installment_id, chave: `anexo:${receiptId}:${url.slice(-24)}`,
        })

        return res.status(200).json({ ok: true, comprovante_url: url })
      }

      // ───────────────────────────────────────────────────────────────────
      case 'confirmar_boleto': {
        const installmentId = String(b.installment_id || '')
        const meio = String(b.meio || '').toUpperCase()
        if (!installmentId) return res.status(400).json({ error: 'installment_id_obrigatorio' })
        if (!MEIOS_BOLETO.has(meio)) return res.status(400).json({ error: 'meio_invalido', detail: 'Escolha WhatsApp, E-mail ou Outro.' })

        const ps = await lerControle<ParcelaRaw>('order_installments', COLS_PARCELA, `&id=eq.${encodeURIComponent(installmentId)}`)
        const parcela = ps[0]
        if (!parcela || parcela.order_id !== orderId) return res.status(400).json({ error: 'parcela_nao_e_do_pedido' })
        if (parcela.canceled) return res.status(400).json({ error: 'parcela_cancelada' })

        const url = await subirComprovante(orderId, b.arquivo as Arquivo | undefined)
        const agora = new Date().toISOString()

        // Espelha no controle pra tela de lá concordar com a daqui.
        const resp = await ctrl(`order_installments?id=eq.${encodeURIComponent(installmentId)}`, {
          method: 'PATCH', body: JSON.stringify({ boleto_enviado: true, boleto_enviado_em: agora }),
        })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })

        // O detalhe (quem/por onde/observação) o controle não guarda — fica aqui.
        avisarSeFalhou(await crm.from('fin_boleto_envios').insert({
          order_id: orderId, installment_id: installmentId, meio,
          observacao: (b.observacao as string) || null, arquivo_url: url,
          vencimento: parcela.due_date, enviado_por: esc.userId, enviado_por_nome: esc.displayName,
          enviado_em: agora,
        }), 'log do boleto')

        await auditar({ order_id: orderId, installment_id: installmentId, acao: 'boleto_enviado',
          antes: { boleto_enviado: !!parcela.boleto_enviado }, depois: { boleto_enviado: true, meio }, ...ator })

        return res.status(200).json({ ok: true, enviado_em: agora })
      }

      // ───────────────────────────────────────────────────────────────────
      case 'conferir': {
        // Item 6: conferir é exclusivo do gestor/financeiro. O vendedor lança e
        // anexa, mas não valida o próprio pagamento.
        if (!gestor) return res.status(403).json({ error: 'so_gestor', detail: 'Só gestor ou financeiro pode conferir comprovante.' })

        const receiptId = String(b.receipt_id || '')
        const status = String(b.status || '').toUpperCase()
        const motivo = ((b.motivo as string) || '').trim()
        if (!receiptId) return res.status(400).json({ error: 'receipt_id_obrigatorio' })
        if (status !== 'APROVADO' && status !== 'REJEITADO') return res.status(400).json({ error: 'status_invalido' })
        if (status === 'REJEITADO' && !motivo) {
          return res.status(400).json({ error: 'motivo_obrigatorio', detail: 'Rejeitar exige uma justificativa.' })
        }

        const rs = await lerControle<{ id: string; order_id: string; installment_id: string | null; amount: number; receipt_url: string | null }>(
          'receipts', 'id,order_id,installment_id,amount,receipt_url', `&id=eq.${encodeURIComponent(receiptId)}`)
        const rec = rs[0]
        if (!rec || rec.order_id !== orderId) return res.status(400).json({ error: 'recebimento_nao_e_do_pedido' })
        if (status === 'APROVADO' && !rec.receipt_url) {
          return res.status(400).json({ error: 'sem_comprovante', detail: 'Não dá pra aprovar um recebimento sem comprovante anexado.' })
        }

        const { data: antes } = await crm.from('fin_conferencias').select('status, motivo').eq('receipt_id', receiptId).maybeSingle()

        exigir(await crm.from('fin_conferencias').upsert({
          receipt_id: receiptId, order_id: orderId, installment_id: rec.installment_id,
          status, motivo: motivo || null,
          conferido_por: esc.userId, conferido_por_nome: esc.displayName,
          conferido_em: new Date().toISOString(), updated_at: new Date().toISOString(),
        }), 'gravar conferencia')

        await auditar({ order_id: orderId, installment_id: rec.installment_id, receipt_id: receiptId,
          acao: status === 'APROVADO' ? 'comprovante_aprovado' : 'comprovante_rejeitado',
          antes: antes ?? { status: 'AGUARDANDO' }, depois: { status }, motivo: motivo || null, ...ator })

        await notificar({
          destinatarios: await idsDosVendedoresDoPedido(pedido), tipo: `comprovante_${status.toLowerCase()}`,
          titulo: status === 'APROVADO' ? 'Pagamento confirmado' : 'Comprovante rejeitado',
          corpo: status === 'APROVADO'
            ? `Seu comprovante no pedido ${pedido.pedido_numero} foi aprovado.`
            : `Comprovante do pedido ${pedido.pedido_numero} rejeitado: ${motivo}`,
          order_id: orderId, installment_id: rec.installment_id,
          chave: `conf:${receiptId}:${status}`,
        })

        return res.status(200).json({ ok: true })
      }

      // ───────────────────────────────────────────────────────────────────
      // Aprovar vários de uma vez (fila de conferência). Existe por causa do
      // cliente que paga em dezenas de PIX pequenos: 26 comprovantes de R$ 1.000
      // na mesma parcela eram 26 cliques. Só APROVA — rejeitar pede motivo, e
      // motivo é por comprovante. Todos têm que ser DESTE pedido e ter arquivo.
      case 'conferir_lote': {
        if (!gestor) return res.status(403).json({ error: 'so_gestor', detail: 'Só gestor ou financeiro pode conferir comprovante.' })
        const ids = [...new Set((Array.isArray(b.receipt_ids) ? b.receipt_ids : []).map(String).filter(Boolean))]
        if (ids.length === 0) return res.status(400).json({ error: 'receipt_ids_obrigatorio' })
        if (ids.length > 200) return res.status(400).json({ error: 'lote_grande', detail: 'No máximo 200 por vez.' })

        const rs = await lerControle<{ id: string; order_id: string; installment_id: string | null; amount: number; receipt_url: string | null }>(
          'receipts', 'id,order_id,installment_id,amount,receipt_url', `&id=in.(${ids.map(encodeURIComponent).join(',')})`)
        if (rs.length !== ids.length || rs.some(r => r.order_id !== orderId)) {
          return res.status(400).json({ error: 'recebimento_nao_e_do_pedido', detail: 'Algum comprovante do lote não é deste pedido.' })
        }
        if (rs.some(r => !r.receipt_url)) {
          return res.status(400).json({ error: 'sem_comprovante', detail: 'Tem pagamento sem arquivo no lote — esse não dá pra aprovar.' })
        }

        const agora = new Date().toISOString()
        exigir(await crm.from('fin_conferencias').upsert(rs.map(r => ({
          receipt_id: r.id, order_id: orderId, installment_id: r.installment_id,
          status: 'APROVADO', motivo: null,
          conferido_por: esc.userId, conferido_por_nome: esc.displayName,
          conferido_em: agora, updated_at: agora,
        }))), 'aprovar em lote')

        await Promise.all(rs.map(r => auditar({ order_id: orderId, installment_id: r.installment_id, receipt_id: r.id,
          acao: 'comprovante_aprovado', depois: { status: 'APROVADO' }, motivo: `aprovado em lote (${rs.length})`, ...ator })))

        const total = rs.reduce((s, r) => s + (Number(r.amount) || 0), 0)
        await notificar({
          destinatarios: await idsDosVendedoresDoPedido(pedido), tipo: 'comprovante_aprovado',
          titulo: 'Pagamentos confirmados',
          corpo: `${rs.length} comprovantes do pedido ${pedido.pedido_numero} foram aprovados (${fmtBRL(total)}).`,
          order_id: orderId, chave: `conflote:${orderId}:${agora}`,
        })

        return res.status(200).json({ ok: true, aprovados: rs.length })
      }

      // ───────────────────────────────────────────────────────────────────
      case 'editar_pagamento': {
        const receiptId = String(b.receipt_id || '')
        if (!receiptId) return res.status(400).json({ error: 'receipt_id_obrigatorio' })

        const rs = await lerControle<ReceiptCompleto>('receipts', COLS_RECEIPT, `&id=eq.${encodeURIComponent(receiptId)}`)
        const rec = rs[0]
        if (!rec || rec.order_id !== orderId) return res.status(400).json({ error: 'recebimento_nao_e_do_pedido' })

        // Falha ao ler NÃO pode virar "aguardando": seria liberar a edição de pagamento aprovado.
        const { data: cf, error: eCf } = await crm.from('fin_conferencias').select('status, motivo').eq('receipt_id', receiptId).maybeSingle()
        if (eCf) throw new CrmRecusou(`ler conferencia: ${eCf.message}`)
        const confAtual = (cf?.status as 'AGUARDANDO' | 'APROVADO' | 'REJEITADO') ?? 'AGUARDANDO'
        const perm = podeAlterarRecebimento(esc.role, confAtual)
        if (!perm.ok) return res.status(403).json({ error: 'precisa_gestor', detail: perm.motivo })

        // Só mexe no que veio; o resto fica como está.
        const patch: Record<string, unknown> = {}
        if (b.valor !== undefined) {
          const v = Number(b.valor)
          if (!(v > 0)) return res.status(400).json({ error: 'valor_invalido', detail: 'Informe um valor maior que zero.' })
          if (valorPassaDoPedido(v, devidoDe(pedido))) {
            return res.status(400).json({ error: 'valor_acima_do_pedido',
              detail: `${fmtBRL(v)} é mais que o pedido inteiro (${fmtBRL(devidoDe(pedido))}). Confira o valor digitado.` })
          }
          patch.amount = v
        }
        if (b.pago_em !== undefined) {
          const d = String(b.pago_em).slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'data_invalida' })
          if (d > hojeSP()) return res.status(400).json({ error: 'data_futura', detail: 'A data do recebimento não pode estar no futuro.' })
          patch.paid_at = d
        }
        if (b.meio !== undefined) {
          const m = String(b.meio).toUpperCase()
          if (!MEIOS_PAGAMENTO.has(m)) return res.status(400).json({ error: 'meio_invalido' })
          patch.payment_method = m
        }
        if (b.observacao !== undefined) patch.notes = String(b.observacao) || null
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nada_a_mudar' })

        // Mudou dinheiro/data/forma? A aprovação anterior não vale mais para o
        // novo valor — volta pra fila de conferência em vez de seguir "aprovado".
        // Reabre ANTES de mexer no controle: se a reabertura falhar, nada muda;
        // na ordem inversa, uma falha deixava o valor novo marcado como aprovado.
        const mexeuNoDinheiro = patch.amount !== undefined || patch.paid_at !== undefined || patch.payment_method !== undefined
        const reabriu = mexeuNoDinheiro && confAtual === 'APROVADO'
        if (reabriu) {
          exigir(await crm.from('fin_conferencias').upsert({
            receipt_id: receiptId, order_id: orderId, installment_id: rec.installment_id,
            status: 'AGUARDANDO', motivo: null, conferido_por: null, conferido_por_nome: null,
            conferido_em: null, updated_at: new Date().toISOString(),
          }), 'reabrir conferencia')
        }

        const resp = await ctrl(`receipts?id=eq.${encodeURIComponent(receiptId)}`, {
          method: 'PATCH', body: JSON.stringify(patch),
        })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })

        await auditar({ order_id: orderId, installment_id: rec.installment_id, receipt_id: receiptId,
          acao: 'pagamento_editado',
          antes: { valor: rec.amount, pago_em: rec.paid_at, meio: rec.payment_method, observacao: rec.notes, conferencia: confAtual },
          depois: { ...patch, ...(reabriu ? { conferencia: 'AGUARDANDO' } : {}) },
          motivo: (b.motivo as string) || null, ...ator })

        if (reabriu) {
          await notificar({
            destinatarios: await idsDosGestores(), tipo: 'comprovante_a_conferir',
            titulo: 'Pagamento alterado — precisa conferir de novo',
            corpo: `${esc.displayName || 'Alguém'} alterou um pagamento já aprovado no pedido ${pedido.pedido_numero}.`,
            order_id: orderId, installment_id: rec.installment_id,
            chave: `reabriu:${receiptId}:${Date.now()}`,
          })
        }

        return res.status(200).json({ ok: true, reabriu_conferencia: reabriu })
      }

      // ───────────────────────────────────────────────────────────────────
      case 'excluir_pagamento': {
        const receiptId = String(b.receipt_id || '')
        const motivo = ((b.motivo as string) || '').trim()
        if (!receiptId) return res.status(400).json({ error: 'receipt_id_obrigatorio' })

        const rs = await lerControle<ReceiptCompleto>('receipts', COLS_RECEIPT, `&id=eq.${encodeURIComponent(receiptId)}`)
        const rec = rs[0]
        if (!rec || rec.order_id !== orderId) return res.status(400).json({ error: 'recebimento_nao_e_do_pedido' })

        const { data: cf, error: eCf } = await crm.from('fin_conferencias').select('status').eq('receipt_id', receiptId).maybeSingle()
        if (eCf) throw new CrmRecusou(`ler conferencia: ${eCf.message}`)
        const confAtual = (cf?.status as 'AGUARDANDO' | 'APROVADO' | 'REJEITADO') ?? 'AGUARDANDO'
        const perm = podeAlterarRecebimento(esc.role, confAtual)
        if (!perm.ok) return res.status(403).json({ error: 'precisa_gestor', detail: perm.motivo })

        // Apagar dinheiro já conferido exige justificativa — quem aprovou merece
        // saber por que sumiu.
        if (confAtual === 'APROVADO' && !motivo) {
          return res.status(400).json({ error: 'motivo_obrigatorio', detail: 'Excluir um pagamento já aprovado exige justificativa.' })
        }

        // AUDITA ANTES de apagar: depois da exclusão a linha não existe mais pra
        // ser lida. Guarda o snapshot inteiro, inclusive a URL do comprovante,
        // porque o arquivo permanece no bucket (a anon key não apaga storage).
        await auditar({ order_id: orderId, installment_id: rec.installment_id, receipt_id: receiptId,
          acao: 'pagamento_excluido',
          antes: { valor: rec.amount, pago_em: rec.paid_at, meio: rec.payment_method,
            observacao: rec.notes, comprovante: rec.receipt_url, conferencia: confAtual },
          depois: null, motivo: motivo || null, ...ator })

        const resp = await ctrl(`receipts?id=eq.${encodeURIComponent(receiptId)}`, { method: 'DELETE' })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })

        avisarSeFalhou(await crm.from('fin_conferencias').delete().eq('receipt_id', receiptId), 'apagar conferencia')

        // Gestores E o vendedor do pedido: quem lançou tem que saber que sumiu.
        const avisar = [...new Set([...(await idsDosGestores()), ...(await idsDosVendedoresDoPedido(pedido))])]
        await notificar({
          destinatarios: avisar, tipo: 'pagamento_excluido',
          titulo: 'Pagamento excluído',
          corpo: `${esc.displayName || 'Alguém'} excluiu um recebimento de ${Number(rec.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no pedido ${pedido.pedido_numero}.${motivo ? ' Motivo: ' + motivo : ''}`,
          order_id: orderId, installment_id: rec.installment_id, chave: `del:${receiptId}`,
        })

        return res.status(200).json({ ok: true, comprovante_orfao: rec.receipt_url })
      }

      // ───────────────────────────────────────────────────────────────────
      // Mutirão da dívida velha. O vendedor PROPÕE que o pedido antigo já foi
      // pago; quem confirma é o gestor. Se quem propõe já é gestor, nasce
      // confirmada — não faz sentido ele pedir aprovação a si mesmo.
      //
      // Isto NÃO cria receipt: não é dinheiro conferido, e a tela mostra os dois
      // separados. Só tira o pedido da fila de cobrança.
      case 'propor_regularizacao': {
        const motivo = String(b.motivo || '').trim()
        if (motivo.length < 5) {
          return res.status(400).json({ error: 'motivo_obrigatorio', detail: 'Escreva o que aconteceu com esse pedido — fica no histórico.' })
        }

        const { data: jaTem } = await crm.from('fin_regularizacoes')
          .select('status').eq('order_id', orderId).maybeSingle()
        if (jaTem?.status === 'CONFIRMADA') {
          return res.status(400).json({ error: 'ja_regularizado', detail: 'Este pedido já foi regularizado.' })
        }

        const agora = new Date().toISOString()
        const status = gestor ? 'CONFIRMADA' : 'PROPOSTA'
        exigir(await crm.from('fin_regularizacoes').upsert({
          order_id: orderId, status, motivo,
          valor_referencia: Number(pedido.valor_total) || null,
          proposto_por: esc.userId, proposto_por_nome: esc.displayName, proposto_em: agora,
          decidido_por: gestor ? esc.userId : null,
          decidido_por_nome: gestor ? esc.displayName : null,
          decidido_em: gestor ? agora : null,
          motivo_recusa: null,
          updated_at: agora,
        }), 'gravar regularizacao')

        await auditar({ order_id: orderId, acao: gestor ? 'regularizacao_confirmada' : 'regularizacao_proposta',
          motivo, depois: { status }, ...ator })

        if (!gestor) {
          await notificar({
            destinatarios: await idsDosGestores(), tipo: 'regularizacao_a_confirmar',
            titulo: 'Pedido antigo esperando regularização',
            corpo: `${esc.displayName || 'Alguém'} marcou o pedido ${pedido.pedido_numero} (${pedido.cliente || 'sem nome'}) como já pago. Motivo: ${motivo}`,
            order_id: orderId, chave: `reg:${orderId}`,
          })
        }

        return res.status(200).json({ ok: true, status })
      }

      // ───────────────────────────────────────────────────────────────────
      case 'decidir_regularizacao': {
        if (!gestor) {
          return res.status(403).json({ error: 'so_gestor', detail: 'Só o gestor confirma a regularização de um pedido antigo.' })
        }
        const decisao = String(b.status || '').toUpperCase()
        if (decisao !== 'CONFIRMADA' && decisao !== 'RECUSADA') {
          return res.status(400).json({ error: 'status_invalido' })
        }
        const motivoRecusa = String(b.motivo || '').trim()
        if (decisao === 'RECUSADA' && !motivoRecusa) {
          return res.status(400).json({ error: 'motivo_obrigatorio', detail: 'Diga por que está recusando — o vendedor vai ler.' })
        }

        const { data: reg } = await crm.from('fin_regularizacoes')
          .select('status, proposto_por, motivo').eq('order_id', orderId).maybeSingle()
        if (!reg) return res.status(404).json({ error: 'regularizacao_nao_encontrada' })

        const agora = new Date().toISOString()
        exigir(await crm.from('fin_regularizacoes').update({
          status: decisao, decidido_por: esc.userId, decidido_por_nome: esc.displayName,
          decidido_em: agora, motivo_recusa: decisao === 'RECUSADA' ? motivoRecusa : null,
          updated_at: agora,
        }).eq('order_id', orderId), 'decidir regularizacao')

        await auditar({ order_id: orderId,
          acao: decisao === 'CONFIRMADA' ? 'regularizacao_confirmada' : 'regularizacao_recusada',
          motivo: decisao === 'RECUSADA' ? motivoRecusa : reg.motivo,
          antes: { status: reg.status }, depois: { status: decisao }, ...ator })

        if (reg.proposto_por) {
          await notificar({
            destinatarios: [reg.proposto_por as string],
            tipo: 'regularizacao_decidida',
            titulo: decisao === 'CONFIRMADA' ? 'Regularização confirmada' : 'Regularização recusada',
            corpo: decisao === 'CONFIRMADA'
              ? `O pedido ${pedido.pedido_numero} foi regularizado e saiu da sua fila.`
              : `O pedido ${pedido.pedido_numero} continua em aberto. Motivo: ${motivoRecusa}`,
            order_id: orderId, chave: `regdec:${orderId}:${decisao}`,
          })
        }

        return res.status(200).json({ ok: true, status: decisao })
      }

      // ───────────────────────────────────────────────────────────────────
      // Desfazer. Em 04/09/2026 foram regularizados 365 pedidos de uma vez —
      // sem isto, corrigir um erro só dava por SQL, o que na prática significa
      // que ninguém corrigia. Só gestor: a regularização é decisão dele.
      case 'desfazer_regularizacao': {
        if (!gestor) {
          return res.status(403).json({ error: 'so_gestor', detail: 'Só o gestor desfaz uma regularização.' })
        }
        const motivo = String(b.motivo || '').trim()
        if (!motivo) {
          return res.status(400).json({ error: 'motivo_obrigatorio', detail: 'Diga por que está voltando este pedido para a cobrança.' })
        }

        const { data: reg } = await crm.from('fin_regularizacoes')
          .select('status, motivo, proposto_por, proposto_por_nome').eq('order_id', orderId).maybeSingle()
        if (!reg) return res.status(404).json({ error: 'nao_regularizado', detail: 'Este pedido não está regularizado.' })

        exigir(await crm.from('fin_regularizacoes').delete().eq('order_id', orderId), 'desfazer regularizacao')

        await auditar({ order_id: orderId, acao: 'regularizacao_desfeita', motivo,
          antes: { status: reg.status, motivo: reg.motivo }, depois: null, ...ator })

        // Quem propôs precisa saber que o pedido voltou pra fila dele.
        const avisar = [...new Set([
          ...(reg.proposto_por ? [reg.proposto_por as string] : []),
          ...(await idsDosVendedoresDoPedido(pedido)),
        ])].filter(id => id !== esc.userId)
        if (avisar.length) {
          await notificar({
            destinatarios: avisar, tipo: 'regularizacao_desfeita',
            titulo: 'Pedido voltou para a cobrança',
            corpo: `${esc.displayName || 'O gestor'} desfez a regularização do pedido ${pedido.pedido_numero} (${pedido.cliente || 'sem nome'}). Motivo: ${motivo}`,
            order_id: orderId, chave: `regundo:${orderId}:${Date.now()}`,
          })
        }

        return res.status(200).json({ ok: true })
      }

      // ───────────────────────────────────────────────────────────────────
      // O elo que faltava: a produção sabe quando o equipamento SAIU; só o
      // vendedor sabe quando o cliente RECEBEU. Marca dele, não briga com o
      // kanban da produção.
      case 'confirmar_entrega': {
        const entregueEm = String(b.entregue_em || '').slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entregueEm)) {
          return res.status(400).json({ error: 'data_invalida', detail: 'Informe a data em que o cliente recebeu.' })
        }
        if (entregueEm > hojeSP()) {
          return res.status(400).json({ error: 'data_futura', detail: 'A data da entrega não pode estar no futuro.' })
        }

        const agora = new Date().toISOString()
        exigir(await crm.from('fin_entregas').upsert({
          order_id: orderId, entregue_em: entregueEm,
          observacao: (b.observacao as string) || null,
          confirmado_por: esc.userId, confirmado_por_nome: esc.displayName,
          updated_at: agora,
        }), 'gravar entrega')

        await auditar({ order_id: orderId, acao: 'entrega_confirmada',
          depois: { entregue_em: entregueEm }, ...ator })

        return res.status(200).json({ ok: true, entregue_em: entregueEm })
      }

      default:
        return res.status(400).json({ error: 'acao_desconhecida' })
    }
  } catch (e) {
    if (e instanceof CrmRecusou) {
      console.error('[financeiro-acao]', e.message)
      return res.status(500).json({ error: 'crm_recusou', detail: `Não consegui gravar agora (${e.message}). Nada foi alterado — tente de novo.` })
    }
    const msg = (e as Error).message
    const mapa: Record<string, [number, string]> = {
      formato_nao_aceito: [400, 'Aceito apenas PDF, JPG, PNG ou WEBP.'],
      arquivo_grande: [400, 'O arquivo é grande demais. Tire a foto de novo ou mande um PDF menor que 3 MB.'],
      arquivo_vazio: [400, 'O arquivo chegou vazio.'],
    }
    const [status, detail] = mapa[msg] ?? [500, msg]
    return res.status(status).json({ error: msg.split(':')[0], detail })
  }
}
