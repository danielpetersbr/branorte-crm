import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { OrcamentoAISnapshot, PerguntaPendente, PropostaOrcamento } from '@/lib/orcamento-ai/types'

export interface OrcamentoAIMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ApiResponse {
  reply?: string
  proposal?: PropostaOrcamento | null
  questions?: PerguntaPendente[]
  trace_id?: string
  error?: string
}

export function useOrcamentoAI(snapshot: OrcamentoAISnapshot) {
  const [messages, setMessages] = useState<OrcamentoAIMessage[]>([])
  const [proposal, setProposal] = useState<PropostaOrcamento | null>(null)
  const [questions, setQuestions] = useState<PerguntaPendente[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `conversation-${Date.now()}`)

  const send = useCallback(async (message: string, selectedModelId?: string) => {
    const text = message.trim()
    if (!text || loading) return
    setMessages((current) => [...current, { role: 'user', content: text }])
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sessão expirada — faça login novamente.')
      const conversationRequest = [...messages.filter((item) => item.role === 'user').map((item) => item.content), text].join('\n\nCorreção/continuação do vendedor: ')
      const response = await fetch('/api/orcamento-ai', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: conversationRequest, snapshot, conversation_id: conversationId, selected_model_id: selectedModelId }),
      })
      const raw = await response.text()
      let result: ApiResponse
      try { result = JSON.parse(raw) as ApiResponse } catch { throw new Error(`Servidor retornou uma resposta inválida (HTTP ${response.status}).`) }
      if (!response.ok) throw new Error(result.error || `Falha ao montar proposta (HTTP ${response.status}).`)
      const reply = result.reply || 'Proposta preparada para conferência.'
      setMessages((current) => [...current, { role: 'assistant', content: reply }])
      setProposal(result.proposal ?? null)
      setQuestions(result.questions ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao conversar com o orçamentista.')
    } finally {
      setLoading(false)
    }
  }, [conversationId, loading, messages, snapshot])

  const clear = useCallback(() => {
    setMessages([])
    setProposal(null)
    setQuestions([])
    setError(null)
  }, [])

  const recordEvent = useCallback(async (eventType: 'applied' | 'finalized', proposalId: string, quoteId?: number | string | null) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/orcamento-ai', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType, proposal_id: proposalId, orcamento_id: quoteId, conversation_id: conversationId }),
    }).catch(() => undefined)
  }, [conversationId])

  return { messages, proposal, questions, loading, error, send, clear, setProposal, recordEvent }
}
