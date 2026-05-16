import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, FileText, CheckCircle, MessageSquare, Moon, Sun, ChevronsLeft, ChevronsRight, Shield, LogOut, BarChart2, List, GitBranch, Tag, Activity, Factory, AlertCircle, Sparkles, Package, Zap, BookOpen, Settings, TrendingUp, MessageSquarePlus } from 'lucide-react'
import { useEffect, useState, Suspense } from 'react'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import { useAtendimentoKpis } from '@/hooks/useAtendimentos'
import { useAuth } from '@/hooks/useAuth'
import { RoadmapFAB } from '@/components/RoadmapFAB'

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
  children?: NavItem[]
  matchPrefix?: boolean  // se true, parent fica ativo quando path começa com `to`
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/atendimentos', label: 'Atendimentos', icon: MessageSquare, countKey: 'atendimentos' },
  { to: '/contatos', label: 'Contatos', icon: Users },
  { to: '/atribuir', label: 'Atribuir', icon: UserPlus },
  { to: '/funil', label: 'Funil', icon: GitBranch },
  {
    to: '/etiquetas-zap',
    label: 'Etiquetas Zap',
    icon: Tag,
    matchPrefix: true,
    children: [
      { to: '/etiquetas-zap', label: 'Cards', icon: List },
      { to: '/etiquetas-zap/graficos', label: 'Gráficos', icon: BarChart2 },
      { to: '/etiquetas-zap/painel', label: 'Painel Status', icon: AlertCircle },
    ],
  },
  { to: '/atividade-diaria', label: 'Atividade Diária', icon: Activity },
]
const SECONDARY: NavItem[] = [
  {
    to: '/orcamentos',
    label: 'Orçamentos',
    icon: FileText,
    matchPrefix: true,
    children: [
      { to: '/orcamentos/montar', label: 'Montar Custom', icon: Package },
      { to: '/orcamentos/salvos', label: 'Salvos (Editar)', icon: List },
      { to: '/orcamentos/catalogo-admin', label: 'Catálogo (Admin)', icon: Shield },
      { to: '/orcamentos/motores', label: 'Motores (Preços)', icon: Zap },
      { to: '/orcamentos/precos', label: 'Tabela de Preços', icon: BookOpen },
      { to: '/orcamentos/conversao', label: 'Conversão (KPIs)', icon: TrendingUp },
      { to: '/admin/transportador-funcoes', label: 'Funções do Transportador', icon: GitBranch },
      { to: '/orcamentos', label: 'Painel', icon: BarChart2 },
      { to: '/orcamentos/lista', label: 'Lista', icon: List },
    ],
  },
  { to: '/vendidos', label: 'Vendidos', icon: CheckCircle },
  { to: '/projeto', label: 'Projeto', icon: Factory },
  { to: '/disparos', label: 'Roteamento', icon: GitBranch },
]

// MIGRACAO 2026-05-16: app virou dark-default. Usa key 'theme-v2' pra
// IGNORAR 'theme: light' salvo antes (usuario nao escolheu light de fato,
// era o default antigo). Quem clicar no toggle aqui pra frente vira 'v2'.
function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('theme-v2')
    if (saved === 'dark') return true
    if (saved === 'light') return false
    // Sem preferencia v2: ignora 'theme' antigo, default dark
    return true
  })
  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('theme-v2', 'dark')
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0d0d11')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme-v2', 'light')
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#fafafb')
    }
    // Limpa key legada pra evitar confusao
    try { localStorage.removeItem('theme') } catch {}
  }, [dark])
  return [dark, () => setDark(d => !d)]
}

function useCollapsed(): [boolean, () => void] {
  // Em telas <1024 (md/tablet), default colapsado pra dar espaço pro conteudo.
  // Em >=1024, respeita preferencia salva no localStorage.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    if (window.matchMedia('(max-width: 1023px)').matches) return true
    return localStorage.getItem('sidebar-collapsed') === '1'
  })

  // Quando viewport entra em <1024, colapsa automaticamente
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsed(true)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // So persiste preferencia do user em telas grandes
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(min-width: 1024px)').matches) {
      localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0')
    }
  }, [collapsed])

  return [collapsed, () => setCollapsed(c => !c)]
}

export function Layout() {
  const { data: kpis } = useAtendimentoKpis()
  const [dark, toggleDark] = useDarkMode()
  const [collapsed, toggleCollapsed] = useCollapsed()
  const { profile, signOut } = useAuth()
  const loc = useLocation()
  const isAdmin = profile?.role === 'admin'

  const counts: Partial<Record<NonNullable<NavItem['countKey']>, number>> = {
    atendimentos: kpis?.total,
  }

  const renderChild = (c: NavItem) => (
    <NavLink
      key={c.to}
      to={c.to}
      end
      title={collapsed ? c.label : undefined}
      className={({ isActive }) => cn(
        'group relative flex items-center rounded-md text-[12px] font-medium transition-all duration-150',
        collapsed ? 'justify-center h-8 w-8' : 'gap-2 pl-7 pr-3 py-1.5',
        isActive
          ? 'text-accent'
          : 'text-ink-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          <c.icon className={cn('h-[13px] w-[13px] shrink-0', isActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
          {!collapsed && <span className="flex-1">{c.label}</span>}
        </>
      )}
    </NavLink>
  )

  const renderItem = (l: NavItem) => {
    const parentActive = l.matchPrefix
      ? loc.pathname === l.to || loc.pathname.startsWith(l.to + '/')
      : false
    const showChildren = !collapsed && !!l.children

    return (
      <div key={l.to}>
        <NavLink
          to={l.to}
          end={l.to === '/' && !l.matchPrefix}
          title={collapsed ? l.label : undefined}
          className={({ isActive }) => {
            const active = l.matchPrefix ? parentActive : isActive
            return cn(
              'group relative flex items-center rounded-md text-[13px] font-medium transition-all duration-150',
              collapsed ? 'justify-center h-9 w-9' : 'gap-2.5 px-3 py-2',
              active
                ? 'bg-accent-bg text-accent'
                : 'text-ink-muted hover:text-ink hover:bg-surface-2',
            )
          }}
        >
          {({ isActive }: { isActive: boolean }) => {
            const active = l.matchPrefix ? parentActive : isActive
            return (
              <>
                {active && !collapsed && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-accent" />}
                <l.icon className={cn('h-[15px] w-[15px] shrink-0', active ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{l.label}</span>
                    {l.countKey && counts[l.countKey] !== undefined && (
                      <span className={cn(
                        'text-[10px] tabular-nums px-1.5 py-0.5 rounded-md font-mono shrink-0',
                        active ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-ink-faint',
                      )}>
                        {fmtCount(counts[l.countKey] as number)}
                      </span>
                    )}
                  </>
                )}
              </>
            )
          }}
        </NavLink>
        {showChildren && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {l.children!.map(renderChild)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-bg">
      <aside className={cn(
        'hidden md:flex flex-col border-r border-border bg-bg transition-all duration-200',
        'sticky top-0 h-screen overflow-y-auto shrink-0',
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

        <nav className={cn('flex-1 flex flex-col gap-0.5', collapsed ? 'p-2 items-center' : 'p-3')}>
          {!collapsed && <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-1">Operação</div>}
          {PRIMARY.map(renderItem)}
          {!collapsed && <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-4">Orçamentos</div>}
          {collapsed && <div className="my-2 w-8 h-px bg-border" />}
          {SECONDARY.map(renderItem)}
          {isAdmin && (
            <>
              {!collapsed && <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-4">Admin</div>}
              {collapsed && <div className="my-2 w-8 h-px bg-border" />}
              {renderItem({ to: '/admin/usuarios', label: 'Usuários', icon: Shield })}
              {renderItem({ to: '/admin/transportador-funcoes', label: 'Funções Chupim', icon: Settings })}
              {renderItem({ to: '/roadmap', label: 'Roadmap & Feedback', icon: MessageSquarePlus })}
            </>
          )}
        </nav>

        {/* Toolbar inferior — sempre visível (sidebar é sticky h-screen) */}
        <div className={cn('border-t border-border', collapsed ? 'p-2 flex flex-col items-center gap-1' : 'p-2 flex items-center justify-end gap-1')}>
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
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>

      {/* FAB global de feedback (visivel em todas as paginas autenticadas) */}
      <RoadmapFAB />

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-bg/95 backdrop-blur border-t border-border flex items-center justify-around px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] z-50">
        {PRIMARY.concat(SECONDARY).slice(0, 5).map(l => (
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
