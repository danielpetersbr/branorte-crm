import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'
import { encontrarCatalogoProjeto3D } from './projeto-3d-catalogo-match'
import { encontrarComponentesConjuntoProjeto3D } from './projeto-3d-conjuntos'

type LinhaAutoVinculo = {
  uid?: string
  nome: string
  origem_projeto3d?: OrigemProjeto3D
  specs?: string[]
  foto_url?: string | null
  valor?: number
  valor_original?: number
}

export type MotivoAutoVinculoProjeto3D = 'vinculado' | 'sem_cadastro' | 'ambiguo' | 'sem_preco'
  | 'motor_incompleto' | 'edicao_preservada' | 'falha_precificacao'

export interface DiagnosticoAutoVinculoProjeto3D {
  index: number
  uid?: string
  motivo: MotivoAutoVinculoProjeto3D
  mensagem: string
  catalogo?: CatalogoItem
  candidatos?: CatalogoItem[]
}

export interface ResultadoAutoVinculoProjeto3D<T> {
  linhas: T[]
  diagnosticos: DiagnosticoAutoVinculoProjeto3D[]
}

/** Pricing and motor validation remain in the CRM callback. Catalog metadata is
 * returned separately so failed pricing never turns a pending row into an edit.
 * Diagnostics cover only pending equipment rows, using their original indexes.
 */
export function autoVincularProjeto3DComDiagnostico<T extends LinhaAutoVinculo>(
  linhas: readonly T[],
  catalogo: readonly CatalogoItem[],
  vincular: (linha: T, item: CatalogoItem) => T,
): ResultadoAutoVinculoProjeto3D<T> {
  const diagnosticos: DiagnosticoAutoVinculoProjeto3D[] = []
  const resultado = linhas.flatMap((linha, index): T[] => {
    const origem = linha.origem_projeto3d
    if (origem?.resolution !== 'pendente' || origem.kind !== 'equipment') return [linha]
    const registrar = (diagnostico: Omit<DiagnosticoAutoVinculoProjeto3D, 'index' | 'uid'>) => {
      const uid = 'uid' in linha && typeof linha.uid === 'string' ? linha.uid : undefined
      diagnosticos.push({ index, uid, ...diagnostico })
    }
    // Inline edits can exist before the resolution panel confirms the row.
    if (linha.foto_url || (linha.valor ?? 0) !== 0 || (linha.valor_original ?? 0) !== 0
      || (linha.specs && (linha.specs.length !== origem.sourceSpecifications.length
        || linha.specs.some((spec, specIndex) => spec !== origem.sourceSpecifications[specIndex])))) {
      registrar({ motivo: 'edicao_preservada', mensagem: 'Esta linha já foi editada no orçamento. A edição foi preservada; confira o vínculo ou confirme o valor manual.' })
      return [linha]
    }
    const componentes = encontrarComponentesConjuntoProjeto3D(linha, catalogo)
    if (componentes && linha.uid) {
      try {
        // Price every component before replacing the source row. A missing
        // price/motor leaves the entire assembly pending, without a partial bill.
        const vinculadas = componentes.map(item => vincular({
          ...linha, uid: `${linha.uid}:componente:${item.id}`,
          nome: item.categoria === 'CAIXA' ? item.nome_curto.replace(/^CAIXA\b/i, 'Caixa de Ração') : item.nome_curto,
          origem_projeto3d: { ...origem, componentCatalogId: item.id },
        }, item))
        registrar({ motivo: 'vinculado', mensagem: 'Componentes do conjunto vinculados aos cadastros atuais.' })
        return vinculadas
      } catch (error) {
        const mensagem = error instanceof Error ? error.message : 'Não foi possível conferir o preço de todos os componentes do conjunto.'
        registrar({ motivo: /motor/i.test(mensagem) ? 'motor_incompleto' : 'sem_preco', mensagem })
        return [linha]
      }
    }
    const item = encontrarCatalogoProjeto3D(linha, catalogo)
    if (!item) {
      // Reuse the exact matcher rules, only scanning singletons when no unique
      // match exists. Do not infer another product or bypass variant conflicts.
      const candidatos = catalogo.filter(candidate => encontrarCatalogoProjeto3D(linha, [candidate]) !== null)
      if (candidatos.length > 1) {
        registrar({ motivo: 'ambiguo', mensagem: 'Mais de um cadastro corresponde a esta peça. Escolha o produto correto no catálogo.', candidatos })
      } else {
        registrar({ motivo: 'sem_cadastro', mensagem: 'Nenhum cadastro ativo e oficial corresponde com segurança a esta peça. Confira o catálogo ou confirme um valor manual.' })
      }
      return [linha]
    }
    try {
      const vinculada = vincular(linha, item)
      registrar({ motivo: 'vinculado', mensagem: 'Cadastro e preço conferidos para esta peça.', catalogo: item })
      return [vinculada]
    } catch (error) {
      // An incomplete price or motor keeps this row pending without blocking the rest.
      const mensagemOriginal = error instanceof Error ? error.message.trim() : ''
      const mensagem = mensagemOriginal || 'Não foi possível conferir o preço desta peça. Confira o catálogo ou confirme um valor manual.'
      const motivo: MotivoAutoVinculoProjeto3D = /motor/i.test(mensagemOriginal) ? 'motor_incompleto'
        : /pre[cç]o|valor/i.test(mensagemOriginal) ? 'sem_preco' : 'falha_precificacao'
      registrar({ motivo, mensagem, catalogo: item })
      return [linha]
    }
  })
  return { linhas: resultado, diagnosticos }
}

/** Backward-compatible array API for callers that do not display diagnostics. */
export function autoVincularProjeto3D<T extends LinhaAutoVinculo>(
  linhas: readonly T[],
  catalogo: readonly CatalogoItem[],
  vincular: (linha: T, item: CatalogoItem) => T,
): T[] {
  return autoVincularProjeto3DComDiagnostico(linhas, catalogo, vincular).linhas
}
