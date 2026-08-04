import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, FileText, CheckCircle, MessageSquare, Moon, Sun, ChevronsLeft, ChevronsRight, ChevronDown, Shield, LogOut, BarChart2, List, GitBranch, Tag, Activity, Factory, AlertCircle, Package, Zap, BookOpen, Settings, TrendingUp, MessageSquarePlus, FilePlus2, Truck, History, Search, Wallet, MapPin, Star, Target, Boxes, Calculator, ClipboardList, Beef, Wheat, Headphones, BookCheck, Bot, Workflow, CalendarDays, ShoppingBag } from 'lucide-react'
import { useEffect, useState, Suspense } from 'react'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import { useAtendimentoKpis } from '@/hooks/useAtendimentos'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import { useDarkMode } from '@/hooks/useDarkMode'
import { RoadmapFAB } from '@/components/RoadmapFAB'
import { GenerationOverlay } from '@/components/GenerationOverlay'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LembretesNotifier } from '@/components/LembretesNotifier'

/**
 * Papéis de ACESSO RESTRITO: contas externas sem a sidebar do CRM. Não passam
 * por `role_permissions` (o papel nem existe lá, e `useCan()` devolve false pra
 * tudo), então o menu abaixo é a ÚNICA navegação que elas têm.
 *
 * ⚠️ Casar com ROTAS_RESTRITAS no App.tsx: rota liberada lá sem item aqui = tela
 * que existe mas ninguém alcança; item aqui sem rota lá = clique que devolve o
 * sujeito pro começo.
 */
// As duas telas de ração são estudos OPOSTOS e aparecem separadas de propósito:
//   Produção Própria = vale a pena o CLIENTE parar de comprar e produzir
//   Venda de Ração   = a Branorte vendendo: custo, margem, preço, proposta
// (a /viabilidade antiga era iframe e foi absorvida pela Produção Própria)
const MENUS_RESTRITOS: Record<string, Array<{ to: string; label: string; icon: typeof MapPin }>> = {
  // Patrick e afins: consulta os mapas + os dois estudos.
  mapa: [
    { to: '/mapa-visitas', label: 'Mapa de Visitas', icon: MapPin },
    { to: '/mapa-representantes', label: 'Representantes', icon: Users },
    { to: '/producao-propria', label: 'Produção Própria', icon: Calculator },
    { to: '/venda-racao', label: 'Venda de Ração', icon: ShoppingBag },
  ],
  // Consultor externo: SÓ os dois estudos. Sem mapa, sem contato, sem orçamento.
  consultor: [
    { to: '/producao-propria', label: 'Produção Própria', icon: Calculator },
    { to: '/venda-racao', label: 'Venda de Ração', icon: ShoppingBag },
  ],
}

// Abrevia numero pra caber no badge: 1234 -> 1.2k
function fmtCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return (k >= 10 ? Math.round(k) : k.toFixed(1).replace('.0', '')) + 'k'
}

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  countKey?: 'atendimentos'
  end?: boolean      // ativa SO na rota exata (pra paths que sao prefixo de irmaos)
  permKey?: string   // so mostra quando can(permKey) === true
  adminOnly?: boolean // so mostra pro role 'admin' (o guard de rota em App.tsx trava o resto)
}
interface NavGroup {
  id: string
  label: string
  icon: typeof LayoutDashboard
  items: NavItem[]
}

// ============================================================================
// Navegacao agrupada por CATEGORIAS colapsaveis (accordion). Clica no cabecalho
// do grupo -> abre/fecha as opcoes. Permissoes preservadas item a item (permKey);
// um grupo so aparece se tiver >= 1 item visivel pro usuario.
// ============================================================================
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacao', label: 'Operação', icon: LayoutDashboard,
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, permKey: 'menu.dashboard' },
      { to: '/atendimentos', label: 'Atendimentos', icon: MessageSquare, countKey: 'atendimentos', permKey: 'menu.atendimentos' },
      { to: '/agenda', label: 'Agenda', icon: CalendarDays },
      { to: '/contatos', label: 'Contatos', icon: Users, permKey: 'menu.contatos' },
      { to: '/consulta', label: 'Consulta', icon: Search, permKey: 'due_diligence.consultar' },
      { to: '/atribuir', label: 'Atribuir', icon: UserPlus, permKey: 'menu.atribuir' },
      { to: '/prospeccao', label: 'Prospecção', icon: Target, permKey: 'menu.prospeccao' },
      { to: '/funil', label: 'Funil', icon: GitBranch, permKey: 'menu.funil' },
      { to: '/atividade-diaria', label: 'Atividade Diária', icon: Activity, permKey: 'menu.atividade_diaria' },
      { to: '/avaliacoes', label: 'Avaliações', icon: Star, permKey: 'menu.avaliacoes' },
      { to: '/reunioes', label: 'Adm de Reunião', icon: ClipboardList, permKey: 'menu.reunioes' },
    ],
  },
  {
    id: 'etiquetas', label: 'Etiquetas Zap', icon: Tag,
    items: [
      { to: '/etiquetas-zap', label: 'Cards', icon: List, end: true, permKey: 'menu.etiquetas_zap' },
      { to: '/etiquetas-zap/graficos', label: 'Gráficos', icon: BarChart2, permKey: 'menu.etiquetas_zap' },
      { to: '/etiquetas-zap/painel', label: 'Painel Status', icon: AlertCircle, permKey: 'menu.etiquetas_zap' },
    ],
  },
  {
    id: 'orcamentos', label: 'Orçamentos', icon: FileText,
    items: [
      { to: '/orcamentos/montar', label: 'Montar Orçamento', icon: Package, permKey: 'menu.orcamentos' },
      { to: '/orcamentos/salvos', label: 'Salvos (Editar)', icon: List, permKey: 'menu.orcamentos' },
      { to: '/orcamentos/catalogo-admin', label: 'Catálogo (Admin)', icon: Shield, permKey: 'menu.orcamentos_avancado' },
      { to: '/orcamentos/motores', label: 'Motores (Preços)', icon: Zap, permKey: 'menu.orcamentos_avancado' },
      { to: '/orcamentos/precos', label: 'Tabela de Preços', icon: BookOpen, permKey: 'menu.orcamentos_avancado' },
      { to: '/orcamentos/conversao', label: 'Conversão (KPIs)', icon: TrendingUp, permKey: 'menu.orcamentos_avancado' },
      { to: '/admin/transportador-funcoes', label: 'Funções Chupim', icon: GitBranch, permKey: 'menu.orcamentos_avancado' },
      { to: '/orcamentos', label: 'Painel', icon: BarChart2, end: true, permKey: 'menu.orcamentos_avancado' },
      { to: '/orcamentos/lista', label: 'Lista', icon: List, permKey: 'menu.orcamentos_avancado' },
    ],
  },
  {
    id: 'frete', label: 'Frete', icon: Truck,
    items: [
      { to: '/frete/solicitar', label: 'Pedir Frete', icon: Truck, permKey: 'frete.solicitar' },
      { to: '/frete/cotacoes', label: 'Cotações', icon: CheckCircle, permKey: 'frete.solicitar' },
      { to: '/frete/itens', label: 'Itens de frete', icon: Package, permKey: 'frete.solicitar' },
      { to: '/frete/mapa', label: 'Mapa de Fretes', icon: MapPin },
      { to: '/frete', label: 'Calculadora', icon: Truck, end: true },
      { to: '/frete/transportadoras', label: 'Transportadoras', icon: Package },
      { to: '/frete/historico', label: 'Histórico', icon: History },
    ],
  },
  {
    id: 'vendas', label: 'Vendas', icon: BarChart2,
    items: [
      { to: '/controle', label: 'Painel de Vendas', icon: LayoutDashboard, end: true, permKey: 'menu.controle' },
      { to: '/controle/pedidos', label: 'Pedidos de Venda', icon: FileText, permKey: 'menu.controle' },
      { to: '/controle/financeiro', label: 'Financeiro', icon: Wallet, permKey: 'menu.controle' },
      { to: '/controle/novo-pedido', label: 'Novo Pedido', icon: FilePlus2, permKey: 'menu.controle' },
      { to: '/vendidos', label: 'Vendidos', icon: CheckCircle, permKey: 'menu.vendidos' },
      { to: '/mapa-visitas', label: 'Mapa de Visitas', icon: MapPin },
      // Visão de gestão: mostra a carteira de TODOS os reps e o quanto cada um está
      // acima/abaixo da média. Só admin — o guard em App.tsx trava a URL direta.
      { to: '/mapa-representantes', label: 'Mapa de Representantes', icon: MapPin, adminOnly: true },
    ],
  },
  {
    id: 'producao', label: 'Produção', icon: Factory,
    items: [
      { to: '/projeto-3d', label: 'Projeto 3D', icon: Boxes, permKey: 'menu.projeto_3d' },
    ],
  },
  {
    id: 'estudo', label: 'Estudo', icon: Calculator,
    items: [
      { to: '/producao-propria', label: 'Produção Própria', icon: Calculator, permKey: 'menu.venda_racao' },
      { to: '/venda-racao', label: 'Venda de Ração', icon: ShoppingBag, permKey: 'menu.venda_racao' },
      { to: '/guia?modo=atendimento', label: 'Atendimento rápido', icon: Headphones, permKey: 'menu.viabilidade' },
      { to: '/guia?modo=animais', label: 'Guia de Animais', icon: Beef, permKey: 'menu.viabilidade' },
      { to: '/guia?modo=materias', label: 'Matérias-primas', icon: Wheat, permKey: 'menu.viabilidade' },
      { to: '/guia/admin', label: 'Revisão do Guia', icon: BookCheck, permKey: 'guia.editar' },
    ],
  },
  {
    id: 'sistema', label: 'Sistema', icon: Settings,
    items: [
      { to: '/disparos', label: 'Roteamento', icon: GitBranch, permKey: 'menu.disparos' },
      { to: '/ia-atendente', label: 'IA Atendente', icon: Bot, permKey: 'menu.ia_atendente' },
      { to: '/fluxos', label: 'Fluxos do Funil', icon: Workflow, permKey: 'menu.fluxos_funil' },
      { to: '/admin/usuarios', label: 'Usuários', icon: Shield, permKey: 'menu.admin_usuarios' },
      { to: '/admin/permissoes', label: 'Permissões', icon: Settings, permKey: 'menu.admin_permissoes' },
      { to: '/admin/transportador-funcoes', label: 'Funções Chupim', icon: Settings, permKey: 'menu.admin_transportador_funcoes' },
      { to: '/roadmap', label: 'Roadmap & Feedback', icon: MessageSquarePlus, permKey: 'menu.roadmap' },
    ],
  },
]

// Bottom nav mobile — destinos mais usados no dia-a-dia. Itens com permKey só
// aparecem pra quem tem a permissão (ver filtro `mobileNav`).
const MOBILE_NAV: NavItem[] = [
  { to: '/', label: 'Início', icon: LayoutDashboard },
  { to: '/atendimentos', label: 'Atender', icon: MessageSquare, countKey: 'atendimentos' },
  { to: '/prospeccao', label: 'Prospectar', icon: Target },
  { to: '/orcamentos/montar', label: 'Orçar', icon: FilePlus2 },
  { to: '/vendidos', label: 'Vendidos', icon: CheckCircle },
  { to: '/projeto-3d', label: 'Projeto 3D', icon: Boxes, permKey: 'menu.projeto_3d' },
]

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('sidebar-collapsed') === '1'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0')
  }, [collapsed])
  return [collapsed, () => setCollapsed(c => !c)]
}

// Estado dos grupos abertos (accordion). Persiste no localStorage.
function useOpenGroups(): [Record<string, boolean>, (id: string) => void, (id: string) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('sidebar-open-groups') || '{}') } catch { return {} }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem('sidebar-open-groups', JSON.stringify(open)) } catch {}
  }, [open])
  const toggle = (id: string) => setOpen(s => ({ ...s, [id]: !(s[id] ?? false) }))
  const ensureOpen = (id: string) => setOpen(s => (s[id] ? s : { ...s, [id]: true }))
  return [open, toggle, ensureOpen]
}

// Observa o data-ai-drawer-open no <body> pra esconder a bottom nav mobile.
function useAiDrawerOpen(): boolean {
  const [open, setOpen] = useState(() =>
    typeof document !== 'undefined' && document.body.dataset.aiDrawerOpen === '1'
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const obs = new MutationObserver(() => {
      setOpen(document.body.dataset.aiDrawerOpen === '1')
    })
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-ai-drawer-open'] })
    return () => obs.disconnect()
  }, [])
  return open
}

export function Layout() {
  const { data: kpis } = useAtendimentoKpis()
  const [dark, toggleDark] = useDarkMode()
  const [collapsed, toggleCollapsed] = useCollapsed()
  const { profile, signOut } = useAuth()
  const can = useCan()
  const loc = useLocation()
  const aiDrawerOpen = useAiDrawerOpen()
  const [openGroups, toggleGroup, ensureGroupOpen] = useOpenGroups()
  const [confirmSair, setConfirmSair] = useState(false)

  // Papel restrito? Então o chrome do CRM não monta — vale o menu próprio.
  const menuRestrito = profile?.role ? MENUS_RESTRITOS[profile.role] : undefined

  // TODO papel restrito (mapa, consultor) roda SEMPRE em tema claro.
  //
  // A trava nasceu pra /viabilidade, que era iframe de um app externo só-claro e
  // saiu na unificação de 08/2026. Ficou de pé por outra razão, que é a que vale
  // agora: são contas de gente de FORA, que não tem o botão de trocar tema no
  // menu. Como o tema é por NAVEGADOR e não por usuário, essas contas herdam o
  // escuro de quem usou a máquina antes e não têm como sair dele.
  //
  // Chegou a ficar só no 'mapa' e o consultor abriu escuro na máquina do Daniel —
  // o mesmo sintoma, pela mesma causa. Por isso vale pro conjunto, não caso a caso.
  //
  // Declarado DEPOIS do useDarkMode de propósito: efeitos rodam na ordem de
  // declaração, então este desfaz o `dark` que aquele acabou de aplicar.
  //
  // NÃO grava em localStorage: o cleanup devolve o tema do dono da máquina ao
  // sair da conta.
  const ehPapelRestrito = !!menuRestrito
  useEffect(() => {
    if (!ehPapelRestrito) return
    const root = document.documentElement
    if (!root.classList.contains('dark')) return
    root.classList.remove('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    const corAntes = meta?.getAttribute('content') ?? null
    meta?.setAttribute('content', '#f5f5f7')
    return () => {
      root.classList.add('dark')
      if (corAntes) meta?.setAttribute('content', corAntes)
    }
  }, [ehPapelRestrito])
  // Tooltip instantâneo do menu colapsado — substitui o title nativo (Chrome mostra
  // o nome do botão anterior por um instante ao passar rápido entre vizinhos).
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null)
  const mostrarTip = (label: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setTip({ label, x: r.right + 8, y: r.top + r.height / 2 })
  }

  const visible = (item: NavItem) =>
    (!item.adminOnly || profile?.role === 'admin') && (!item.permKey || can(item.permKey))
  // Grupos com itens visiveis (descarta grupos vazios pro usuario)
  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(visible) }))
    .filter(g => g.items.length > 0)

  const counts: Partial<Record<NonNullable<NavItem['countKey']>, number>> = {
    atendimentos: kpis?.total,
  }

  const isItemActive = (it: NavItem) =>
    it.end ? loc.pathname === it.to : (loc.pathname === it.to || loc.pathname.startsWith(it.to + '/'))

  // Auto-abre o grupo que contem a rota atual (sem fechar os outros).
  useEffect(() => {
    const active = groups.find(g => g.items.some(isItemActive))
    if (active) ensureGroupOpen(active.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname])

  const mobileBase = profile?.role === 'visualizador'
    ? MOBILE_NAV.filter(l => l.to === '/' || l.to === '/atendimentos')
    : profile?.role === 'vendor'
    ? MOBILE_NAV.filter(l => l.to === '/atendimentos' || l.to === '/orcamentos/montar' || l.to === '/prospeccao')
    : MOBILE_NAV
  // Respeita permKey: item só entra na barra se o usuário tiver a permissão.
  const mobileNav = mobileBase.filter(visible)

  // Item dentro de um grupo aberto (modo expandido)
  const renderItem = (it: NavItem) => (
    <NavLink
      key={it.to}
      to={it.to}
      end={it.end}
      className={({ isActive }) => cn(
        'group relative flex items-center gap-2 rounded-md pl-9 pr-3 py-1.5 text-[12.5px] font-medium transition-all duration-150',
        isActive ? 'text-accent bg-accent-bg' : 'text-ink-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          {isActive && <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-accent" />}
          <it.icon className={cn('h-[14px] w-[14px] shrink-0', isActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
          <span className="flex-1 truncate">{it.label}</span>
          {it.countKey && counts[it.countKey] !== undefined && (
            <span className={cn(
              'text-[10px] tabular-nums px-1.5 py-0.5 rounded-md font-mono shrink-0',
              isActive ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-ink-faint',
            )}>
              {fmtCount(counts[it.countKey] as number)}
            </span>
          )}
        </>
      )}
    </NavLink>
  )

  // Grupo colapsavel (modo expandido)
  const renderGroup = (g: NavGroup) => {
    const groupActive = g.items.some(isItemActive)
    const open = openGroups[g.id] ?? false
    const headerCount = g.items.reduce(
      (acc, it) => acc + (it.countKey && counts[it.countKey] ? (counts[it.countKey] as number) : 0), 0,
    )
    return (
      <div key={g.id} className="mb-0.5">
        <button
          onClick={() => toggleGroup(g.id)}
          className={cn(
            'w-full group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-semibold transition-all duration-150',
            groupActive ? 'text-accent' : 'text-ink hover:bg-surface-2',
          )}
        >
          <g.icon className={cn('h-[15px] w-[15px] shrink-0', groupActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
          <span className="flex-1 text-left truncate">{g.label}</span>
          {!open && headerCount > 0 && (
            <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-md font-mono bg-surface-2 text-ink-faint">
              {fmtCount(headerCount)}
            </span>
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')} />
        </button>
        {open && (
          <div className="mt-0.5 mb-1 flex flex-col gap-0.5">
            {g.items.map(renderItem)}
          </div>
        )}
      </div>
    )
  }

  // Modo colapsado (w-14): icone de cada grupo. Clicar expande a sidebar e abre o grupo.
  const renderGroupCollapsed = (g: NavGroup) => {
    const groupActive = g.items.some(isItemActive)
    return (
      <button
        key={g.id}
        onClick={() => { toggleCollapsed(); ensureGroupOpen(g.id) }}
        onMouseEnter={e => mostrarTip(g.label, e.currentTarget)}
        onMouseLeave={() => setTip(null)}
        className={cn(
          'h-9 w-9 flex items-center justify-center rounded-md transition-colors',
          groupActive ? 'bg-accent-bg text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-2',
        )}
      >
        <g.icon className="h-[16px] w-[16px]" />
      </button>
    )
  }

  // Conta "mapa" (Patrick e afins): acesso restrito, mas com MENU LATERAL próprio —
  // mesma gramática da sidebar do CRM. Rail de ícones no celular, rótulos no md+.
  //
  // Substituiu (03/08/2026) a pill flutuante no canto inferior direito: ela ficava
  // POR CIMA do conteúdo e não tinha pra onde crescer — virou menu.
  // Este menu é a ÚNICA navegação do papel — o que não estiver aqui, ele não
  // alcança. Manter em sincronia com MAPA_PERMITIDAS no App.tsx.
  if (menuRestrito) {
    const MENU_MAPA = menuRestrito
    return (
      <div className="min-h-screen flex bg-bg">
        <aside className="w-14 md:w-56 shrink-0 sticky top-0 h-[100dvh] flex flex-col border-r border-border bg-surface">
          <div className="h-14 shrink-0 flex items-center justify-center md:justify-start md:px-4 border-b border-border select-none">
            <span className="font-extrabold text-[18px] leading-none tracking-[-0.045em] whitespace-nowrap">
              <span className="text-accent">B</span><span className="text-ink hidden md:inline">RANORTE</span>
            </span>
          </div>
          <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 p-2">
            {MENU_MAPA.map(m => (
              <NavLink
                key={m.to}
                to={m.to}
                title={m.label}
                className={({ isActive }) => cn(
                  'h-11 shrink-0 rounded-lg text-[13px] font-semibold flex items-center',
                  'justify-center md:justify-start md:px-3 md:gap-2.5',
                  isActive ? 'bg-accent text-white' : 'text-ink-muted hover:bg-bg hover:text-ink',
                )}
              >
                <m.icon className="h-5 w-5 shrink-0" />
                <span className="hidden md:inline truncate">{m.label}</span>
              </NavLink>
            ))}
          </nav>
          {/* Sair no pé do menu, com confirmação — era flutuante antes */}
          <button
            onClick={() => setConfirmSair(true)}
            title="Sair"
            className="m-2 h-11 shrink-0 rounded-lg text-[13px] font-semibold flex items-center justify-center md:justify-start md:px-3 md:gap-2.5 text-ink-muted hover:bg-bg hover:text-red-600"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="hidden md:inline">Sair</span>
          </button>
        </aside>

        <main className="flex-1 min-w-0">
          <ErrorBoundary resetKey={loc.pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>

        {confirmSair && (
          <div className="fixed inset-0 z-[1200] bg-black/50 flex items-center justify-center p-6" onClick={() => setConfirmSair(false)}>
            <div className="bg-surface rounded-2xl border border-border p-5 w-full max-w-xs text-center shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="h-11 w-11 rounded-full bg-red-500/10 mx-auto flex items-center justify-center mb-3"><LogOut className="h-5 w-5 text-red-600" /></div>
              <h2 className="font-semibold text-ink mb-1">Sair da conta?</h2>
              <p className="text-[13px] text-ink-muted mb-4">Você vai precisar entrar de novo pra ver o mapa.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmSair(false)} className="flex-1 h-11 rounded-lg border border-border text-ink-muted font-medium">Cancelar</button>
                <button onClick={signOut} className="flex-1 h-11 rounded-lg bg-red-600 text-white font-semibold">Sair</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-bg">
      {/* Tooltip do menu colapsado — fixo no viewport (não é cortado pelo overflow do aside) */}
      {collapsed && tip && (
        <div
          className="fixed z-[1200] -translate-y-1/2 pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[12px] font-medium text-ink shadow-lg"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.label}
        </div>
      )}
      <aside className={cn(
        'hidden md:flex flex-col border-r border-border bg-surface transition-all duration-200',
        'sticky top-0 h-screen shrink-0 overflow-hidden',
        collapsed ? 'w-14' : 'w-64',
      )}>
        {/* Brand (wordmark BRANORTE, adaptável ao tema) + avatar + collapse */}
        <div className={cn('flex items-center h-14 border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2 px-4')}>
          {collapsed ? (
            <NavLink to="/" title="Branorte CRM" className="flex items-center justify-center h-8 w-8 select-none">
              <span className="font-extrabold text-[20px] leading-none tracking-[-0.05em] text-accent">B</span>
            </NavLink>
          ) : (
            <>
              <NavLink to="/" title="Branorte CRM" className="flex items-center gap-1.5 min-w-0 flex-1 select-none">
                {/* Logo de verdade, não o nome imitado com duas <span>. São dois
                    arquivos porque a marca tem duas versões oficiais: verde+preto
                    no claro, verde+branco no escuro. Um arquivo só com filtro CSS
                    não serve — filtro não sabe recolorir SÓ o preto e ia comer o
                    verde junto. Troca por `dark:` (Tailwind darkMode: 'class'),
                    sem JS: no instante do toggle já está certo. */}
                <img
                  src="/branorte-logo.png"
                  alt="Branorte"
                  className="h-[17px] w-auto shrink-0 dark:hidden"
                />
                <img
                  src="/branorte-logo-dark.png"
                  alt=""
                  aria-hidden="true"
                  className="h-[17px] w-auto shrink-0 hidden dark:block"
                />
                <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-ink-faint self-end pb-[2px]">CRM</span>
              </NavLink>
              {profile && (
                <NavLink
                  to="/perfil"
                  title={`${profile.display_name ?? '—'} · ${profile.email}`}
                  className={({ isActive }) => cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shrink-0 ring-2 ring-transparent transition-all',
                    isActive ? 'bg-accent-700 ring-accent/40' : 'bg-accent hover:ring-accent/30'
                  )}
                >
                  {(profile.display_name ?? profile.email)[0].toUpperCase()}
                </NavLink>
              )}
              <button
                onClick={toggleCollapsed}
                title="Minimizar menu"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors shrink-0"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Avatar pequeno no modo collapsed (abaixo do brand) */}
        {profile && collapsed && (
          <NavLink
            to="/perfil"
            title={`Perfil (${profile.email})`}
            className={({ isActive }) => cn(
              'border-b border-border p-2 flex items-center justify-center transition-colors',
              isActive ? 'bg-accent-bg' : 'hover:bg-surface-2'
            )}
          >
            <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center text-white text-[11px] font-bold">
              {(profile.display_name ?? profile.email)[0].toUpperCase()}
            </div>
          </NavLink>
        )}

        <nav className={cn('flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5', collapsed ? 'p-2 items-center' : 'p-3')}>
          {collapsed ? groups.map(renderGroupCollapsed) : groups.map(renderGroup)}
        </nav>

        {/* Toolbar inferior — logo após items (sem gap) */}
        <div className={cn('border-t border-border mt-auto shrink-0 bg-surface', collapsed ? 'p-2 flex flex-col items-center gap-1' : 'p-2 flex items-center justify-end gap-1')}>
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              title="Expandir menu"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={toggleDark}
            title={dark ? 'Tema claro' : 'Tema escuro'}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          {profile && (
            <button
              onClick={signOut}
              title={`Sair (${profile.email})`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint hover:text-red-600 hover:bg-surface-2 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* ErrorBoundary impede TELA PRETA: captura crash de render e falha de
            import() de chunk lazy. resetKey troca na rota pra limpar o erro. */}
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* FAB global de feedback */}
      <RoadmapFAB />

      {/* Overlay global de geração de orçamento */}
      <GenerationOverlay />

      {/* Aviso na tela quando um lembrete/compromisso da Agenda vence.
          Isolado em ErrorBoundary: é overlay GLOBAL — se algo nele falhar,
          não pode derrubar o app inteiro. */}
      <ErrorBoundary resetKey="lembretes-notifier">
        <LembretesNotifier />
      </ErrorBoundary>

      <nav className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 bg-bg/95 backdrop-blur border-t border-border flex items-center justify-around px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] z-50',
        aiDrawerOpen && 'hidden',
      )}>
        {mobileNav.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) => cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] font-medium rounded-xl min-w-[58px] transition-all',
              isActive
                ? 'text-accent bg-accent-bg/60'
                : 'text-ink-faint hover:text-ink-muted active:bg-surface-2',
            )}
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                <l.icon className={cn('h-[18px] w-[18px] transition-transform', isActive && 'scale-110')} />
                <span className={cn(isActive && 'font-semibold')}>{l.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
