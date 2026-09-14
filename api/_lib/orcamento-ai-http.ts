import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authenticateSeller } from './orcamento-ai-auth.js'
import { findModelCandidates, resolveCatalogComposition } from './orcamento-ai-catalog.js'
import { interpretQuoteRequest } from './orcamento-ai-openai.js'
import { createOrcamentoAIService } from './orcamento-ai-service.js'
import { writeOrcamentoAIAudit } from './orcamento-ai-audit.js'

export async function handleTransactionalOrcamentoAI(req: VercelRequest, res: VercelResponse) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const openAIKey = process.env.OPENAI_API_KEY
  if (!url || !serviceKey || !openAIKey) return res.status(500).json({ error: 'env_missing' })
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const service = createOrcamentoAIService({
    authenticate: (value) => authenticateSeller(supabase, value),
    interpret: (message) => interpretQuoteRequest(message, openAIKey),
    findModels: (intent, _seller, selectedModelId) => findModelCandidates(supabase, intent, selectedModelId),
    resolveItems: (intent) => resolveCatalogComposition(supabase, intent),
    audit: (event) => writeOrcamentoAIAudit(supabase, event),
  })
  const result = await service.execute({ token, body: req.body })
  return res.status(result.status).json(result.body)
}
