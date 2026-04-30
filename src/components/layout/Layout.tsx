import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, FileText, CheckCircle, MessageSquare, Moon, Sun, ChevronsLeft, ChevronsRight, Shield, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAtendimentoKpis } from '@/hooks/useAtendimentos'
import { useAuth } from '@/hooks/useAuth'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  countKey?: 'atendimentos'
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/atendimentos', label: 'Atendimentos', icon: MessageSquare, countKey: 'atendimentos' },
  { to: '/contatos', label: 'Contatos', icon: Users },
  { to: '/atribuir', label: 'Atribuir', icon: UserPlus },
]
const SECONDARY: NavItem[] = [
  { to: '/orcamentos', label: 'Orçamentos', icon: FileText },
  { to: '/vendidos', label: 'Vendidos', icon: CheckCircle },
]

function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return document.documentElement.classList.contains('dark') || localStorage.getItem('theme') === 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (dark) { root.classList.add('dark'); localStorage.setItem('theme', 'dark') }
    else      { root.classList.remove('dark'); localStorage.setItem('theme', 'light') }
  }, [dark])
  return [dark, () => setDark(d => !d)]
}

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('sidebar-collapsed') === '1'
  })
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0')
  }, [collapsed])
  return [collapsed, () => setCollapsed(c => !c)]
}

export function Layout() {
  const { data: kpis } = useAtendimentoKpis()
  const [dark, toggleDark] = useDarkMode()
  const [collapsed, toggleCollapsed] = useCollapsed()
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const counts: Partial<Record<NonNullable<NavItem['countKey']>, number>> = {
    atendimentos: kpis?.total,
  }

  const renderItem = (l: NavItem) => (
    <NavLink
      key={l.to}
      to={l.to}
      end={l.to === '/'}
      title={collapsed ? l.label : undefined}
      className={({ isActive }) => cn(
        'group relative flex items-center rounded-md text-[13px] font-medium transition-all duration-150',
        collapsed ? 'justify-center h-9 w-9' : 'gap-2.5 px-3 py-2',
        isActive
          ? 'bg-accent-bg text-accent'
          : 'text-ink-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          {isActive && !collapsed && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-accent" />}
          <l.icon className={cn('h-[15px] w-[15px] shrink-0', isActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
          {!collapsed && (
            <>
              <span className="flex-1">{l.label}</span>
              {l.countKey && counts[l.countKey] !== undefined && (
                <span className={cn(
                  'text-[10px] tabular-nums px-1.5 py-0.5 rounded-md font-mono',
                  isActive ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-ink-faint',
                )}>
                  {counts[l.countKey]}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  )

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-bg">
      <aside className={cn(
        'hidden lg:flex flex-col border-r border-border bg-bg transition-all duration-200',
        collapsed ? 'w-14' : 'w-60',
      )}>
        {/* Brand + collapse button */}
        <div className={cn('flex items-center h-14 border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2.5 px-5')}>
          <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center shadow-sm shrink-0">
            <span className="text-white font-bold text-[13px] tracking-tight">B</span>
          </div>
          {!collapsed && (
            <>
              <div className="leading-tight flex-1">
                <h1 className="font-semibold text-ink text-[13px] tracking-tight">Branorte</h1>
                <p className="text-[10px] text-ink-faint -mt-0.5 uppercase tracking-wider">CRM</p>
              </div>
              <button
                onClick={toggleCollapsed}
                title="Minimizar menu"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* User card no topo (logo abaixo do brand) */}
        {profile && !collapsed && (
          <NavLink
            to="/perfil"
            className={({ isActive }) => cn(
              'border-b border-border px-3 py-2.5 flex items-center gap-2.5 transition-colors',
              isActive ? 'bg-accent-bg' : 'hover:bg-surface-2'
            )}
          >
            <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center text-white text-[11px] font-bold shrink-0">
              {(profile.display_name ?? profile.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <p className="text-[12px] font-medium text-ink truncate">{profile.display_name ?? '—'}</p>
              <p className="text-[10px] text-ink-faint truncate">{profile.email}</p>
            </div>
          </NavLink>
        )}
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
          {!collapsed && <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-4">Financeiro</div>}
          {collapsed && <div className="my-2 w-8 h-px bg-border" />}
          {SECONDARY.map(renderItem)}
          {isAdmin && (
            <>
              {!collapsed && <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-4">Admin</div>}
              {collapsed && <div className="my-2 w-8 h-px bg-border" />}
              {renderItem({ to: '/admin/usuarios', label: 'Usuários', icon: Shield })}
            </>
          )}
        </nav>

        {/* Toolbar inferior */}
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

      <main className="flex-1 min-h-screen pb-16 lg:pb-0">
        <Outlet />
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-bg/95 backdrop-blur border-t border-border flex items-center justify-around px-2 py-1.5 z-50">
        {PRIMARY.concat(SECONDARY).slice(0, 5).map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) => cn(
              'flex flex-col items-center gap-0.5 px-3 py-1.5 text-[10px] font-medium rounded-md min-w-[60px]',
              isActive ? 'text-accent' : 'text-ink-faint',
            )}
          >
            <l.icon className="h-[18px] w-[18px]" />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
