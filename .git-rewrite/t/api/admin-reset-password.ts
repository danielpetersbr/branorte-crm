// Vercel serverless — admin reseta senha de outro usuário via service role.
// Requer JWT de admin no header Authorization.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // Verificar JWT do caller
  const auth = req.headers.authorization?.replace('Bearer ', '')
  if (!auth) return res.status(401).json({ error: 'Missing token' })

  const supa = createClient(SUPA_URL, SVC_KEY)

  // Verificar que caller é admin
  const { data: { user: caller }, error: authErr } = await supa.auth.getUser(auth)
  if (authErr || !caller) return res.status(401).json({ error: 'Invalid token' })

  const { data: callerProfile } = await supa
    .from('user_profiles')
    .select('role')
    .eq('id', caller.id)
    .maybeSingle()

  if (callerProfile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' })
  }

  // Pegar params
  const { user_id, new_password } = req.body || {}
  if (!user_id || !new_password) {
    return res.status(400).json({ error: 'user_id and new_password required' })
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  // Resetar senha via admin API
  const { error: updErr } = await supa.auth.admin.updateUserById(user_id, {
    password: new_password,
  })

  if (updErr) {
    return res.status(500).json({ error: updErr.message })
  }

  return res.status(200).json({ ok: true })
}
