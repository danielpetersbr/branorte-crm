import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DIGISAC_BASE = Deno.env.get("DIGISAC_BASE_URL") ?? "https://mbranorte2.digisac.io/api/v1";
const DIGISAC_TOKEN = Deno.env.get("DIGISAC_TOKEN") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function digisacGet(path: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${DIGISAC_BASE}/${path}`, {
        headers: {
          Authorization: `Bearer ${DIGISAC_TOKEN}`,
          "User-Agent": "Mozilla/5.0",
        },
      });
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!resp.ok) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return await resp.json();
    } catch (e) {
      console.log(`Error: ${e}, retry ${attempt + 1}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

async function fetchMessages(contactId: string, limit = 30): Promise<any[]> {
  const data = await digisacGet(
    `messages?where[contactId]=${contactId}&limit=${limit}&order[0][0]=createdAt&order[0][1]=DESC`
  );
  return data?.data ?? [];
}

async function analyzeWithAI(vendorName: string, contactName: string, messages: any[]): Promise<any> {
  if (!GEMINI_KEY) return { error: "GEMINI_API_KEY not configured" };

  const conversation = messages
    .reverse()
    .map((m: any) => {
      const sender = m.fromMe ? `VENDEDOR (${vendorName})` : `CLIENTE (${contactName})`;
      const time = new Date(m.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const text = m.text || m.caption || "[midia]";
      return `[${time}] ${sender}: ${text}`;
    })
    .join("\n");

  const prompt = `Voce e o GESTOR COMERCIAL da BRANORTE INDUSTRIA METALURGICA, especialista em analisar conversas de vendedores no WhatsApp.

CONTEXTO DA EMPRESA:
- Produto: Maquinas industriais para fabricas de racao animal (misturadores, peletizadoras, extrusoras, silos, transportadores)
- Mercado: B2B, ticket alto (medio R$ 21.690, deals grandes chegam a R$ 300K+), venda consultiva
- Canal: 93% WhatsApp
- Ciclo de venda: Semanas a meses
- ICP: Donos/gerentes de producao/diretores industriais de fabricas de racao animal
- Objecoes mais comuns: Preco alto, prazo de entrega, aprovacao interna

CONVERSA PARA ANALISAR:
${conversation}

Responda APENAS em JSON valido. Sem markdown, sem explicacao, sem texto antes ou depois do JSON.

Estrutura EXATA:
{
  "score": <0-100 nota do vendedor>,
  "acertos": ["<ponto positivo 1>", "<ponto positivo 2>"],
  "erros": ["<erro 1>", "<erro 2>"],
  "ultima_msg_vendedor": "<resumo da ultima msg do vendedor>",
  "ultima_msg_cliente": "<resumo da ultima msg do cliente>",
  "status_conversa": "<ativa|esperando_cliente|esperando_vendedor|abandonada|finalizada>",
  "dias_parado": <numero de dias desde ultima interacao>,
  "proxima_acao": "<acao especifica que o vendedor deve fazer AGORA>",
  "sentimento_cliente": "<positivo|neutro|negativo|frustrado>",
  "tem_agendamento": <true/false se mencionou data/horario para reuniao/visita>,
  "temperatura_lead": "<quente|morno|frio|descartar>",
  "resumo": "<resumo de 2 linhas da conversa>"
}

CRITERIOS DE AVALIACAO BRANORTE (peso na nota):

1. VELOCIDADE DE RESPOSTA (peso 20%):
   - Ideal: < 15 min para primeira resposta
   - Aceitavel: < 1h
   - Ruim: > 4h (media da equipe e 22h - isso e CRITICO)
   - Pessimo: > 24h

2. QUALIFICACAO NEPQ (peso 25%) - Vendedor fez estas perguntas?
   - Capacidade de producao atual da fabrica
   - Onde o processo trava (gargalos)
   - Impacto de nao resolver o problema em 6 meses
   - Quem mais decide a compra (decisores)
   - Tem budget aprovado ou esta em avaliacao
   - Qual a urgencia / prazo

3. APRESENTACAO DE SOLUCAO (peso 20%):
   - Personalizou para o tipo de fabrica do cliente?
   - Mencionou maquinas especificas da Branorte?
   - Falou de capacidade produtiva, nao so preco?
   - Tratou objecao de preco com custo de oportunidade?

4. FOLLOW-UP E FECHAMENTO (peso 20%):
   - Tentou agendar visita tecnica ou reuniao?
   - Fez follow-up no prazo correto? (D+0 qualificar, D+3 sem resposta, D+7 reengajamento)
   - Manteve conversa ativa (nao deixou morrer)?
   - Propoe proximo passo concreto?

5. COMUNICACAO (peso 15%):
   - Tom profissional mas amigavel
   - Resposta completa (nao monossilabica)
   - Se cliente perguntou, respondeu tudo
   - Nao manda audio longo sem texto de apoio

ERROS GRAVES (reduzem score em 15-25 pontos cada):
- Deixar cliente sem resposta por >24h (media da equipe e 22h - INACEITAVEL)
- Cliente esperando e vendedor sumiu (29% dos cards ficam abandonados >7 dias)
- Nao qualificar lead - responder preco sem perguntar sobre a fabrica
- Nao fazer follow-up apos enviar proposta
- Ignorar pergunta do cliente
- Conversa morreu e vendedor nao reativou
- Lead quente (prazo definido + budget) e vendedor demorou >4h

CLASSIFICACAO DE TEMPERATURA DO LEAD:
- QUENTE: Prazo definido + budget aprovado ou em aprovacao
- MORNO: Interesse real demonstrado, prazo vago
- FRIO: Pediu preco sem dar contexto, so curiosidade
- DESCARTAR: Sem budget / sem fit / fora do ICP (nao e fabrica de racao)`;

  // Retry with backoff for rate limits (Gemini free tier = 15 RPM)
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1000,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (resp.status === 429) {
      const wait = (attempt + 1) * 5000; // 5s, 10s, 15s
      console.log(`Gemini 429 rate limit, waiting ${wait}ms (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`Gemini error: ${err.slice(0, 200)}`);
      return { error: `Gemini ${resp.status}` };
    }

    const data = await resp.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    try {
      return JSON.parse(content.replace(/```json\n?/g, "").replace(/```/g, "").trim());
    } catch {
      return { error: "Failed to parse AI response", raw: content.slice(0, 500) };
    }
  }

  return { error: "Gemini rate limit exceeded after 3 retries" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const { vendor_id, limit: cardLimit } = body as { vendor_id?: string; limit?: number };
    const maxCards = Math.min(cardLimit ?? 20, 50);

    // Get cards with recent activity (not archived, not finalized)
    let query = supabase
      .from("cards")
      .select("id, contact_id, contact_name, contact_phone, owner_id, last_message_at, pipeline_stage_id, total_value_cents, subject")
      .eq("is_archived", false)
      .not("contact_id", "is", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(maxCards);

    if (vendor_id) {
      query = query.eq("owner_id", vendor_id);
    }

    const { data: cards, error: cardsError } = await query;
    if (cardsError) throw cardsError;
    if (!cards?.length) {
      return new Response(
        JSON.stringify({ ok: true, analyses: [], message: "No cards found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get vendor names
    const { data: vendors } = await supabase.from("vendors").select("id, name");
    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    // Get stage names
    const { data: stages } = await supabase.from("pipeline_stages").select("id, name");
    const stageMap = new Map((stages ?? []).map((s: any) => [s.id, s.name]));

    // Analyze each card's conversation (1 at a time to respect Gemini free tier rate limits)
    const analyses: any[] = [];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const vendorName = vendorMap.get(card.owner_id) ?? "Vendedor";
      const messages = await fetchMessages(card.contact_id);

      if (messages.length < 2) {
        analyses.push({
          card_id: card.id,
          contact_name: card.contact_name,
          contact_phone: card.contact_phone,
          vendor_name: vendorName,
          stage: stageMap.get(card.pipeline_stage_id) ?? "Desconhecido",
          value_cents: card.total_value_cents,
          last_message_at: card.last_message_at,
          analysis: {
            score: 0,
            status_conversa: "sem_mensagens",
            resumo: "Conversa sem mensagens suficientes para analise",
            erros: ["Sem interacao com o cliente"],
            acertos: [],
            proxima_acao: "Iniciar contato com o cliente",
            dias_parado: card.last_message_at
              ? Math.floor((Date.now() - new Date(card.last_message_at).getTime()) / 86400000)
              : 999,
          },
          message_count: messages.length,
        });
        continue;
      }

      const analysis = await analyzeWithAI(vendorName, card.contact_name, messages);

      analyses.push({
        card_id: card.id,
        contact_name: card.contact_name,
        contact_phone: card.contact_phone,
        vendor_name: vendorName,
        stage: stageMap.get(card.pipeline_stage_id) ?? "Desconhecido",
        value_cents: card.total_value_cents,
        last_message_at: card.last_message_at,
        analysis,
        message_count: messages.length,
      });

      // Rate limit: wait 2s between Gemini calls (free tier = 15 RPM)
      if (i < cards.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Save to conversation_analyses table
    const upserts = analyses.map((a) => ({
      card_id: a.card_id,
      vendor_name: a.vendor_name,
      contact_name: a.contact_name,
      contact_phone: a.contact_phone,
      stage: a.stage,
      value_cents: a.value_cents,
      score: a.analysis?.score ?? 0,
      status: a.analysis?.status_conversa ?? "unknown",
      analysis_json: a.analysis,
      message_count: a.message_count,
      last_message_at: a.last_message_at,
      analyzed_at: new Date().toISOString(),
    }));

    await supabase
      .from("conversation_analyses")
      .upsert(upserts, { onConflict: "card_id" })
      .then(({ error }) => {
        if (error) console.error("Upsert error:", error.message);
      });

    // Summary stats
    const avgScore = analyses.reduce((s, a) => s + (a.analysis?.score ?? 0), 0) / analyses.length;
    const waiting = analyses.filter((a) => a.analysis?.status_conversa === "esperando_vendedor").length;
    const abandoned = analyses.filter((a) => (a.analysis?.dias_parado ?? 0) > 1).length;
    const noSchedule = analyses.filter((a) => a.analysis?.tem_agendamento === false).length;

    return new Response(
      JSON.stringify({
        ok: true,
        summary: {
          total_analyzed: analyses.length,
          avg_score: Math.round(avgScore),
          waiting_vendor_reply: waiting,
          abandoned_1d: abandoned,
          no_scheduling: noSchedule,
        },
        analyses,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Analysis error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
