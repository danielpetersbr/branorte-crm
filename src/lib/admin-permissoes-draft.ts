export type MatrizPermissoes = Record<string, Record<string, boolean>>

export interface RascunhoPermissoes {
  base: MatrizPermissoes | null
  draft: MatrizPermissoes
}

export function matrizesPermissoesIguais(a: MatrizPermissoes, b: MatrizPermissoes, roles: readonly string[], keys: readonly string[]): boolean {
  return roles.every(role => {
    const left = a[role] ?? {}, right = b[role] ?? {}
    const allKeys = new Set([...keys, ...Object.keys(left), ...Object.keys(right)])
    return [...allKeys].every(key => !!left[key] === !!right[key])
  })
}

// A query pode atualizar no foco e por polling. Só reidrata um formulário limpo.
export function reconciliarRascunhoPermissoes(state: RascunhoPermissoes, received: MatrizPermissoes, roles: readonly string[], keys: readonly string[]): RascunhoPermissoes {
  if (state.base && !matrizesPermissoesIguais(state.base, state.draft, roles, keys)) return state
  const clone = () => Object.fromEntries(Object.entries(received).map(([role, permissions]) => [role, { ...permissions }]))
  return { base: clone(), draft: clone() }
}
