import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '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'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ETIQUETAS_FUNIL_ENDPOINT = `${SUPABASE_URL}/functions/v1/etiquetas-status-funil`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function getSazonalidade(): { fase: string, gancho: string } {
  const m = new Date().getMonth() + 1
  if (m >= 6 && m <= 9) return { fase: 'PRÉ-SAFRA', gancho: 'Bom momento pra ele se preparar antes da virada — quem prepara agora colhe melhor.' }
  if (m >= 10 || m <= 3) return { fase: 'SAFRA', gancho: 'Dinheiro entrando agora é hora de fechar — ROI começa no próximo ciclo.' }
  return { fase: 'PÓS-SAFRA / PLANEJAMENTO', gancho: 'Período de Pronaf Mais Alimentos — ele pode parcelar em 60-120 meses.' }
}

function detectarProduto(s1: string | null, s2?: string | null): string | null {
  const s = `${s1 || ''} ${s2 || ''}`.toLowerCase()
  if (!s.trim()) return null
  if (/\bjr ?pro\b/.test(s)) return 'Fábrica Compacta JR Pro'
  if (/\b(compacta|jr|master)\b/.test(s)) return 'Fábrica Compacta'
  if (/\b(misturador|mistur)\b/.test(s)) return 'Misturador Vertical'
  if (/\b(moinho|martelo)\b/.test(s)) return 'Moinho Martelo'
  if (/\b(silo)\b/.test(s)) return 'Silo'
  if (/\b(esteira)\b/.test(s)) return 'Esteira'
  if (/\b(ensacadeira|ensacar)\b/.test(s)) return 'Ensacadeira'
  return null
}

function detectarSegmento(s1: string | null, s2?: string | null): string | null {
  const s = `${s1 || ''} ${s2 || ''}`.toLowerCase()
  if (!s.trim()) return null
  if (/\b(su[íi]no|porco|leitao|leitão)\b/.test(s)) return 'suínos'
  if (/\b(gado|boi|bovin|nelore|leite)\b/.test(s)) return 'gado'
  if (/\b(ave|frango|galinha|poedeira)\b/.test(s)) return 'aves'
  if (/\b(peixe|piscicultura|tilapia)\b/.test(s)) return 'peixes'
  return null
}

// Busca dados do funil temporal (Fresco/Recente/Parado/SemDado) por etiqueta
async function buscarFunilTemporal(vendedor_nome?: string): Promise<any | null> {
  try {
    const url = vendedor_nome
      ? `${ETIQUETAS_FUNIL_ENDPOINT}?vendedor=${encodeURIComponent(vendedor_nome)}`
      : ETIQUETAS_FUNIL_ENDPOINT
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

const PROMPTS_AGREGADOS: Record<string, { titulo: string, instrucao: string, exemplos: string }> = {
  fechar_hoje: {
    titulo: '🔥 Quem fechar HOJE',
    instrucao: `Esses leads estão em CLOSE com prob alta. Pra cada um:
- **Nome** + % + dias parado
- 1 frase curta com o gancho de fechamento (boleto, PIX, prazo, garantia)
- <msg>...</msg> direta, brasileira, fecha com pergunta de ação (não de informação)
No final: qual abordar primeiro e por quê (1 frase).`,
    exemplos: `EXEMPLOS DE <msg> BOAS (estilo Branorte):
✅ COM PRODUTO confirmado: "João boa! Tenho a JR Pro em estoque, te mando o boleto agora? PIX se preferir, hoje mesmo despacho."
✅ SEM PRODUTO confirmado: "Pedro, fechei a planilha do seu caso. Qual modelo você fechou: JR ou JR Pro? PIX hoje ou boleto 30/60?"
❌ "Olá, tudo bem? Estou aqui para avançarmos."`,
  },
  quebrar_objecao: {
    titulo: '🛡️ Quebrar objeções',
    instrucao: `Esses estão presos em objeção. Pra cada:
- **Nome** + % + dias parado
- Hipótese da objeção real
- Técnica ANSWER
- <msg>...</msg> com a virada — NUNCA dê desconto`,
    exemplos: `✅ "João, simulei Pronaf. R$3.200 vira R$1.900 — manda CPF que rodo?"`,
  },
  reanimar_parados: {
    titulo: '😴 Reanimar parados',
    instrucao: `Esses esfriaram. Pra cada:
- **Nome** + dias parado
- Hipótese curta (sem culpar cliente)
- <msg>...</msg> LEVE. Máximo 2 linhas.`,
    exemplos: `✅ "Fala João, tudo bem? Como tá a recria nesse calor?"`,
  },
  aplicar_spin: {
    titulo: '🔬 Aplicar SPIN',
    instrucao: `Cada cliente está em qualificação. Pra cada:
- **Nome** + estágio
- Tipo SPIN apropriado (S/P/I/N)
- <msg>...</msg> com a pergunta direta`,
    exemplos: `✅ "João, quantas cabeças você tá manejando hoje e qual ração usa?"`,
  },
  diagnostico_funil: {
    titulo: '📊 Diagnóstico do funil',
    instrucao: `Análise estratégica da carteira usando os dados temporais:
- Mostre TOTAIS por estágio + bucket temporal (Fresco/Recente/Parado/SemDado)
- Identifique o GARGALO real (estágio com muito "Parado")
- Aponte oportunidades: estágios com "Fresco" alto = quentes que podem virar venda essa semana
- Aponte riscos: muitos "Parados" em estágio quente = pipeline congelado
- 1-3 ações concretas
- Termine com 1 métrica de alerta ("X% do FOLLOW UP está parado")`,
    exemplos: ``,
  },
  em_risco: {
    titulo: '⚠️ Em risco',
    instrucao: `Esses ESTAVAM bons mas estão virando frio. Pra cada:
- **Nome** + % + dias parado
- Por que é risco real
- <msg>...</msg> direta-mas-respeitosa`,
    exemplos: `✅ "João, posso ser direto? Já faz X dias — ainda faz sentido pra você?"`,
  },
  reativar_quentes: {
    titulo: '🎯 Reativar quentes',
    instrucao: `Top quentes parados. Pra cada:
- **Nome** + %
- É quente que esfriou OU em decisão final?
- <msg>...</msg> de fechamento com urgência REAL`,
    exemplos: `✅ "João, aço subiu 8% essa semana — trava hoje no preço antigo?"`,
  },
}

async function buscarClientes(supa: any, pergunta_id: string, vendedor_nome: string): Promise<{ clientes: any[], stats?: any }> {
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

  const baseQuery = supa.from('coach_forecasts')
    .select('chat_id, nome_contato, probabilidade, estagio, saude, motivo, features, data_ref')
    .eq('vendedor_nome', vendedor_nome)
    .gte('data_ref', cutoff)
    .order('data_ref', { ascending: false })

  const { data, error } = await baseQuery.limit(2000)
  if (error || !data) return { clientes: [] }

  const seen = new Set<string>()
  const all: any[] = []
  for (const r of data) {
    if (seen.has(r.chat_id)) continue
    seen.add(r.chat_id)
    const dias = r.features?.diasParado ?? 999
    const stage = String(r.features?.stage || '').toUpperCase()
    all.push({ ...r, dias_parado: dias, stage_branorte: stage })
  }

  let filtrados: any[] = []
  if (pergunta_id === 'fechar_hoje') {
    filtrados = all.filter(c =>
      c.probabilidade >= 60 && !/8-End/.test(c.estagio || '') &&
      c.stage_branorte !== 'VENDIDO' && c.probabilidade < 100
    ).sort((a, b) => b.probabilidade - a.probabilidade).slice(0, 5)
  } else if (pergunta_id === 'quebrar_objecao') {
    filtrados = all.filter(c =>
      (/(6-Object|5-Solution)/.test(c.estagio || '') || /(FOLLOW UP|ORCAMENTO ENVIADO|FORA DO ORCAMENTO)/.test(c.stage_branorte)) &&
      c.dias_parado >= 3 && c.dias_parado <= 30 && c.probabilidade >= 25
    ).sort((a, b) => b.probabilidade - a.probabilidade).slice(0, 5)
  } else if (pergunta_id === 'reanimar_parados') {
    filtrados = all.filter(c =>
      c.probabilidade >= 20 && c.probabilidade < 60 &&
      c.dias_parado >= 3 && c.dias_parado <= 20 && !/8-End/.test(c.estagio || '')
    ).sort((a, b) => a.dias_parado - b.dias_parado).slice(0, 5)
  } else if (pergunta_id === 'aplicar_spin') {
    filtrados = all.filter(c =>
      /(4-Needs|2-Qualif|3-Value)/.test(c.estagio || '') &&
      c.probabilidade >= 15 && c.dias_parado <= 14
    ).sort((a, b) => b.probabilidade - a.probabilidade).slice(0, 5)
  } else if (pergunta_id === 'em_risco') {
    filtrados = all.filter(c =>
      c.probabilidade >= 45 && c.probabilidade < 100 &&
      c.dias_parado >= 7 && c.dias_parado <= 25
    ).sort((a, b) => b.dias_parado - a.dias_parado).slice(0, 5)
  } else if (pergunta_id === 'reativar_quentes') {
    filtrados = all.filter(c =>
      c.probabilidade >= 55 && c.probabilidade < 100 &&
      c.dias_parado >= 5 && c.dias_parado <= 25
    ).sort((a, b) => b.probabilidade - a.probabilidade).slice(0, 5)
  } else if (pergunta_id === 'diagnostico_funil') {
    // 🆕 Puxa do endpoint etiquetas-status-funil (mesmos dados do painel /etiquetas-zap)
    const funilTemporal = await buscarFunilTemporal(vendedor_nome)
    if (funilTemporal?.ok) {
      return { clientes: [], stats: { funil_temporal: funilTemporal } }
    }
    // Fallback: agrega só do coach_forecasts (sem temporal detalhado)
    const stats: Record<string, number> = {}
    for (const c of all) stats[c.stage_branorte] = (stats[c.stage_branorte] || 0) + 1
    const inativos = ['NUNCA RESPONDEU', 'NAO RESPONDEU MAIS', 'NAO TEM INTERESSE', 'COMPROU DO CONCORRENTE', 'NAO FABRICAMOS', 'VENDIDO', 'BRANORTE', 'OUTROS ASSUNTOS', 'RESOLVIDOS']
    const ativos_total = all.filter(c => !inativos.includes(c.stage_branorte)).length
    return { clientes: [], stats: { por_estagio: stats, ativos_total, total: all.length } }
  }

  if (filtrados.length > 0) {
    const phones = filtrados.map(c => c.chat_id.replace('@c.us', ''))
    const { data: cards } = await supa.from('cards')
      .select('contact_phone, contact_phone_formatted, first_message, subject, total_value_cents')
      .or(phones.map(p => `contact_phone.eq.${p}`).join(','))
    const cardsMap = new Map<string, any>()
    if (Array.isArray(cards)) {
      for (const card of cards) {
        const ph = String(card.contact_phone || card.contact_phone_formatted || '').replace(/\D/g, '')
        if (ph) cardsMap.set(ph, card)
      }
    }
    for (const c of filtrados) {
      const ph = c.chat_id.replace('@c.us', '')
      const card = cardsMap.get(ph)
      if (card) {
        c.first_message = card.first_message
        c.subject = card.subject
        c.total_value_cents = card.total_value_cents
        c.produto_detectado = detectarProduto(card.first_message, card.subject)
        c.segmento_detectado = detectarSegmento(card.first_message, card.subject)
      }
    }
  }

  return { clientes: filtrados }
}

async function formatarComLLM(pergunta_id: string, vendedor_nome: string, clientes: any[], stats: any | null): Promise<string> {
  const conf = PROMPTS_AGREGADOS[pergunta_id]
  const saz = getSazonalidade()

  let userMsg = `VENDEDOR: ${vendedor_nome}\nMÊS ATUAL: ${new Date().toLocaleString('pt-BR', { month: 'long' })} (fase: ${saz.fase})\n\n`
  if (clientes.length > 0) {
    userMsg += `=== CLIENTES REAIS DA CARTEIRA (use ESSES nomes, não invente) ===\n`
    for (const c of clientes) {
      userMsg += `\n- Nome: ${c.nome_contato || 'cliente'}\n  Probabilidade: ${c.probabilidade}%\n  Estágio Branorte: ${c.stage_branorte || '?'}\n  Saúde: ${c.saude}\n  Dias parado: ${c.dias_parado}\n  Motivo do score: ${c.motivo || ''}\n`
      if (c.first_message) userMsg += `  Primeira msg do cliente: "${String(c.first_message).slice(0, 250)}"\n`
      if (c.subject) userMsg += `  Assunto: ${c.subject}\n`
      userMsg += `  PRODUTO_DETECTADO: ${c.produto_detectado || '⛔ NÃO ESPECIFICADO — NÃO INVENTAR PRODUTO'}\n`
      userMsg += `  SEGMENTO_DETECTADO: ${c.segmento_detectado || '⛔ NÃO ESPECIFICADO — NÃO INVENTAR SEGMENTO'}\n`
      if (c.total_value_cents) userMsg += `  Valor estimado: R$ ${(c.total_value_cents / 100).toLocaleString('pt-BR')}\n`
    }
    userMsg += `\n=== FIM ===\n`
  } else if (stats?.funil_temporal?.linhas) {
    // 🆕 Diagnóstico do funil com dados temporais reais (mesma fonte do painel)
    const ft = stats.funil_temporal
    userMsg += `=== FUNIL POR ETIQUETA + STATUS TEMPORAL ===\n`
    userMsg += `TOTAIS: ${ft.totais.total} chats | Fresco(<24h): ${ft.totais.fresco} | Recente(1-3d): ${ft.totais.recente} | Parado(3-30d): ${ft.totais.parado} | SemDado(>30d): ${ft.totais.sem_dado}\n\n`
    userMsg += `Por estágio (ordem do funil):\n`
    for (const l of ft.linhas) {
      const pctParado = l.total > 0 ? Math.round((l.parado / l.total) * 100) : 0
      userMsg += `- ${l.etiqueta} | total ${l.total} | 🔥 Fresco ${l.fresco} | ⚡ Recente ${l.recente} | 🔴 Parado ${l.parado} (${pctParado}%) | ⚰ SemDado ${l.sem_dado}\n`
    }
    userMsg += `\n=== FIM ===\n`
  } else if (stats?.por_estagio) {
    userMsg += `=== ESTATÍSTICAS DA CARTEIRA (fallback) ===\nTotal: ${stats.total} | Ativos: ${stats.ativos_total}\nPor estágio:\n`
    for (const [k, v] of Object.entries(stats.por_estagio)) {
      userMsg += `- ${k}: ${v}\n`
    }
    userMsg += `=== FIM ===\n`
  } else {
    userMsg += `(sem clientes nessa categoria hoje — sugira o que fazer)`
  }

  const systemPrompt = `Você é o **Coach de Vendas Branorte** — sub-agente AGREGADO. Fábrica brasileira de equipamentos pra ração e silos. Vendedores: Daniel, Pedro, Eder, Ramon, Jardel, Gustavo, Alvaro, Edilson Jr.

PÚBLICO: produtor rural brasileiro. Tom direto, sem firula.

SAZONALIDADE ATUAL: ${saz.fase}. Use o gancho: "${saz.gancho}"

=== 🚨 REGRA INVIOLÁVEL: ANTI-ALUCINAÇÃO 🚨 ===
Se PRODUTO_DETECTADO = "⛔ NÃO ESPECIFICADO" → use "sua proposta", "a fábrica", linguagem NEUTRA. PROIBIDO citar JR/Compacta/Misturador etc se não detectado.
Mesma regra pra SEGMENTO_DETECTADO.

=== TAREFA ===

## ${conf.titulo}

${conf.instrucao}

${conf.exemplos ? `\n=== EXEMPLOS ===\n${conf.exemplos}\n` : ''}

=== REGRAS ===
- USE APENAS os dados/nomes fornecidos — NUNCA invente
- <msg>...</msg> texto puro, BR direto, pergunta de AÇÃO
- Máximo 800 palavras
- Se lista vazia: "sem clientes nessa categoria hoje" + próxima ação`

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 1700,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    }),
  })
  if (!r.ok) {
    const txt = await r.text()
    return `⚠️ Erro LLM: ${txt.slice(0, 200)}`
  }
  const j = await r.json()
  return j.choices?.[0]?.message?.content?.trim() || '(sem resposta)'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const { pergunta_id, vendedor_nome } = body
  if (!pergunta_id || !vendedor_nome) {
    return new Response(JSON.stringify({ error: 'pergunta_id e vendedor_nome obrigatorios' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (!PROMPTS_AGREGADOS[pergunta_id]) {
    return new Response(JSON.stringify({ error: 'pergunta_id desconhecido', validos: Object.keys(PROMPTS_AGREGADOS) }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const { clientes, stats } = await buscarClientes(supa, pergunta_id, vendedor_nome)
  const resposta = await formatarComLLM(pergunta_id, vendedor_nome, clientes, stats || null)

  return new Response(JSON.stringify({
    ok: true,
    pergunta_id,
    vendedor_nome,
    sub_agent: 'AGREGADO',
    sazonalidade: getSazonalidade(),
    clientes_count: clientes.length,
    clientes,
    stats,
    resposta,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
