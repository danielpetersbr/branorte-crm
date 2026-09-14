import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleTransactionalOrcamentoAI } from './_lib/orcamento-ai-http.js'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  return handleTransactionalOrcamentoAI(req, res)
}
