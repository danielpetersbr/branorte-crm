/**
 * sync-disparachat-whatsapp
 *
 * DIREÇÃO 2: DisparaChat → WhatsApp
 *
 * Quando uma tag SYNC-* é adicionada no DisparaChat, a automação
 * "Enviar Solicitação Externa" chama esta Edge Function.
 * Esta função mapeia a tag → etiqueta WhatsApp e aplica via UazAPI.
 *
 * Payload esperado do DisparaChat (Enviar Solicitação Externa):
 * {
 *   "phone": "554884692860",        // telefone do contato
 *   "tag": "SYNC-PROSPECCAO",       // tag adicionada
 *   "action": "add" | "remove",     // ação (default: "add")
 *   "contact_name": "João Silva"    // nome do contato (opcional)
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mapeamento: Tag DisparaChat → WhatsApp Label ID
// Labels criadas no WhatsApp do Daniel (branorte.uazapi.com)
const TAG_TO_LABEL: Record<string, { labelId: string; labelName: string }> = {
  "SYNC-PROSPECCAO":        { labelId: "1", labelName: "PROSPECÇÃO" },
  "SYNC-NOVO-LEAD":         { labelId: "2", labelName: "NOVO LEAD" },
  "SYNC-FOLLOW-UP":         { labelId: "3", labelName: "FOLLOW UP" },
  "SYNC-2-TENTATIVA":       { labelId: "4", labelName: "2 TENTATIVA" },
  "SYNC-INTERESSE-FUTURO":  { labelId: "5", labelName: "INTERESSE FUTURO" },
  "SYNC-GANHO":             { labelId: "6", labelName: "Ganho" },
  "SYNC-PERDIDO":           { labelId: "7", labelName: "Perdido" },
};

// Todas as label IDs de funil (pra remover as anteriores ao mover)
const ALL_FUNNEL_LABEL_IDS = ["1", "2", "3", "4", "5", "6", "7"];

// Tags de IA que devem ser registradas em lead_events
const IA_TAG_MAP: Record<string, { event_type: string; reason?: string }> = {
  "IA ATENDENDO": { event_type: "ia_started" },
  "IA-ATENDENDO": { event_type: "ia_started" },
  "HUMANO": { event_type: "ia_transferred" },
  "PIPELINE OK": { event_type: "ia_transferred" },
  "PIPELINE-OK": { event_type: "ia_transferred" },
  "IA FINALIZOU": { event_type: "ia_finished" },
  "IA-FINALIZOU": { event_type: "ia_finished" },
  "ENCERRADO INATIVIDADE": { event_type: "ia_finished", reason: "inatividade" },
  "ENCERRADO-INATIVIDADE": { event_type: "ia_finished", reason: "inatividade" },
  "ENCERRADO CLIENTE": { event_type: "ia_finished", reason: "cliente_encerrou" },
  "ENCERRADO-CLIENTE": { event_type: "ia_finished", reason: "cliente_encerrou" },
};

function extractAdCode(text: string): string | null {
  if (!text) return null;
  const m1 = text.match(/&(\d+)/);
  if (m1) return `&${m1[1]}`;
  const m2 = text.match(/#LP(\w+)/i);
  if (m2) return `#LP${m2[1]}`;
  return null;
}

async function recordLeadEvent(phone: string, contactName: string, tag: string, iaConfig: { event_type: string; reason?: string }) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const row = {
    contact_phone: "+" + phone,
    contact_name: contactName || null,
    event_type: iaConfig.event_type,
    ad_source: extractAdCode(contactName),
    vendor_name: iaConfig.event_type === "ia_transferred" ? (contactName || null) : null,
    reason: iaConfig.reason ?? null,
    metadata: { source: "sync-disparachat-whatsapp", original_tag: tag },
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lead_events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Prefer": "return=minimal" },
      body: JSON.stringify(row),
    });
    console.log(`[lead_events] Inserted ${iaConfig.event_type} for ${phone}: ${r.status}`);
  } catch (e) {
    console.error(`[lead_events] Error inserting: ${e}`);
  }
}

function normalizePhone(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeTag(tag: string): string {
  return String(tag || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[ÀÁÂÃ]/g, "A")
    .replace(/[ÉÊ]/g, "E")
    .replace(/[ÍÎ]/g, "I")
    .replace(/[ÓÔÕ]/g, "O")
    .replace(/[ÚÜ]/g, "U")
    .replace(/Ç/g, "C");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const UAZAPI_URL = Deno.env.get("UAZAPI_URL") || "https://free.uazapi.com";
    const UAZAPI_TOKEN = Deno.env.get("UAZAPI_TOKEN");

    if (!UAZAPI_TOKEN) {
      throw new Error("UAZAPI_TOKEN não configurado");
    }

    const body = await req.json();

    // Log full payload for debugging
    console.log(`[sync-dw] RAW PAYLOAD: ${JSON.stringify(body).substring(0, 500)}`);

    // Accept multiple field name formats (DisparaChat auto-context vs manual)
    const phone = normalizePhone(body.phone || body.contact_phone || body.contact?.phone || body.contact_id || "");
    const tag = normalizeTag(body.tag || body.trigger_tag || body.tag_name || body.label || "");
    const action = body.action || "add";
    const contactName = body.contact_name || body.name || body.contact?.name || "";

    console.log(`[sync-dw] phone=${phone} tag=${tag} action=${action} contact=${contactName}`);

    // Check if this is an IA-related tag → record lead event
    const rawTag = String(body.tag || body.trigger_tag || body.tag_name || body.label || "").trim();
    const iaTagNormalized = rawTag.toUpperCase();
    const iaConfig = IA_TAG_MAP[iaTagNormalized] || IA_TAG_MAP[rawTag] || IA_TAG_MAP[tag];
    if (iaConfig) {
      console.log(`[IA TAG DETECTED] "${rawTag}" → ${iaConfig.event_type} phone=${phone} name=${contactName}`);
      await recordLeadEvent(phone || "unknown", contactName, rawTag, iaConfig);
      // Return success immediately for IA events
      return new Response(
        JSON.stringify({ success: true, ia_event_recorded: true, event_type: iaConfig.event_type, phone, tag: rawTag }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!phone) {
      throw new Error("Telefone ausente ou inválido");
    }

    const mapping = TAG_TO_LABEL[tag];
    if (!mapping) {
      // Even if tag is not in SYNC mapping, if it was an IA tag we already recorded it
      if (iaConfig) {
        return new Response(
          JSON.stringify({ success: true, ia_event_recorded: true, event_type: iaConfig.event_type }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`Tag "${tag}" não está no mapeamento. Tags válidas: ${Object.keys(TAG_TO_LABEL).join(", ")}`);
      return new Response(
        JSON.stringify({ success: false, error: `Tag "${body.tag}" não mapeada`, validTags: Object.keys(TAG_TO_LABEL) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (action === "add") {
      // 1. Adiciona a etiqueta alvo
      const addRes = await fetch(`${UAZAPI_URL}/chat/labels`, {
        method: "POST",
        headers: { "token": UAZAPI_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, add_labelid: mapping.labelId }),
      });

      if (!addRes.ok) {
        const errText = await addRes.text();
        throw new Error(`Erro ao adicionar label ${mapping.labelId}: ${addRes.status} - ${errText}`);
      }

      console.log(`Label ${mapping.labelId} (${mapping.labelName}) adicionada ao ${phone}`);

      // 2. Remove as outras etiquetas de funil (exclusão mútua)
      const toRemove = ALL_FUNNEL_LABEL_IDS.filter(id => id !== mapping.labelId);
      for (const labelId of toRemove) {
        try {
          await fetch(`${UAZAPI_URL}/chat/labels`, {
            method: "POST",
            headers: { "token": UAZAPI_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ number: phone, remove_labelid: labelId }),
          });
        } catch (e) {
          console.warn(`Aviso ao remover label ${labelId}:`, e);
        }
      }

      console.log(`Labels antigas removidas. Sync completo.`);

    } else if (action === "remove") {
      // Apenas remove a etiqueta
      await fetch(`${UAZAPI_URL}/chat/labels`, {
        method: "POST",
        headers: { "token": UAZAPI_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, remove_labelid: mapping.labelId }),
      });
      console.log(`Label ${mapping.labelId} (${mapping.labelName}) removida do ${phone}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        phone,
        tag: body.tag,
        action,
        whatsapp_label: mapping.labelName,
        whatsapp_label_id: mapping.labelId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[sync-disparachat-whatsapp] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
