// Coleta erros de upload de orcamento do client. Sem isso, o erro do PUT signed URL
// fica preso no browser console e a gente nao consegue debugar.
//
// Endpoint chamado pelo orcamento-upload.ts quando todas as 4 retries falham.
// So loga no console do Vercel — fica visivel via `vercel logs`.
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = req.body || {}
  const log = {
    ts: new Date().toISOString(),
    orcamentoId: body.orcamentoId,
    numero: body.numero,
    vendedor: body.vendedor,
    cliente: body.cliente,
    label: body.label,
    blobSize: body.blobSize,
    contentType: body.contentType,
    errorMessage: body.errorMessage,
    errorName: body.errorName,
    attempts: body.attempts,
    userAgent: req.headers['user-agent']?.slice(0, 200),
  }
  console.error('[upload-error]', JSON.stringify(log))
  return res.status(200).json({ ok: true })
}
