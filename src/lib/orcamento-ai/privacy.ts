function digits(value: string): string { return value.replace(/\D/g, '') }

export function maskCpfCnpj(value: string): string {
  const raw = digits(value)
  if (raw.length > 11) return `**.***.***/****-${raw.slice(-2)}`
  return `***.***.***-${raw.slice(-2).padStart(2, '*')}`
}

export function maskPhone(value: string): string {
  const raw = digits(value)
  return `(**) *****-${raw.slice(-4).padStart(4, '*')}`
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split('@')
  if (!domain) return '***'
  return `${local?.slice(0, 1) || '*'}***@${domain}`
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const SAFE_ROOT_KEYS = new Set(['cliente', 'modelo', 'orcamentoId', 'proposalId', 'conversationId', 'eventType', 'status', 'totais', 'alertCodes', 'questions'])
const SAFE_NESTED_KEYS = new Set(['nome', 'cpfCnpj', 'cnpj', 'telefone', 'fone', 'email', 'cidade', 'uf', 'id', 'basename', 'master', 'voltagem', 'equipamentos', 'motores', 'acessorios', 'componentes', 'proposta', 'code', 'question'])

function clean(value: unknown, nested = false): Json | undefined {
  if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value as Json
  if (Array.isArray(value)) return value.map((item) => clean(item, true)).filter((item): item is Json => item !== undefined)
  if (typeof value !== 'object') return undefined
  const result: Record<string, Json> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!(nested ? SAFE_NESTED_KEYS : SAFE_ROOT_KEYS).has(key)) continue
    let next: Json | undefined
    if (key === 'cpfCnpj' || key === 'cnpj') next = maskCpfCnpj(String(item ?? ''))
    else if (key === 'telefone' || key === 'fone') next = maskPhone(String(item ?? ''))
    else if (key === 'email') next = maskEmail(String(item ?? ''))
    else next = clean(item, true)
    if (next !== undefined) result[key] = next
  }
  return result
}

export function sanitizeAuditPayload(payload: Record<string, unknown>): Record<string, Json> {
  return (clean(payload) ?? {}) as Record<string, Json>
}
