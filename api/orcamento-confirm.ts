// Vercel serverless function — apos cliente subir os arquivos via signed URL,
// chama esse endpoint pra:
//   1. Confirmar que arquivos existem no Storage (defensive check)
//   2. Atualizar orcamento_gerados.status = 'enviado' (era 'rascunho' ate aqui)
//   3. Se whatsapp marcado: gerar signed READ URL do PDF e disparar
//      edge function orcamento-enviar-meu-zap
//
// Por que separar de presign:
//   - Status so vira 'enviado' SE upload realmente aconteceu (zero falso positivo)
//   - WhatsApp e idempotente (pode re-enviar sem subir de novo)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { settleWithin } from './_lib/orcamento-confirm-timeout.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface ConfirmBody {
  orcamento_id: number
  ano: string
  mes: string
  base: string
  // WhatsApp
  send_whatsapp?: boolean
  whatsapp_envio_path?: string  // path do PDF em _envios/
  whatsapp_caption?: string
  whatsapp_filename?: string
  vendedor_nome?: string        // primeiro nome em UPPERCASE
  cliente_nome?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing' })

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const body = req.body as ConfirmBody
  const id = Number(body?.orcamento_id)
  const ano = String(body?.ano || '').trim()
  const mes = String(body?.mes || '').trim()
  const base = String(body?.base || '').trim()
  if (!id || !ano || !mes || !base) return res.status(400).json({ error: 'missing_fields' })

  const folder = `${ano}/${mes}`
  const docxPath = `${folder}/${base}.docx`

  // 1. Verifica que .docx ao menos existe (PDF e .txt podem falhar — docx e core)
  //
  // ⚠️ CORRIDA COM O DAEMON (09/09/2026): o `scripts/sync-orcamentos.mjs` varre ESTE
  // bucket a cada 30s, leva os arquivos pro Z: e MOVE cada um pra `_processados/<path>`.
  // O cliente sobe docx/txt/pdf/envio em paralelo e só então chama este confirm — se o
  // daemon pegar o .docx nessa janela (PDF grande = janela maior; o 2026-2515 tinha
  // 11,4 MB e o docx foi movido 3s ANTES do confirm), a listagem de `AAAA/MM` volta
  // vazia e o endpoint respondia 400 docx_missing. O front lia isso como upload falho:
  // pintava "FALHA AO SALVAR", baixava 18 MB no Downloads, convidava a regerar
  // (duplicata) e — o pior — o bloco 3 nunca rodava, então o PDF NÃO ia pro WhatsApp
  // do vendedor. Estar em `_processados/` é prova MAIOR de entrega (o arquivo já chegou
  // no Z:), não motivo de erro. Por isso procuramos nos dois lugares.
  async function listar(prefix: string) {
    const { data, error } = await supa.storage
      .from('orcamentos-pendentes')
      .list(prefix, { limit: 100, search: base })
    if (error) throw new Error(error.message)
    return (data || []).filter(f => f.name?.includes(base))
  }

  let arquivos: { name: string }[] = []
  let achadoEm = folder
  try {
    arquivos = await listar(folder)
    if (!arquivos.some(f => f.name === `${base}.docx`)) {
      const processados = await listar(`_processados/${folder}`)
      if (processados.some(f => f.name === `${base}.docx`)) {
        arquivos = processados
        achadoEm = `_processados/${folder}`
      }
    }
  } catch (e) {
    return res.status(500).json({ error: 'list_failed', detail: (e as Error).message })
  }

  const temDocx = arquivos.some(f => f.name === `${base}.docx`)
  const temPdf = arquivos.some(f => f.name === `${base}.pdf`)
  if (!temDocx) {
    return res.status(400).json({
      error: 'docx_missing',
      detail: `Arquivo principal ${docxPath} nao encontrado no Storage (nem em _processados/). Faca upload primeiro.`,
      encontrados: arquivos.map(f => f.name),
    })
  }

  // 2. Atualiza status do orcamento (RLS bypass via service role)
  const { error: updErr } = await supa
    .from('orcamentos_gerados')
    .update({ status: 'enviado', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (updErr) {
    return res.status(500).json({ error: 'status_update_failed', detail: updErr.message })
  }

  const result: any = {
    ok: true,
    arquivos: arquivos.map(f => f.name),
    tem_pdf: temPdf,
    achado_em: achadoEm,
  }

  // 3. WhatsApp (opcional)
  if (body.send_whatsapp && body.whatsapp_envio_path && body.vendedor_nome) {
    try {
      const { data: signed, error: sErr } = await supa.storage
        .from('orcamentos-pendentes')
        .createSignedUrl(body.whatsapp_envio_path, 60 * 60 * 24 * 7)
      if (sErr || !signed?.signedUrl) throw new Error(`signed_url: ${sErr?.message || 'sem url'}`)

      const invocation = await settleWithin(supa.functions.invoke('orcamento-enviar-meu-zap', {
        body: {
          vendedor_nome: body.vendedor_nome,
          pdf_url: signed.signedUrl,
          filename: body.whatsapp_filename || `${base}.pdf`,
          cliente_nome: body.cliente_nome || '',
          caption: body.whatsapp_caption || `Orcamento ${base}`,
        },
      }), 10_000)
      if (invocation.status === 'timeout') {
        throw new Error('O WhatsApp demorou para responder. O orçamento foi salvo; use Reenviar ao WhatsApp em Orçamentos Salvos.')
      }
      const { data: fnData, error: fnErr } = invocation.value
      if (fnErr) throw new Error(fnErr.message)
      if ((fnData as any)?.error) throw new Error((fnData as any).detail || (fnData as any).error)
      result.whatsapp = { ok: true, msg: (fnData as any)?.msg || 'Enviado pro WhatsApp' }
    } catch (e) {
      result.whatsapp = { ok: false, error: (e as Error).message }
    }
  }

  return res.status(200).json(result)
}
