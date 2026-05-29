import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export type AssignableRole = 'admin' | 'vendor' | 'marketing'

export interface RolePermissionsRow {
  role: AssignableRole
  permissions: Record<string, boolean>
  updated_at: string
  updated_by: string | null
}

// Catálogo único de features. Adicionar aqui = aparece na matriz da página admin
// e fica disponível pra useCan('chave').
export const FEATURE_CATALOG: Array<{
  key: string
  label: string
  group: 'Menu' | 'Ações'
  description?: string
}> = [
  { key: 'menu.atendimentos', label: 'Atendimentos', group: 'Menu' },
  { key: 'menu.contatos', label: 'Contatos', group: 'Menu' },
  { key: 'menu.atribuir', label: 'Atribuir', group: 'Menu' },
  { key: 'menu.funil', label: 'Funil', group: 'Menu' },
  { key: 'menu.etiquetas_zap', label: 'Etiquetas Zap', group: 'Menu' },
  { key: 'menu.atividade_diaria', label: 'Atividade Diária', group: 'Menu' },
  { key: 'menu.orcamentos', label: 'Orçamentos', group: 'Menu' },
  { key: 'menu.vendidos', label: 'Vendidos', group: 'Menu' },
  { key: 'menu.projeto', label: 'Projeto', group: 'Menu' },
  { key: 'menu.disparos', label: 'Roteamento (Disparos)', group: 'Menu' },
  { key: 'menu.admin_usuarios', label: 'Admin: Usuários', group: 'Menu' },
  { key: 'menu.admin_permissoes', label: 'Admin: Permissões', group: 'Menu' },
  { key: 'menu.admin_transportador_funcoes', label: 'Admin: Funções Transportador', group: 'Menu' },
  { key: 'menu.roadmap', label: 'Roadmap & Feedback', group: 'Menu' },
  { key: 'contacts.view_all', label: 'Ver TODOS os contatos (não só do próprio vendedor)', group: 'Ações' },
  { key: 'atendimentos.reatribuir', label: 'Reatribuir atendimento pra outro vendedor', group: 'Ações' },
  { key: 'orcamentos.criar', label: 'Criar/editar orçamento', group: 'Ações' },
  { key: 'disparos.send', label: 'Enviar disparo (roteamento)', group: 'Ações' },
]

export const ASSIGNABLE_ROLES: AssignableRole[] = ['admin', 'vendor', 'marketing']

export const ROLE_LABELS: Record<AssignableRole, string> = {
  admin: 'Admin',
  vendor: 'Vendedor',
  marketing: 'Marketing',
}

// Fallback usado enquanto a query carrega ou se a row não existir.
// Mantém o comportamento legado: admin = tudo, vendor = mínimo, marketing = nada.
const FALLBACK: Record<AssignableRole, Record<string, boolean>> = {
  admin: Object.fromEntries(FEATURE_CATALOG.map(f => [f.key, true])),
  vendor: {
    'menu.atendimentos': true,
    'menu.contatos': true,
    'menu.atribuir': true,
    'menu.funil': true,
    'menu.etiquetas_zap': true,
    'menu.atividade_diaria': true,
    'menu.orcamentos': true,
    'menu.vendidos': true,
    'menu.projeto': true,
    'orcamentos.criar': true,
  },
  marketing: {},
}

export function useRolePermissions() {
  return useQuery({
    queryKey: ['role_permissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('role, permissions, updated_at, updated_by')
        .order('role')
      if (error) throw error
      return (data ?? []) as RolePermissionsRow[]
    },
    staleTime: 60_000,
  })
}

// API principal: `can('menu.disparos')` retorna boolean pro user logado.
export function useCan(): (featureKey: string) => boolean {
  const { profile } = useAuth()
  const { data } = useRolePermissions()

  return (featureKey: string) => {
    if (!profile) return false
    const role = profile.role
    if (role === 'pending' || role === 'rejected') return false
    const row = data?.find(r => r.role === role)
    const perms = row?.permissions ?? FALLBACK[role as AssignableRole] ?? {}
    return perms[featureKey] === true
  }
}
