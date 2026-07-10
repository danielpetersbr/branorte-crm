import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, FileText, CheckCircle, MessageSquare, Moon, Sun, ChevronsLeft, ChevronsRight, ChevronDown, Shield, LogOut, BarChart2, List, GitBranch, Tag, Activity, Factory, AlertCircle, Package, Zap, BookOpen, Settings, TrendingUp, MessageSquarePlus, FilePlus2, Truck, History, Search, Wallet, MapPin, Star, Target, Boxes, Filter } from 'lucide-react'
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
      { to: '/funil-site', label: 'Funil do Site', icon: Filter, permKey: 'menu.funil' },
      { to: '/contatos', label: 'Contatos', icon: Users, permKey: 'menu.contatos' },
      { to: '/consulta', label: 'Consulta', icon: Search, permKey: 'due_diligence.consultar' },
      { to: '/atribuir', label: 'Atribuir', icon: UserPlus, permKey: 'menu.atribuir' },
      { to: '/prospeccao', label: 'Prospecção', icon: Target, permKey: 'menu.prospeccao' },
      { to: '/funil', label: 'Funil', icon: GitBranch, permKey: 'menu.funil' },
      { to: '/atividade-diaria', label: 'Atividade Diária', icon: Activity, permKey: 'menu.atividade_diaria' },
      { to: '/avaliacoes', label: 'Avaliações', icon: Star, permKey: 'menu.avaliacoes' },
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
    ],
  },
  {
    id: 'producao', label: 'Produção', icon: Factory,
    items: [
      { to: '/projeto', label: 'Projeto', icon: Factory, permKey: 'menu.projeto' },
      { to: '/projeto-3d', label: 'Projeto 3D', icon: Boxes, permKey: 'menu.projeto' },
    ],
  },
  {
    id: 'sistema', label: 'Sistema', icon: Settings,
    items: [
      { to: '/disparos', label: 'Roteamento', icon: GitBranch, permKey: 'menu.disparos' },
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
  { to: '/projeto-3d', label: 'Projeto 3D', icon: Boxes, permKey: 'menu.projeto' },
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

  const visible = (item: NavItem) => !item.permKey || can(item.permKey)
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
        title={g.label}
        onClick={() => { toggleCollapsed(); ensureGroupOpen(g.id) }}
        className={cn(
          'h-9 w-9 flex items-center justify-center rounded-md transition-colors',
          groupActive ? 'bg-accent-bg text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-2',
        )}
      >
        <g.icon className="h-[16px] w-[16px]" />
      </button>
    )
  }

  // Conta "mapa" (Patrick e afins): SÓ o Mapa de Visitas, em tela cheia. Sem sidebar,
  // sem bottom-nav — pensado pra uso no celular. Botão de sair discreto e flutuante.
  if (profile?.role === 'mapa') {
    return (
      <div className="min-h-screen bg-bg">
        {/* Botão sair — canto INFERIOR direito, com confirmação antes de sair */}
        <button
          onClick={() => setConfirmSair(true)}
          title="Sair"
          className="fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[1100] h-11 px-4 inline-flex items-center gap-1.5 rounded-full bg-surface/95 backdrop-blur border border-border text-ink-muted hover:text-red-600 shadow-md text-[13px] font-semibold"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
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
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-bg">
      <aside className={cn(
        'hidden md:flex flex-col border-r border-border bg-surface transition-all duration-200',
        'sticky top-0 h-screen shrink-0 overflow-hidden',
        collapsed ? 'w-14' : 'w-64',
      )}>
        {/* Brand + avatar + collapse */}
        <div className={cn('flex items-center h-14 border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2 px-4')}>
          <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center shadow-sm shrink-0">
            <span className="text-white font-bold text-[13px] tracking-tight">B</span>
          </div>
          {!collapsed && (
            <>
              <div className="leading-tight flex-1 min-w-0">
                <h1 className="font-semibold text-ink text-[13px] tracking-tight">Branorte</h1>
                <p className="text-[10px] text-ink-faint -mt-0.5 uppercase tracking-wider">CRM</p>
              </div>
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
