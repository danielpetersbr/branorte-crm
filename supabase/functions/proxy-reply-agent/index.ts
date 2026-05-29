import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const REPLY_BASE = Deno.env.get("REPLY_BASE_URL") ?? "https://ra-bcknd.com/v1";
const REPLY_TOKEN = Deno.env.get("REPLY_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Custom field slug used to pass the vendor's custom message into the flow template
// Uses existing field: "[ MSG PARA CLIENTE ]" (id=30047, slug=_msg_para_cliente_)
const CUSTOM_MSG_FIELD = "_msg_para_cliente_";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Build candidate phone numbers to try in Reply Agent.
 *  Reply Agent stores 10-digit local numbers (no 9th digit): +55 DDD 8digits
 *  Supabase cards may store 11-digit numbers (with 9th digit): +55 DDD 9 8digits
 *  We try both formats so lookups work regardless of how the number is stored.
 */
function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  // Strip leading 55 country code if present
  const local = digits.startsWith("55") ? digits.slice(2) : digits;

  const variants = new Set<string>();

  // DDD (2 digits) + subscriber
  if (local.length === 11) {
    // 11 digits: DDD + 9 + 8-digit number → try with and without the leading 9
    const ddd = local.slice(0, 2);
    const sub11 = local.slice(2); // "9XXXXXXXX"
    const sub10 = sub11.startsWith("9") ? sub11.slice(1) : sub11; // "XXXXXXXX"
    variants.add("+55" + ddd + sub11); // original with 9
    variants.add("+55" + ddd + sub10); // without 9 (Reply Agent format)
  } else if (local.length === 10) {
    // 10 digits: DDD + 8-digit → try with and without leading 9
    const ddd = local.slice(0, 2);
    const sub = local.slice(2); // "XXXXXXXX"
    variants.add("+55" + ddd + sub);   // as-is
    variants.add("+55" + ddd + "9" + sub); // add 9
  } else {
    // Unknown format — try as-is with country code
    variants.add("+55" + local);
  }

  return [...variants];
}

/** Find the Reply Agent contact ID by WhatsApp phone number */
async function findContact(phone: string): Promise<string | null> {
  const candidates = phoneVariants(phone);

  for (const candidate of candidates) {
    const resp = await fetch(`${REPLY_BASE}/fetch-contacts-by-whatsapp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLY_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ whatsapp_number: candidate }),
    });

    if (!resp.ok) {
      console.error(`findContact(${candidate}) HTTP ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    const contacts = data?.data ?? [];
    if (contacts.length > 0) {
      console.log(`findContact matched: ${candidate} → id=${contacts[0].id}`);
      return String(contacts[0].id);
    }
    console.log(`findContact no match: ${candidate}`);
  }

  return null;
}

/** Set a custom field value on a Reply Agent contact */
async function setCustomField(contactId: string, fieldName: string, value: string): Promise<void> {
  const resp = await fetch(`${REPLY_BASE}/contacts/${contactId}/set-custom-field`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${REPLY_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ field_value: value, system_name: fieldName }),
  });
  if (!resp.ok) {
    console.error(`setCustomField failed ${resp.status}: ${await resp.text()}`);
  }
}

/** Send a smart flow (automation) to a contact via multipart/form-data */
async function sendFlow(automationId: number, contactId: string): Promise<{ ok: boolean; error?: string }> {
  const boundary = "----FormBoundary" + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="automation_id"\r\n\r\n${automationId}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="contact_id"\r\n\r\n${contactId}\r\n` +
    `--${boundary}--\r\n`;

  const resp = await fetch(`${REPLY_BASE}/send-a-flow`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLY_TOKEN}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` };
  }
  return { ok: true };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const body = await req.json();
    const { action } = body;

    // ─── Send flow immediately ────────────────────────────────────────────────
    if (action === "send-flow") {
      const { phone, flow_id, flow_name, contact_name, card_id, custom_message } = body;

      if (!phone || !flow_id) {
        return new Response(
          JSON.stringify({ error: "Missing phone or flow_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Insert log row (success updated below)
      const { data: logRow } = await supabase
        .from("flow_send_log")
        .insert({ phone, flow_id, flow_name, contact_name, success: false })
        .select("id")
        .single();
      const logId = logRow?.id;

      // Dev mode (no token)
      if (!REPLY_TOKEN) {
        console.log("[DEV] Would send flow:", { phone, flow_id, flow_name, custom_message });
        if (logId) await supabase.from("flow_send_log").update({ success: true }).eq("id", logId);
        return new Response(
          JSON.stringify({ success: true, dev_mode: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 1. Find contact in Reply Agent
      const contactId = await findContact(phone);
      if (!contactId) {
        const errMsg = `Contato não encontrado no Reply Agent: ${phone}`;
        if (logId) await supabase.from("flow_send_log").update({ success: false, error_message: errMsg }).eq("id", logId);
        return new Response(
          JSON.stringify({ error: errMsg }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 2. Set custom message field (if provided)
      if (custom_message?.trim()) {
        await setCustomField(contactId, CUSTOM_MSG_FIELD, custom_message.trim());
      }

      // 3. Send the flow
      const result = await sendFlow(flow_id, contactId);

      if (logId) {
        await supabase.from("flow_send_log").update({
          success: result.ok,
          error_message: result.error ?? null,
          reply_contact_id: contactId,
        }).eq("id", logId);
      }

      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, contact_id: contactId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
