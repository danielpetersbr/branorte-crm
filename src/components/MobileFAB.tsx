import { Link, useLocation } from 'react-router-dom'
import { FilePlus2 } from 'lucide-react'

/**
 * Floating Action Button mobile pra criar novo orçamento.
 * Aparece SÓ em viewport < lg (md:hidden em alguns lugares, lg:hidden aqui)
 * e em rotas onde faz sentido (esconde nas próprias telas de orçamento
 * pra não atrapalhar). Fica acima do bottom nav (bottom-20).
 */
const HIDE_ON = [
  '/orcamentos/montar',
  '/orcamentos/novo',
  '/login',
  '/signup',
  '/pendente',
]

export function MobileFAB() {
  const loc = useLocation()
  if (HIDE_ON.some(p => loc.pathname.startsWith(p))) return null

  return (
    <Link
      to="/orcamentos/montar"
      title="Novo orçamento"
      aria-label="Novo orçamento"
      className="lg:hidden fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-accent text-white shadow-2xl flex items-center justify-center hover:bg-accent/90 active:scale-95 transition-all"
    >
      <FilePlus2 className="h-6 w-6" />
    </Link>
  )
}
