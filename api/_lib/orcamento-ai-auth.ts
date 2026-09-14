import type { SupabaseClient } from '@supabase/supabase-js'

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
  if (!token) return { ok: false, status: 401, error: 'no_auth' }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false, status: 401, error: 'invalid_jwt' }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role, approved_at, vendor_id')
    .eq('id', data.user.id)
    .maybeSingle()
  if (profileError) return { ok: false, status: 500, error: 'profile_lookup_failed' }
  if (!profile || !profile.approved_at || profile.role === 'pending' || profile.role === 'rejected') {
    return { ok: false, status: 403, error: 'not_approved' }
  }

  return {
    ok: true,
    seller: {
      userId: data.user.id,
      email: data.user.email ?? null,
      sellerId: typeof profile.vendor_id === 'number' ? profile.vendor_id : null,
      isAdmin: profile.role === 'admin' || profile.role === 'financeiro',
    },
  }
}
