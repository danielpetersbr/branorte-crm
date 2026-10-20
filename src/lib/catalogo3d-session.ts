type CatalogSession = { user: { id: string }; access_token: string; expires_at?: number }
type CatalogProfile = { id: string; role: string; approved_at: string | null }
type CatalogRequest = { origin: string; source: unknown; data: unknown }
type CatalogReply = { type: 'branorte:catalog:session:result'; requestId: string; accessToken: string | null }

export const CONFIGURADOR_ORIGIN = 'https://branorte-configurador-3d.vercel.app'
// O catálogo do configurador pede a sessão com postMessage endereçado a ESTE
// origin. Aberto por branorte-crm.vercel.app, o pedido é descartado pelo
// navegador e o catálogo cai em "Acesso restrito" (e o botão dele some).
export const CRM_ORIGIN_CATALOGO = 'https://sistema.mbranorte.com.br'
const CATALOGO_OWNER_ID = '9cf979c3-17cc-4aee-b692-ff9d1eea5540'

/** Só a conta dona do catálogo vê o atalho da biblioteca de blocos. */
export function podeVerCatalogo3d(profile: CatalogProfile | null): boolean {
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
