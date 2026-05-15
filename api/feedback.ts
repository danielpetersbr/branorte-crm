// Vercel serverless function — insere feedback bypassando RLS via service role.
// Verifica JWT do Supabase no header Authorization pra garantir que e usuario
// logado (nao queremos endpoint anonimo aceitando spam).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export const config = {
  api: {
    bodyParser: { sizeLimit: '8mb' }, // screenshots podem ser grandes
  },
}

const SUPA_URL = process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!

interface FeedbackBody {
  tipo: 'bug' | 'sugestao' | 'melhoria'
  titulo: string
  descricao?: string | null
  url_origem?: string | null
  // Screenshot enviado como base64 (data URL ou raw base64). Servidor decodifica
  // e sobe pro bucket roadmap-screenshots via service role (bypass RLS).
  screenshot_base64?: string | null
  screenshot_mime?: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS basico (mesmo origin so, mas deixa pra preview/dev)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Valida usuario logado via JWT
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supaAuth = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supaAuth.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const body = req.body as FeedbackBody
  const tipo = body?.tipo
  const titulo = String(body?.titulo || '').trim()
  if (!tipo || !titulo) return res.status(400).json({ error: 'missing_fields' })
  if (!['bug', 'sugestao', 'melhoria'].includes(tipo)) return res.status(400).json({ error: 'invalid_tipo' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })

  // Upload do screenshot via service role (bypassa RLS de storage.objects).
  // Cliente nao consegue subir direto pq RLS bloqueia INSERT em storage.objects
  // mesmo com bucket public (public so afeta READ).
  let screenshot_url: string | null = null
  if (body.screenshot_base64) {
    try {
      const b64 = body.screenshot_base64.replace(/^data:[^;]+;base64,/, '')
      const buf = Buffer.from(b64, 'base64')
      const mime = body.screenshot_mime || 'image/png'
      const ext = mime.split('/')[1]?.toLowerCase() || 'png'
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supa.storage
        .from('roadmap-screenshots')
        .upload(path, buf, { contentType: mime, upsert: false })
      if (upErr) return res.status(500).json({ error: 'screenshot_upload_failed', detail: upErr.message })
      const { data: pub } = supa.storage.from('roadmap-screenshots').getPublicUrl(path)
      screenshot_url = pub.publicUrl
    } catch (e) {
      return res.status(400).json({ error: 'screenshot_decode_failed', detail: (e as Error).message })
    }
  }

  // Insert via service role (bypassa RLS)
  const { data, error } = await supa.from('roadmap_feedback').insert({
    tipo,
    titulo,
    descricao: body.descricao?.trim() || null,
    url_origem: body.url_origem || null,
    screenshot_url,
    criado_por: u.user.id,
    criado_por_nome: u.user.email || null,
  }).select('*').single()

  if (error) return res.status(500).json({ error: 'insert_failed', detail: error.message })
  return res.status(200).json({ ok: true, feedback: data })
}
