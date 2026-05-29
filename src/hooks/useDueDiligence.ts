// Hook React Query pra Due Diligence — chama /api/dd-consultar
// e expõe estado loading/erro/sucesso pro componente.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Pacote = 'economico' | 'completo' | 'paranoico' | 'custom'

export interface DDConsultaInput {
  contact_id?: string | null
  /** 'pj' = só empresa; 'pf' = só pessoa; 'ambos' = empresa + sócio */
  tipo_consulta?: 'pj' | 'pf' | 'ambos'
  /** CNPJ obrigatório se tipo_consulta = pj | ambos */
  cnpj?: string | null
  /** CPF obrigatório se tipo_consulta = pf | ambos */
  cpf_socio?: string | null
  pacote: Pacote
  force_refresh?: boolean
}

export interface DDConsulta {
  id: string
  contact_id: string | null
  cnpj: string | null
  cpf_socio: string | null
  nome_empresa: string | null
  nome_socio: string | null
  pacote: Pacote
  produtos_spc: string[]
  resultado_spc: Record<string, unknown> | null
  resultado_datajud: Record<string, unknown> | null
  resultado_google: Record<string, unknown> | null
  resultado_instagram: Record<string, unknown> | null
  parecer_ia: string | null
  custo_brl: number
  status: 'pending' | 'success' | 'partial' | 'failed'
  erro: string | null
  created_at: string
  created_by: string | null
  cnpj_normalizado: string
}

export interface DDConsultaResponse {
  ok: boolean
  _cache_hit: boolean
  consulta: DDConsulta
}

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Usuario nao autenticado')
  return `Bearer ${token}`
}

export function useConsultarDueDiligence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: DDConsultaInput): Promise<DDConsultaResponse> => {
      const authorization = await getAuthHeader()
      const resp = await fetch('/api/dd-consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization },
        body: JSON.stringify(input),
      })
      const text = await resp.text()
      let body: unknown = null
      try { body = text ? JSON.parse(text) : null } catch { /* ignore */ }
      if (!resp.ok) {
        const detail = (body as { error?: string; detail?: string } | null)
        throw new Error(`${detail?.error ?? resp.status}: ${detail?.detail ?? resp.statusText}`)
      }
      return body as DDConsultaResponse
    },
    onSuccess: (_, vars) => {
      // Invalida historico do contato pra refletir nova consulta
      qc.invalidateQueries({ queryKey: ['dd', 'historico', vars.contact_id] })
    },
  })
}

/** Lista de consultas anteriores pra um contato (ordem: mais recente primeiro). */
export function useDDHistorico(contactId: string | null | undefined) {
  return useQuery({
    queryKey: ['dd', 'historico', contactId],
    queryFn: async (): Promise<DDConsulta[]> => {
      if (!contactId) return []
      const { data, error } = await supabase
        .from('due_diligence_consultas')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as DDConsulta[]
    },
    enabled: !!contactId,
    staleTime: 30_000,
  })
}
