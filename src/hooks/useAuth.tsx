import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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

type AuthContextValue = AuthState & { signOut: () => Promise<void> }

const AuthContext = createContext<AuthContextValue | null>(null)

// Provider único — fica no topo do app, executa getSession()/profile fetch UMA vez.
// Todas as chamadas a useAuth() compartilham o mesmo estado, sem refetch ao trocar de página.
export function AuthProvider({ children }: { children: ReactNode }) {
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
    setProfile(prev => {
      if (!prev || prev.id !== userId) setLoading(true)
      return prev
    })
    // Timeout de 8s: libera a UI se a query travar (rede ruim, RLS lenta).
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

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Consome o AuthContext. Lança erro se chamado fora do AuthProvider.
 * Todas as 14 chamadas espalhadas pelo app compartilham o mesmo estado.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
