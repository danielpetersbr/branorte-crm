import type { DiferencaProposta, OrcamentoAISnapshot, PropostaOrcamento } from './types'

const TRACKED_FIELDS: Array<keyof Pick<PropostaOrcamento, 'cliente' | 'modelo' | 'itens' | 'motores' | 'acessorios' | 'componentes' | 'voltagem' | 'fotoPrincipalUrl' | 'condicoes'>> = [
  'cliente', 'modelo', 'itens', 'motores', 'acessorios', 'componentes', 'voltagem', 'fotoPrincipalUrl', 'condicoes',
]

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function diffProposal(snapshot: OrcamentoAISnapshot, proposal: PropostaOrcamento): DiferencaProposta[] {
  return TRACKED_FIELDS.map((path) => {
    const before = snapshot[path]
    const after = proposal[path]
    const unchanged = equal(before, after)
    return {
      path,
      kind: unchanged ? 'mantido' : before == null || (Array.isArray(before) && before.length === 0) ? 'adicionado' : 'alterado',
      before,
      after,
      requiresExplicitApproval: !unchanged,
    }
  })
}
