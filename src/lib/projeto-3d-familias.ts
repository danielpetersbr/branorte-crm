import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

type Identity = { family: string; model?: string; height?: number; rate?: number; kg?: number; litres?: number; role?: string; material: string; variants: string; brand?: string }
const norm = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const num = (value: string) => Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(?:\.\d{3})+$/.test(value) ? value.replace(/\./g, '') : value)
const numeric = '(\\d+(?:[.,]\\d+)*)'
const compound = (text: string) => /\+|\bFABRICA\b|\bCOMPACTA\b|CAIXA.*ENSACADEIRA|\b(?:SUPORTE|PORTA|BIG)\s*BAG\b|\bCONJ\.?\s*(?:BASE|ETTR)|\b(?:CABECA|MODULO|PLATAFORMA|SKIP)\b|\bPE\s+ELEVADOR\b/.test(text)
const nominalSpecs = (values: readonly string[]) => values.filter(value => !/REFER[EÊ]NCIA\s*3D|PROJETO\s+L|EXTERNAS\s+L|L\s*[X×]\s*P\s*[X×]\s*A/i.test(value))

function variants(text: string): string {
  return [...new Set(text.match(/\b(?:PARAF(?:USAD[OA])?|SOLD(?:AD[OA])?|SUPER\s+BAIXA|ADAPTACAO|ESPECIAL|SEM\s+MOTOR|ESCADA\s+INVERTIDA|GUARDA\s+CORPO|SEM\s+PE|S\s+PES|Q\d+|WALDEMAR|GILMARCIO|ELI\s+PONTES|ROSCA\s+(?:DE\s+)?DESCARGA|COM\s+ROSCA|\d+\s+SAIDAS?|\d+\s+DIVISORIAS?|SEM\s+DIVISORIA|FUNDO\s+PLANO|FUNIL\s+CONICO\s+\d+\s+GRAUS)\b/g) ?? [])].sort().join('|')
}

function parse(name: string, specifications: readonly string[], item?: CatalogoItem): Identity | null {
  const title = norm(name), specs = nominalSpecs(specifications).map(norm)
  const text = [title, ...specs].join(' ')
  if (!title || compound(title) || /EXTERNAS\s+L|L\s*[X×]\s*P\s*[X×]\s*A/.test(title)) return null
  const alloys = [...new Set([...text.matchAll(/\bINOX(?:\s*(304|316))?\b/g)].map(value => `INOX${value[1] ?? ''}`))]
  if (alloys.length > 1 || (alloys.length && /GALVANIZAD/.test(text))) return null
  const identity: Identity = { family: '', material: alloys[0] ?? (/\bPLASTICO\b/.test(text) ? 'PLASTICO' : /ACO\s+CARBONO/.test(text) ? 'CARBONO' : 'PADRAO'), variants: variants(text) }
  let conflict = false
  const set = (field: 'model' | 'height' | 'rate' | 'kg' | 'litres', value: string | number) => {
    if (identity[field] !== undefined && identity[field] !== value) conflict = true
    else Object.assign(identity, { [field]: value })
  }
  const rates = (value: string) => { for (const match of value.matchAll(new RegExp(`${numeric}\\s*(?:TON(?:ELADAS?)?|TN|T)\\s*\\/\\s*(?:H\\b|HORA)`, 'g'))) set('rate', num(match[1])) }
  const capacities = (value: string) => {
    for (const match of value.matchAll(new RegExp(`${numeric}\\s*(LITROS?|L|KG|M[³3]|TONELADAS?|TON|T)(?=\\s|$|[),;·])(?!\\s*\\/)`, 'g'))) {
      const unit = match[2], amount = num(match[1])
      set(unit === 'KG' || /^(?:TON|T$)/.test(unit) ? 'kg' : 'litres', amount * (/^(?:TON|T$)/.test(unit) ? 1000 : /^M/.test(unit) ? 1000 : 1))
    }
  }
  if (/^(?:ELEVADOR(?:\s+DE)?\s+CANECAS?\b|BNEC\s*\d{4})/.test(title)) {
    identity.family = 'ELEVADOR'
    for (const value of [title, ...specs]) {
      const direct = value.match(/^(?:ELEVADOR(?:\s+DE)?\s+CANECAS?\s+)(\d{4})\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*M\b/)
      if (direct) { set('model', direct[1]); set('height', num(direct[2])) }
      for (const match of value.matchAll(/\b(?:BNEC|EC)[ -]*(\d{4})(?:-(\d+(?:[.,]\d+)?))?\b/g)) {
        set('model', match[1]); if (value.startsWith('BNEC') && match[2]) set('height', num(match[2]))
      }
      const height = value.match(/^(?:ELEVADOR(?:\s+DE)?\s+CANECAS?\s+|ALTURA(?:\s+DE\s+ELEVACAO)?\s*:?\s*)(\d+(?:[.,]\d+)?)\s*(?:M\b|METROS?\b)/)
      if (height) set('height', num(height[1]))
      rates(value)
    }
    if (!identity.model || !identity.height) return null
  } else if (/^(?:MAQUINA\s+)?PRE[ -]?LIMPEZA\b/.test(title)) {
    identity.family = 'PRE_LIMPEZA'
    rates(title)
    const literal = title.match(/^PRE[ -]?LIMPEZA\s+(\d+(?:[.,]\d+)?)\s*(?:TON|T)\b/)
    if (literal) set('rate', num(literal[1]))
    for (const match of title.matchAll(/\bPL\s*(\d+(?:[.,]\d+)?)\s*T\b/g)) set('rate', num(match[1]))
    for (const spec of specs) if (/^CAPACIDADE\b/.test(spec)) rates(spec)
    if (!identity.rate) return null
  } else if (/^SILO\b/.test(title) && !/^SILO\s+MISTURADOR\b/.test(title)) {
    identity.family = 'SILO'
    capacities(title)
    const material = [...new Set(text.match(/\b(?:MILHO|RACAO|SOJA)\b/g) ?? [])]
    if (material.length !== 1) return null
    identity.role = material[0]
    identity.brand = title.match(/\b(?:GSI|PLASSON|AVIOESTE|BECKER|CASP|KEPLER|SAR\d+[A-Z0-9-]*|SAB\d+)\b/)?.[0]
  } else if (/^(?:CAIXA\b|CX\.?(?=\s|\d))/.test(title)) {
    identity.family = 'CAIXA'
    identity.role = /RACAO\s+PRONTA/.test(title) ? 'RACAO PRONTA' : /\bRACAO\b/.test(title) ? 'RACAO' : /\bPICADOS\b/.test(title) ? 'PICADOS' : /DOSAD|DOSAGEM|\bDOS\./.test(title) ? 'DOSADORA' : ''
    // Multiple nominal dimensions describe another box layout; capacity alone cannot prove it.
    if (/\d\s*[X×]\s*\d/.test(title) || /\d\s*[X×]\s*\d/.test(specs.join(' '))) return null
    capacities(title)
  } else if (/^ENSACADEIRA\b/.test(title)) {
    if (!/SEMI\s*AUTOMATICA/.test(title)) return null
    identity.family = 'ENSACADEIRA'
    identity.role = /VALVULAD/.test(text) ? 'VALVULADA' : 'SACO ABERTO'
    if (/AUTOMATICA/.test(title.replace(/SEMI\s*AUTOMATICA/g, ''))) return null
  } else return null
  if (identity.family === 'CAIXA' || identity.family === 'SILO') {
    for (const spec of specs) if (/^(?:CAPACIDADE|VOLUME)\b/.test(spec) || /^\d+(?:[.,]\d+)*\s*(?:M[³3]|LITROS?|L|KG|TONELADAS?|TON|T)(?=\s|$|[),;·])/.test(spec)) capacities(spec.replace(/\([^)]*\)/g, ''))
    for (const [field, value] of [['kg', item?.capacidade_kg], ['litres', item?.capacidade_litros]] as const) if (value != null && Number(value) > 0) set(field, Number(value))
    if (!identity.kg && !identity.litres) return null
    if (identity.family === 'SILO' && !identity.kg) return null
  }
  return conflict ? null : identity
}

/** Only literal current nominal identities participate; this never derives mass
 * from volume, substitutes bucket series, prices an assembly, or reads a CAD envelope. */
export function candidatosFamiliaProjeto3D(origin: OrigemProjeto3D, catalogo: readonly CatalogoItem[]): CatalogoItem[] {
  if (origin.kind !== 'equipment' || origin.resolution !== 'pendente' || !/^(?:branorte_|brn_)/.test(origin.catalogId ?? '')) return []
  const source = parse(origin.sourceName, origin.sourceSpecifications)
  if (!source) return []
  const conflicts = (a: Identity, b: Identity) => a.family !== b.family || a.material !== b.material || a.variants !== b.variants || a.role !== b.role
    || (['model', 'height', 'rate', 'kg', 'litres', 'brand'] as const).some(field => a[field] !== undefined && b[field] !== undefined && a[field] !== b[field])
  for (const specification of origin.sourceSpecifications) {
    const declared = norm(specification).match(/^EQUIPAMENTO\s*:\s*(.+)$/)?.[1]
    if (declared) { const other = parse(declared, []); if (!other || conflicts(source, other)) return [] }
  }
  const matches = catalogo.filter(item => {
    if (!item.ativo || !item.is_oficial || norm(item.categoria) !== source.family) return false
    const candidate = parse(item.nome_completo || item.nome_curto, item.specs ?? [], item)
    if (!candidate || candidate.family !== source.family || candidate.material !== source.material || candidate.variants !== source.variants || candidate.role !== source.role) return false
    const short = item.nome_curto && parse(item.nome_curto, item.specs ?? [], item)
    if (item.nome_curto && (!short || conflicts(candidate, short))) return false
    return (['model', 'height', 'rate', 'kg', 'litres', 'brand'] as const).every(field => source[field] === undefined || source[field] === candidate[field])
  })
  return matches
}
