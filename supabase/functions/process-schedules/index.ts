import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const REPLY_BASE = Deno.env.get("REPLY_BASE_URL") ?? "https://ra-bcknd.com/v1";
const REPLY_TOKEN = Deno.env.get("REPLY_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Uses existing Reply Agent field: "[ MSG PARA CLIENTE ]" (id=30047, slug=_msg_para_cliente_)
const CUSTOM_MSG_FIELD = "_msg_para_cliente_";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const variants = new Set<string>();
  if (local.length === 11) {
    const ddd = local.slice(0, 2);
    const sub11 = local.slice(2);
    const sub10 = sub11.startsWith("9") ? sub11.slice(1) : sub11;
    variants.add("+55" + ddd + sub11);
    variants.add("+55" + ddd + sub10);
  } else if (local.length === 10) {
    const ddd = local.slice(0, 2);
    const sub = local.slice(2);
    variants.add("+55" + ddd + sub);
    variants.add("+55" + ddd + "9" + sub);
  } else {
    variants.add("+55" + local);
  }
  return [...variants];
}

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
    if (!resp.ok) continue;
    const data = await resp.json();
    const contacts = data?.data ?? [];
    if (contacts.length > 0) {
      console.log(`[SCHEDULE] findContact matched: ${candidate} → id=${contacts[0].id}`);
      return String(contacts[0].id);
    }
  }
  return null;
}

async function setCustomField(contactId: string, fieldName: string, value: string): Promise<void> {
  await fetch(`${REPLY_BASE}/contacts/${contactId}/set-custom-field`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${REPLY_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ field_value: value, system_name: fieldName }),
  });
}

// Trigger flow via Visual API endpoint (configured in Reply Agent as API trigger)
// The api_trigger_slug is stored in smart_flows.api_trigger_slug
async function triggerViaApiVisual(
  apiTriggerSlug: string,
  contactId: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${REPLY_BASE}/api-trigger/${apiTriggerSlug}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLY_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ contact_id: contactId }),
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
    const now = new Date().toISOString();

    // Fetch pending schedules that are due (up to 10 per invocation)
    const { data: dueSchedules, error } = await supabase
      .from("scheduled_flows")
      .select("*, smart_flows(id, name, api_trigger_slug)")
      .eq("status", "pending")
      .lte("send_at", now)
      .order("send_at", { ascending: true })
      .limit(10);

    if (error) throw error;
    if (!dueSchedules?.length) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0;
    let succeeded = 0;

    for (const schedule of dueSchedules) {
      // Optimistic lock: mark as sending to avoid double-processing
      const { error: lockErr } = await supabase
        .from("scheduled_flows")
        .update({ status: "sending" })
        .eq("id", schedule.id)
        .eq("status", "pending");

      if (lockErr) {
        console.error(`Failed to lock schedule ${schedule.id}:`, lockErr);
        continue;
      }

      console.log(`[SCHEDULE] Firing: ${schedule.flow_name} -> ${schedule.phone}`);

      const contactId = await findContact(schedule.phone);
      let result: { ok: boolean; error?: string };

      if (contactId) {
        // Set custom message field if present
        if (schedule.custom_message?.trim()) {
          await setCustomField(contactId, CUSTOM_MSG_FIELD, schedule.custom_message.trim());
        }

        // Use API Visual trigger if configured, fallback to send-a-flow
        const apiSlug = schedule.smart_flows?.api_trigger_slug;
        if (apiSlug) {
          result = await triggerViaApiVisual(apiSlug, contactId);
        } else {
          // Fallback: old send-a-flow method
          const boundary = "----FormBoundary" + Date.now();
          const body =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="automation_id"\r\n\r\n${schedule.flow_id}\r\n` +
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
            result = { ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` };
          } else {
            result = { ok: true };
          }
        }
      } else {
        result = { ok: false, error: `Contato não encontrado: ${schedule.phone}` };
      }

      // Update schedule status
      await supabase
        .from("scheduled_flows")
        .update({
          status: result.ok ? "sent" : "failed",
          result: result.ok ? "OK" : (result.error ?? "Erro desconhecido"),
          executed_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);

      // Append to send log
      await supabase.from("flow_send_log").insert({
        phone: schedule.phone,
        flow_id: schedule.flow_id,
        flow_name: schedule.flow_name,
        contact_name: schedule.contact_name,
        success: result.ok,
        error_message: result.error ?? null,
        reply_contact_id: contactId,
        source: "scheduled",
      });

      processed++;
      if (result.ok) succeeded++;

      // Throttle to avoid rate limiting
      if (processed < dueSchedules.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`[SCHEDULE] Processed ${processed}, succeeded ${succeeded}`);
    return new Response(
      JSON.stringify({ ok: true, processed, succeeded }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("process-schedules error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
