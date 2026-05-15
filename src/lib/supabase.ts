import { createClient } from '@supabase/supabase-js'

// SEM fallback hardcoded — força configuração via env. Se Vercel/local não
// tiver VITE_SUPABASE_URL/KEY setados, a build/runtime falha cedo (visível)
// em vez de silenciosamente usar credenciais antigas após rotação.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios. Configure em Vercel > Settings > Environment Variables.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Cliente paralelo apontando para o schema "auditoria" (mesmas creds, view `atendimentos_por_cliente`).
// Auth desabilitado pra evitar warning "Multiple GoTrueClient instances" — esse client
// so faz queries; sessao vem do client principal acima.
export const supabaseAuditoria = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'auditoria' },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-flwbeevtvjiouxdjmziv-auth-token-auditoria',
  },
})
