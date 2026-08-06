import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ContactFilters } from '@/types'

// Etiquetas PRÓPRIAS do CRM + a contagem por etiqueta que respeita os filtros da tela.
//
// As do WhatsApp continuam vindo da extensão (mv_wa_contato_resumo) e são
// intocáveis daqui. As do CRM vivem em crm_etiquetas/crm_contato_etiquetas e
// NÃO sobem pro WhatsApp do cliente — é organização interna da carteira.

export type OrigemEtiqueta = 'wa' | 'crm'

export interface ChipEtiqueta {
  origem: OrigemEtiqueta
  etiqueta: string
  contatos: number
}

export interface CrmEtiqueta {
  id: string
  nome: string
  cor: string
  ativa: boolean
  criada_por: string | null
  created_at: string
}

// Hex, e não classe Tailwind, porque é assim que as etiquetas do WhatsApp já são
// pintadas (corDaEtiqueta em lib/wa-funil). Mesma paleta → o chip do CRM e o do
// WhatsApp ficam com o mesmo peso visual na tela.
export const CORES_ETIQUETA = [
  { v: 'cinza',    label: 'Cinza',    hex: '#9ca3af' },
  { v: 'azul',     label: 'Azul',     hex: '#3b82f6' },
  { v: 'verde',    label: 'Verde',    hex: '#10b981' },
  { v: 'amarelo',  label: 'Amarelo',  hex: '#eab308' },
  { v: 'laranja',  label: 'Laranja',  hex: '#f97316' },
  { v: 'vermelho', label: 'Vermelho', hex: '#ef4444' },
  { v: 'roxo',     label: 'Roxo',     hex: '#8b5cf6' },
  { v: 'rosa',     label: 'Rosa',     hex: '#ec4899' },
] as const

export function hexDaCor(cor: string): string {
  return CORES_ETIQUETA.find(c => c.v === cor)?.hex ?? '#9ca3af'
}

/** Mesmo tratamento visual do Badge de etiqueta do WhatsApp. */
export function estiloEtiqueta(hex: string) {
  return { backgroundColor: hex + '1f', color: hex, boxShadow: `inset 0 0 0 1px ${hex}55` }
}

/**
 * Contagem por etiqueta com os MESMOS filtros da lista.
 *
 * A RPC antiga (wa_etiquetas_disponiveis) não recebia parâmetro nenhum: filtrar
 * por vendedor mudava a lista e os chips continuavam com o número geral. Aqui os
 * filtros entram na queryKey, então trocar de vendedor refaz a conta.
 *
 * `etiqueta` fica de fora de propósito — é o próprio facet. Se entrasse, escolher
 * um chip apagaria todos os outros e não daria pra trocar sem limpar antes.
 */
export function useContatosEtiquetas(f: ContactFilters) {
  const chave = [f.search, f.estado, f.vendor_id, f.status, f.orcamento_ano, f.orcamento_mes,
                 f.orcamento, f.temperatura, f.com_whatsapp, f.esperando_resposta]
  return useQuery({
    queryKey: ['contatos-etiquetas', ...chave],
    queryFn: async (): Promise<ChipEtiqueta[]> => {
      const { data, error } = await (supabase as any).rpc('contatos_etiquetas_resumo', {
        p_search: f.search || null,
        p_estado: f.estado || null,
        p_vendor_id: f.vendor_id || null,
        p_status: f.status || null,
        p_orcamento_ano: f.orcamento_ano ? Number(f.orcamento_ano) : null,
        p_orcamento_mes: f.orcamento_mes ? Number(f.orcamento_mes) : null,
        p_orcamento: !!f.orcamento,
        p_temperatura: f.temperatura || null,
        p_com_whatsapp: !!f.com_whatsapp,
        p_esperando_resposta: !!f.esperando_resposta,
      })
      if (error) throw error
      return ((data ?? []) as any[]).map(r => ({
        origem: r.origem as OrigemEtiqueta,
        etiqueta: String(r.etiqueta),
        // bigint do Postgres chega como string
        contatos: Number(r.contatos ?? 0),
      }))
    },
    staleTime: 60_000,
  })
}

export function useCrmEtiquetas() {
  return useQuery({
    queryKey: ['crm-etiquetas'],
    queryFn: async (): Promise<CrmEtiqueta[]> => {
      const { data, error } = await (supabase as any)
        .from('crm_etiquetas').select('*').eq('ativa', true).order('nome')
      if (error) throw error
      return (data ?? []) as CrmEtiqueta[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useCriarEtiqueta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nome, cor }: { nome: string; cor: string }) => {
      const { data: u } = await supabase.auth.getUser()
      const { error } = await (supabase as any).from('crm_etiquetas')
        .insert({ nome: nome.trim(), cor, criada_por: u.user?.id })
      if (error) {
        // 23505 = unique_violation do índice que ignora caixa e acento
        if ((error as any).code === '23505') throw new Error('Já existe uma etiqueta com esse nome.')
        throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-etiquetas'] })
      qc.invalidateQueries({ queryKey: ['contatos-etiquetas'] })
    },
  })
}

export function useEditarEtiqueta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; nome?: string; cor?: string; ativa?: boolean }) => {
      const { error } = await (supabase as any).from('crm_etiquetas').update(patch).eq('id', id)
      if (error) {
        if ((error as any).code === '23505') throw new Error('Já existe uma etiqueta com esse nome.')
        throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-etiquetas'] })
      qc.invalidateQueries({ queryKey: ['contatos-etiquetas'] })
      qc.invalidateQueries({ queryKey: ['crm-etiq-contatos'] })
    },
  })
}

/** Etiquetas do CRM dos contatos da página atual, em UMA consulta. */
export function useEtiquetasDeContatos(ids: string[]) {
  const chave = ids.slice().sort().join(',')
  return useQuery({
    queryKey: ['crm-etiq-contatos', chave],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, CrmEtiqueta[]>> => {
      const { data, error } = await (supabase as any)
        .from('crm_contato_etiquetas')
        .select('contact_id, crm_etiquetas(id, nome, cor, ativa, criada_por, created_at)')
        .in('contact_id', ids)
      if (error) throw error
      const m = new Map<string, CrmEtiqueta[]>()
      for (const r of (data ?? []) as any[]) {
        const e = r.crm_etiquetas
        if (!e || !e.ativa) continue
        const arr = m.get(r.contact_id) ?? []
        arr.push(e as CrmEtiqueta)
        m.set(r.contact_id, arr)
      }
      return m
    },
    staleTime: 30_000,
  })
}

export function useAplicarEtiqueta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ contactId, etiquetaId, aplicar }: { contactId: string; etiquetaId: string; aplicar: boolean }) => {
      if (aplicar) {
        const { data: u } = await supabase.auth.getUser()
        const { error } = await (supabase as any).from('crm_contato_etiquetas')
          .insert({ contact_id: contactId, etiqueta_id: etiquetaId, aplicada_por: u.user?.id })
        // 23505 = já estava aplicada; clique repetido não é erro pro usuário
        if (error && (error as any).code !== '23505') throw error
      } else {
        const { error } = await (supabase as any).from('crm_contato_etiquetas')
          .delete().eq('contact_id', contactId).eq('etiqueta_id', etiquetaId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-etiq-contatos'] })
      qc.invalidateQueries({ queryKey: ['contatos-etiquetas'] })
    },
  })
}

/** Quais chips ESTE usuário escondeu. Preferência de tela, por pessoa. */
export function useEtiquetaPrefs() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['crm-etiqueta-prefs'],
    queryFn: async (): Promise<string[]> => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return []
      const { data, error } = await (supabase as any)
        .from('crm_etiqueta_prefs').select('ocultas').eq('user_id', u.user.id).maybeSingle()
      if (error) throw error
      return (data?.ocultas ?? []) as string[]
    },
    staleTime: 10 * 60_000,
  })

  const salvar = useMutation({
    mutationFn: async (ocultas: string[]) => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return
      const { error } = await (supabase as any).from('crm_etiqueta_prefs')
        .upsert({ user_id: u.user.id, ocultas, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-etiqueta-prefs'] }),
  })

  return { ocultas: q.data ?? [], carregando: q.isLoading, salvar: salvar.mutateAsync }
}
