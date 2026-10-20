import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'
import { encontrarCatalogoProjeto3D } from './projeto-3d-catalogo-match'

/** Completes only unresolved equipment rows; pricing and motor validation belong to the CRM. */
export function autoVincularProjeto3D<T extends {
  nome: string
  origem_projeto3d?: OrigemProjeto3D
  specs?: string[]
  foto_url?: string | null
  valor?: number
  valor_original?: number
}>(
  linhas: readonly T[],
  catalogo: readonly CatalogoItem[],
  vincular: (linha: T, item: CatalogoItem) => T,
): T[] {
  return linhas.map(linha => {
    const origem = linha.origem_projeto3d
    if (origem?.resolution !== 'pendente' || origem.kind !== 'equipment') return linha
    // Inline edits can exist before the resolution panel confirms the row.
    if (linha.foto_url || (linha.valor ?? 0) !== 0 || (linha.valor_original ?? 0) !== 0) return linha
    if (linha.specs && (linha.specs.length !== origem.sourceSpecifications.length
      || linha.specs.some((spec, index) => spec !== origem.sourceSpecifications[index]))) return linha
    const item = encontrarCatalogoProjeto3D(linha, catalogo)
    if (!item) return linha
    try {
      return vincular(linha, item)
    } catch {
      // An incomplete price or motor keeps this row pending without blocking the rest.
      return linha
    }
  })
}
