/**
 * webhook-uazapi-disparachat
 *
 * DIREÇÃO 1: WhatsApp → DisparaChat
 *
 * Recebe webhook da UazAPI quando uma etiqueta é alterada (evento chat_labels).
 * Mapeia a etiqueta WhatsApp → tag DisparaChat e chama o webhook do DisparaChat.
 *
 * Webhook da UazAPI envia payload tipo:
 * {
 *   "event": "chat_labels",
 *   "data": {
 *     "chatid": "554884692860@s.whatsapp.net",
 *     "labels": ["28", "29"],           // labels atuais no chat
 *     "added": ["28"],                   // labels adicionadas
 *     "removed": ["26"]                  // labels removidas
 *   }
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mapeamento inverso: WhatsApp Label ID → Tag DisparaChat
// Labels no servidor branorte.uazapi.com
const LABEL_TO_TAG: Record<string, { tag: string; stageName: string }> = {
  "1": { tag: "SYNC-PROSPECCAO",       stageName: "PROSPECÇÃO" },
  "2": { tag: "SYNC-NOVO-LEAD",        stageName: "NOVO LEAD" },
  "3": { tag: "SYNC-FOLLOW-UP",        stageName: "FOLLOW UP" },
  "4": { tag: "SYNC-2-TENTATIVA",      stageName: "2 TENTATIVA" },
  "5": { tag: "SYNC-INTERESSE-FUTURO", stageName: "INTERESSE FUTURO" },
  "6": { tag: "SYNC-GANHO",            stageName: "Ganho" },
  "7": { tag: "SYNC-PERDIDO",          stageName: "Perdido" },
};

// Todas as tags de sync (pra remover as anteriores)
const ALL_SYNC_TAGS = Object.values(LABEL_TO_TAG).map(v => v.tag);

function extractPhone(chatId: string): string {
  // "554884692860@s.whatsapp.net" → "554884692860"
  return String(chatId || "").replace(/@.*$/, "").replace(/\D/g, "");
}

async function callDisparachatWebhook(
  webhookUrl: string,
  phone: string,
  tagToAdd: string,
  tagsToRemove: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    // Chama o webhook do DisparaChat para adicionar a tag
    // O webhook do DisparaChat espera dados que serão mapeados para campos do contato
    const payload = {
      phone: phone,
      tag: tagToAdd,
      tags_remove: tagsToRemove,
      source: "whatsapp-sync",
      timestamp: new Date().toISOString(),
    };

    console.log(`Chamando DisparaChat webhook: ${webhookUrl}`);
    console.log(`Payload:`, JSON.stringify(payload));

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `DisparaChat webhook error ${response.status}: ${text}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // URL do webhook do DisparaChat (configurado em Automações → Webhooks)
    const DISPARACHAT_WEBHOOK_URL = Deno.env.get("DISPARACHAT_WEBHOOK_URL");
    if (!DISPARACHAT_WEBHOOK_URL) {
      throw new Error("DISPARACHAT_WEBHOOK_URL não configurado");
    }

    const body = await req.json();

    console.log(`[webhook-uazapi-disparachat] Evento recebido:`, JSON.stringify(body).substring(0, 500));

    // Extrair dados do webhook da UazAPI
    // O formato pode variar - vamos tratar os casos comuns
    const event = body.event || body.type || "";
    const data = body.data || body;

    // Só processa eventos de chat_labels
    if (event && event !== "chat_labels" && event !== "labels") {
      console.log(`Evento "${event}" ignorado (só processa chat_labels)`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: `Evento "${event}" não relevante` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extrair phone e labels
    const chatId = data.chatid || data.chat_id || data.number || data.from || "";
    const phone = extractPhone(chatId);
    const addedLabels: string[] = data.added || [];
    const removedLabels: string[] = data.removed || [];
    const currentLabels: string[] = data.labels || data.label_ids || [];

    if (!phone) {
      throw new Error(`Não foi possível extrair telefone do payload: ${JSON.stringify(data).substring(0, 200)}`);
    }

    console.log(`Phone: ${phone}, Added: ${addedLabels}, Removed: ${removedLabels}, Current: ${currentLabels}`);

    // Encontrar qual label de funil foi ADICIONADA
    const funnelLabelAdded = addedLabels.find(id => LABEL_TO_TAG[id]);

    if (!funnelLabelAdded) {
      // Nenhuma label de funil foi adicionada — pode ser label de qualificação ou outra
      console.log("Nenhuma label de funil detectada nas adições. Ignorando.");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "Nenhuma label de funil adicionada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mapping = LABEL_TO_TAG[funnelLabelAdded];
    console.log(`Label ${funnelLabelAdded} mapeada para tag "${mapping.tag}" (${mapping.stageName})`);

    // Tags a remover (todas as outras de sync)
    const tagsToRemove = ALL_SYNC_TAGS.filter(t => t !== mapping.tag);

    // Chamar webhook do DisparaChat
    const result = await callDisparachatWebhook(
      DISPARACHAT_WEBHOOK_URL,
      phone,
      mapping.tag,
      tagsToRemove,
    );

    if (!result.success) {
      console.error("Erro ao chamar DisparaChat:", result.error);
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
      );
    }

    console.log(`Sync completo: WhatsApp label ${funnelLabelAdded} → DisparaChat tag ${mapping.tag}`);

    return new Response(
      JSON.stringify({
        success: true,
        phone,
        whatsapp_label_id: funnelLabelAdded,
        disparachat_tag: mapping.tag,
        stage_name: mapping.stageName,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[webhook-uazapi-disparachat] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
