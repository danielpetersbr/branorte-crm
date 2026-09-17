// Trilha de acesso: registra qual página o usuário abriu, de onde, e responde
// se ele está dentro da janela de horário permitida.
//
// Por que no servidor e não no browser:
//  1. A geolocalização vem de graça nos headers da Vercel (x-vercel-ip-*) — não
//     dá pra forjar do cliente e não custa API de geoIP.
//  2. O IP real só existe aqui.
//  3. A resposta `liberado` é decidida pelo banco (public.acesso_liberado), não
//     pelo front — o front só obedece. Quem barra de verdade é a RLS.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Headers de geo da Vercel vêm URL-encoded ("S%C3%A3o%20Paulo").
function h(req: VercelRequest, nome: string): string | null {
  const v = req.headers[nome]
  const s = Array.isArray(v) ? v[0] : v
  if (!s) return null
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function ipDoRequest(req: VercelRequest): string | null {
  const fwd = h(req, 'x-forwarded-for')
  if (!fwd) return null
  // x-forwarded-for pode vir com vários: o primeiro é o cliente.
  const primeiro = fwd.split(',')[0]?.trim()
  return primeiro || null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    // Fail-open: se o ambiente não está configurado, não é o registro de acesso
    // que vai derrubar o CRM inteiro.
    return res.status(200).json({ liberado: true, registrado: false, motivo: 'env_missing' })
  }

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt' })

  const body = (req.body || {}) as { rota?: string; plataforma?: string }
  const rota = String(body.rota || '').slice(0, 200)
  if (!rota) return res.status(400).json({ error: 'rota_obrigatoria' })

  // 1) O banco decide se pode. Fail-open se a chamada falhar.
  let liberado = true
  try {
    const { data, error } = await supa.rpc('acesso_liberado', {
      p_user: u.user.id,
      p_rota: rota,
    })
    if (!error && typeof data === 'boolean') liberado = data
  } catch {
    /* fail-open */
  }

  // 2) Registra a passagem (inclusive a tentativa bloqueada — é o que denuncia
  //    alguém tentando entrar fora de hora).
  const evento = {
    user_id: u.user.id,
    email: u.user.email ?? null,
    rota,
    ip: ipDoRequest(req),
    cidade: h(req, 'x-vercel-ip-city'),
    uf: h(req, 'x-vercel-ip-country-region'),
    pais: h(req, 'x-vercel-ip-country'),
    user_agent: (h(req, 'user-agent') || '').slice(0, 400) || null,
    plataforma: body.plataforma === 'mobile' ? 'mobile' : 'desktop',
    bloqueado: !liberado,
  }

  let registrado = true
  try {
    const { error } = await supa.from('acesso_eventos').insert(evento)
    if (error) registrado = false
  } catch {
    registrado = false
  }

  // 3) Quando bloqueia, devolve a janela pra tela poder dizer o horário — um
  //    bloqueio mudo vira chamado de suporte.
  let janela: { dias: number[]; hora_inicio: string; hora_fim: string } | null = null
  if (!liberado) {
    const { data } = await supa
      .from('acesso_janelas')
      .select('dias,hora_inicio,hora_fim,rota_prefixo')
      .eq('user_id', u.user.id)
      .eq('ativo', true)
    const aplicavel = (data || []).find(
      j => !j.rota_prefixo || rota.startsWith(j.rota_prefixo as string),
    )
    if (aplicavel) {
      janela = {
        dias: aplicavel.dias as number[],
        hora_inicio: aplicavel.hora_inicio as string,
        hora_fim: aplicavel.hora_fim as string,
      }
    }
  }

  return res.status(200).json({ liberado, registrado, janela })
}
