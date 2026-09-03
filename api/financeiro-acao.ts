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
  lerControle, crmAdmin, auditar, notificar, idsDosGestores, idsDoVendedor, hojeSP,
  CONTROLE_URL, CONTROLE_KEY, COLS_PEDIDO, COLS_PARCELA, COLS_RECEIPT,
  type PedidoRaw, type ParcelaRaw, type ReceiptRaw,
} from './_lib/financeiro-core.js'

type ReceiptCompleto = ReceiptRaw

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

        // Nasce AGUARDANDO: lançar valor NÃO quita (item 2).
        await crm.from('fin_conferencias').upsert({
          receipt_id: novo.id, order_id: orderId, installment_id: installmentId,
          status: 'AGUARDANDO', criado_por: esc.userId, criado_por_nome: esc.displayName,
          updated_at: new Date().toISOString(),
        })

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

        const url = await subirComprovante(orderId, b.arquivo as Arquivo | undefined)
        if (!url) return res.status(400).json({ error: 'arquivo_obrigatorio' })

        const resp = await ctrl(`receipts?id=eq.${encodeURIComponent(receiptId)}`, {
          method: 'PATCH', body: JSON.stringify({ receipt_url: url }),
        })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })

        // Comprovante novo reabre a conferência — inclusive se estava rejeitado.
        await crm.from('fin_conferencias').upsert({
          receipt_id: receiptId, order_id: orderId, installment_id: rec.installment_id,
          status: 'AGUARDANDO', motivo: null, conferido_por: null, conferido_por_nome: null,
          conferido_em: null, updated_at: new Date().toISOString(),
        })

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
        await crm.from('fin_boleto_envios').insert({
          order_id: orderId, installment_id: installmentId, meio,
          observacao: (b.observacao as string) || null, arquivo_url: url,
          vencimento: parcela.due_date, enviado_por: esc.userId, enviado_por_nome: esc.displayName,
          enviado_em: agora,
        })

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

        await crm.from('fin_conferencias').upsert({
          receipt_id: receiptId, order_id: orderId, installment_id: rec.installment_id,
          status, motivo: motivo || null,
          conferido_por: esc.userId, conferido_por_nome: esc.displayName,
          conferido_em: new Date().toISOString(), updated_at: new Date().toISOString(),
        })

        await auditar({ order_id: orderId, installment_id: rec.installment_id, receipt_id: receiptId,
          acao: status === 'APROVADO' ? 'comprovante_aprovado' : 'comprovante_rejeitado',
          antes: antes ?? { status: 'AGUARDANDO' }, depois: { status }, motivo: motivo || null, ...ator })

        await notificar({
          destinatarios: await idsDoVendedor(pedido.vendedor), tipo: `comprovante_${status.toLowerCase()}`,
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
      case 'editar_pagamento': {
        const receiptId = String(b.receipt_id || '')
        if (!receiptId) return res.status(400).json({ error: 'receipt_id_obrigatorio' })

        const rs = await lerControle<ReceiptCompleto>('receipts', COLS_RECEIPT, `&id=eq.${encodeURIComponent(receiptId)}`)
        const rec = rs[0]
        if (!rec || rec.order_id !== orderId) return res.status(400).json({ error: 'recebimento_nao_e_do_pedido' })

        const { data: cf } = await crm.from('fin_conferencias').select('status, motivo').eq('receipt_id', receiptId).maybeSingle()
        const confAtual = (cf?.status as 'AGUARDANDO' | 'APROVADO' | 'REJEITADO') ?? 'AGUARDANDO'
        const perm = podeAlterarRecebimento(esc.role, confAtual)
        if (!perm.ok) return res.status(403).json({ error: 'precisa_gestor', detail: perm.motivo })

        // Só mexe no que veio; o resto fica como está.
        const patch: Record<string, unknown> = {}
        if (b.valor !== undefined) {
          const v = Number(b.valor)
          if (!(v > 0)) return res.status(400).json({ error: 'valor_invalido', detail: 'Informe um valor maior que zero.' })
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

        const resp = await ctrl(`receipts?id=eq.${encodeURIComponent(receiptId)}`, {
          method: 'PATCH', body: JSON.stringify(patch),
        })
        if (!resp.ok) return res.status(502).json({ error: 'controle_recusou', detail: await resp.text() })

        // Mudou dinheiro/data/forma? A aprovação anterior não vale mais para o
        // novo valor — volta pra fila de conferência em vez de seguir "aprovado".
        const mexeuNoDinheiro = patch.amount !== undefined || patch.paid_at !== undefined || patch.payment_method !== undefined
        const reabriu = mexeuNoDinheiro && confAtual === 'APROVADO'
        if (reabriu) {
          await crm.from('fin_conferencias').upsert({
            receipt_id: receiptId, order_id: orderId, installment_id: rec.installment_id,
            status: 'AGUARDANDO', motivo: null, conferido_por: null, conferido_por_nome: null,
            conferido_em: null, updated_at: new Date().toISOString(),
          })
        }

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

        const { data: cf } = await crm.from('fin_conferencias').select('status').eq('receipt_id', receiptId).maybeSingle()
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

        await crm.from('fin_conferencias').delete().eq('receipt_id', receiptId)

        // Gestores E o vendedor do pedido: quem lançou tem que saber que sumiu.
        const avisar = [...new Set([...(await idsDosGestores()), ...(await idsDoVendedor(pedido.vendedor))])]
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
        await crm.from('fin_regularizacoes').upsert({
          order_id: orderId, status, motivo,
          valor_referencia: Number(pedido.valor_total) || null,
          proposto_por: esc.userId, proposto_por_nome: esc.displayName, proposto_em: agora,
          decidido_por: gestor ? esc.userId : null,
          decidido_por_nome: gestor ? esc.displayName : null,
          decidido_em: gestor ? agora : null,
          motivo_recusa: null,
          updated_at: agora,
        })

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
        await crm.from('fin_regularizacoes').update({
          status: decisao, decidido_por: esc.userId, decidido_por_nome: esc.displayName,
          decidido_em: agora, motivo_recusa: decisao === 'RECUSADA' ? motivoRecusa : null,
          updated_at: agora,
        }).eq('order_id', orderId)

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
        await crm.from('fin_entregas').upsert({
          order_id: orderId, entregue_em: entregueEm,
          observacao: (b.observacao as string) || null,
          confirmado_por: esc.userId, confirmado_por_nome: esc.displayName,
          updated_at: agora,
        })

        await auditar({ order_id: orderId, acao: 'entrega_confirmada',
          depois: { entregue_em: entregueEm }, ...ator })

        return res.status(200).json({ ok: true, entregue_em: entregueEm })
      }

      default:
        return res.status(400).json({ error: 'acao_desconhecida' })
    }
  } catch (e) {
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
