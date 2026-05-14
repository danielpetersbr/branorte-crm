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
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!mounted) return
        setSession(data.session)
        if (!data.session) setLoading(false)
      })
      .catch(() => {
        if (!mounted) return
        setLoading(false)
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

  // Carrega profile só quando o user_id muda (evita refetch em TOKEN_REFRESHED/foco da aba).
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let cancel = false
    // Só mostra full-page loading se ainda não temos profile (primeiro load).
    // Refresh subsequente fica em background — não pisca tela.
    setProfile(prev => {
      if (!prev || prev.id !== userId) setLoading(true)
      return prev
    })
    // Timeout de 8s: se a query travar (rede ruim, RLS lenta), libera a UI mesmo assim.
    const timeoutId = window.setTimeout(() => {
      if (cancel) return
      setLoading(false)
    }, 8000)
    supabase
      .from('user_profiles')
      .select('id,email,display_name,role,vendor_id,approved_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancel) return
        window.clearTimeout(timeoutId)
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[useAuth] profile fetch error:', error)
        } else {
          setProfile(data as UserProfile | null)
        }
        setLoading(false)
      })
      .catch(err => {
        if (cancel) return
        window.clearTimeout(timeoutId)
        // eslint-disable-next-line no-console
        console.error('[useAuth] profile fetch threw:', err)
        setLoading(false)
      })
    return () => {
      cancel = true
      window.clearTimeout(timeoutId)
    }
  }, [userId])

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  return { session, profile, loading, signOut }
}
