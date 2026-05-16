// Vercel serverless function — gera signed upload URLs para o cliente subir
// arquivos do orcamento direto pro Supabase Storage SEM passar por RLS.
//
// Por que: o upload client-side estava falhando silenciosamente (provavelmente
// JWT stale no PWA). Signed URLs eliminam essa dependencia — sao tokens
// curtos validos pra UM upload especifico.
//
// Fluxo:
//   1. Modal chama POST /api/orcamento-presign com { ano, mes, base, withWhatsApp }
//   2. Endpoint valida JWT do usuario
//   3. Retorna { docx: url, docxEditavel: url, pdf: url, txt: url, envio?: url }
//   4. Cliente faz PUT em paralelo pras URLs (Supabase aceita sem limite Vercel)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface PresignBody {
  ano: string         // '2026'
  mes: string         // '05'
  base: string        // '2026 - 0795 - Cliente (Descricao)'
  vendedor_nome?: string
  withWhatsApp: boolean
}

interface PresignedFile {
  path: string
  token: string  // upload token (signed)
  url: string    // URL absoluta pra PUT
}

interface PresignResponse {
  ok: true
  docx: PresignedFile
  docxEditavel: PresignedFile
  pdf: PresignedFile
  txt: PresignedFile
  envio?: PresignedFile  // so se withWhatsApp
}

async function makeSigned(supa: ReturnType<typeof createClient>, path: string): Promise<PresignedFile> {
  // Apaga arquivo anterior se existir (createSignedUploadUrl exige path livre)
  await supa.storage.from('orcamentos-pendentes').remove([path])
  const { data, error } = await supa.storage
    .from('orcamentos-pendentes')
    .createSignedUploadUrl(path)
  if (error || !data) throw new Error(`presign falhou pra ${path}: ${error?.message}`)
  // data.signedUrl ja vem absoluto; data.token e o param que vai no header
  return { path, token: data.token, url: data.signedUrl }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    return res.status(500).json({ error: 'env_missing' })
  }

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const body = req.body as PresignBody
  const ano = String(body?.ano || '').trim()
  const mes = String(body?.mes || '').trim()
  const base = String(body?.base || '').trim()
  if (!/^\d{4}$/.test(ano)) return res.status(400).json({ error: 'invalid_ano' })
  if (!/^(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ error: 'invalid_mes' })
  if (!base || base.length > 200) return res.status(400).json({ error: 'invalid_base' })

  const folder = `${ano}/${mes}`
  const vendedorNome = String(body?.vendedor_nome || 'Vendedor').trim().slice(0, 50)

  try {
    const [docx, docxEditavel, pdf, txt] = await Promise.all([
      makeSigned(supa, `${folder}/${base}.docx`),
      makeSigned(supa, `${folder}/${base} - EDITAVEL.docx`),
      makeSigned(supa, `${folder}/${base}.pdf`),
      makeSigned(supa, `${folder}/${base} - ${vendedorNome}.txt`),
    ])
    const result: PresignResponse = { ok: true, docx, docxEditavel, pdf, txt }

    if (body.withWhatsApp) {
      result.envio = await makeSigned(supa, `_envios/${folder}/${base}.pdf`)
    }
    return res.status(200).json(result)
  } catch (e) {
    console.error('[presign] error', e)
    return res.status(500).json({ error: 'presign_failed', detail: (e as Error).message })
  }
}
