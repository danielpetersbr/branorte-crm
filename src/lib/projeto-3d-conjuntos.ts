import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

type LinhaProjeto3D = { nome: string; origem_projeto3d?: OrigemProjeto3D }
const nomeConjunto = 'CAIXA 6M³ + ENSACADEIRA (SEM CHUPIM)'
const normalizar = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const variante = (text: string) => /\bINOX\b|\bVALVULAD[OA]S?\b|\bADAPTACAO\b/.test(text)
const numero = (value: string) => Number(value.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'))

function volumeCompativel(text: string, litros: readonly number[] = [6000]): boolean {
  return [...normalizar(text).matchAll(/(\d+(?:[.,]\d+)*)\s*(LITROS?|L|M³|M3)(?!\w)/g)]
    .every(value => litros.includes(numero(value[1]) * (value[2].startsWith('M') ? 1000 : 1)))
}

function candidatoPadrao(item: CatalogoItem): boolean {
  return item.ativo === true && item.is_oficial === true
    && !variante(normalizar([item.nome_curto, item.nome_completo, item.subcategoria, ...(item.specs ?? [])].filter(Boolean).join(' ')))
}

/** This exact CAD assembly was confirmed as Caixa de Ração 4 Ton plus the
 * standard bagger. Its CAD envelope is not a nominal capacity or a third item.
 * Return existing records atomically; prices, quantities and cart provenance
 * remain the responsibility of the normal quotation flow.
 */
export function encontrarComponentesConjuntoProjeto3D(line: LinhaProjeto3D, catalogo: readonly CatalogoItem[]): CatalogoItem[] | null {
  const origin = line.origem_projeto3d
  if (!origin || origin.kind !== 'equipment' || origin.resolution !== 'pendente'
    || origin.catalogId !== 'branorte_caixa_6m3_ensacadeira_sm_chupim'
    || normalizar(origin.sourceName) !== nomeConjunto) return null
  const details = origin.sourceSpecifications.filter(value => !/^\s*(?:PROJETO\s+L|EXTERNAS\s+L|REFER[EÊ]NCIA\s+3D)/i.test(value))
  if (details.some(value => {
    const text = normalizar(value)
    const equipment = text.match(/^EQUIPAMENTO\s*:\s*(.+)$/)?.[1]
    return variante(text) || !volumeCompativel(text) || (equipment !== undefined && equipment !== nomeConjunto)
      || /\bCOM\s+(?:O\s+)?CHUPIM\b/.test(text)
  })) return null

  const boxes = catalogo.filter(item => candidatoPadrao(item) && normalizar(item.categoria) === 'CAIXA'
    && Number(item.capacidade_litros) === 6154 && Number(item.capacidade_kg) === 4000
    && [item.nome_curto, item.nome_completo].filter(Boolean).every(name => normalizar(name) === 'CAIXA DE RACAO 4 TON')
    && (item.specs ?? []).every(spec => volumeCompativel(spec, [6154, 6200])
      && !/\bSEM DIVISORIA\b|\b1\s+(?:COMPARTIMENTO|SAIDA)\b/.test(normalizar(spec))))
  const baggers = catalogo.filter(item => candidatoPadrao(item) && normalizar(item.categoria) === 'ENSACADEIRA'
    && [item.nome_curto, item.nome_completo].filter(Boolean).every(name => normalizar(name) === 'ENSACADEIRA SEMI AUTOMATICA'))
  return boxes.length === 1 && baggers.length === 1 ? [boxes[0], baggers[0]] : null
}
