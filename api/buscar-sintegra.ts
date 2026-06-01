// Consulta de Inscrição Estadual / Sintegra (cadastro de contribuinte).
// Esconde os tokens das APIs pagas server-side (padrão igual ao cpfcnpj/SPC).
//
// Estratégia:
//   - CNPJ        -> CNPJá (registrations). Se não vier IE e houver UF + Infosimples, faz fallback.
//   - IE ou CPF   -> Infosimples (CNPJá não aceita IE de entrada). Exige UF.
//
// Env vars (Vercel):
//   CNPJA_TOKEN                token da CNPJá (https://cnpja.com)            — opcional
//   INFOSIMPLES_TOKEN          token da Infosimples (https://infosimples.com) — opcional
//   SINTEGRA_MOCK=1            retorna payload fake pra dev sem tokens/sem auth
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   valida o JWT do usuário logado
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  consultarCnpja,
  consultarInfosimples,
  mockSintegra,
  type SintegraResult,
} from './_lib/sintegra-client.js'

export const config = { api: { bodyParser: { sizeLimit: '256kb' } }, maxDuration: 30 }

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const CNPJA_TOKEN = process.env.CNPJA_TOKEN || ''
const INFOSIMPLES_TOKEN = process.env.INFOSIMPLES_TOKEN || ''
const MOCK = process.env.SINTEGRA_MOCK === '1'

type Tipo = 'cnpj' | 'cpf' | 'ie'

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}
function detectarTipo(d: string): Tipo {
  if (d.length === 14) return 'cnpj'
  if (d.length === 11) return 'cpf'
  return 'ie'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Auth: exige JWT do usuário logado (evita abuso da API paga por URL pública).
  if (!MOCK) {
    if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing' })
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!auth) return res.status(401).json({ error: 'no_auth' })
    const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
    const { data: u, error } = await supa.auth.getUser(auth)
    if (error || !u?.user) return res.status(401).json({ error: 'invalid_jwt' })
  }

  const body = (req.body || {}) as { documento?: string; tipo?: Tipo; uf?: string }
  const d = digits(body.documento)
  if (d.length < 8) return res.status(400).json({ ok: false, error: 'documento_invalido' })
  const tipo: Tipo = body.tipo || detectarTipo(d)
  const uf = (body.uf || '').toUpperCase().slice(0, 2) || null

  if (MOCK) {
    const input = tipo === 'cnpj' ? { cnpj: d } : tipo === 'cpf' ? { cpf: d } : { ie: d }
    return res.status(200).json({ ok: true, resultado: mockSintegra({ ...input, uf: uf || undefined }) })
  }

  const temCnpja = !!CNPJA_TOKEN
  const temInfo = !!INFOSIMPLES_TOKEN
  if (!temCnpja && !temInfo) {
    return res.status(200).json({
      ok: false,
      configurado: false,
      error: 'tokens_ausentes',
      detail: 'Defina CNPJA_TOKEN e/ou INFOSIMPLES_TOKEN nas env vars do Vercel.',
    })
  }

  let resultado: SintegraResult | null = null
  const tentativas: string[] = []
  try {
    if (tipo === 'cnpj') {
      if (temCnpja) {
        tentativas.push('cnpja')
        resultado = await consultarCnpja(d, { token: CNPJA_TOKEN, uf })
      }
      // Fallback Infosimples se a CNPJá não trouxe IE (precisa UF).
      if ((!resultado || !resultado.ie) && temInfo && uf) {
        tentativas.push('infosimples')
        resultado = (await consultarInfosimples({ token: INFOSIMPLES_TOKEN, uf, cnpj: d })) || resultado
      }
    } else {
      // IE ou CPF -> só Infosimples (CNPJá não aceita IE de entrada). Exige UF.
      if (!uf) {
        return res.status(400).json({ ok: false, error: 'uf_obrigatoria', detail: 'Para buscar por IE/CPF informe a UF.' })
      }
      if (!temInfo) {
        return res.status(200).json({ ok: false, error: 'infosimples_ausente', detail: 'Busca por IE/CPF requer INFOSIMPLES_TOKEN.' })
      }
      tentativas.push('infosimples')
      const extra = tipo === 'cpf' ? { cpf: d } : { ie: d }
      resultado = await consultarInfosimples({ token: INFOSIMPLES_TOKEN, uf, ...extra })
    }
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'provedor_indisponivel', detail: (e as Error).message, tentativas })
  }

  if (!resultado) return res.status(200).json({ ok: false, error: 'nao_encontrado', tentativas })
  return res.status(200).json({ ok: true, resultado, tentativas })
}
