export interface RascunhoConta {
  userId: string
  input: unknown
  id: string | null
  codigo?: string
}

export function chaveRascunhoConta(base: string, userId: string): string {
  return `${base}:${encodeURIComponent(userId)}`
}

/** Legado só migra se o autor do ID salvo tiver sido confirmado pelo banco. */
export function lerRascunhoConta(raw: string | null, userId: string, verifiedCreatedBy?: string | null): RascunhoConta | null {
  if (!raw || !userId) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.input || typeof value.input !== 'object') return null
    if (value.id != null && (typeof value.id !== 'string' || !value.id.trim())) return null
    const ownId = Object.prototype.hasOwnProperty.call(value, 'userId')
    if (ownId ? value.userId !== userId : !(value.id && verifiedCreatedBy === userId)) return null
    return { userId, input: value.input, id: value.id ?? null, ...(typeof value.codigo === 'string' ? { codigo: value.codigo } : {}) }
  } catch { return null }
}

export async function restaurarRascunhoConta(scopedRaw: string | null, legacyRaw: string | null, userId: string, fetchCreatedBy: (id: string) => Promise<string | null>, timeoutMs = 6000): Promise<RascunhoConta | null> {
  const scoped = lerRascunhoConta(scopedRaw, userId)
  if (scoped) return scoped
  const identifiedLegacy = lerRascunhoConta(legacyRaw, userId)
  if (identifiedLegacy) return identifiedLegacy
  try {
    const legacy = JSON.parse(legacyRaw ?? 'null')
    if (!legacy || typeof legacy.id !== 'string' || !legacy.id.trim() || Object.prototype.hasOwnProperty.call(legacy, 'userId')) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const createdBy = await Promise.race([
        fetchCreatedBy(legacy.id),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('draft-author-timeout')), timeoutMs) }),
      ])
      return lerRascunhoConta(legacyRaw, userId, createdBy)
    } finally { if (timer !== undefined) clearTimeout(timer) }
  } catch { return null }
}
