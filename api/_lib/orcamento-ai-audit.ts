import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizeAuditPayload } from '../../src/lib/orcamento-ai/privacy.js'

export type AuditEventType = 'requested' | 'proposed' | 'blocked' | 'applied' | 'finalized' | 'failed'

export interface AuditEvent {
  traceId: string
  conversationId: string
  sellerUserId: string
  quoteId?: number | string | null
  proposalId?: string | null
  eventType: AuditEventType
  request?: Record<string, unknown>
  proposal?: Record<string, unknown>
  result?: Record<string, unknown>
}

export async function writeOrcamentoAIAudit(supabase: SupabaseClient, event: AuditEvent): Promise<void> {
  const quoteId = event.quoteId == null ? null : Number(event.quoteId)
  const { error } = await supabase.from('orcamento_ai_eventos').insert({
    trace_id: event.traceId,
    conversation_id: event.conversationId,
    vendedor_id: event.sellerUserId,
    orcamento_id: Number.isFinite(quoteId) ? quoteId : null,
    proposal_id: event.proposalId ?? null,
    event_type: event.eventType,
    request_summary: event.request ? sanitizeAuditPayload(event.request) : null,
    proposal_summary: event.proposal ? sanitizeAuditPayload(event.proposal) : null,
    result_summary: event.result ? sanitizeAuditPayload(event.result) : null,
  })
  if (error) throw new Error('audit_insert_failed')
}
