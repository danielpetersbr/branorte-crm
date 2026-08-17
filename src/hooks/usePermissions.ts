import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// 'mapa' e 'financeiro' entraram em 06/08/2026 junto com o Financeiro por parcelas.
// 'mapa' porque o Patrick tem esse papel e vende (12 pedidos, R$ 5,95 mi) — sem uma
// linha em role_permissions, can() devolve false pra tudo e ele não vê item nenhum.
// 'financeiro' é o perfil que confere comprovante sem ser admin do sistema.
// Os dois ficam em ASSIGNABLE_ROLES de propósito: papel que só existe no banco vira
// fonte de verdade que /admin/permissoes não enxerga, e ninguém descobre por quê.
export type AssignableRole = 'admin' | 'vendor' | 'marketing' | 'visualizador' | 'mapa' | 'financeiro'

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
  { key: 'menu.dashboard', label: 'Dashboard', group: 'Menu' },
  { key: 'menu.atendimentos', label: 'Atendimentos', group: 'Menu' },
  { key: 'menu.contatos', label: 'Contatos', group: 'Menu' },
  { key: 'menu.atribuir', label: 'Atribuir', group: 'Menu' },
  { key: 'menu.funil', label: 'Funil', group: 'Menu' },
  { key: 'menu.atividade_diaria', label: 'Atividade Diária', group: 'Menu' },
  { key: 'menu.orcamentos', label: 'Orçamentos', group: 'Menu' },
  { key: 'menu.orcamentos_avancado', label: 'Orçamentos avançado (Catálogo/Motores/Preços/Conversão/Painel/Lista)', group: 'Menu' },
  { key: 'menu.vendidos', label: 'Vendidos', group: 'Menu' },
  { key: 'menu.frete', label: 'Frete', group: 'Menu' },
  { key: 'menu.controle', label: 'Controle (Vendas)', group: 'Menu' },
  // Chave própria, separada de menu.controle: o Financeiro é a única tela do
  // grupo Controle que o vendedor precisa ver (e só os pedidos dele — o recorte
  // é feito no servidor, em /api/financeiro). Ligar menu.controle pra ele abriria
  // junto Painel de Vendas, Pedidos e Novo Pedido, que não é o caso.
  { key: 'menu.financeiro', label: 'Financeiro (recebíveis — vendedor vê só os pedidos dele)', group: 'Menu' },
  { key: 'menu.projeto', label: 'Projeto', group: 'Menu' },
  { key: 'menu.projeto_3d', label: 'Projeto 3D', group: 'Menu' },
  { key: 'menu.viabilidade', label: 'Guias de apoio (animais e matérias-primas)', group: 'Menu' },
  { key: 'menu.venda_racao', label: 'Produção Própria (estudo de viabilidade)', group: 'Menu' },
  { key: 'menu.disparos', label: 'Roteamento (Disparos)', group: 'Menu' },
  { key: 'menu.ia_atendente', label: 'IA Atendente (admin)', group: 'Menu' },
  { key: 'menu.fluxos_funil', label: 'Fluxos do Funil (admin)', group: 'Menu' },
  { key: 'menu.admin_usuarios', label: 'Admin: Usuários', group: 'Menu' },
  { key: 'menu.admin_permissoes', label: 'Admin: Permissões', group: 'Menu' },
  { key: 'menu.admin_transportador_funcoes', label: 'Admin: Funções Transportador', group: 'Menu' },
  { key: 'menu.roadmap', label: 'Roadmap & Feedback', group: 'Menu' },
  { key: 'menu.ia_teste', label: 'Testar a IA (arena + apontamentos)', group: 'Menu' },
  // Central de Supervisao: a chave TAMBEM precisa estar na linha 'admin' de
  // role_permissions, senao can() volta false ate pro Daniel - o FALLBACK abaixo
  // so vale quando a linha do role NAO existe, e a de admin existe.
  { key: 'menu.supervisao', label: 'Central de Supervisao (achados por vendedor)', group: 'Menu' },
  { key: 'menu.reunioes', label: 'Adm de Reunião', group: 'Menu' },
  { key: 'menu.ligacoes', label: 'Ligações', group: 'Menu' },
  { key: 'menu.agenda', label: 'Agenda (calendário/tarefas)', group: 'Menu' },
  { key: 'menu.due_diligence', label: 'Consulta (Due Diligence)', group: 'Menu' },
  // Editar o Guia = criar/alterar/aprovar conteúdo técnico e imagens. É poder
  // editorial, não de menu: quem tem isso enxerga rascunho e em_revisão (a RLS
  // usa a mesma chave, em public.guia_pode_editar()).
  { key: 'guia.editar', label: 'Editar o Guia do Vendedor (conteúdo técnico e imagens)', group: 'Ações' },
  { key: 'contacts.view_all', label: 'Ver TODOS os contatos (não só do próprio vendedor)', group: 'Ações' },
  { key: 'atendimentos.reatribuir', label: 'Reatribuir atendimento pra outro vendedor', group: 'Ações' },
  { key: 'orcamentos.criar', label: 'Criar/editar orçamento', group: 'Ações' },
  { key: 'disparos.send', label: 'Enviar disparo (roteamento)', group: 'Ações' },
  { key: 'frete.solicitar', label: 'Frete: abrir pedido de frete', group: 'Ações' },
  { key: 'frete.aprovar', label: 'Frete: aprovar e disparar pras transportadoras', group: 'Ações' },
  { key: 'due_diligence.consultar', label: 'Consultar Due Diligence (SPC + Datajud + IA)', group: 'Ações' },
  { key: 'venda_racao.ver_todas', label: 'Produção Própria: ver estudos de todos e editar os padrões', group: 'Ações' },
  { key: 'admin.due_diligence', label: 'Admin: ver consultas de todos vendedores', group: 'Ações' },
]

export const ASSIGNABLE_ROLES: AssignableRole[] = ['admin', 'financeiro', 'vendor', 'marketing', 'visualizador', 'mapa']

export const ROLE_LABELS: Record<AssignableRole, string> = {
  admin: 'Admin',
  financeiro: 'Financeiro',
  vendor: 'Vendedor',
  marketing: 'Marketing',
  visualizador: 'Visualizador',
  mapa: 'Consulta interna (mapa)',
}

// Fallback usado enquanto a query carrega ou se a row não existir.
// Mantém o comportamento legado: admin = tudo, vendor = mínimo, marketing = nada.
const FALLBACK: Record<AssignableRole, Record<string, boolean>> = {
  admin: Object.fromEntries(FEATURE_CATALOG.map(f => [f.key, true])),
  vendor: {
    // Vendedor restrito: só Atendimentos, Consulta, Montar/Editar Orçamento e Mapa
    // de Visitas (este sem permKey, sempre visível). Demais menus ficam ocultos.
    'menu.atendimentos': true,
    'menu.orcamentos': true,
    'menu.projeto_3d': true,
    'menu.viabilidade': true,
    'menu.venda_racao': true,
    'menu.roadmap': true,
    'menu.financeiro': true,
    'menu.ia_teste': true,
    'orcamentos.criar': true,
    'due_diligence.consultar': true,
    'frete.solicitar': true,
  },
  marketing: {},
  // Visualizador: só Dashboard + Atendimentos.
  visualizador: {
    'menu.dashboard': true,
    'menu.atendimentos': true,
  },
  // Financeiro: confere comprovante e confirma pagamento, sem ser admin do sistema.
  // Do lado do servidor ele é gestor (vê todos os vendedores) — ver PAPEIS_GESTORES
  // em api/_lib/financeiro-core.ts.
  financeiro: {
    'menu.financeiro': true,
    'menu.controle': true,
  },
  // Consulta interna: papel externo, negado por padrão na RLS (papel_restrito()).
  // Só o Financeiro, e mesmo assim recortado pelos pedidos do vendedor vinculado.
  mapa: {
    'menu.financeiro': true,
  },
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

    /*
     * Permissao mudada no banco tem que CHEGAR em quem ja esta com o app aberto.
     *
     * Sem isto, a query so roda no mount: o default global do app e
     * `refetchOnWindowFocus: false` (App.tsx) e o Layout nunca desmonta. Quem usa
     * o CRM como app instalado fica com a permissao do dia em que abriu — foi o
     * que aconteceu em 06/08: liberamos `menu.contatos` pros 9 vendedores, o
     * banco devolvia `true` (conferido com JWT de vendedor real via PostgREST) e
     * o menu continuava sem o item na tela deles.
     *
     * 5 min e barato: sao 4 linhas, e so quando a aba esta visivel.
     */
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
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
