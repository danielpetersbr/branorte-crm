import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    setLoading(false)
    if (error) {
      setErr(error.message)
      return
    }
    setDone(true)
    setTimeout(() => nav('/login', { replace: true }), 2500)
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-sm bg-surface-1 border border-border rounded-2xl p-8 text-center">
          <h2 className="font-bold text-ink mb-2">Cadastro recebido!</h2>
          <p className="text-sm text-ink-muted">
            Aguarde um administrador aprovar seu acesso.
            Você receberá email de confirmação se necessário.
          </p>
          <p className="text-xs text-ink-faint mt-4">Redirecionando pro login...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-sm bg-surface-1 border border-border rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-md bg-accent flex items-center justify-center">
            <span className="text-white font-bold text-lg">B</span>
          </div>
          <div>
            <h1 className="font-bold text-ink">Criar conta</h1>
            <p className="text-xs text-ink-faint">Aguarda aprovação do admin</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-muted">Nome</span>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Senha (mínimo 6 chars)</span>
            <input
              type="password"
              required
              minLength={6}
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
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>
        <p className="text-xs text-ink-faint text-center mt-4">
          Já tem conta? <Link to="/login" className="text-accent hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  )
}
