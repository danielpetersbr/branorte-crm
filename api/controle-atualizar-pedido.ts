// Vercel serverless — as escritas da tela de DETALHE do pedido de venda,
// com recorte por vendedor e reespelhamento numa tacada só.
//
// Cobre as três escritas: status, número do orçamento e ajuste de valor.
//
// ── POR QUE SAIU DO BROWSER ──────────────────────────────────────────────────
// Antes, as três gravavam DIRETO na `pedidos_venda` do controle com a anon key.
// Não havia recorte nenhum: qualquer um dos 9 usuários `role='vendor'` que
// abrisse /controle/pedidos/<id> de um pedido alheio podia trocar o status,
// renomear o orçamento ou dar desconto no negócio do colega. Esconder o botão
// não resolve — o POST continua saindo.
//
// Aqui o pedido é LIDO primeiro e o `pedidoNoEscopo()` decide, com a mesma regra
// do /api/financeiro: admin|financeiro veem tudo; os demais só onde são
// `vendedor` ou `vendedor_2`. Sem vendor_id resolvido = 403 `sem_escopo`.
//
// ⚠️ HONESTIDADE SOBRE O ALCANCE DISTO: é defesa em profundidade, não fronteira.
// A anon key do controle é pública (está no bundle de controle.branorte.com) e a
// RLS de lá está escancarada, então quem quiser MESMO ainda escreve por fora com
// curl. Isto tira o CRM de veículo e dá rastro no log; a fronteira de verdade só
// existe quando a RLS do controle apertar.
//
// ── E O ESPELHO ──────────────────────────────────────────────────────────────
// Depois de gravar, reescreve `mirror_pedidos_venda` (projeto do CRM), que é o
// que a listagem /controle/pedidos lê. Sem isso o vendedor troca o status aqui,
// volta pra lista e vê o valor velho (o sync periódico chega a ficar ~18 h atrás).
// O espelho tem RLS LIGADA e nenhuma policy permissiva de UPDATE/INSERT, e um
// UPDATE barrado por RLS volta 0 linhas SEM ERRO — por isso só a service key do
// CRM escreve, daqui, nunca do front.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  CONTROLE_URL,
  CONTROLE_KEY,
  resolverEscopo,
  ehGateErro,
  pedidoNoEscopo,
} from './_lib/financeiro-core.js'
import { mirrorRow } from './_lib/mirror-pedido.js'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 30 }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS_VALIDOS = new Set(['ABERTO', 'FECHADO', 'CANCELADO'])

const CRM_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const CRM_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

type Acao = 'status' | 'numero_orcamento' | 'ajuste'

interface Corpo {
  id?: unknown
  acao?: unknown
  status?: unknown
  numero_orcamento?: unknown
  ajuste_valor?: unknown
  ajuste_motivo?: unknown
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // JWT + papel + nome do vendedor, na mesma função que o /api/financeiro usa.
  const escopo = await resolverEscopo(req.headers.authorization)
  if (ehGateErro(escopo)) return res.status(escopo.status).json({ error: escopo.error })

  const corpo = (req.body || {}) as Corpo
  const id = String(corpo.id ?? '').trim()
  if (!id) return res.status(400).json({ error: 'id_obrigatorio' })
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'id_invalido' })

  const acao = String(corpo.acao ?? '') as Acao
  if (acao !== 'status' && acao !== 'numero_orcamento' && acao !== 'ajuste') {
    return res.status(400).json({ error: 'acao_invalida' })
  }

  const controle = createClient(CONTROLE_URL, CONTROLE_KEY, { auth: { persistSession: false } })

  // Lê ANTES de gravar: é a leitura que prova de quem é o pedido.
  const { data: pedido, error: erroLeitura } = await controle
    .from('pedidos_venda')
    .select('id, vendedor, vendedor_2, valor_total, payment_plan_json')
    .eq('id', id)
    .maybeSingle()
  if (erroLeitura) return res.status(500).json({ error: 'leitura_falhou', detail: erroLeitura.message })
  if (!pedido) return res.status(404).json({ error: 'pedido_nao_encontrado' })

  if (!pedidoNoEscopo(pedido, escopo)) {
    console.warn(
      `[controle-atualizar-pedido] BLOQUEADO: ${escopo.role} ${escopo.userId} tentou ` +
        `"${acao}" no pedido ${id} (vendedor=${pedido.vendedor}).`,
    )
    return res.status(403).json({ error: 'fora_do_escopo' })
  }

  // Monta só o campo da ação pedida. Nada de aceitar um objeto solto do cliente:
  // um `patch` genérico deixaria escrever qualquer coluna, inclusive `vendedor`
  // (o próprio campo que define o recorte — dava pra roubar o pedido).
  let patch: Record<string, unknown>
  if (acao === 'status') {
    const status = String(corpo.status ?? '')
    if (!STATUS_VALIDOS.has(status)) return res.status(400).json({ error: 'status_invalido' })
    patch = { status }
  } else if (acao === 'numero_orcamento') {
    const numero = String(corpo.numero_orcamento ?? '').trim()
    if (!numero) return res.status(400).json({ error: 'numero_orcamento_vazio' })
    if (numero.length > 60) return res.status(400).json({ error: 'numero_orcamento_longo' })
    patch = { numero_orcamento: numero }
  } else {
    const valor = Number(corpo.ajuste_valor)
    if (!Number.isFinite(valor)) return res.status(400).json({ error: 'ajuste_valor_invalido' })
    const motivo = String(corpo.ajuste_motivo ?? '').trim()
    if (!motivo) return res.status(400).json({ error: 'ajuste_motivo_obrigatorio' })
    // Grava só o DELTA. `valor_total` e `payment_plan_json.total` seguem com o
    // bruto original — o resto da aplicação soma `ajuste_valor` em cima deles.
    patch = {
      ajuste_valor: valor,
      ajuste_motivo: motivo.slice(0, 500),
      ajuste_data: new Date().toISOString().slice(0, 10),
    }
  }

  // `.select()` NÃO é enfeite: UPDATE barrado por RLS volta 0 linhas e
  // `error === null`. Sem conferir, responderíamos "ok" sem ter gravado nada.
  const { data: gravado, error: erroUpdate } = await controle
    .from('pedidos_venda')
    .update(patch)
    .eq('id', id)
    .select('*')
  if (erroUpdate) return res.status(500).json({ error: 'update_falhou', detail: erroUpdate.message })
  if (!gravado || gravado.length === 0) {
    return res.status(500).json({
      error: 'update_sem_efeito',
      detail: 'UPDATE voltou 0 linhas (provavelmente RLS do controle). Nada foi gravado.',
    })
  }

  // Espelho do CRM — não-fatal: o pedido JÁ foi gravado, e falhar aqui só deixa a
  // LISTA velha até o próximo sync. Devolver erro faria o usuário achar que a
  // escrita não pegou e tentar de novo.
  let espelhado = false
  try {
    if (CRM_URL && CRM_SVC) {
      const crm = createClient(CRM_URL, CRM_SVC, { auth: { persistSession: false } })
      const { error } = await crm
        .from('mirror_pedidos_venda')
        .upsert(mirrorRow(gravado[0] as Record<string, unknown>), { onConflict: 'id' })
      espelhado = !error
      if (error) console.warn('[controle-atualizar-pedido] espelho falhou:', error.message)
    }
  } catch (e) {
    console.warn('[controle-atualizar-pedido] espelho falhou:', e)
  }

  return res.status(200).json({ ok: true, id, acao, espelhado })
}
