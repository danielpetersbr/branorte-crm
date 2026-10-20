type CatalogSession = { user: { id: string }; access_token: string; expires_at?: number }
type CatalogProfile = { id: string; role: string; approved_at: string | null }
type CatalogRequest = { origin: string; source: unknown; data: unknown }
type CatalogReply = { type: 'branorte:catalog:session:result'; requestId: string; accessToken: string | null }

export const CONFIGURADOR_ORIGIN = 'https://branorte-configurador-3d.vercel.app'
const CATALOGO_OWNER_ID = '9cf979c3-17cc-4aee-b692-ff9d1eea5540'

/** Menu "Blocos dos equipamentos": só a conta dona do catálogo (as outras cairiam no "Acesso restrito"). */
export function podeVerCatalogo3d(profile: CatalogProfile | null | undefined): boolean {
  return profile?.id === CATALOGO_OWNER_ID && profile.role === 'admin' && !!profile.approved_at
}

// Esta seleção evita compartilhar sessões da equipe. A autorização definitiva
// continua no servidor do configurador, que valida o JWT e a identidade.
export function catalogo3dAccessToken(session: CatalogSession | null, profile: CatalogProfile | null, now = Date.now()): string | null {
  if (session?.user.id !== CATALOGO_OWNER_ID || profile?.id !== CATALOGO_OWNER_ID
    || profile.role !== 'admin' || !profile.approved_at || !session.access_token
    || !Number.isFinite(session.expires_at) || session.expires_at! * 1000 <= now) return null
  return session.access_token
}

export function catalogo3dSessionReply(event: CatalogRequest, frameWindow: unknown, session: CatalogSession | null, profile: CatalogProfile | null, now = Date.now()): CatalogReply | null {
  if (!frameWindow || event.origin !== CONFIGURADOR_ORIGIN || event.source !== frameWindow) return null
  const data = event.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { type, requestId } = data as Record<string, unknown>
  if (type !== 'branorte:catalog:session' || typeof requestId !== 'string'
    || !requestId || requestId.length > 128 || requestId.trim() !== requestId) return null
  return { type: 'branorte:catalog:session:result', requestId, accessToken: catalogo3dAccessToken(session, profile, now) }
}
