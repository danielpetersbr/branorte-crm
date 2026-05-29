import { useRef, useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()
  const next = (loc.state as { from?: string })?.from ?? '/'
  // Throttle local — bloqueia tentativas em rajada antes de tocar o Supabase.
  // Após N falhas seguidas, exige cooldown crescente. Defesa adicional ao
  // rate-limit nativo do Supabase Auth (que só age após muitas requisições).
  const lastAttempt = useRef(0)
  const failedCount = useRef(0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)

    // Cooldown crescente: 1.5s base, +2s por falha (até 30s)
    const cooldownMs = Math.min(1500 + failedCount.current * 2000, 30_000)
    const elapsed = Date.now() - lastAttempt.current
    if (elapsed < cooldownMs) {
      const restante = Math.ceil((cooldownMs - elapsed) / 1000)
      setErr(`Aguarde ${restante}s antes de tentar novamente`)
      return
    }
    lastAttempt.current = Date.now()

    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      failedCount.current += 1
      // Mensagem genérica pra não confirmar existência da conta
      setErr(failedCount.current >= 3
        ? `Credenciais inválidas. Tente novamente em ${Math.ceil(cooldownMs/1000)}s.`
        : 'Credenciais inválidas')
      return
    }
    failedCount.current = 0
    nav(next, { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-sm bg-surface-1 border border-border rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-md bg-accent flex items-center justify-center">
            <span className="text-white font-bold text-lg">B</span>
          </div>
          <div>
            <h1 className="font-bold text-ink">Branorte CRM</h1>
            <p className="text-xs text-ink-faint">Entre com sua conta</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-muted">Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Senha</span>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-md bg-accent text-white font-medium hover:opacity-90 disabled:opacity-60 transition"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="text-xs text-ink-faint text-center mt-4">
          Sem conta? <Link to="/signup" className="text-accent hover:underline">Cadastre-se</Link>
        </p>
      </div>
    </div>
  )
}
