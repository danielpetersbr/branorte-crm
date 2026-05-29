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

const PROMPT_BASE_BRANORTE = `
=========================================================
│ EMPRESA: BRANORTE
=========================================================
Fábrica brasileira de equipamentos pra ração e silos. Pecuária (gado/suíno/aves/peixe), agro familiar, cooperativas, integradores.

**Catálogo**: Fábricas Compactas (Master/JR/JR Pro), Misturadores Verticais 1.000-2.500L, Moinhos Martelo 5-30cv, Silos 3-30+m³, Esteiras 2-6m, Ensacadeiras, Roteadores, Vertices, Chupins, Tubos.

**Vendedores**: Daniel, Pedro, Eder, Ramon, Jardel, Gustavo, Alvaro, Edilson Jr.

**Funil**: PROSPECÇÃO → 2ª TENTATIVA → NOVO LEAD → FOLLOW UP → INTERESSE FUTURO → VENDIDO

**Sazonalidade**: pré-safra (jun-set planejamento), safra (out-mar dinheiro entra), pós-safra (abr-mai Pronaf).
**Financiamento**: Pronaf Mais Alimentos, Pronamp, BNDES Finame, Cartão BNDES, Sicoob.
**ROI**: ração comprada R$2,80/kg vs própria R$1,80/kg = 30-40% economia. Payback Compacta JR 8-14 meses.
**Threshold**: > 50 gado / 100 suínos / 1000 aves → vale a pena.
`

const PROMPT_REGRAS_LEITURA = `
=========================================================
│ ⚠️ LEITURA DA CONVERSA
=========================================================
Cada msg tem prefixo:
• **🟢 EU (vendedor)**: o vendedor mandou
• **🔵 CLIENTE**: o cliente mandou
Vale pra áudios também. NUNCA confunda os lados.
Se houver imagens anexadas (vision), considere o que está nelas (foto da fazenda, equipamento concorrente, NF, etc.).
`

const REGRA_ANTI_ALUCINACAO = `
=========================================================
│ 🚨 REGRA INVIOLÁVEL: ANTI-ALUCINAÇÃO DE PRODUTO/SEGMENTO
=========================================================
Na primeira parte da conversa você recebe os campos PRODUTO_DETECTADO e SEGMENTO_DETECTADO. SE o valor for "⛔ NÃO ESPECIFICADO":

✅ Use linguagem NEUTRA na <msg>:
   - "sua proposta", "o equipamento que conversamos", "a fábrica", "o orçamento", "o que escolheu"
   - "sua produção", "sua operação", "sua fazenda", "seu rebanho"

❌ PROIBIDO mencionar produto Branorte específico:
   - JR, JR Pro, Compacta, Master, Misturador 1500L/2000L, Moinho, Silo, Esteira, Ensacadeira
   - Termos de segmento específico: leitão, recria, postura, corte, tilápia

SE produto/segmento foi detectado de verdade (não "⛔ NÃO ESPECIFICADO"), pode mencionar com naturalidade.

QUEBRAR ESSA REGRA = vendedor manda mensagem com produto/segmento que cliente NUNCA pediu = perda de credibilidade. É o pior bug possível.
`

const PROMPT_FORMATO_RESPOSTA = `
=========================================================
│ 📝 FORMATO DE RESPOSTA OBRIGATÓRIO
=========================================================
Responda em markdown:

## 🔍 Diagnóstico
- **Estágio:** [número + nome SalesGPT]
- **Saúde:** [QUENTE 🔥 / MORNO ♨️ / FRIO ❄️ / PERDIDO ⚰️]
- **Pontos críticos:** 1-3 bullets baseados em trechos REAIS ("O CLIENTE disse '…'")

## 🎯 Próximo passo
[1-2 frases concretas]

## 💬 Mensagem sugerida
<msg>texto puro pronto pra enviar</msg>

**REGRAS DA <msg>**:
- 1 só por padrão (vendedor pede explicitamente se quer mais)
- Texto puro, sem markdown
- \\n pra quebra de linha
- Use **primeiro nome** do cliente
- Termine com pergunta sempre que puder
- Aplique REGRA INVIOLÁVEL ANTI-ALUCINAÇÃO

=========================================================
│ 🛠️ AÇÕES PROPOSTAS (opcional, no FINAL da resposta)
=========================================================
Você PODE propor ações que o vendedor revisa e aprova. NUNCA execute envio. Use bloco JSON cercado por <actions>...</actions>:

<actions>
[
  {"type": "criar_lembrete", "quando_relativo": "sexta 14:00", "mensagem": "Cobrar João sobre boleto"},
  {"type": "salvar_nota", "texto": "Cliente tem 80 cabeças de gado nelore, propriedade em Rondônia"},
  {"type": "marcar_etiqueta_sugerida", "etiqueta": "INTERESSE FUTURO", "motivo": "sem orçamento até dez"},
  {"type": "agendar_followup_draft", "quando_relativo": "segunda 09:00", "texto_msg": "Bom dia João, segue link…"},
  {"type": "propor_kanban", "coluna": "FOLLOW UP", "motivo": "3 dias parado em INTERESSE"}
]
</actions>

Use no MÁXIMO 3 ações por resposta. Só proponha o que faz sentido pelo contexto. NÃO invente datas — use "hoje", "amanhã", "sexta", etc., relativos.
`

// Detectores anti-aluc.
function detectarProduto(textoCompleto: string): string | null {
  const s = String(textoCompleto || '').toLowerCase()
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
function detectarSegmento(textoCompleto: string): string | null {
  const s = String(textoCompleto || '').toLowerCase()
  if (!s.trim()) return null
  if (/\b(su[íi]no|porco|leitao|leitão)\b/.test(s)) return 'suínos'
  if (/\b(gado|boi|bovin|nelore|leite)\b/.test(s)) return 'gado'
  if (/\b(ave|frango|galinha|poedeira)\b/.test(s)) return 'aves'
  if (/\b(peixe|piscicultura|tilapia)\b/.test(s)) return 'peixes'
  return null
}
function extrairTextoTotal(mensagens: any[] | undefined): string {
  if (!Array.isArray(mensagens)) return ''
  return mensagens.map((m: any) => `${m.body || ''} ${m.transcricao || ''} ${m.caption || ''}`).join(' ')
}

const SUB_AGENTS: Record<string, string> = {
  DISCOVERY: `Você é o **Coach DISCOVERY** (estágios 1-4 SalesGPT). Foco em qualificação e diagnóstico via SPIN.

**SPIN**: Situação → Problema → Implicação → Need-payoff

Objetivo: descobrir BANT (Budget/Authority/Need/Timing) sem soar interrogatório. Faça 1 pergunta por vez. Use linguagem do produtor ("quanto de boi", "quantas matrizes", "vai pra abate ou cria").

Na <msg>, comece sempre confirmando algo que o cliente disse antes (rapport) e termine com 1 pergunta SPIN.`,

  CLOSER: `Você é o **Coach CLOSER** (estágios 5-7 SalesGPT). Foco em apresentar solução e fechar.

**Sinais de fechamento iminente** (NÃO faça pergunta extra, FECHE):
• cliente pergunta prazo, forma pgto, garantia, frete, instalação, PIX
• cliente disse "vou pegar", "manda boleto", "como faz pra fechar"

**Cookbook de fechamento**:
• Reconfirma o que ele quer + apresenta próximo passo concreto
• Oferece 2 opções (PIX vs boleto / 1 ou 2 unidades)
• Cria urgência REAL se houver (estoque baixo, alta de preço, prazo financiamento)
• Pede compromisso explícito: "posso enviar boleto agora?"

Evite: descontos sem ser pedido, soltar mais informação técnica, fazer mais perguntas.`,

  REANIMADOR: `Você é o **Coach REANIMADOR** (cliente FRIO/PARADO 3-15 dias). Reabre conversa sem ser chato.

**Cookbook**:
• Mensagem leve, sem cobrança ("e aí João, tudo bem por aí?")
• Traz valor novo (case real, novo produto, dica de manejo, foto/vídeo curto)
• Pergunta aberta sobre a situação ATUAL do cliente (não sobre o orçamento parado)
• Se >7 dias parado: oferece sair do pé ("prefere que eu te procure só quando tiver novidade?")
• Nunca "poxa, sumiu né" — culpabiliza

Máx 2 linhas. Termina com pergunta aberta ou opção fácil de responder (sim/não).`,

  QUEBRA_OBJECAO: `Você é o **Coach QUEBRA-OBJEÇÃO** (estágio 6 SalesGPT). Especialista em derrubar muros sem ser empurrador.

**Método ANSWER**: Acknowledge → Next angle → Specific data → With evidence → Exchange option → Reconfirm.

**Cookbook por objeção**:
• "Tá caro" → reconhece, inverte ROI (R$1k/mês de economia em ração), oferece Pronaf/parcela.
• "Vou pensar" → NÃO insista; agenda dia específico ("posso te ligar quinta 10h?").
• "Quero ver com sócio/esposa" → manda vídeo curto + ficha técnica PDF, agenda call de 15min com os dois.
• "Concorrente +barato" → pede print, compara item a item (potência motor, garantia, suporte BR).
• "Frete caro" → calcula por CEP, oferece coleta no nosso CD.
• "Prazo longo" → confirma realidade, mostra estoque alternativo.
• "Sem dinheiro" → muda etiqueta INTERESSE FUTURO + agenda retorno em 30/60d.

NUNCA: discuta com o cliente, dê desconto sem contrapartida, ignore a objeção.`,

  AGREGADO: `Você é o **Coach ESTRATEGISTA**. Pergunta agregada sobre a carteira inteira.

Foco: diagnosticar saúde do funil, priorizar ações, identificar oportunidades/riscos.

Formato:
- Lista 3-5 clientes prioritários (nome + estágio + trecho real + ação concreta)
- 1 recomendação geral ("foque em quentes parados >2d, eles fecham essa semana")
- Pode propor 1-2 actions específicas (criar_lembrete, marcar_etiqueta_sugerida) pra clientes mais críticos.`,
}

function roteadorSubAgente(pergunta: string, mensagensChat: any[] | undefined): string {
  const p = pergunta.toLowerCase()
  if (/quem (esta|está|tá)|funil|carteira|todos|ranking|quente[s]?|fechar hoje|risco|reativar|parado[s]?|diagnostic/i.test(p)) return 'AGREGADO'
  if (/objeç|caro|preço alto|concorrente|pensar|sócio|esposa|frete|prazo longo|sem dinheiro/i.test(p)) return 'QUEBRA_OBJECAO'
  if (/reanim|parado|sumiu|esfriou|reativar|frio/i.test(p)) return 'REANIMADOR'
  if (/fechar|fecha|boleto|pix|pagto|pagamento|frete|garantia|prazo|instalação|enviar\s+boleto/i.test(p)) return 'CLOSER'
  if (Array.isArray(mensagensChat) && mensagensChat.length < 5) return 'DISCOVERY'
  return 'CLOSER'
}

function montarSystemPrompt(subAgent: string): string {
  const especialista = SUB_AGENTS[subAgent] ?? SUB_AGENTS.CLOSER
  return `Você é o **Coach de Vendas Branorte** (sub-agente: ${subAgent}).

${especialista}

${PROMPT_BASE_BRANORTE}

${PROMPT_REGRAS_LEITURA}

${REGRA_ANTI_ALUCINACAO}

${PROMPT_FORMATO_RESPOSTA}`
}

function formatarMensagens(mensagens: any[], nomeContato: string, vendedor: string): string {
  if (!Array.isArray(mensagens) || mensagens.length === 0) return '(sem histórico)'
  const ord = [...mensagens].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
  const linhas: string[] = []
  for (const m of ord) {
    const tag = m.fromMe ? `🟢 EU (${vendedor})` : `🔵 CLIENTE (${nomeContato})`
    let conteudo = ''
    if (m.type === 'chat' || m.type === 'text') conteudo = m.body ?? ''
    else if (m.type === 'audio' || m.type === 'ptt') {
      const dur = m.duration ? `${Math.round(m.duration)}s` : ''
      conteudo = m.transcricao && String(m.transcricao).trim()
        ? `[ÁUDIO ${dur}] transcrito: "${String(m.transcricao).trim()}"`
        : `[ÁUDIO ${dur} - SEM transcrição]`
    } else if (m.type === 'image') conteudo = `[IMAGEM${m.caption ? ': "' + m.caption + '"' : ''}]`
    else if (m.type === 'video') conteudo = `[VÍDEO${m.caption ? ': "' + m.caption + '"' : ''}]`
    else if (m.type === 'document') conteudo = `[DOCUMENTO: ${m.filename ?? '?'}]`
    else if (m.type === 'sticker') conteudo = `[FIGURINHA]`
    else conteudo = `[${m.type}]`
    if (conteudo.length > 600) conteudo = conteudo.slice(0, 597) + '...'
    const ts = m.t ? new Date(m.t * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
    linhas.push(`[${ts}] ${tag}: ${conteudo}`)
  }
  return linhas.join('\n')
}

function calcularForecast(args: { mensagens: any[], estagio: string, saude: string }): { prob: number, motivo: string, features: any } {
  const { mensagens, estagio, saude } = args
  const m = Array.isArray(mensagens) ? mensagens : []
  const agora = Date.now() / 1000
  const ult = m.length ? Math.max(...m.map((x: any) => x.t ?? 0)) : 0
  const diasParado = ult ? (agora - ult) / 86400 : 999
  const totalCli = m.filter(x => !x.fromMe).length
  const totalEu = m.filter(x => x.fromMe).length
  const textoCli = m.filter(x => !x.fromMe).map((x: any) => x.body || x.transcricao || '').join(' ').toLowerCase()
  const sinaisFechamento = /\b(boleto|pix|prazo|garantia|frete|instalaç|quando posso|fechar|manda)\b/.test(textoCli)
  const sinaisInteresse = /\b(quanto|preço|preco|valor|orçamento|orcamento|disponível|disponivel|tem em estoque)\b/.test(textoCli)
  const sinaisRecusa = /\b(não tenho|nao tenho|sem dinheiro|caro demais|outra hora|depois eu|não|nao agora)\b/.test(textoCli)
  const estStr = String(estagio || '').toLowerCase()
  let prob = 5
  if (/clos|7\b/.test(estStr)) prob = 70
  else if (/solut|5\b/.test(estStr)) prob = 50
  else if (/object|6\b/.test(estStr)) prob = 40
  else if (/needs|4\b/.test(estStr)) prob = 30
  else if (/value|3\b/.test(estStr)) prob = 20
  else if (/qualif|2\b/.test(estStr)) prob = 12
  else if (/intro|1\b/.test(estStr)) prob = 6
  else if (/end|8\b|perdido/.test(estStr)) prob = 1
  const saStr = String(saude || '').toLowerCase()
  if (/quente|🔥/.test(saStr)) prob += 15
  else if (/morno|♨/.test(saStr)) prob += 5
  else if (/frio|❄/.test(saStr)) prob -= 10
  else if (/perdido|⚰/.test(saStr)) prob = Math.min(prob, 3)
  if (sinaisFechamento) prob += 15
  if (sinaisInteresse) prob += 5
  if (sinaisRecusa) prob -= 15
  if (totalCli >= 5 && totalEu >= 3) prob += 5
  if (diasParado > 7) prob -= 15
  else if (diasParado > 3) prob -= 8
  else if (diasParado < 1) prob += 5
  prob = Math.max(0, Math.min(99, Math.round(prob)))
  const motivos: string[] = []
  if (sinaisFechamento) motivos.push('cliente perguntou sobre boleto/prazo/PIX')
  else if (sinaisInteresse) motivos.push('cliente pediu preço/orçamento')
  else if (sinaisRecusa) motivos.push('cliente sinalizou recusa/sem dinheiro')
  if (diasParado > 7) motivos.push(`${Math.round(diasParado)}d parado`)
  else if (diasParado < 1) motivos.push('respondendo agora')
  const motivo = motivos.length ? motivos.join(' + ') : `estágio ${estagio || 'indefinido'}`
  return { prob, motivo, features: { estagio, saude, diasParado: Math.round(diasParado * 10) / 10, totalCli, totalEu, sinaisFechamento, sinaisInteresse, sinaisRecusa } }
}

function extrairActions(resposta: string): any[] {
  const m = resposta.match(/<actions>([\s\S]*?)<\/actions>/i)
  if (!m) return []
  try {
    const arr = JSON.parse(m[1].trim())
    if (!Array.isArray(arr)) return []
    return arr.slice(0, 3).filter((a: any) => a && typeof a === 'object' && a.type)
  } catch { return [] }
}

function limparActions(resposta: string): string {
  return resposta.replace(/<actions>[\s\S]*?<\/actions>/i, '').trim()
}

async function buscarGoldenExamples(supa: any, situacao: string, estagio: string | null): Promise<any[]> {
  if (!OPENAI_KEY || !supa) return []
  try {
    const er = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: situacao.slice(0, 1500) }),
    })
    if (!er.ok) return []
    const ej = await er.json()
    const emb = ej.data?.[0]?.embedding
    if (!emb) return []
    const { data } = await supa.rpc('match_golden_examples', {
      query_embedding: emb,
      match_estagio: estagio,
      match_count: 2,
      match_threshold: 0.65,
    })
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  if (!OPENAI_KEY) return new Response(JSON.stringify({ error: 'OPENAI_API_KEY nao configurada' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const { vendedor_nome, pergunta, contexto, historico, mensagens_chat, nome_contato, chat_id, imagens_url, forcar_agente } = body
  if (!pergunta || !vendedor_nome) {
    return new Response(JSON.stringify({ error: 'vendedor_nome e pergunta sao obrigatorios' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supa = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null

  const subAgent = (typeof forcar_agente === 'string' && SUB_AGENTS[forcar_agente]) ? forcar_agente : roteadorSubAgente(pergunta, mensagens_chat)
  const systemPrompt = montarSystemPrompt(subAgent)

  // 🔍 Anti-aluc.: detecta produto/segmento de TODA a conversa real
  const textoTotal = extrairTextoTotal(mensagens_chat) + ' ' + (contexto || '')
  const produto_detectado = detectarProduto(textoTotal)
  const segmento_detectado = detectarSegmento(textoTotal)

  let userPrompt = `VENDEDOR (eu): ${vendedor_nome}\nCLIENTE: ${nome_contato || 'desconhecido'}\n`
  if (chat_id) userPrompt += `chat_id: ${chat_id}\n`
  // 🚨 marcadores anti-aluc.
  userPrompt += `PRODUTO_DETECTADO: ${produto_detectado || '⛔ NÃO ESPECIFICADO — NÃO INVENTAR PRODUTO'}\n`
  userPrompt += `SEGMENTO_DETECTADO: ${segmento_detectado || '⛔ NÃO ESPECIFICADO — NÃO INVENTAR SEGMENTO'}\n`
  if (contexto) userPrompt += `\nDADOS DO CRM:\n${contexto}\n`
  if (mensagens_chat) {
    const conversa = formatarMensagens(mensagens_chat, nome_contato || 'CLIENTE', vendedor_nome)
    userPrompt += `\n=== CONVERSA (🟢 EU = vendedor, 🔵 CLIENTE = cliente) ===\n${conversa}\n=== FIM ===\n`
    const audiosSemTrans = mensagens_chat.filter((m: any) =>
      (m.type === 'audio' || m.type === 'ptt') && !m.transcricao
    ).length
    if (audiosSemTrans > 0) userPrompt += `\n⚠️ ${audiosSemTrans} áudio(s) sem transcrição.\n`
  }

  const situacaoResumo = `${pergunta} | sub:${subAgent} | cliente:${nome_contato || ''}`.slice(0, 500)
  const golden = supa ? await buscarGoldenExamples(supa, situacaoResumo, null) : []
  if (golden.length > 0) {
    userPrompt += `\n=== EXEMPLOS APROVADOS PELO VENDEDOR (use estilo similar) ===\n`
    for (const g of golden) {
      userPrompt += `Situação: ${g.situacao_resumo}\nResposta (👍 aprovada): ${String(g.resposta_aprovada).slice(0, 800)}\n---\n`
    }
  }

  userPrompt += `\nPERGUNTA DO VENDEDOR: ${pergunta}`

  const userContent: any = (Array.isArray(imagens_url) && imagens_url.length > 0)
    ? [{ type: 'text', text: userPrompt }, ...imagens_url.slice(0, 4).map((url: string) => ({ type: 'image_url', image_url: { url } }))]
    : userPrompt
  const useVision = Array.isArray(imagens_url) && imagens_url.length > 0
  const model = useVision ? 'gpt-4o' : 'gpt-4o-mini'
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(historico) ? historico.slice(-6) : []),
    { role: 'user', content: userContent },
  ]

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 1500 }),
    })
    if (!r.ok) {
      const txt = await r.text()
      return new Response(JSON.stringify({ error: 'openai_failed', status: r.status, detail: txt.slice(0, 300) }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const j = await r.json()
    const respostaRaw = j.choices?.[0]?.message?.content ?? '(sem resposta)'

    const actions = extrairActions(respostaRaw)
    const resposta = limparActions(respostaRaw)

    const matches = resposta.matchAll(/<msg>([\s\S]*?)<\/msg>/gi)
    const mensagem_sugerida = Array.from(matches).map(m => m[1].trim()).filter(Boolean)

    const estagioMatch = resposta.match(/Estágio[:\s\*]+([^\n]+)/i)
    const saudeMatch = resposta.match(/Saúde[:\s\*]+([^\n]+)/i)
    const estagio = estagioMatch?.[1]?.trim().replace(/\*+/g, '')
    const saude = saudeMatch?.[1]?.trim().replace(/\*+/g, '')

    const forecast = calcularForecast({ mensagens: mensagens_chat || [], estagio: estagio || '', saude: saude || '' })

    let actions_persisted: any[] = []
    if (supa && actions.length > 0) {
      const rows = actions.map(a => ({
        vendedor_nome,
        chat_id: chat_id || null,
        nome_contato: nome_contato || null,
        action_type: a.type,
        payload: a,
        motivo_ia: a.motivo || a.razao || null,
        pergunta_origem: pergunta.slice(0, 500),
      }))
      const { data, error } = await supa.from('coach_actions').insert(rows).select('id, action_type, payload, motivo_ia, status')
      if (!error && data) actions_persisted = data
    }

    if (supa && chat_id && forecast.prob >= 0) {
      await supa.from('coach_forecasts').upsert({
        vendedor_nome,
        chat_id,
        nome_contato: nome_contato || null,
        probabilidade: forecast.prob,
        estagio: estagio || null,
        saude: saude || null,
        features: forecast.features,
        motivo: forecast.motivo,
        data_ref: new Date().toISOString().slice(0, 10),
      }, { onConflict: 'chat_id,data_ref' })
    }

    const usage = j.usage ?? {}
    return new Response(JSON.stringify({
      ok: true,
      resposta,
      mensagem_sugerida,
      estagio,
      saude,
      sub_agent: subAgent,
      produto_detectado,
      segmento_detectado,
      actions: actions_persisted.length ? actions_persisted : actions.map(a => ({ ...a, status: 'pending' })),
      forecast: { probabilidade: forecast.prob, motivo: forecast.motivo },
      golden_used: golden.length,
      vision_used: useVision,
      model,
      usage,
    }), { headers: { ...CORS, 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'fetch_failed', detail: String(e) }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }
})
