/**
 * Selos do Guia — a camada visual que faltava.
 *
 * No guia antigo TUDO usava a mesma tarja amarela: "ureia mata o animal" tinha
 * o mesmo peso visual de "farelo de trigo absorve umidade". Aqui o risco tem
 * escala e a compatibilidade com o equipamento tem selo próprio.
 */
import { AlertTriangle, Ban, CheckCircle2, FlaskConical, Info, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { COMPAT, RISCOS, STATUS } from '@/lib/guia/catalogo'
import type { CompatBranorte, NivelRisco, StatusConteudo } from '@/lib/guia/tipos'

export function SeloRisco({ nivel, className }: { nivel: NivelRisco; className?: string }) {
  const r = RISCOS[nivel]
  const Icone = nivel === 'informacao' ? Info
    : nivel === 'atencao' ? AlertTriangle
    : nivel === 'alto_risco' ? ShieldAlert : Ban
  return (
    <Badge className={cn(r.classe, className)}>
      <Icone className="h-3 w-3 shrink-0" />
      {r.nome}
    </Badge>
  )
}

export function SeloCompat({ compat, className }: { compat: CompatBranorte; className?: string }) {
  const c = COMPAT[compat]
  const Icone = compat === 'ok' ? CheckCircle2
    : compat === 'ressalva' ? AlertTriangle
    : compat === 'incompativel' ? Ban : Info
  return (
    <Badge className={cn(c.classe, className)} title={c.nome}>
      <Icone className="h-3 w-3 shrink-0" />
      {c.curto}
    </Badge>
  )
}

export function SeloStatus({ status, className }: { status: StatusConteudo; className?: string }) {
  const s = STATUS[status]
  return <Badge className={cn(s.classe, className)}>{s.nome}</Badge>
}

/**
 * O selo mais importante do guia. Enquanto nutricionista e engenharia não
 * assinam, o número é referência — e o vendedor precisa VER isso, não
 * descobrir depois na frente do cliente.
 */
export function SeloPendente({ pendencias, className }: { pendencias?: string[]; className?: string }) {
  return (
    <Badge
      className={cn('bg-warning-bg text-warning', className)}
      title={pendencias?.length ? pendencias.join('\n') : 'Aguarda validação técnica'}
    >
      <FlaskConical className="h-3 w-3 shrink-0" />
      Referência — pendente de validação
    </Badge>
  )
}

/** Tarja de alerta dentro da página individual. */
export function Alerta({ nivel, children }: { nivel: NivelRisco; children: React.ReactNode }) {
  const cores: Record<NivelRisco, string> = {
    informacao: 'border-l-info bg-info-bg/40',
    atencao: 'border-l-warning bg-warning-bg/40',
    alto_risco: 'border-l-danger bg-danger-bg/50',
    incompativel: 'border-l-danger bg-danger-bg/50',
  }
  const Icone = nivel === 'informacao' ? Info
    : nivel === 'atencao' ? AlertTriangle
    : nivel === 'alto_risco' ? ShieldAlert : Ban
  return (
    <div className={cn('flex gap-2.5 rounded-md border-l-[3px] px-3 py-2.5 text-[13px] leading-relaxed text-ink', cores[nivel])}>
      <Icone className={cn('h-4 w-4 shrink-0 mt-0.5',
        nivel === 'informacao' ? 'text-info' : nivel === 'atencao' ? 'text-warning' : 'text-danger')} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
