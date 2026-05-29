/**
 * webhook-digisac-cards
 *
 * Receives card events from Digisac in real-time and immediately upserts
 * to Supabase. Supabase Realtime then pushes to all connected frontends
 * in <1s, making the kanban board instantaneous.
 *
 * Events handled: card.created, card.updated, card.finished, card.moved
 *
 * Configure in Digisac Admin:
 *   URL: https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/webhook-digisac-cards
 *   Events: card.created, card.updated, card.finished
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DIGISAC_BASE = Deno.env.get("DIGISAC_BASE_URL") ?? "https://mbranorte2.digisac.io/api/v1";
const DIGISAC_TOKEN = Deno.env.get("DIGISAC_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Fetch full card from Digisac (with contact included) ────────────────────

async function fetchCard(cardId: string): Promise<any | null> {
  try {
    const resp = await fetch(`${DIGISAC_BASE}/cards/${cardId}?include=contact`, {
      headers: {
        Authorization: `Bearer ${DIGISAC_TOKEN}`,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!resp.ok) {
      console.error(`Digisac fetchCard ${cardId} returned ${resp.status}`);
      return null;
    }
    const json = await resp.json();
    return json?.data ?? json ?? null;
  } catch (e) {
    console.error(`fetchCard error: ${e}`);
    return null;
  }
}

// ─── Helpers (same logic as sync-digisac) ────────────────────────────────────

function extractPhone(contact: any): { raw: string; formatted: string } {
  const number = contact?.number ?? contact?.phone ?? contact?.data?.number ?? "";
  const raw = number.replace(/\D/g, "");
  let formatted = raw;
  if (raw.length >= 12 && raw.startsWith("55")) {
    const ddd = raw.slice(2, 4);
    const num = raw.slice(4);
    const split = num.length === 9 ? 5 : 4;
    formatted = `(${ddd}) ${num.slice(0, split)}-${num.slice(split)}`;
  }
  return { raw, formatted };
}

function extractLossReason(card: any, contact: any) {
  const reasonId =
    card?.reasonId ?? card?.reason_id ?? card?.lossReasonId ??
    card?.finishReasonId ?? card?.reason?.id ?? card?.lossReason?.id ?? null;
  const reasonName =
    card?.reasonName ?? card?.reason_name ?? card?.lossReasonName ??
    card?.finishReasonName ?? card?.reason?.name ?? card?.lossReason?.name ?? null;
  return {
    reasonId: reasonId ? String(reasonId) : null,
    reasonName: reasonName ? String(reasonName) : null,
  };
}

function mapCardToRow(card: any): any {
  const contact = card.contact ?? {};
  const phone = extractPhone(contact);
  const lossReason = extractLossReason(card, contact);
  const now = new Date().toISOString();

  return {
    id: card.id,
    contact_id: card.contactId ?? null,
    pipeline_stage_id: card.pipelineStageId,
    owner_id: card.ownerId ?? null,
    contact_name: contact.name ?? card.subject ?? "",
    contact_phone: phone.raw,
    contact_phone_formatted: phone.formatted,
    total_value_cents: (card.totalValue ?? 0) * 100,
    subject: card.subject ?? "",
    loss_reason: lossReason.reasonName ?? null,
    loss_note: lossReason.reasonId ?? null,
    created_at: card.createdAt ?? now,
    last_message_at: contact.lastMessageAt ?? null,
    is_archived: false,
    synced_at: now,
    raw_data: {
      success: card.success ?? null,
      finishedAt: card.finishedAt ?? null,
      reasonId: lossReason.reasonId,
      reasonName: lossReason.reasonName,
      originChannel: card.originChannel ?? contact.originChannel ?? null,
      channel: card.channel ?? null,
    },
  };
}

// ─── Extract card ID from various Digisac payload shapes ─────────────────────

function extractCardId(payload: any): string | null {
  return (
    payload?.data?.id ??
    payload?.card?.id ??
    payload?.cardId ??
    payload?.id ??
    null
  );
}

function extractCardData(payload: any): any | null {
  return payload?.data ?? payload?.card ?? null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Digisac sends POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event: string = payload?.event ?? payload?.type ?? "";
  console.log(`[webhook] event="${event}" payload=${JSON.stringify(payload).slice(0, 300)}`);

  // Only process card events
  if (!event.startsWith("card.")) {
    console.log(`[webhook] Ignoring non-card event: ${event}`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cardId = extractCardId(payload);
  if (!cardId) {
    console.error("[webhook] Could not extract card ID from payload");
    return new Response(JSON.stringify({ ok: false, error: "no card id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Try to use data from payload first; fallback to fetching fresh from Digisac
  let cardData = extractCardData(payload);

  // If payload card is missing the contact or pipelineStageId, fetch fresh
  if (!cardData?.pipelineStageId || !cardData?.contact) {
    console.log(`[webhook] Fetching full card ${cardId} from Digisac API...`);
    cardData = await fetchCard(cardId);
  }

  if (!cardData) {
    console.error(`[webhook] Failed to get card data for ${cardId}`);
    return new Response(JSON.stringify({ ok: false, error: "card fetch failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const row = mapCardToRow(cardData);

  const { error } = await supabase.from("cards").upsert([row], { onConflict: "id" });
  if (error) {
    console.error(`[webhook] Upsert error: ${error.message}`);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[webhook] Card ${cardId} upserted (event=${event}, stage=${cardData.pipelineStageId?.slice(0, 8)})`);
  return new Response(JSON.stringify({ ok: true, cardId, event }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
