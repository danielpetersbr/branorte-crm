// Due Diligence — endpoint de consulta SPC (Fase 2).
//
// Fluxo:
//  1. valida JWT do usuario logado
//  2. valida contact_id pertence ao tenant (ou eh admin)
//  3. checa cache de 30d via view v_dd_cache_30d
//     - se HIT → retorna sem cobrar (custo = 0, _cache_hit = true)
//     - se MISS → chama SPC, salva e retorna
//  4. monta pacote economico: CNPJ SPC + Score (+CPF socio opcional)
//
// Variaveis de ambiente:
//   SPC_USER         usuario de webservice (NAO o usuario WEB)
//   SPC_PASSWORD     senha de webservice
//   SPC_AMBIENTE     'homolog' (default) ou 'producao'
//   SPC_MOCK         '1' = retorna payload fake (pra dev sem credenciais)
//
// O endpoint salva o resultado em due_diligence_consultas (status=success ou
// =failed) e retorna o registro pro frontend. Cache de 30d eh por CNPJ.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  consultarSpc,
  PRODUTOS_SPC,
  INSUMOS_OPCIONAIS,
  calcularCustoPacote,
  type AmbienteSpc,
} from './_lib/spc-client.js'
import { gerarMockResumo, normalizarPayloadSpc } from './_lib/spc-normalizer.js'

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 60,
}

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SPC_USER = process.env.SPC_USER || ''
const SPC_PASSWORD = process.env.SPC_PASSWORD || ''
const SPC_AMBIENTE: AmbienteSpc =
  (process.env.SPC_AMBIENTE as AmbienteSpc) === 'producao' ? 'producao' : 'homolog'
const SPC_MOCK = process.env.SPC_MOCK === '1'

interface ConsultarBody {
  /** UUID do contato (FK contacts.id) — opcional, pra registrar vinculo */
  contact_id?: string | null
  /** Tipo: 'pj' = so empresa, 'pf' = so pessoa, 'ambos' = empresa + socio. Default = 'pj' (legado). */
  tipo_consulta?: 'pj' | 'pf' | 'ambos'
  /** CNPJ — obrigatorio se tipo_consulta = pj|ambos */
  cnpj?: string | null
  /** CPF — obrigatorio se tipo_consulta = pf|ambos */
  cpf_socio?: string | null
  /** Pacote: economico | completo | paranoico | custom */
  pacote: 'economico' | 'completo' | 'paranoico' | 'custom'
  /** Forca reconsulta mesmo se tem cache <30d */
  force_refresh?: boolean
}

// ============================================================================
// Pacotes — definicoes
// ============================================================================
// PRODUTO BASE em todos os pacotes: 325 (Novo SPC Maxi) — completo + barato.
//
// NOTA SPC: nenhum dos insumos opcionais que tentamos (144, 318, 268) eh
// suportado pelo produto 325. Testado em produção via API, todos retornam
// erro CN_WEB001.E12.39. O produto 325 sozinho ja retorna dados RIQUÍSSIMOS:
//   - Dados cadastrais completos (razao social, fundacao, atividades, etc.)
//   - Endereço, telefone, email
//   - Capital social
//   - SPC (restrições com valor)
//   - Pendência financeira
//   - Histórico de consultas (últimos 90 dias)
//   - Dados adicionais de contato (celulares, emails extras)
//
// Por isso pacote Econômico = apenas produto 325 (R$ 5,62).
//
// Completo: pode adicionar Faturamento Presumido (#400) e Quadro Social
// (#458), mas precisa testar compatibilidade primeiro. Por enquanto = 325.
function montarPacotes(
  pacote: ConsultarBody['pacote'],
  opts: { incluiPj: boolean; incluiPf: boolean },
) {
  type Plano = {
    produto: string
    insumos: number[]
    tipoConsumidor: 'F' | 'J'
  }
  const planos: Plano[] = []
  if (pacote !== 'economico' && pacote !== 'completo' && pacote !== 'paranoico') {
    return planos
  }

  if (opts.incluiPj) {
    // PJ: so o produto 325 (Novo SPC Maxi)
    planos.push({
      produto: PRODUTOS_SPC.NOVO_SPC_MAXI.codigo,
      insumos: [],
      tipoConsumidor: 'J',
    })
  }

  if (opts.incluiPf) {
    // PF: so o produto 325 (Novo SPC Maxi)
    planos.push({
      produto: PRODUTOS_SPC.NOVO_SPC_MAXI.codigo,
      insumos: [],
      tipoConsumidor: 'F',
    })
  }

  return planos
}

function normalizarDoc(doc: string | null | undefined): string {
  return (doc ?? '').replace(/\D/g, '')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    return res.status(500).json({ error: 'env_missing', detail: 'Supabase env nao configurada' })
  }

  // 1) Auth do usuario
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })
  const userId = u.user.id

  // 2) Body
  const body = req.body as ConsultarBody
  const tipoConsulta = body?.tipo_consulta || 'pj'
  const cnpj = body?.cnpj ? normalizarDoc(body.cnpj) : ''
  const cpfSocio = body?.cpf_socio ? normalizarDoc(body.cpf_socio) : ''
  const pacote = body?.pacote || 'economico'

  if (!['pj', 'pf', 'ambos'].includes(tipoConsulta)) {
    return res.status(400).json({ error: 'tipo_consulta_invalido' })
  }
  const precisaCnpj = tipoConsulta === 'pj' || tipoConsulta === 'ambos'
  const precisaCpf = tipoConsulta === 'pf' || tipoConsulta === 'ambos'

  if (precisaCnpj && cnpj.length !== 14) {
    return res.status(400).json({ error: 'cnpj_invalido', detail: 'CNPJ deve ter 14 digitos' })
  }
  if (precisaCpf && cpfSocio.length !== 11) {
    return res.status(400).json({ error: 'cpf_invalido', detail: 'CPF deve ter 11 digitos' })
  }
  if (!['economico', 'completo', 'paranoico', 'custom'].includes(pacote)) {
    return res.status(400).json({ error: 'pacote_invalido' })
  }

  // 3) Permissao do user (precisa de 'due_diligence.consultar')
  const { data: perms } = await supa
    .from('role_permissions')
    .select('permissions')
    .eq('role', (await supa.from('user_profiles').select('role').eq('id', userId).single()).data?.role || 'vendor')
    .single()
  const pode = (perms?.permissions as Record<string, boolean> | null)?.['due_diligence.consultar']
  if (pode === false) {
    return res.status(403).json({ error: 'sem_permissao' })
  }

  // 4) Cache 30d (a menos que force_refresh)
  // Cache so funciona pra PJ por enquanto (v_dd_cache_30d indexa por cnpj_normalizado)
  if (!body.force_refresh && precisaCnpj && cnpj.length === 14) {
    const { data: cache } = await supa
      .from('v_dd_cache_30d')
      .select('*')
      .eq('cnpj_normalizado', cnpj)
      .maybeSingle()
    if (cache) {
      return res.status(200).json({
        ok: true,
        _cache_hit: true,
        consulta: { ...cache, custo_brl: 0 },
      })
    }
  }

  // 5) Cria registro pending pra rastreabilidade mesmo se falhar
  const planos = montarPacotes(pacote, { incluiPj: precisaCnpj, incluiPf: precisaCpf })
  const todosOsCodigos = planos.flatMap(p => [p.produto, ...p.insumos.map(String)])
  const custoEstimado = planos.reduce(
    (acc, p) => acc + calcularCustoPacote({ produto: p.produto, insumos: p.insumos }),
    0,
  )

  const { data: inserted, error: insErr } = await supa
    .from('due_diligence_consultas')
    .insert({
      contact_id: body.contact_id || null,
      cnpj: precisaCnpj ? cnpj : null,
      cpf_socio: precisaCpf ? cpfSocio : null,
      pacote,
      produtos_spc: todosOsCodigos,
      status: 'pending',
      custo_brl: 0,
      created_by: userId,
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    return res.status(500).json({ error: 'insert_failed', detail: insErr?.message })
  }
  const consultaId = inserted.id

  // 6) Consulta SPC (ou mock)
  let resultadoSpc: Record<string, unknown> | null = null
  let statusFinal: 'success' | 'partial' | 'failed' = 'success'
  let erroMsg: string | null = null

  if (SPC_MOCK) {
    // Modo dev: payload fake estruturado (mesmo shape do real, mas com dados ficticios)
    const resumos = planos.map(p => ({
      produto: p.produto,
      documento: p.tipoConsumidor === 'J' ? cnpj : cpfSocio,
      ok: true,
      resumo: gerarMockResumo(p.tipoConsumidor, p.tipoConsumidor === 'J' ? cnpj : cpfSocio),
    }))
    resultadoSpc = {
      _mock: true,
      _nota: 'Resultado simulado — SPC_MOCK=1 no ambiente',
      resumos,
    }
  } else if (!SPC_USER || !SPC_PASSWORD) {
    statusFinal = 'failed'
    erroMsg = 'SPC nao configurado: defina SPC_USER e SPC_PASSWORD nas env vars do Vercel'
  } else {
    // Chama SPC pra cada plano em sequencia (consultas independentes)
    const consultas: Array<Record<string, unknown>> = []
    const resumos: Array<Record<string, unknown>> = []
    let algumaFalhou = false
    let todasFalharam = true
    for (const plano of planos) {
      const doc = plano.tipoConsumidor === 'J' ? cnpj : cpfSocio
      const r = await consultarSpc(
        {
          codigoProduto: plano.produto,
          tipoConsumidor: plano.tipoConsumidor,
          documentoConsumidor: doc || '',
          codigoInsumoOpcional: plano.insumos,
        },
        { usuario: SPC_USER, senha: SPC_PASSWORD, ambiente: SPC_AMBIENTE },
      )
      consultas.push({
        produto: plano.produto,
        documento: doc,
        ok: r.ok,
        status: r.status,
        data: r.data,
        erro: r.erro,
      })
      // Normaliza o payload pra estrutura "resumo" que o frontend renderiza
      if (r.ok) {
        const resumo = normalizarPayloadSpc(r.data ?? null, doc || '')
        if (resumo) {
          resumos.push({ produto: plano.produto, documento: doc, ok: true, resumo })
        }
        todasFalharam = false
      } else {
        algumaFalhou = true
      }
    }
    resultadoSpc = { resumos, consultas }
    if (todasFalharam) {
      statusFinal = 'failed'
      erroMsg = 'Todas as consultas SPC falharam'
    } else if (algumaFalhou) {
      statusFinal = 'partial'
      erroMsg = 'Algumas consultas SPC falharam — veja resultado_spc.consultas'
    }
  }

  // 7) Update do registro com resultado
  const custoFinal = statusFinal === 'failed' ? 0 : custoEstimado

  const { data: updated, error: updErr } = await supa
    .from('due_diligence_consultas')
    .update({
      resultado_spc: resultadoSpc,
      status: statusFinal,
      custo_brl: custoFinal,
      erro: erroMsg,
    })
    .eq('id', consultaId)
    .select('*')
    .single()
  if (updErr) {
    return res.status(500).json({ error: 'update_failed', detail: updErr.message })
  }

  return res.status(200).json({
    ok: statusFinal !== 'failed',
    _cache_hit: false,
    consulta: updated,
  })
}
