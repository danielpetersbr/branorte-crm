import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { atualizarNomePerfilAtual } from '@/lib/profile-display-name'
import type { Session } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  // 'mapa' e 'consultor' são papéis de ACESSO RESTRITO: não estão em
  // ASSIGNABLE_ROLES nem em role_permissions (useCan() é sempre false pra eles).
  // Quem libera tela é ROTAS_RESTRITAS no App.tsx + MENUS_RESTRITOS no Layout.
  // Espelha o CHECK user_profiles_role_check no banco.
  role: 'admin' | 'vendor' | 'marketing' | 'visualizador' | 'mapa' | 'mapa_visual' | 'consultor' | 'representante' | 'pending' | 'rejected'
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

type AuthContextValue = AuthState & { signOut: () => Promise<void>; retryProfile: () => void; updateDisplayName: (confirmedId: string, displayName: string) => void }

const AuthContext = createContext<AuthContextValue | null>(null)

// Provider único — fica no topo do app, executa getSession()/profile fetch UMA vez.
// Todas as chamadas a useAuth() compartilham o mesmo estado, sem refetch ao trocar de página.
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const identity = useRef<string | null>(null)
  const profileRequest = useRef<{ userId: string; controller: AbortController } | null>(null)
  const profileStatus = useRef<'pending' | 'failed' | 'ready'>('pending')
  const sessionToken = useRef<string | null>(null)
  const signOutPending = useRef(false)
  const profileLoadDeferred = useRef(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)
  const [profileLoadGeneration, setProfileLoadGeneration] = useState(0)

  const retryProfile = () => {
    if (signOutPending.current || !identity.current || profileStatus.current !== 'failed') return
    profileStatus.current = 'pending'
    setProfileError(false)
    setLoading(true)
    setProfileLoadGeneration(current => current + 1)
  }

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
      const nextId = sess?.user.id ?? null
      const nextToken = sess?.access_token ?? null
      const tokenChanged = !!nextToken && sessionToken.current !== nextToken
      if (nextToken || !sess) sessionToken.current = nextToken
      if (identity.current !== nextId) {
        // INITIAL_SESSION pode chegar depois da carga iniciada por getSession.
        // Preserva também seu resultado ou erro se já pertencem à mesma conta.
        if (profileRequest.current?.userId !== nextId) {
          if (signOutPending.current) profileLoadDeferred.current = true
          profileRequest.current?.controller.abort()
          profileStatus.current = 'pending'
          setProfile(null)
          setProfileError(false)
          setLoading(!!nextId)
        }
        // Limpa também logout em outra aba e troca direta de conta. Não limpar
        // em TOKEN_REFRESHED: a identidade e a carteira continuam as mesmas.
        queryClient.clear()
        identity.current = nextId
      } else if (!signOutPending.current && tokenChanged && (_evt === 'TOKEN_REFRESHED' || _evt === 'SIGNED_IN')) {
        // Retoma só uma carga que falhou. Perfil confirmado e eventos com o
        // mesmo token não refazem consultas nem criam uma sequência de retries.
        retryProfile()
      }
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
  }, [queryClient])

  // Carrega ao mudar a identidade ou solicitar retomada de uma carga que falhou.
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (signOutPending.current) {
      profileLoadDeferred.current = true
      return
    }
    if (!userId) {
      profileStatus.current = 'pending'
      setProfile(null)
      setProfileError(false)
      return
    }
    const lifecycle = new AbortController()
    profileRequest.current = { userId, controller: lifecycle }
    profileStatus.current = 'pending'
    // Só mostra full-page loading se ainda não temos profile (primeiro load).
    setProfile(prev => {
      if (!prev || prev.id !== userId) setLoading(true)
      return prev
    })
    setProfileError(false)

    // O prazo inclui a espera interna de sessão do SDK. Além de encerrar a
    // espera da UI, aborta o transporte antes de iniciar a próxima tentativa.
    const withTimeout = async <T,>(request: (signal: AbortSignal) => PromiseLike<T>, ms: number): Promise<T> => {
      if (lifecycle.signal.aborted) throw new Error('profile-cancelled')
      const controller = new AbortController()
      let rejectInterrupted!: (error: Error) => void
      const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject })
      const timer = window.setTimeout(() => {
        controller.abort()
        rejectInterrupted(new Error('profile-timeout'))
      }, ms)
      const abort = () => {
        window.clearTimeout(timer)
        controller.abort()
        rejectInterrupted(new Error('profile-cancelled'))
      }
      lifecycle.signal.addEventListener('abort', abort, { once: true })
      if (lifecycle.signal.aborted) abort()
      try {
        return await Promise.race([Promise.resolve(request(controller.signal)), interrupted])
      } finally {
        window.clearTimeout(timer)
        lifecycle.signal.removeEventListener('abort', abort)
      }
    }

    const backoff = (ms: number) => new Promise<void>(resolve => {
      const finish = () => {
        window.clearTimeout(timer)
        lifecycle.signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = window.setTimeout(finish, ms)
      lifecycle.signal.addEventListener('abort', finish, { once: true })
      if (lifecycle.signal.aborted) finish()
    })

    const fetchProfile = async () => {
      for (let attempt = 0; attempt < 3 && !lifecycle.signal.aborted; attempt++) {
        try {
          const { data, error } = await withTimeout(
            signal => supabase
              .from('user_profiles')
              .select('id,email,display_name,role,vendor_id,approved_at')
              .eq('id', userId)
              .maybeSingle()
              .abortSignal(signal),
            6000,
          )
          if (lifecycle.signal.aborted) return
          if (error) throw error
          // Resposta definitiva (data pode ser null = sem perfil de verdade → /pendente)
          profileStatus.current = 'ready'
          setProfile(data as UserProfile | null)
          setProfileError(false)
          setLoading(false)
          return
        } catch (err) {
          if (lifecycle.signal.aborted) return
          // eslint-disable-next-line no-console
          console.error(`[useAuth] profile fetch attempt ${attempt + 1} falhou:`, err)
          if (attempt < 2 && !lifecycle.signal.aborted) {
            await backoff(800 * (attempt + 1))
          }
        }
      }
      if (lifecycle.signal.aborted) return
      // Falhou após retries: NÃO assumir "não aprovado". Sinaliza erro pra UI
      // mostrar tela de reconexão (não a tela de "Aguardando aprovação").
      profileStatus.current = 'failed'
      setProfileError(true)
      setLoading(false)
    }
    fetchProfile()

    return () => {
      lifecycle.abort()
      if (profileRequest.current?.controller === lifecycle) profileRequest.current = null
    }
  }, [userId, profileLoadGeneration])

  const signOut = async () => {
    if (signOutPending.current) return
    const signOutUserId = identity.current
    const wasReady = profileStatus.current === 'ready'
    profileLoadDeferred.current = false
    signOutPending.current = true
    profileStatus.current = 'pending'
    profileRequest.current?.controller.abort()
    try {
      await supabase.auth.signOut()
      queryClient.clear()
      identity.current = null
      setSession(null)
      setProfile(null)
      setProfileError(false)
      setLoading(false)
    } catch (error) {
      profileStatus.current = wasReady && identity.current === signOutUserId && !profileLoadDeferred.current ? 'ready' : 'failed'
      if (profileStatus.current === 'failed') setProfileError(true)
      setLoading(false)
      throw error
    } finally {
      signOutPending.current = false
      if (profileLoadDeferred.current) {
        profileLoadDeferred.current = false
        retryProfile()
      }
    }
  }

  const updateDisplayName = (confirmedId: string, displayName: string) => {
    setProfile(current => identity.current === confirmedId ? atualizarNomePerfilAtual(current, confirmedId, displayName) : current)
  }

  return (
    <AuthContext.Provider value={{ session, profile: profile?.id === userId ? profile : null, loading: loading || (!!userId && !!profile && profile.id !== userId), profileError, signOut, retryProfile, updateDisplayName }}>
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
