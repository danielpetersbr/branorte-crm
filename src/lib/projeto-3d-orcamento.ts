/** The CAD reference is provenance, never a commercial SKU or price-table FK. */
export interface Projeto3DOrcamentoItem {
  sourceId: string
  floorId: string
  floorName: string
  kind: 'equipment' | 'manual'
  catalogId: string | null
  sequence: number
  name: string
  quantity: number
  specifications: string[]
}

export interface Projeto3DOrcamentoPayload {
  version: 1
  exportId: string
  projectId: string
  projectName: string
  clientName: string
  /** CRM metadata only; the receiving CRM must verify the contact through its session. */
  contactId?: string | null
  items: Projeto3DOrcamentoItem[]
  /** Peças auxiliares ficam no bloco Acessórios, fora das linhas de equipamentos. */
  accessories?: Projeto3DOrcamentoItem[]
}

export interface OrigemAcessoriosProjeto3D {
  exportId: string
  projectId: string
  projectName: string
  items: Projeto3DOrcamentoItem[]
}

export interface AcessoriosProjeto3D {
  pct: number
  items: string[]
  valorFixo: number
  origem_projeto3d: OrigemAcessoriosProjeto3D
}

export interface OrigemProjeto3D {
  exportId: string
  projectId: string
  projectName: string
  floorId: string
  floorName: string
  sourceId: string
  kind: 'equipment' | 'manual'
  catalogId: string | null
  sequence: number
  sourceName: string
  sourceSpecifications: string[]
  resolution: 'pendente' | 'vinculado' | 'manual'
}

export interface CarrinhoProjeto3DItem {
  uid: string
  catalogo_id: number
  categoria: string
  nome: string
  specs: string[]
  qtd: number
  valor: number
  valor_original: number
  motor_cv: number | null
  motor_polos: number | null
  motor_qtd: number
  motor_valor_unit: number
  preco_branorte_id: number | null
  foto_url: string | null
  origem_projeto3d: OrigemProjeto3D
}

const STORAGE_PREFIX = 'branorte:projeto3d:orcamento:v1:'
const EXPORT_ID = /^[A-Za-z0-9_-]{12,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

function invalid(reason: string): never {
  throw new Error(`Dados do orçamento 3D inválidos: ${reason}.`)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('objeto obrigatório')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, maxLength = 2000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) invalid(`${field} inválido ou acima do limite`)
  return value
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field, 128)
  if (CONTROL_CHARACTERS.test(result)) invalid(`${field} inválido`)
  return result.trim()
}

/** Validate the entire transfer atomically; no row is silently removed or regrouped. */
export function parseProjeto3DOrcamentoPayload(value: unknown): Projeto3DOrcamentoPayload {
  const input = record(value)
  if (input.version !== 1) invalid('versão inválida')
  if (typeof input.exportId !== 'string' || !EXPORT_ID.test(input.exportId)) invalid('identificador da transferência inválido')
  const projectId = identifier(input.projectId, 'identificador do projeto')
  const projectName = text(input.projectName, 'nome do projeto', 2000, true)
  const clientName = text(input.clientName, 'nome do cliente', 500, true)
  if (input.contactId !== undefined && input.contactId !== null && (typeof input.contactId !== 'string' || !UUID.test(input.contactId))) invalid('identificador do cliente inválido')
  if (!Array.isArray(input.items) || (input.accessories !== undefined && !Array.isArray(input.accessories))) invalid('listas de itens e acessórios inválidas')
  const accessoryValues = (input.accessories ?? []) as unknown[]
  if ((!input.items.length && !accessoryValues.length) || input.items.length + accessoryValues.length > 2000) invalid('lista obrigatória, com limite combinado de 2000 linhas')
  const seen = new Set<string>()
  const parseItems = (values: unknown[], accessory = false) => Array.from(values, (value, index): Projeto3DOrcamentoItem => {
    const item = record(value)
    const sourceId = identifier(item.sourceId, 'identificador da peça')
    const floorId = identifier(item.floorId, 'identificador do piso')
    const floorName = text(item.floorName, 'nome do piso')
    if (item.kind !== 'equipment' && item.kind !== 'manual') invalid('tipo de item inválido')
    if (accessory && item.kind !== 'equipment') invalid('acessório deve ser uma peça de equipamento')
    const catalogId = item.catalogId === null ? null : identifier(item.catalogId, 'referência do catálogo')
    if (item.sequence !== index + 1) invalid('sequência global incoerente')
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) invalid('quantidade inválida')
    const name = text(item.name, 'nome do item')
    if (!Array.isArray(item.specifications) || item.specifications.length > 20) invalid('especificações inválidas ou acima do limite')
    const specifications = Array.from(item.specifications, specification => text(specification, 'especificação', 2000, true))
    const key = JSON.stringify([floorId, item.kind, sourceId])
    if (seen.has(key)) invalid('linha duplicada no mesmo piso e tipo')
    seen.add(key)
    return { sourceId, floorId, floorName, kind: item.kind, catalogId, sequence: index + 1, name, quantity: item.quantity, specifications }
  })
  const items = parseItems(input.items)
  const accessories = input.accessories === undefined ? undefined : parseItems(accessoryValues, true)
  return {
    version: 1, exportId: input.exportId, projectId, projectName: projectName.trim() ? projectName : 'Projeto 3D', clientName,
    ...(input.contactId !== undefined ? { contactId: input.contactId as string | null } : {}), items,
    ...(accessories !== undefined ? { accessories } : {}),
  }
}

/** Retain a validated snapshot for navigation and reload, with no inferred prices. */
export function saveProjeto3DOrcamentoTransfer(payload: Projeto3DOrcamentoPayload, storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  const validated = parseProjeto3DOrcamentoPayload(payload)
  const key = STORAGE_PREFIX + validated.exportId
  const serialized = JSON.stringify(validated)
  let existing: string | null
  try {
    existing = storage.getItem(key)
  } catch {
    throw new Error('Não foi possível acessar o armazenamento da transferência do orçamento 3D.')
  }
  if (existing !== null) {
    const previous = readProjeto3DOrcamentoTransfer(validated.exportId, storage)
    if (!previous || JSON.stringify(previous) !== serialized) throw new Error('O identificador desta transferência já foi usado com outros dados. Gere o orçamento novamente.')
    return validated.exportId
  }
  try {
    storage.setItem(key, serialized)
  } catch {
    throw new Error('Não foi possível salvar a transferência do orçamento 3D no armazenamento. Tente novamente.')
  }
  return validated.exportId
}

/** Read without consuming, so refresh and back navigation retain the source rows. */
export function readProjeto3DOrcamentoTransfer(token: string, storage: Pick<Storage, 'getItem'>): Projeto3DOrcamentoPayload | null {
  if (typeof token !== 'string' || !EXPORT_ID.test(token)) return null
  try {
    const raw = storage.getItem(STORAGE_PREFIX + token)
    if (raw === null) return null
    const payload = parseProjeto3DOrcamentoPayload(JSON.parse(raw))
    return payload.exportId === token ? payload : null
  } catch {
    return null
  }
}

/** Every transferred row starts pending; prices and commercial links come from CRM. */
export function materializeProjeto3DOrcamento(payload: Projeto3DOrcamentoPayload): CarrinhoProjeto3DItem[] {
  const validated = parseProjeto3DOrcamentoPayload(payload)
  return validated.items.map(item => ({
    uid: JSON.stringify([validated.exportId, item.floorId, item.kind, item.sourceId]),
    catalogo_id: -1, categoria: 'PROJETO3D', nome: item.name, specs: [...item.specifications], qtd: item.quantity,
    valor: 0, valor_original: 0, motor_cv: null, motor_polos: null, motor_qtd: 0, motor_valor_unit: 0,
    preco_branorte_id: null, foto_url: null,
    origem_projeto3d: {
      exportId: validated.exportId, projectId: validated.projectId, projectName: validated.projectName,
      floorId: item.floorId, floorName: item.floorName, sourceId: item.sourceId, kind: item.kind,
      catalogId: item.catalogId, sequence: item.sequence, sourceName: item.name,
      sourceSpecifications: [...item.specifications], resolution: 'pendente',
    },
  }))
}

/** Descriptive import only: the seller may later price the existing accessories block. */
export function materializeProjeto3DAcessorios(payload: Projeto3DOrcamentoPayload): AcessoriosProjeto3D | null {
  const validated = parseProjeto3DOrcamentoPayload(payload)
  if (!validated.accessories?.length) return null
  const floors = new Set([...validated.items, ...validated.accessories].map(item => item.floorId))
  return {
    pct: 0, valorFixo: 0,
    items: validated.accessories.map(item => [item.name, `Qtde: ${item.quantity}`, ...item.specifications, ...(floors.size > 1 ? [`Piso: ${item.floorName}`] : [])].join(' · ')),
    origem_projeto3d: { exportId: validated.exportId, projectId: validated.projectId, projectName: validated.projectName, items: validated.accessories },
  }
}
