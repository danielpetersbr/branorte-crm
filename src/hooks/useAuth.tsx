import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  role: 'admin' | 'vendor' | 'marketing' | 'visualizador' | 'mapa' | 'pending' | 'rejected'
  vendor_id: string | null
  approved_at: string | null
}

export interface AuthState {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  // true quando a query do profile falhou (timeout/erro) após retries.
  // Distingue "não consegui carregar" de "carregou e não está aprovado".
  profileError: boolean
}

type AuthContextValue = AuthState & { signOut: () => Promise<void> }

const AuthContext = createContext<AuthContextValue | null>(null)

// Provider único — fica no topo do app, executa getSession()/profile fetch UMA vez.
// Todas as chamadas a useAuth() compartilham o mesmo estado, sem refetch ao trocar de página.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)

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
      setProfileError(false)
      return
    }
    let cancel = false
    // Só mostra full-page loading se ainda não temos profile (primeiro load).
    setProfile(prev => {
      if (!prev || prev.id !== userId) setLoading(true)
      return prev
    })
    setProfileError(false)

    // Cada tentativa é limitada por tempo: o supabase-js pode TRAVAR (não rejeitar)
    // quando o Supabase está sob carga. Sem isso, o usuário fica preso no spinner.
    const withTimeout = <T,>(p: PromiseLike<T>, ms: number): Promise<T> =>
      Promise.race([
        Promise.resolve(p),
        new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('profile-timeout')), ms)),
      ])

    const fetchProfile = async () => {
      for (let attempt = 0; attempt < 3 && !cancel; attempt++) {
        try {
          const { data, error } = await withTimeout(
            supabase
              .from('user_profiles')
              .select('id,email,display_name,role,vendor_id,approved_at')
              .eq('id', userId)
              .maybeSingle(),
            6000,
          )
          if (cancel) return
          if (error) throw error
          // Resposta definitiva (data pode ser null = sem perfil de verdade → /pendente)
          setProfile(data as UserProfile | null)
          setProfileError(false)
          setLoading(false)
          return
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[useAuth] profile fetch attempt ${attempt + 1} falhou:`, err)
          if (attempt < 2 && !cancel) {
            await new Promise(r => window.setTimeout(r, 800 * (attempt + 1)))
          }
        }
      }
      if (cancel) return
      // Falhou após retries: NÃO assumir "não aprovado". Sinaliza erro pra UI
      // mostrar tela de reconexão (não a tela de "Aguardando aprovação").
      setProfileError(true)
      setLoading(false)
    }
    fetchProfile()

    return () => {
      cancel = true
    }
  }, [userId])

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileError, signOut }}>
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
