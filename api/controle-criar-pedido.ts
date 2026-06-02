// Vercel serverless — cria um PEDIDO DE VENDA direto no controle.branorte.com
// (Supabase kfucuvwrnwrkshxpsmyq) usando a service_role key DO CONTROLE.
//
// A service key NUNCA vai pro frontend: fica só aqui (env CONTROLE_SERVICE_KEY).
// O caller precisa estar logado no CRM (JWT validado via service key do CRM).
//
// Env vars (Vercel):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY    -> valida o JWT do usuário do CRM
//   CONTROLE_SUPABASE_URL (opcional)            -> default kfucuvwrnwrkshxpsmyq
//   CONTROLE_SERVICE_KEY (opcional)             -> service_role do controle, se algum dia a RLS apertar
//   CONTROLE_ANON_KEY    (opcional)             -> override da anon key (default = a pública do bundle)
//
// Hoje a RLS do controle permite anon INSERT/SELECT em pedidos_venda + RPC gerar_pedido_numero
// (verificado 2026-06-02). Então NÃO exige service_role: usa a anon key PÚBLICA (mesma do
// frontend controle.branorte.com — já exposta no bundle, não é segredo). O acesso ao endpoint
// continua travado por JWT do CRM (usuário logado + aprovado), que é a defesa real.
//
// Fluxo (tipo "simples", o insert mínimo válido da spec):
//   1) RPC gerar_pedido_numero(p_data) -> PV-YYYY-NNNN
//   2) INSERT pedidos_venda (colunas NOT NULL preenchidas; arquivo_url='')
//   3) cria producao_pedidos no 1º estágio ativo (não-fatal)
//   4) espelha a linha em mirror_pedidos_venda do CRM (aparece na hora; não-fatal)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '256kb' } }, maxDuration: 30 }

const CRM_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const CRM_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const CONTROLE_URL = process.env.CONTROLE_SUPABASE_URL || 'https://kfucuvwrnwrkshxpsmyq.supabase.co'
// anon key PÚBLICA do controle (role=anon, ref=kfucuvwrnwrkshxpsmyq, exp 2075) — extraída do
// próprio bundle de controle.branorte.com. Não é segredo. Pode ser sobrescrita por env.
const CONTROLE_PUBLIC_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWN1dndybndya3NoeHBzbXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMzAwODgsImV4cCI6MjA3NTYwNjA4OH0.Oe0otpf1l_Ssbi8FQJlbcDRNtW_j_IRY5EMnr8dNYNE'
const CONTROLE_SVC = process.env.CONTROLE_SERVICE_KEY || process.env.CONTROLE_ANON_KEY || CONTROLE_PUBLIC_ANON

interface Body {
  cliente?: string
  vendedor?: string
  data_venda?: string // YYYY-MM-DD
  produto?: string
  valor_total?: number | string
  forma_pagamento?: string
  telefone?: string
  cidade?: string
  estado?: string
}

function mirrorRow(p: Record<string, unknown>) {
  return {
    id: String(p.id),
    numero_orcamento: p.numero_orcamento ?? null,
    pedido_numero: p.pedido_numero ?? null,
    cliente: p.cliente ?? null,
    vendedor: p.vendedor ?? null,
    vendedor_2: p.vendedor_2 ?? null,
    valor_total: p.valor_total ?? null,
    valor_pago: p.valor_pago ?? null,
    ajuste_valor: p.ajuste_valor ?? null,
    ajuste_data: (p.ajuste_data as string | null)?.slice(0, 10) ?? null,
    status: p.status ?? null,
    status_pagamento: p.status_pagamento ?? null,
    forma_pagamento: p.forma_pagamento ?? null,
    data_venda: (p.data_venda as string | null)?.slice(0, 10) ?? null,
    data_entrega: (p.data_entrega as string | null)?.slice(0, 10) ?? null,
    data_pagamento: (p.data_pagamento as string | null)?.slice(0, 10) ?? null,
    cidade: p.cidade ?? null,
    estado: p.estado ?? null,
    payment_plan_json: p.payment_plan_json ?? null,
    raw: p,
    synced_at: new Date().toISOString(),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!CRM_URL || !CRM_SVC) return res.status(500).json({ error: 'env_missing' })

  // Auth: exige usuário logado e aprovado no CRM
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })
  const crm = createClient(CRM_URL, CRM_SVC, { auth: { persistSession: false } })
  const { data: u, error: authErr } = await crm.auth.getUser(auth)
  if (authErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt' })
  const { data: prof } = await crm.from('user_profiles').select('role, approved_at').eq('id', u.user.id).maybeSingle()
  if (!prof || !prof.approved_at || prof.role === 'pending' || prof.role === 'rejected') {
    return res.status(403).json({ error: 'not_approved' })
  }

  // CONTROLE_SVC sempre definido (anon pública por default) — sem 500 de "key missing".

  const body = (req.body || {}) as Body
  const vendedor = (body.vendedor || '').trim()
  const data_venda = (body.data_venda || '').slice(0, 10)
  const produto = (body.produto || '').trim()
  if (!vendedor || !data_venda || !produto) {
    return res.status(400).json({ error: 'campos_obrigatorios', detail: 'vendedor, data_venda e produto são obrigatórios.' })
  }
  const valorNum = Number(body.valor_total) || 0

  const controle = createClient(CONTROLE_URL, CONTROLE_SVC, { auth: { persistSession: false } })

  // 1) Número do pedido (sequencial anual, lock-free). NUNCA inventar.
  const { data: pn, error: rpcErr } = await controle.rpc('gerar_pedido_numero', { p_data: data_venda })
  if (rpcErr || !pn) return res.status(500).json({ error: 'rpc_numero_falhou', detail: rpcErr?.message })
  const pedido_numero = String(pn)

  // 2) INSERT em pedidos_venda (colunas NOT NULL sempre preenchidas)
  const row = {
    pedido_numero,
    numero_orcamento: pedido_numero,
    cliente: body.cliente?.trim() || 'Não informado',
    vendedor,
    data_venda,
    data_entrega: data_venda,
    dias_uteis: 0,
    equipamentos_json: [produto],
    motores_json: [],
    equipamentos_detalhados: [{ descricao: produto, quantidade: 1, unidade: 'UN', valor: valorNum }],
    descricao_equipamento: produto,
    valor_total: valorNum,
    forma_pagamento: body.forma_pagamento?.trim() || null,
    telefone: body.telefone?.trim() || null,
    cidade: body.cidade?.trim() || null,
    estado: body.estado?.trim()?.toUpperCase()?.slice(0, 2) || null,
    payment_plan_json: valorNum > 0 ? { modo: 'custom', moeda: 'BRL', total: valorNum, parcelas: [] } : null,
    status: 'ABERTO',
    arquivo_url: '',
    fonte_origem: 'CRM',
  }
  const { data: created, error: insErr } = await controle.from('pedidos_venda').insert(row).select().single()
  if (insErr || !created) return res.status(500).json({ error: 'insert_falhou', detail: insErr?.message })

  // 3) Card de produção no 1º estágio ativo (não-fatal)
  try {
    const { data: estagio } = await controle
      .from('producao_estagios').select('id').eq('ativo', true).order('ordem', { ascending: true }).limit(1).maybeSingle()
    if (estagio?.id) await controle.from('producao_pedidos').insert({ pedido_id: created.id, estagio_id: estagio.id })
  } catch { /* não-fatal */ }

  // 4) Espelha no CRM pra aparecer na hora (sem esperar o sync de 30min) — não-fatal
  try {
    await crm.from('mirror_pedidos_venda').upsert(mirrorRow(created as Record<string, unknown>), { onConflict: 'id' })
  } catch { /* não-fatal */ }

  return res.status(200).json({ ok: true, pedido: { id: created.id, pedido_numero, cliente: row.cliente, valor_total: valorNum } })
}
