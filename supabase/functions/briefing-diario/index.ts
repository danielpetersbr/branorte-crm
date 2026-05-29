import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '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'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

const SYSTEM_BRIEFING = `Você é o **Estrategista de Carteira Branorte**. Gera um briefing matinal CURTO (1 mínuto de leitura) pra um vendedor que vai abrir o WhatsApp às 7h.

FORMATO OBRIGATÓRIO:

*🌅 BOM DIA, [VENDEDOR]*

*🔥 Foco hoje (max 5):*
1. *Nome* — motivo (1 linha)
2. ...

*⚠️ Cuidados:*
- ...

*📊 Sua carteira ativa:*
[X] quentes • [Y] mornos • [Z] frios (sem contar já fechados/perdidos)

*🎯 Meta de hoje:* [1 ação concreta]

REGRAS:
- MÁXIMO 380 caracteres
- Use *negrito* (formato WhatsApp, 1 asterisco)
- Não invente nomes — use só os do contexto
- Direto, sem firula
- Quem está em VENDIDO/Close+motivo VENDIDO JÁ FECHOU — NÃO inclui em foco`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const { vendedor_nome, force_regen } = body
  if (!vendedor_nome) {
    return new Response(JSON.stringify({ error: 'vendedor_nome obrigatorio' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const hoje = new Date().toISOString().slice(0, 10)

  if (!force_regen) {
    const { data: existente } = await supa.from('coach_briefings').select('*').eq('vendedor_nome', vendedor_nome).eq('data_ref', hoje).maybeSingle()
    if (existente) {
      return new Response(JSON.stringify({ ok: true, cached: true, briefing: existente }), { headers: { ...CORS, 'content-type': 'application/json' } })
    }
  }

  const { data: forecasts } = await supa.from('coach_forecasts')
    .select('chat_id, nome_contato, probabilidade, estagio, saude, motivo')
    .eq('vendedor_nome', vendedor_nome)
    .gte('data_ref', new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10))
    .order('probabilidade', { ascending: false })
    .limit(200)

  const lista = Array.isArray(forecasts) ? forecasts : []
  // Filtra já-fechados (VENDIDO) e perdidos do ranking de "foco"
  const fechouOuPerdeu = (f: any) => {
    const m = String(f.motivo || '').toUpperCase()
    return f.probabilidade >= 100
        || m.includes('VENDIDO')
        || m.includes('NAO TEM INTERESSE')
        || m.includes('NAO RESPONDEU')
        || m.includes('NUNCA RESPONDEU')
        || m.includes('COMPROU DO CONCORRENTE')
        || m.includes('NAO FABRICAMOS')
        || m.includes('FORA DO ORCAMENTO')
  }
  const ativos = lista.filter(f => !fechouOuPerdeu(f))

  // Stats sobre ATIVOS apenas (mais útil)
  const quentes = ativos.filter(f => f.probabilidade >= 60).length
  const mornos = ativos.filter(f => f.probabilidade >= 30 && f.probabilidade < 60).length
  const frios = ativos.filter(f => f.probabilidade < 30 && f.probabilidade > 5).length

  // Foco: top 5 ATIVOS (não-fechados) por probabilidade
  const foco = ativos.slice(0, 5)

  // Cuidados: ativos com motivo contém "parado" / "frio"
  const cuidados = ativos.filter(f => /parado|frio/.test(String(f.motivo || ''))).slice(0, 3)

  const contextoLLM = `VENDEDOR: ${vendedor_nome}\n\nFOCO (top probabilidade ENTRE ATIVOS, sem incluir já-fechados):\n${foco.map((f, i) => `${i + 1}. ${f.nome_contato || '?'} — ${f.probabilidade}% — ${f.motivo}`).join('\n') || '(carteira ativa vazia)'}\n\nCUIDADOS:\n${cuidados.map(f => `- ${f.nome_contato || '?'}: ${f.motivo}`).join('\n') || '(nenhum)'}\n\nCARTEIRA ATIVA: ${quentes} quentes • ${mornos} mornos • ${frios} frios`

  let resumo_md = ''
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_BRIEFING },
          { role: 'user', content: contextoLLM },
        ],
      }),
    })
    if (r.ok) {
      const j = await r.json()
      resumo_md = j.choices?.[0]?.message?.content?.trim() || ''
    }
  } catch (e) { /* ignore */ }

  if (!resumo_md) {
    resumo_md = `*🌅 BOM DIA, ${vendedor_nome.toUpperCase()}*\n\n*🔥 Foco hoje:*\n${foco.map((f, i) => `${i + 1}. *${f.nome_contato || '?'}* — ${f.probabilidade}%`).join('\n') || '(sem leads ativos)'}\n\n*📊* ${quentes} quentes • ${mornos} mornos • ${frios} frios`
  }

  const { data: salvo, error: errSave } = await supa.from('coach_briefings').upsert({
    vendedor_nome,
    data_ref: hoje,
    resumo_md,
    prioridades: foco,
    estatisticas: { quentes, mornos, frios, total_ativos: ativos.length, total_carteira: lista.length },
  }, { onConflict: 'vendedor_nome,data_ref' }).select('*').single()

  return new Response(JSON.stringify({
    ok: true,
    cached: false,
    briefing: salvo || { vendedor_nome, data_ref: hoje, resumo_md, prioridades: foco, estatisticas: { quentes, mornos, frios } },
    err_save: errSave?.message,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
