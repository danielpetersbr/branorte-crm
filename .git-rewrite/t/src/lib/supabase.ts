import { createClient } from '@supabase/supabase-js'

// Fallback temporário — env vars não estavam disponíveis no build do Vercel
// (rollback de e738c27 que quebrou prod). Voltar a remover depois de
// confirmar que Vite tem acesso a VITE_SUPABASE_URL/KEY no build.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://flwbeevtvjiouxdjmziv.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEwNDA2NzYsImV4cCI6MjA2NjYxNjY3Nn0.HLYYomR0p-4MQ39rlvOekjOIqpH96tWc_qZ4M1t1irA'

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
