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
//   3. Retorna { docx: url, pdf: url, txt: url, envio?: url }
//   4. Cliente faz PUT em paralelo pras URLs (Supabase aceita sem limite Vercel)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { exigirAprovado, exigirPermissaoDoPapel, nomeDeArquivoSeguro } from './_lib/exigir-aprovado.js'

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
  pdf: PresignedFile
  txt: PresignedFile
  envio?: PresignedFile  // so se withWhatsApp
}

async function makeSigned(supa: ReturnType<typeof createClient>, path: string): Promise<PresignedFile> {
  // SEM remove() antes (29/09/2026). Ele existia porque createSignedUploadUrl
  // sem upsert exige path livre — mas era um DELETE com service role, e no
  // bucket só admin apaga (policy orcamentos_pendentes_delete). Com isso qualquer
  // conta aprovada apagava o .docx/.pdf de outro orçamento e o
  // `_envios/AAAA/MM/<base>.pdf`, alvo do link de 7 dias que vai ao cliente.
  // `upsert: true` resolve o path ocupado (orçamento regerado com o mesmo nome)
  // sobrescrevendo na hora do PUT, sem apagar nada antes.
  const { data, error } = await supa.storage
    .from('orcamentos-pendentes')
    .createSignedUploadUrl(path, { upsert: true })
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
  // Conta APROVADA (29/09/2026): signup é público e nasce 'pending'. Este endpoint
  // assina upload no bucket com service role — não pode bastar JWT.
  const acesso = await exigirAprovado(supa, auth)
  if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error, detail: acesso.detail })
  // E o papel tem que MONTAR orçamento (orcamentos.criar = true: hoje admin,
  // vendor e marketing). Aprovado sozinho deixava visualizador/financeiro e os
  // papéis restritos (mapa, consultor, representante) — que a policy RESTRICTIVE
  // storage_bucket_interno_nao_e_pra_externo mantém fora deste bucket — gravarem
  // nele pela service role. Nenhum desses chega na tela /orcamentos/montar.
  const papel = await exigirPermissaoDoPapel(supa, acesso.usuario, 'orcamentos.criar')
  if (!papel.ok) return res.status(papel.status).json({ error: papel.error })

  const body = req.body as PresignBody
  const ano = String(body?.ano || '').trim()
  const mes = String(body?.mes || '').trim()
  const base = String(body?.base || '').trim()
  if (!/^\d{4}$/.test(ano)) return res.status(400).json({ error: 'invalid_ano' })
  if (!/^(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ error: 'invalid_mes' })
  // Sem '/', '\' nem caractere de controle (29/09/2026): com barra o base saía de
  // AAAA/MM e o upload assinado caía em qualquer pasta do bucket (_processados/,
  // outro mês). nomeBase() do front já tira essas barras, então nada legítimo cai.
  if (!base || base.length > 200 || !nomeDeArquivoSeguro(base)) {
    return res.status(400).json({ error: 'invalid_base' })
  }

  const folder = `${ano}/${mes}`
  // O nome do vendedor também entra no caminho do .txt: tira barra/controle em
  // vez de recusar (é nome de gente, não deve derrubar o upload do orçamento).
  const vendedorNome = String(body?.vendedor_nome || 'Vendedor')
    .replace(/[\\/\x00-\x1f\x7f]/g, '').trim().slice(0, 50) || 'Vendedor'

  try {
    const [docx, pdf, txt] = await Promise.all([
      makeSigned(supa, `${folder}/${base}.docx`),
      makeSigned(supa, `${folder}/${base}.pdf`),
      makeSigned(supa, `${folder}/${base} - ${vendedorNome}.txt`),
    ])
    const result: PresignResponse = { ok: true, docx, pdf, txt }

    if (body.withWhatsApp) {
      result.envio = await makeSigned(supa, `_envios/${folder}/${base}.pdf`)
    }
    return res.status(200).json(result)
  } catch (e) {
    console.error('[presign] error', e)
    return res.status(500).json({ error: 'presign_failed', detail: (e as Error).message })
  }
}
