import { useState, useEffect } from 'react'

const CORRECT_PASSWORD = 'Bn210408'
const STORAGE_KEY = 'branorte-crm-auth'

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved === 'true') {
      setAuthenticated(true)
    }
    setLoading(false)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password === CORRECT_PASSWORD) {
      sessionStorage.setItem(STORAGE_KEY, 'true')
      setAuthenticated(true)
      setError(false)
    } else {
      setError(true)
      setPassword('')
    }
  }

  if (loading) return null

  if (authenticated) return <>{children}</>

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="flex items-center justify-center mb-6">
          <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
            B
          </div>
        </div>
        <h1 className="text-xl font-bold text-center text-gray-900 mb-1">
          Branorte CRM
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          Digite a senha para acessar
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(false)
            }}
            placeholder="Senha"
            autoFocus
            className={`w-full px-4 py-3 rounded-lg border ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-200'
            } focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-center text-lg tracking-widest`}
          />
          {error && (
            <p className="text-red-500 text-sm text-center mt-2">
              Senha incorreta
            </p>
          )}
          <button
            type="submit"
            className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}