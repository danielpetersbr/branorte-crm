import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Pouso do SSO vindo do controle.branorte.com (Pedido de Venda).
// Recebe o token_hash do magic link no fragment (#th=...) e troca por
// sessão via verifyOtp — sem redirect do Supabase, sem allowlist de URL.
export function SsoLanding() {
  const [msg, setMsg] = useState('Entrando no CRM…')

  useEffect(() => {
    const th = new URLSearchParams(window.location.hash.slice(1)).get('th')
    if (!th) {
      setMsg('Link de acesso inválido. Use o botão do sistema principal.')
      return
    }
    supabase.auth
      .verifyOtp({ type: 'email', token_hash: th })
      .then(({ error }) => {
        if (error) {
          setMsg('Acesso expirado ou já utilizado. Volte ao sistema principal e clique de novo, ou faça login normal.')
        } else {
          // Reload limpo: AuthProvider pega a sessão do localStorage
          window.location.replace('/')
        }
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <div className="text-lg font-medium">{msg}</div>
        <div className="text-sm text-gray-500">Branorte CRM</div>
      </div>
    </div>
  )
}
