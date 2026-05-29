import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DIGISAC_BASE = Deno.env.get("DIGISAC_BASE_URL") ?? "https://mbranorte2.digisac.io/api/v1";
const DIGISAC_TOKEN = Deno.env.get("DIGISAC_TOKEN") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
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
  if (!OPENAI_KEY) return { error: "OPENAI_API_KEY not configured" };

  const conversation = messages
    .reverse()
    .map((m: any) => {
      const sender = m.fromMe ? `VENDEDOR (${vendorName})` : `CLIENTE (${contactName})`;
      const time = new Date(m.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const text = m.text || m.caption || "[midia]";
      return `[${time}] ${sender}: ${text}`;
    })
    .join("\n");

  const prompt = `Voce e um analista de vendas especialista. Analise esta conversa entre um vendedor da Branorte (empresa de insumos agricolas) e um cliente potencial.

CONVERSA:
${conversation}

Responda em JSON com esta estrutura EXATA:
{
  "score": <0-100 nota geral do vendedor nesta conversa>,
  "acertos": ["<ponto positivo 1>", "<ponto positivo 2>"],
  "erros": ["<erro 1>", "<erro 2>"],
  "ultima_msg_vendedor": "<resumo da ultima msg do vendedor>",
  "ultima_msg_cliente": "<resumo da ultima msg do cliente>",
  "status_conversa": "<ativa|esperando_cliente|esperando_vendedor|abandonada|finalizada>",
  "dias_parado": <numero de dias desde ultima interacao>,
  "proxima_acao": "<o que o vendedor deveria fazer agora>",
  "sentimento_cliente": "<positivo|neutro|negativo|frustrado>",
  "tem_agendamento": <true/false se mencionou data/horario para reuniao>,
  "resumo": "<resumo de 2 linhas da conversa>"
}

CRITERIOS DE AVALIACAO:
- Vendedor respondeu rapido? (ideal < 1h)
- Fez perguntas de qualificacao? (area plantada, cultura, regiao)
- Apresentou solucao personalizada?
- Tentou agendar visita/reuniao?
- Manteve conversa ativa (nao deixou morrer)?
- Usou tom profissional mas amigavel?
- Se cliente perguntou algo, respondeu completamente?

ERROS COMUNS:
- Deixar cliente sem resposta por >24h
- Nao fazer follow-up apos proposta
- Respostas monossilabicas
- Nao qualificar o lead
- Nao tentar fechar/agendar
- Mandar audio longo sem texto
- Ignorar pergunta do cliente`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Voce responde APENAS em JSON valido. Sem markdown, sem explicacao." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`OpenAI error: ${err.slice(0, 200)}`);
    return { error: `OpenAI ${resp.status}` };
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";

  try {
    return JSON.parse(content.replace(/```json\n?/g, "").replace(/```/g, "").trim());
  } catch {
    return { error: "Failed to parse AI response", raw: content.slice(0, 500) };
  }
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

    // Analyze each card's conversation (3 at a time)
    const analyses: any[] = [];
    const batchSize = 3;

    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (card: any) => {
          const vendorName = vendorMap.get(card.owner_id) ?? "Vendedor";
          const messages = await fetchMessages(card.contact_id);

          if (messages.length < 2) {
            return {
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
            };
          }

          const analysis = await analyzeWithAI(vendorName, card.contact_name, messages);

          return {
            card_id: card.id,
            contact_name: card.contact_name,
            contact_phone: card.contact_phone,
            vendor_name: vendorName,
            stage: stageMap.get(card.pipeline_stage_id) ?? "Desconhecido",
            value_cents: card.total_value_cents,
            last_message_at: card.last_message_at,
            analysis,
            message_count: messages.length,
          };
        })
      );
      analyses.push(...results);
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
