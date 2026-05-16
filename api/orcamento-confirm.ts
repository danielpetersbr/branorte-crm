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
  const pdfPath = `${folder}/${base}.pdf`

  // 1. Verifica que .docx ao menos existe (PDF e .txt podem falhar — docx e core)
  const { data: files, error: lErr } = await supa.storage
    .from('orcamentos-pendentes')
    .list(folder, { limit: 100, search: base })
  if (lErr) return res.status(500).json({ error: 'list_failed', detail: lErr.message })

  const arquivos = (files || []).filter(f => f.name?.includes(base))
  const temDocx = arquivos.some(f => f.name === `${base}.docx`)
  const temPdf = arquivos.some(f => f.name === `${base}.pdf`)
  if (!temDocx) {
    return res.status(400).json({
      error: 'docx_missing',
      detail: `Arquivo principal ${docxPath} nao encontrado no Storage. Faca upload primeiro.`,
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
  }

  // 3. WhatsApp (opcional)
  if (body.send_whatsapp && body.whatsapp_envio_path && body.vendedor_nome) {
    try {
      const { data: signed, error: sErr } = await supa.storage
        .from('orcamentos-pendentes')
        .createSignedUrl(body.whatsapp_envio_path, 60 * 60 * 24 * 7)
      if (sErr || !signed?.signedUrl) throw new Error(`signed_url: ${sErr?.message || 'sem url'}`)

      const { data: fnData, error: fnErr } = await supa.functions.invoke('orcamento-enviar-meu-zap', {
        body: {
          vendedor_nome: body.vendedor_nome,
          pdf_url: signed.signedUrl,
          filename: body.whatsapp_filename || `${base}.pdf`,
          cliente_nome: body.cliente_nome || '',
          caption: body.whatsapp_caption || `Orcamento ${base}`,
        },
      })
      if (fnErr) throw new Error(fnErr.message)
      if ((fnData as any)?.error) throw new Error((fnData as any).detail || (fnData as any).error)
      result.whatsapp = { ok: true, msg: (fnData as any)?.msg || 'Enviado pro WhatsApp' }
    } catch (e) {
      result.whatsapp = { ok: false, error: (e as Error).message }
    }
  }

  return res.status(200).json(result)
}
