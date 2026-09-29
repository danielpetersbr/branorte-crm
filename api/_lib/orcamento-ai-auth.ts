import type { SupabaseClient } from '@supabase/supabase-js'
// A regra de "conta aprovada" mora em exigir-aprovado.ts desde 29/09/2026 —
// os outros endpoints passaram a usar o mesmo portão, e duas cópias da regra
// iam divergir. Aqui só se adapta o formato que o orcamento-ai já consome.
import { exigirAprovado } from './exigir-aprovado.js'

export interface AuthenticatedSeller {
  userId: string
  email: string | null
  sellerId: number | null
  isAdmin: boolean
}

export type AuthenticationResult =
  | { ok: true; seller: AuthenticatedSeller }
  | { ok: false; status: 401 | 403 | 500; error: string }

export async function authenticateSeller(supabase: SupabaseClient, token: string): Promise<AuthenticationResult> {
  const r = await exigirAprovado(supabase, token)
  if (!r.ok) return { ok: false, status: r.status, error: r.error }
  return {
    ok: true,
    seller: {
      userId: r.usuario.userId,
      email: r.usuario.email,
      sellerId: r.usuario.vendorId,
      isAdmin: r.usuario.isAdmin,
    },
  }
}
