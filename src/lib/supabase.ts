import { createClient } from '@supabase/supabase-js'

// Fallback temporário — env vars não estavam disponíveis no build do Vercel
// (rollback de e738c27 que quebrou prod). Voltar a remover depois de
// confirmar que Vite tem acesso a VITE_SUPABASE_URL/KEY no build.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://flwbeevtvjiouxdjmziv.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEwNDA2NzYsImV4cCI6MjA2NjYxNjY3Nn0.HLYYomR0p-4MQ39rlvOekjOIqpH96tWc_qZ4M1t1irA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Acesso ao schema "auditoria" (view `atendimentos_por_cliente` etc).
//
// ⚠️ Era um createClient SEPARADO com `persistSession: false` — ou seja, SEM a sessão do
// usuário. Todo request daqui saía como **anon**, e anon tem `statement_timeout = 3s`
// (authenticated tem 8s). O read do Dashboard (10,4k linhas em páginas de 2500) estourava
// esses 3 s sob carga e voltava 500 `57014 canceling statement due to statement timeout` —
// era isso que travava a tela no esqueleto (medido 06/08/2026).
//
// `supabase.schema()` reusa o MESMO client (mesma sessão, um só GoTrueClient — que era o
// motivo do client separado) e manda o JWT do usuário: papel `authenticated`, 8 s.
// Verificado antes de trocar: anon e authenticated enxergam as MESMAS 10.409 linhas da view,
// então nada muda no que a tela mostra. Só `.from()` e `.rpc()` são usados daqui.
export const supabaseAuditoria = supabase.schema('auditoria')
