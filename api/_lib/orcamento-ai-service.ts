import { buildProposal } from '../../src/lib/orcamento-ai/proposal-builder.js'
import { matchModel } from '../../src/lib/orcamento-ai/model-matcher.js'
import type { ComposicaoResolvida, IntencaoOrcamento, ModeloCandidato, OrcamentoAISnapshot, PerguntaPendente, PropostaOrcamento } from '../../src/lib/orcamento-ai/types.js'
import type { AuthenticatedSeller, AuthenticationResult } from './orcamento-ai-auth.js'
import type { AuditEvent, AuditEventType } from './orcamento-ai-audit.js'

interface ServiceDeps {
  authenticate(token: string): Promise<AuthenticationResult>
  interpret(message: string): Promise<IntencaoOrcamento>
  findModels(intent: IntencaoOrcamento, seller: AuthenticatedSeller): Promise<ModeloCandidato[]>
  resolveItems?(intent: IntencaoOrcamento, seller: AuthenticatedSeller): Promise<ComposicaoResolvida>
  audit?(event: AuditEvent): Promise<void>
}

interface ServiceBody {
  message?: string
  snapshot?: OrcamentoAISnapshot
  conversation_id?: string
  selected_model_id?: string
  event_type?: Extract<AuditEventType, 'applied' | 'finalized'>
  proposal_id?: string
  orcamento_id?: number | string | null
}

export interface ServiceResponseBody {
  reply?: string
  proposal?: PropostaOrcamento | null
  questions?: PerguntaPendente[]
  trace_id?: string
  error?: string
}

function traceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000'
}

export function createOrcamentoAIService(deps: ServiceDeps) {
  return {
    async execute(input: { token: string; body: ServiceBody }): Promise<{ status: number; body: Required<Pick<ServiceResponseBody, 'questions'>> & ServiceResponseBody }> {
      const trace_id = traceId()
      if (!input.token) return { status: 401, body: { error: 'no_auth', questions: [], trace_id } }
      const auth = await deps.authenticate(input.token)
      if (!auth.ok) return { status: auth.status, body: { error: auth.error, questions: [], trace_id } }
      const conversationId = input.body?.conversation_id || trace_id
      const audit = async (event: Omit<AuditEvent, 'traceId' | 'conversationId' | 'sellerUserId'>) => {
        try { await deps.audit?.({ ...event, traceId: trace_id, conversationId, sellerUserId: auth.seller.userId }) } catch { /* auditoria não derruba uma proposta válida */ }
      }
      if (input.body?.event_type && input.body.proposal_id) {
        await audit({ eventType: input.body.event_type, proposalId: input.body.proposal_id, quoteId: input.body.orcamento_id, result: { status: input.body.event_type } })
        return { status: 200, body: { reply: 'Evento registrado.', questions: [], trace_id } }
      }
      const message = input.body?.message?.trim()
      const snapshot = input.body?.snapshot
      if (!message || !snapshot || message.length > 12000) return { status: 400, body: { error: 'invalid_request', questions: [], trace_id } }

      try {
        await audit({ eventType: 'requested', quoteId: snapshot.orcamentoId, request: { cliente: snapshot.cliente, modelo: snapshot.modelo } })
        const intent = await deps.interpret(message)
        let proposal: PropostaOrcamento
        if (intent.modeloPedido?.linha) {
          const candidates = await deps.findModels(intent, auth.seller)
          const selected = input.body.selected_model_id ? candidates.find((candidate) => String(candidate.id) === input.body.selected_model_id) : undefined
          const match = selected ? { status: 'exato' as const, match: selected, alternatives: [] as [] } : matchModel(intent, candidates)
          if (match.status !== 'exato') {
            const options = match.alternatives.map((model) => ({ id: String(model.id), label: model.basename }))
            const questions: PerguntaPendente[] = [{ code: 'MODEL_CHOICE', question: match.reason, options }]
            await audit({ eventType: 'blocked', quoteId: snapshot.orcamentoId, result: { status: match.status, questions } })
            return { status: 200, body: { reply: match.reason, proposal: null, questions, trace_id } }
          }
          proposal = buildProposal({ snapshot, intent, model: match.match })
        } else {
          const composition = await deps.resolveItems?.(intent, auth.seller)
          if (!composition || composition.perguntas.length) {
            const questions = composition?.perguntas ?? [{ code: 'ITEMS_UNAVAILABLE', question: 'Não consegui consultar os equipamentos agora.' }]
            await audit({ eventType: 'blocked', quoteId: snapshot.orcamentoId, result: { status: 'requer_escolha', questions } })
            return { status: 200, body: { reply: questions.map((item) => item.question).join('\n'), proposal: null, questions, trace_id } }
          }
          proposal = buildProposal({ snapshot, intent, resolvedItems: composition.itens, resolvedMotors: composition.motores })
        }
        await audit({
          eventType: proposal.status === 'bloqueada' ? 'blocked' : 'proposed', quoteId: snapshot.orcamentoId, proposalId: proposal.id,
          proposal: { cliente: proposal.cliente, modelo: proposal.modelo, totais: proposal.totais, status: proposal.status, alertCodes: proposal.alertas.map((item) => item.code) },
        })
        return { status: 200, body: { reply: 'Montei a proposta completa para sua conferência. Nada foi aplicado ainda.', proposal, questions: [], trace_id } }
      } catch {
        await audit({ eventType: 'failed', quoteId: snapshot.orcamentoId, result: { status: 'failed' } })
        return { status: 500, body: { error: 'orcamento_ai_failed', questions: [], trace_id } }
      }
    },
  }
}
