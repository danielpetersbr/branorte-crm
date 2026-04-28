import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, FileText, CheckCircle, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contatos', label: 'Contatos', icon: Users },
  { to: '/atendimentos', label: 'Atendimentos', icon: MessageSquare },
  { to: '/atribuir', label: 'Atribuir', icon: UserPlus },
  { to: '/orcamentos', label: 'Orçamentos', icon: FileText },
  { to: '/vendidos', label: 'Vendidos', icon: CheckCircle },
]

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-surface-border p-4 gap-1">
        <div className="flex items-center gap-3 px-3 py-4 mb-4">
          <div className="h-10 w-10 rounded-lg bg-brand-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">B</span>
          </div>
          <div>
            <h1 className="font-bold text-text-primary text-sm">Branorte CRM</h1>
            <p className="text-xs text-text-muted">Controle de Contatos</p>
          </div>
        </div>
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-tertiary'
            )}
          >
            <l.icon className="h-5 w-5" />
            {l.label}
          </NavLink>
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen pb-20 lg:pb-0">
        <Outlet />
      </main>

      {/* Bottom nav - mobile */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-surface-border flex items-center justify-around px-2 py-1 z-50">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) => cn(
              'flex flex-col items-center gap-0.5 px-3 py-2 text-xs font-medium rounded-lg min-w-[64px]',
              isActive ? 'text-brand-600' : 'text-text-muted'
            )}
          >
            <l.icon className="h-5 w-5" />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
