import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, FileText, CheckCircle, MessageSquare, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAtendimentoKpis } from '@/hooks/useAtendimentos'

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

export function Layout() {
  const { data: kpis } = useAtendimentoKpis()
  const [dark, toggle] = useDarkMode()

  const counts: Partial<Record<NonNullable<NavItem['countKey']>, number>> = {
    atendimentos: kpis?.total,
  }

  const renderItem = (l: NavItem) => (
    <NavLink
      key={l.to}
      to={l.to}
      end={l.to === '/'}
      className={({ isActive }) => cn(
        'group relative flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150',
        isActive
          ? 'bg-accent-bg text-accent'
          : 'text-ink-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-accent" />}
          <l.icon className={cn('h-[15px] w-[15px] shrink-0', isActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
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
    </NavLink>
  )

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-bg">
      <aside className="hidden lg:flex flex-col w-60 border-r border-border bg-bg">
        <div className="flex items-center gap-2.5 px-5 h-14 border-b border-border">
          <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-[13px] tracking-tight">B</span>
          </div>
          <div className="leading-tight">
            <h1 className="font-semibold text-ink text-[13px] tracking-tight">Branorte</h1>
            <p className="text-[10px] text-ink-faint -mt-0.5 uppercase tracking-wider">CRM</p>
          </div>
        </div>

        <nav className="flex-1 p-3 flex flex-col gap-0.5">
          <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-1">Operação</div>
          {PRIMARY.map(renderItem)}
          <div className="text-[10px] uppercase tracking-widest text-ink-faint px-3 mb-1.5 mt-4">Financeiro</div>
          {SECONDARY.map(renderItem)}
        </nav>

        <div className="border-t border-border p-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            Online
          </span>
          <button
            onClick={toggle}
            title={dark ? 'Tema claro' : 'Tema escuro'}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
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
