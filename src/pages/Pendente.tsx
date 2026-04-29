import { useAuth } from '@/hooks/useAuth'

export function Pendente() {
  const { profile, signOut } = useAuth()
  const isRejected = profile?.role === 'rejected'

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-8 text-center">
        <div className="h-12 w-12 rounded-full bg-amber-50 mx-auto flex items-center justify-center mb-4">
          <span className="text-amber-600 text-xl">⏳</span>
        </div>
        <h1 className="font-bold text-ink mb-2">
          {isRejected ? 'Acesso negado' : 'Aguardando aprovação'}
        </h1>
        <p className="text-sm text-ink-muted mb-1">
          {profile?.email}
        </p>
        <p className="text-sm text-ink-muted mb-6">
          {isRejected
            ? 'Seu cadastro foi rejeitado. Entre em contato com o administrador.'
            : 'Seu cadastro foi recebido e está aguardando aprovação de um administrador. Volta aqui em alguns minutos.'}
        </p>
        <button
          onClick={signOut}
          className="text-sm text-ink-faint hover:text-ink underline"
        >
          Sair
        </button>
      </div>
    </div>
  )
}
