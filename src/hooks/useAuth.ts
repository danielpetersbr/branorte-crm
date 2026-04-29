import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  role: 'admin' | 'vendor' | 'pending' | 'rejected'
  vendor_id: string | null
  approved_at: string | null
}

export interface AuthState {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
}

/**
 * Hook que mantém sessão Supabase Auth + carrega user_profile do logado.
 * Usado por App.tsx pra decidir guard (login, /pendente, app).
 */
export function useAuth(): AuthState & { signOut: () => Promise<void> } {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!mounted) return
      setSession(sess)
      if (!sess) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Carrega profile sempre que session muda
  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    let cancel = false
    setLoading(true)
    supabase
      .from('user_profiles')
      .select('id,email,display_name,role,vendor_id,approved_at')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancel) return
        setProfile(data as UserProfile | null)
        setLoading(false)
      })
    return () => { cancel = true }
  }, [session])

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  return { session, profile, loading, signOut }
}
