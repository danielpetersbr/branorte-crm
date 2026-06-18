// frete-lance — endpoint PÚBLICO da cotação reversa de frete.
// A transportadora abre /cotar-frete/<token> (deslogada) e esta função:
//   action 'get'      -> devolve o RESUMO do frete daquele token (sem expor os
//                        lances das concorrentes) e marca o lance como "aberto".
//   action 'submit'   -> grava valor/prazo/observação da transportadora.
//   action 'recusar'  -> transportadora declina a cotação.
// Segurança: o token (32 hex) é a credencial. verify_jwt=false (público).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'content-type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || 'get')
  const token = String(body.token || '').trim()
  if (!token) return json({ error: 'token_required' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: lance, error: le } = await sb.from('frete_lances').select('*').eq('token', token).maybeSingle()
  if (le) return json({ error: 'db', detail: le.message }, 500)
  if (!lance) return json({ error: 'token_invalido' }, 404)

  const { data: solic, error: se } = await sb.from('frete_solicitacoes').select('*').eq('id', lance.solicitacao_id).maybeSingle()
  if (se || !solic) return json({ error: 'solicitacao_nao_encontrada' }, 404)

  let caminhao: string | null = null
  if (solic.caminhao_recomendado_id) {
    const { data: c } = await sb.from('frete_tipos_caminhao').select('nome').eq('id', solic.caminhao_recomendado_id).maybeSingle()
    caminhao = c?.nome ?? null
  }

  const encerrada = ['fechada', 'cancelada'].includes(solic.status)

  const resumo = {
    codigo: solic.codigo,
    transportadora_nome: lance.transportadora_nome,
    cidade_destino: solic.cidade_destino,
    uf_destino: solic.uf_destino,
    distancia_km: solic.distancia_km,
    equipamentos_itens: solic.equipamentos_itens,
    descricao_carga: solic.descricao_carga,
    peso_total_kg: solic.peso_total_kg,
    comprimento_m: solic.comprimento_m,
    largura_m: solic.largura_m,
    altura_m: solic.altura_m,
    volume_m3: solic.volume_m3,
    carga_indivisivel: solic.carga_indivisivel,
    caminhao_recomendado: caminhao,
    prazo_desejado: solic.prazo_desejado,
    observacoes: solic.observacoes,
    solic_status: solic.status,
    // estado SÓ do próprio lance (não vaza concorrentes)
    lance_status: lance.status,
    valor: lance.valor,
    prazo_dias: lance.prazo_dias,
    lance_observacoes: lance.observacoes,
  }

  if (action === 'get') {
    // só marca "aberto" se ainda está em aberto (não em cotação cancelada/fechada)
    if (lance.status === 'enviado' && !encerrada) {
      await sb.from('frete_lances').update({ status: 'aberto', aberto_em: new Date().toISOString() }).eq('id', lance.id)
      resumo.lance_status = 'aberto'
    }
    return json({ ok: true, encerrada, resumo })
  }

  if (action === 'submit') {
    if (encerrada) return json({ error: 'encerrada', detail: 'Esta cotação já foi encerrada.' }, 409)
    const valor = Number(body.valor)
    const prazo_dias = body.prazo_dias != null && body.prazo_dias !== '' ? Number(body.prazo_dias) : null
    const observacoes = String(body.observacoes || '').slice(0, 800) || null
    if (!Number.isFinite(valor) || valor <= 0) return json({ error: 'valor_invalido' }, 400)

    const { error: ue } = await sb.from('frete_lances').update({
      status: 'respondido', valor, prazo_dias, observacoes,
      respondido_em: new Date().toISOString(),
      aberto_em: lance.aberto_em ?? new Date().toISOString(),
    }).eq('id', lance.id)
    if (ue) return json({ error: 'db', detail: ue.message }, 500)

    if (solic.status === 'aprovada') {
      await sb.from('frete_solicitacoes').update({ status: 'em_cotacao' }).eq('id', solic.id)
    }
    return json({ ok: true })
  }

  if (action === 'recusar') {
    if (!encerrada) {
      await sb.from('frete_lances').update({ status: 'recusado', respondido_em: new Date().toISOString() }).eq('id', lance.id)
    }
    return json({ ok: true })
  }

  return json({ error: 'action_invalida' }, 400)
})
