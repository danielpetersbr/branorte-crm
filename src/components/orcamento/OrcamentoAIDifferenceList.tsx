import type { DiferencaProposta } from '@/lib/orcamento-ai/types'

const labels: Record<string, string> = {
  cliente: 'Cliente', modelo: 'Modelo', itens: 'Equipamentos', motores: 'Motores', acessorios: 'Acessórios',
  componentes: 'Componentes', voltagem: 'Voltagem', fotoPrincipalUrl: 'Foto principal', condicoes: 'Condições comerciais',
}

export function OrcamentoAIDifferenceList({ differences }: { differences: DiferencaProposta[] }) {
  const changed = differences.filter((item) => item.kind !== 'mantido')
  if (!changed.length) return <p className="text-xs text-slate-500">Nenhuma alteração em relação ao orçamento atual.</p>
  return (
    <ul className="space-y-1 text-xs">
      {changed.map((item) => (
        <li key={item.path} className="flex items-center justify-between rounded bg-amber-50 px-2 py-1 text-amber-900">
          <span>{labels[item.path] ?? item.path}</span>
          <span className="font-semibold">{item.kind}</span>
        </li>
      ))}
    </ul>
  )
}
