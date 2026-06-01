import { Link } from 'react-router-dom'
import {
  FilePlus2,
  ClipboardList,
  DollarSign,
  CheckCircle,
  Truck,
  ShieldCheck,
  Users,
  MessageSquare,
  LayoutDashboard,
  ChevronRight,
  User,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'

/**
 * Home mobile (launcher) — landing do app no celular (PWA).
 * Grid de atalhos grandes pros tools do vendedor, com cards gated por permissão.
 * Renderizada só no viewport mobile via HomeRouter em App.tsx; no desktop a
 * rota "/" segue mostrando o Dashboard.
 */

type Tile = {
  to: string
  label: string
  sub: string
  icon: typeof FilePlus2
  /** classe de cor do ícone/realce */
  tone: string
  show: boolean
}

export function MobileHome() {
  const { profile } = useAuth()
  const can = useCan()
  const isAdmin = profile?.role === 'admin'

  const firstName = (profile?.display_name ?? profile?.email ?? 'vendedor')
    .split(/[ @]/)[0]

  const podeOrcar = can('menu.orcamentos')

  const tiles: Tile[] = [
    {
      to: '/orcamentos/salvos',
      label: 'Meus Orçamentos',
      sub: 'Abrir e editar',
      icon: ClipboardList,
      tone: 'text-sky-400',
      show: podeOrcar,
    },
    {
      to: '/orcamentos/precos',
      label: 'Tabela de Preços',
      sub: 'Consultar valores',
      icon: DollarSign,
      tone: 'text-emerald-400',
      show: podeOrcar,
    },
    {
      to: '/frete',
      label: 'Frete',
      sub: 'Calcular cotação',
      icon: Truck,
      tone: 'text-amber-400',
      show: true,
    },
    {
      to: '/vendidos',
      label: 'Vendidos',
      sub: 'Vendas fechadas',
      icon: CheckCircle,
      tone: 'text-green-400',
      show: can('menu.vendidos'),
    },
    {
      to: '/consulta',
      label: 'Consulta de Crédito',
      sub: 'CNPJ / CPF',
      icon: ShieldCheck,
      tone: 'text-violet-400',
      show: can('due_diligence.consultar'),
    },
    {
      to: '/contatos',
      label: 'Contatos',
      sub: 'Leads e clientes',
      icon: Users,
      tone: 'text-cyan-400',
      show: can('menu.contatos'),
    },
    {
      to: '/atendimentos',
      label: 'Atendimentos',
      sub: 'WhatsApp',
      icon: MessageSquare,
      tone: 'text-pink-400',
      show: can('menu.atendimentos'),
    },
    {
      to: '/dashboard',
      label: 'Dashboard',
      sub: 'KPIs e metas',
      icon: LayoutDashboard,
      tone: 'text-indigo-400',
      show: isAdmin,
    },
  ].filter((t) => t.show)

  return (
    <div
      className="min-h-full bg-bg"
      style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
    >
      {/* Header / saudação */}
      <header
        className="px-4 pt-5 pb-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top))' }}
      >
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-ink/40 font-semibold">
            Branorte
          </div>
          <h1 className="text-2xl font-bold text-ink truncate">
            Olá, {firstName} 👋
          </h1>
          <p className="text-xs text-ink/50 mt-0.5">O que vamos fazer agora?</p>
        </div>
        <Link
          to="/perfil"
          aria-label="Perfil"
          className="shrink-0 h-11 w-11 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold text-lg active:scale-95 transition-transform"
        >
          {profile?.display_name || profile?.email ? (
            (profile.display_name ?? profile.email!)[0].toUpperCase()
          ) : (
            <User className="h-5 w-5" />
          )}
        </Link>
      </header>

      {/* Hero — ação primária */}
      {podeOrcar && (
        <div className="px-4">
          <Link
            to="/orcamentos/montar"
            className="group flex items-center gap-4 rounded-2xl bg-accent text-white p-5 shadow-lg shadow-accent/20 active:scale-[0.98] transition-transform"
          >
            <div className="h-14 w-14 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <FilePlus2 className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold leading-tight">Novo Orçamento</div>
              <div className="text-sm text-white/80">Montar do zero</div>
            </div>
            <ChevronRight className="h-6 w-6 text-white/70 group-active:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      )}

      {/* Grid de atalhos */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((t) => {
            const Icon = t.icon
            return (
              <Link
                key={t.to + t.label}
                to={t.to}
                className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-3 active:scale-[0.97] transition-transform min-h-[112px]"
              >
                <div className="h-11 w-11 rounded-xl bg-surface-2 flex items-center justify-center">
                  <Icon className={`h-6 w-6 ${t.tone}`} />
                </div>
                <div className="mt-auto">
                  <div className="text-sm font-semibold text-ink leading-tight">
                    {t.label}
                  </div>
                  <div className="text-[11px] text-ink/45">{t.sub}</div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
