import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://flwbeevtvjiouxdjmziv.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEwNDA2NzYsImV4cCI6MjA2NjYxNjY3Nn0.HLYYomR0p-4MQ39rlvOekjOIqpH96tWc_qZ4M1t1irA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
