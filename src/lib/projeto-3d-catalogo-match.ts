import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

type LinhaProjeto3D = { nome: string; specs?: string[]; origem_projeto3d?: OrigemProjeto3D }
type Identidade = {
  familia: 'transportador' | 'moinho' | 'misturador' | 'elevador' | 'cacamba'
  tipo: string
  diametro?: number
  comprimento?: number
  potencia?: number
  litros?: number
  kg?: number
}

const numero = (value: string) => Number(value.replace(',', '.'))
const normalizar = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const tituloExato = (value: string) => normalizar(value).replace(/(\d),(\d)/g, '$1.$2').replace(/\s*([×X])\s*/g, ' X ').replace(/\s+/g, ' ').trim()
const conjunto = (text: string) => /\+|\bFABRICA\b|\bCOMPACTA\b|MOINHO.*MISTURADOR|MISTURADOR.*MOINHO|CAIXA.*ENSACADEIRA|\bBIG\s*BAG\b|\bSUPORTE\s+BAG\b/.test(text)

const especificacoesComerciais = (values: readonly string[]) => values.filter(value => !/REFER[EÊ]NCIA\s*3D|PROJETO\s+L|EXTERNAS\s+L|L\s*[X×]\s*P\s*[X×]\s*A/i.test(value))

function detalhesParaVariantes(values: readonly string[]): string {
  return especificacoesComerciais(values).map(value => {
    // A standard motor description is not the specially named motorredutor model.
    const text = normalizar(value)
    return /^(?:MOTOR|ACIONAMENTO)\b/.test(text) && /\d+(?:[.,]\d+)?\s*CV\b/.test(text) ? text.replace(/MOTORREDUTOR|MOTOREDUTOR/g, '') : text
  }).join(' ')
}

function presencaQualificador(text: string, positive: RegExp, negative: RegExp): boolean | null {
  const withoutNegative = text.replace(negative, '')
  const present = positive.test(withoutNegative)
  return present && withoutNegative !== text ? null : present
}

/** Commercial qualifiers distinguish positive, absent/negative, and contradictory evidence. */
function variantes(text: string): string | null {
  const pulmao = presencaQualificador(text, /\bPULMAO\b/, /\b(?:SEM\s+|S\s*\/\s*)PULMAO\b/g)
  const aquecimento = presencaQualificador(text, /AQUECIMENTO|AQUECID/, /\b(?:SEM\s+|S\s*\/\s*|NAO\s+)(?:SISTEMA\s+DE\s+)?(?:AQUECIMENTO|AQUECID[OA]S?)\b/g)
  if (pulmao === null || aquecimento === null) return null
  const values = [
    /\bINOX\b/.test(text) ? `INOX${text.match(/\bINOX\s*(304|316)\b/)?.[1] ?? ''}` : '',
    /\bPLASTIC[OA]S?\b/.test(text) ? 'PLASTICO' : '',
    pulmao ? 'PULMAO' : '',
    /\bSECADOR\b/.test(text) ? 'SECADOR' : '',
    aquecimento ? 'AQUECIMENTO' : '',
    /MOTORREDUTOR|MOTOREDUTOR/.test(text) ? 'MOTORREDUTOR' : '',
    /(?:MOTORREDUTOR|MOTOREDUTOR)\s+(?:EM CIMA|SUPERIOR)/.test(text) ? 'MOTORREDUTOR SUPERIOR' : '',
    /\bCARDAN\b/.test(text) ? 'CARDAN' : '',
    /\bSEM\s+MOTOR\b|\bS\s*\/\s*MOTOR\b|MOTOR\s+POR\s+CONTA/.test(text) ? 'SEM MOTOR' : '',
    /ROSCA\s+(?:DE\s+)?DESCARGA/.test(text) ? 'ROSCA DESCARGA' : '',
    /REGISTRO\s+(?:DE\s+)?GAVETA/.test(text) ? 'REGISTRO GAVETA' : '',
    /\bVALVULAD[OA]S?\b/.test(text) ? 'VALVULADA' : '',
    /SAIDA\s+(?:REDONDA|CIRCULAR)/.test(text) ? 'SAIDA REDONDA' : '',
    /(?:SAIDA|DESCARGA)\s+(?:2|DUAS)\s+VIAS/.test(text) ? 'SAIDA 2 VIAS' : '',
    ...Array.from(text.matchAll(/\b(ENTRADA|SAIDA|DESCARGA)\s+(?:PELA\s+)?(ESQ(?:UERDA)?|DIR(?:EITA)?|LATERAL|RETA|CENTRAL)\b/g), value => `${value[1] === 'DESCARGA' ? 'SAIDA' : value[1]} ${/^ESQ/.test(value[2]) ? 'ESQUERDA' : /^DIR/.test(value[2]) ? 'DIREITA' : value[2]}`),
    ...Array.from(text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:°|GRAUS\b)/g), value => `ANGULO ${numero(value[1])}`),
  ]
  return [...new Set(values.filter(Boolean))].sort().join('|')
}

function identidade(value: string): Identidade | null {
  // Legacy CAD copies may retain a drawing revision immediately after the unit.
  // Remove that revision only; the nominal length and diameter remain literal.
  const text = normalizar(value).replace(/(\d\s*(?:MM|M))ALT\s*\d+\b/g, '$1')
  const conveyor = text.match(/^(?:TRANSPORTADOR\s+HELICOIDAL(?:\s+CALHA\s+TH)?|CALHA\s+TH|TH|CHUPIM)\s*[Øø]?\s*(\d{2,3})\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*(MM|M)\b/)
  if (conveyor) return { familia: 'transportador', tipo: /\bTH\b|\bCALHA\b/.test(conveyor[0]) ? 'calha' : 'tubular', diametro: numero(conveyor[1]), comprimento: numero(conveyor[2]) / (conveyor[3] === 'MM' ? 1000 : 1) }
  const mill = text.match(/^(?:MOINHO(?:\s+DE)?(?:\s+MARTELOS?)?|TRITURADOR(?:ES)?\s+DE\s+GRAOS)\s*(\d+(?:[.,]\d+)?)\s*CV\b/)
  if (mill) return { familia: 'moinho', tipo: 'martelo', potencia: numero(mill[1]) }
  const mixer = text.match(/^(SILO\s+)?MISTURADOR\s+(VERTICAL|HORIZONTAL)\b/)
  if (mixer) {
    const litres = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:LITROS?|L)\b/)
    const kg = text.match(/\b(\d+(?:[.,]\d+)?)\s*KG\b/)
    return { familia: 'misturador', tipo: `${mixer[1] ? 'silo-' : ''}${mixer[2]}`, ...(litres ? { litros: numero(litres[1]) } : {}), ...(kg ? { kg: numero(kg[1]) } : {}) }
  }
  const elevator = text.match(/^ELEVADOR(?:\s+DE)?\s+CANECAS?\s+(\d{4})\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*M\b/)
  if (elevator) return { familia: 'elevador', tipo: elevator[1], comprimento: numero(elevator[2]) }
  if (/^CACAMBA\s+(?:DE\s+)?PESAGEM\b/.test(text)) {
    const litres = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:LITROS?|L)\b/)
    const kg = text.match(/\b(\d+(?:[.,]\d+)?)\s*KG\b/)
    return { familia: 'cacamba', tipo: 'pesagem', ...(litres ? { litros: numero(litres[1]) } : {}), ...(kg ? { kg: numero(kg[1]) } : {}) }
  }
  return null
}

function mesmoValor(a: number | undefined, b: number | undefined): boolean {
  return a === b
}

/** Only labelled nominal dimensions or literal L/kg capacities refine identity.
 * Motor CV, weight, production rates and CAD envelopes are not nominal measures.
 */
function refinarEspecificacoes(identity: Identidade, specifications: readonly string[]): Identidade | null {
  if (identity.familia !== 'transportador' && identity.familia !== 'misturador' && identity.familia !== 'cacamba') return identity
  const refined = { ...identity }
  for (const detail of especificacoesComerciais(specifications)) {
    const text = normalizar(detail)
    if (identity.familia === 'transportador') {
      const dimension = text.match(/^(DIAMETRO|COMPRIMENTO)(?:\s+NOMINAL)?\s*:?\s*[Ø]?\s*(\d+(?:[.,]\d+)?)\s*(MM|METROS?|M)\b/)
      if (dimension) {
        const field = dimension[1] === 'DIAMETRO' ? 'diametro' : 'comprimento'
        const value = numero(dimension[2])
        const measure = field === 'diametro' ? (dimension[3] === 'MM' ? value : value * 1000) : (dimension[3] === 'MM' ? value / 1000 : value)
        if (refined[field] !== undefined && !mesmoValor(refined[field], measure)) return null
        refined[field] = measure
      }
      continue
    }
    for (const value of text.matchAll(/(?:^|[(;/·])\s*(?:(?:CAPACIDADE(?:\s+(?:NOMINAL|UTIL|DE))?|VOLUME(?:\s+NOMINAL)?)\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*(LITROS?|L|KG)\b(?!\s*\/\s*(?:H\b|HORA))/g)) {
      const field = value[2] === 'KG' ? 'kg' : 'litros'
      const capacity = numero(value[1])
      if (refined[field] !== undefined && !mesmoValor(refined[field], capacity)) return null
      refined[field] = capacity
    }
  }
  return refined
}

function candidatoIdentidade(item: CatalogoItem): Identidade | null {
  const names = [item.nome_curto, item.nome_completo].filter(Boolean)
  const identities = names.map(identidade).filter((value): value is Identidade => value !== null)
  const size = normalizar(item.tamanho_codigo ?? '').match(/^(HELICOIDAL|TH)_(\d{2,3})X(\d+(?:[.,]\d+)?)$/)
  if (size) identities.push({ familia: 'transportador', tipo: size[1] === 'TH' ? 'calha' : 'tubular', diametro: numero(size[2]), comprimento: numero(size[3]) })
  if (!identities.length) return null
  const first = { ...identities[0] }
  for (const other of identities.slice(1)) {
    if (other.familia !== first.familia || other.tipo !== first.tipo) return null
    for (const field of ['diametro', 'comprimento', 'potencia', 'litros', 'kg'] as const) {
      if (other[field] !== undefined && first[field] !== undefined && !mesmoValor(other[field], first[field])) return null
      if (other[field] !== undefined) first[field] = other[field]
    }
  }
  if (first.familia === 'misturador' || first.familia === 'cacamba') {
    for (const [field, explicit] of [['litros', item.capacidade_litros], ['kg', item.capacidade_kg]] as const) {
      const capacity = Number(explicit)
      if (explicit != null && Number.isFinite(capacity) && capacity > 0) {
        if (first[field] !== undefined && !mesmoValor(first[field], capacity)) return null
        first[field] = capacity
      }
    }
  }
  return refinarEspecificacoes(first, item.specs ?? [])
}

function compativel(source: Identidade, candidate: Identidade): boolean {
  if (source.familia !== candidate.familia || source.tipo !== candidate.tipo) return false
  if ((source.familia === 'misturador' || source.familia === 'cacamba') && source.litros === undefined && source.kg === undefined) return false
  return (['diametro', 'comprimento', 'potencia', 'litros', 'kg'] as const).every(field => source[field] === undefined || mesmoValor(source[field], candidate[field]))
}

function categoriaCompativel(identity: Identidade, item: CatalogoItem): boolean {
  const allowed = { transportador: ['TRANSPORTADOR'], moinho: ['MOINHO'], misturador: ['MISTURADOR'], elevador: ['ELEVADOR'], cacamba: ['CACAMBA', 'CACAMBA_PESAGEM', 'CACAMBA DE PESAGEM'] }
  return allowed[identity.familia].includes(normalizar(item.categoria))
}

function medidaMoega(specifications: readonly string[], field: 'COMPRIMENTO' | 'LARGURA', expected: number): boolean {
  const expression = new RegExp(`^${field}\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:METROS?|M)\\b`)
  const values = specifications.map(detail => normalizar(detail).match(expression)).filter(value => value !== null).map(value => numero(value![1]))
  return values.length > 0 && values.every(value => value === expected)
}

/** Display alias for the exact live 3 x 1 m unloading-hopper record, without
 * mutating the raw catalog or assigning a historical product id or price.
 */
export function nomeComercialMoegaDescarga(item: CatalogoItem): string | null {
  const completeName = normalizar(item.nome_completo ?? '')
  const completeMeasures = [...completeName.matchAll(/\b(\d+(?:[.,]\d+)?)\s*[X×]\s*(\d+(?:[.,]\d+)?)(?![\d.,])/g)]
  if (item.ativo !== true || item.is_oficial !== true || normalizar(item.categoria) !== 'MOEGA'
    || tituloExato(item.nome_curto) !== tituloExato('CAIXA ENTRADA MOEGA COM HELICODE')
    || conjunto(completeName) || /\b(?:SEM\s+|S\s*\/\s*)GRADE\b/.test(completeName)
    || completeMeasures.some(measure => numero(measure[1]) !== 3 || numero(measure[2]) !== 1)
    || !medidaMoega(item.specs ?? [], 'COMPRIMENTO', 3)
    || !medidaMoega(item.specs ?? [], 'LARGURA', 1)
    || variantes(normalizar(`${item.nome_curto} ${item.nome_completo ?? ''} ${detalhesParaVariantes(item.specs ?? [])}`)) !== '') return null
  return 'MOEGA DE DESCARGA 3 X 1 M'
}

/** Return the current catalog record only for one unambiguous commercial identity.
 * No prices, product ids, kg/litre conversions or CAD bounding boxes are inferred.
 */
export function encontrarCatalogoProjeto3D(line: LinhaProjeto3D, catalogo: readonly CatalogoItem[]): CatalogoItem | null {
  const origin = line.origem_projeto3d
  if (!origin || origin.resolution !== 'pendente' || origin.kind !== 'equipment' || !origin.catalogId || origin.catalogId.startsWith('custom_') || origin.catalogId === 'branorte_650_012_01alt2_moinho_martelo_75cv_com_base') return null
  const name = origin.sourceName.trim()
  const sourceName = normalizar(name)
  if (!sourceName || conjunto(sourceName) || /EXTERNAS\s+L|L\s*[X×]\s*P\s*[X×]\s*A/.test(sourceName)) return null
  const titleIdentity = identidade(name)
  const source = titleIdentity && refinarEspecificacoes(titleIdentity, origin.sourceSpecifications)
  if (titleIdentity && !source) return null
  // Legacy user labels can retain the old CAD length while this source detail
  // carries the current commercial identity. Conflicting evidence stays pending.
  if (source && origin.sourceSpecifications.some(detail => {
    const declaredName = normalizar(detail).match(/^EQUIPAMENTO\s*:\s*(.+)$/)?.[1]
    const declared = declaredName ? identidade(declaredName) : null
    return declared !== null && (declared.familia !== source.familia || declared.tipo !== source.tipo
      || (['diametro', 'comprimento', 'potencia', 'litros', 'kg'] as const).some(field =>
        source[field] !== undefined && declared[field] !== undefined && !mesmoValor(source[field], declared[field])))
  })) return null
  // A family name without an explicit size/capacity is not a commercial identity.
  if (!source && /^(?:TRANSPORTADOR|CHUPIM|CALHA|TH\b|MOINHO|TRITURADOR|MISTURADOR|SILO MISTURADOR|ELEVADOR|CACAMBA)/.test(sourceName)) return null
  const sourceVariants = variantes(normalizar(`${name} ${detalhesParaVariantes(origin.sourceSpecifications)}`))
  if (sourceVariants === null) return null
  // This exact CAD was identified by Daniel as the 3 x 1 m graded unloading
  // hopper. Its live quotation record retains the old "caixa entrada" title.
  // Match the current record by that verified title plus both nominal measures;
  // neither its historical id/price nor the external CAD envelope is evidence.
  const moegaDescargaPadrao = origin.catalogId === 'branorte_mg_moega_ext_3x1m_paraf'
    && tituloExato(name) === 'MOEGA DE DESCARGA 3 X 1 M'
    && origin.sourceSpecifications.some(detail => normalizar(detail) === 'COM GRADE')
  if (moegaDescargaPadrao) {
    const matches = sourceVariants === '' ? catalogo.filter(item => nomeComercialMoegaDescarga(item) !== null) : []
    return matches.length === 1 ? matches[0] : null
  }
  const matches = catalogo.filter(item => {
    if (item.ativo !== true || item.is_oficial !== true) return false
    const candidateName = normalizar([item.nome_curto, item.nome_completo].filter(Boolean).join(' '))
    if (conjunto(candidateName) || variantes(normalizar(`${candidateName} ${detalhesParaVariantes(item.specs ?? [])}`)) !== sourceVariants) return false
    if (source) {
      const candidate = candidatoIdentidade(item)
      return candidate !== null && categoriaCompativel(source, item) && compativel(source, candidate)
    }
    if (/^(?:CAIXA\b|CX\.(?=\s|\d))/.test(sourceName) && !/\bMOEGA\b/.test(sourceName) && normalizar(item.categoria) !== 'CAIXA') return false
    return [item.nome_curto, item.nome_completo].some(value => value && tituloExato(value) === tituloExato(name))
  })
  return matches.length === 1 ? matches[0] : null
}
