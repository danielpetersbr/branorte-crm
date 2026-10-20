import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'
import type { ConversaoClientDetail, ConversaoMetrics } from '@/lib/conversao-comercial'

export type FiltroConversao = { from: string; to: string; windowDays: 30 | 60 | 90 }
export type VendaSemVinculo = {
  id: string; orderNumber: string | null; date: string; clientName: string | null
  phone: string | null; sellerKeys: string[]; reason: string
}
export type ClienteSemClassificacao = { id: string; name: string | null; phone: string | null }
export type DadosConversaoComercial = {
  version: 1
  generatedAt: string
  cutoffAt: string
  cohort: { from: string; to: string; windowDays: number }
  scope: { canManage: boolean; sellers: Array<{ key: string; name: string }> }
  summary: ConversaoMetrics
  sellers: Array<ConversaoMetrics & { key: string; name: string }>
  clients: ConversaoClientDetail[]
  quality: {
    status: 'partial' | 'verified'; captureSince: string | null; unlinkedSales: number
    missingIdentity: number; gaps: string[]
  }
  unlinkedSales: VendaSemVinculo[]
  unclassifiedClients: ClienteSemClassificacao[]
  allClients: Array<ClienteSemClassificacao & { classification: string }>
}
export type AjusteConversao =
  | { action: 'link_sale'; saleId: string; clientId: string; reason: string; sameDayConfirmed?: boolean }
  | { action: 'classify_client'; clientId: string; classification: 'commercial' | 'internal'; reason: string }

function respostaValida(value: unknown): value is DadosConversaoComercial {
  if (!value || typeof value !== 'object') return false
  const d = value as DadosConversaoComercial
  const metrics = (m: ConversaoMetrics) => m && ['attended', 'mature', 'pending', 'buyers', 'linkedOrders', 'recurrent', 'unclassified'].every(k => Number.isFinite(m[k as keyof ConversaoMetrics]))
    && [m.ratePct, m.clientsPerBuyer].every(v => v === null || Number.isFinite(v))
  return d.version === 1 && typeof d.generatedAt === 'string' && typeof d.cutoffAt === 'string'
    && typeof d.scope?.canManage === 'boolean' && Array.isArray(d.scope.sellers)
    && Array.isArray(d.sellers) && d.sellers.every(metrics) && metrics(d.summary)
    && Array.isArray(d.clients) && Array.isArray(d.unlinkedSales) && Array.isArray(d.unclassifiedClients) && Array.isArray(d.allClients)
    && ['partial', 'verified'].includes(d.quality?.status) && Array.isArray(d.quality.gaps)
    && typeof d.cohort?.from === 'string' && typeof d.cohort.to === 'string' && Number.isFinite(d.cohort.windowDays)
}

export function useConversaoComercial(filtro: FiltroConversao) {
  const auth = useAuth(), p = auth.profile, qc = useQueryClient()
  const userId = auth.session?.user.id
  const autorizado = !!userId && userId === p?.id && !auth.loading && !auth.profileError
    && !!p?.approved_at && ['admin', 'vendor'].includes(p.role)
  const identityKey = JSON.stringify([userId, p?.role, p?.vendor_id, p?.approved_at])
  const queryKey = ['conversao-comercial', identityKey, filtro.from, filtro.to, filtro.windowDays]

  const request = async (signal?: AbortSignal, ajuste?: AjusteConversao) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!autorizado || !session || session.user.id !== userId) throw new Error('Sessão indisponível. Entre novamente.')
    const params = new URLSearchParams({ from: filtro.from, to: filtro.to, window: String(filtro.windowDays) })
    const response = await fetch(`/api/conversao-comercial${ajuste ? '' : `?${params}`}`, {
      method: ajuste ? 'POST' : 'GET', cache: 'no-store', signal,
      headers: { Authorization: `Bearer ${session.access_token}`, ...(ajuste ? { 'Content-Type': 'application/json' } : {}) },
      ...(ajuste ? { body: JSON.stringify(ajuste) } : {}),
    })
    if (!response.ok) {
      if (response.status === 403) throw new Error('Seu acesso ou vínculo de vendedor não permite esta consulta.')
      if (response.status === 409) throw new Error('O cadastro mudou. Atualize os dados e confira o vínculo antes de tentar novamente.')
      throw new Error(ajuste ? 'Não foi possível salvar a conferência. Tente novamente.' : 'Não foi possível consultar a conversão comercial.')
    }
    return response.json()
  }

  const query = useQuery<DadosConversaoComercial>({
    queryKey, enabled: autorizado, staleTime: 30_000, refetchInterval: 60_000, retry: 1,
    queryFn: async ({ signal }) => {
      const data: unknown = await request(signal)
      if (!respostaValida(data) || data.cohort.from !== filtro.from || data.cohort.to !== filtro.to || data.cohort.windowDays !== filtro.windowDays) {
        throw new Error('A resposta da conversão está incompleta. Atualize para tentar novamente.')
      }
      return data
    },
  })
  const ajuste = useMutation({
    mutationKey: ['conversao-comercial-ajuste', identityKey],
    mutationFn: async (valor: AjusteConversao) => {
      if (!autorizado || p?.role !== 'admin' || !query.data?.scope.canManage) throw new Error('Somente a administração pode conferir vínculos.')
      return request(undefined, valor)
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['conversao-comercial', identityKey] }) },
  })
  return {
    ...query, data: autorizado && !query.error ? query.data : undefined,
    autorizado, authLoading: auth.loading, identityKey,
    salvar: ajuste.mutateAsync, salvando: ajuste.isPending,
  }
}
