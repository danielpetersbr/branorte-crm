import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DIGISAC_BASE = Deno.env.get("DIGISAC_BASE_URL") ?? "https://mbranorte2.digisac.io/api/v1";
const DIGISAC_TOKEN = Deno.env.get("DIGISAC_TOKEN") ?? "";
const PIPELINE_ID = Deno.env.get("DIGISAC_PIPELINE_ID") ?? "3a4c7704-935c-4b61-88d9-bf82e0c0dd11";

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

const PIPELINE_STAGES = [
  "fc84b46a-32ce-4d8b-b02b-9556df50afe2", // NOVO LEAD
  "d7be7021-3542-4e10-8a20-94c40cccb45a", // Fila de Chamadas
  "36d89975-c339-47e0-9d85-0e19b29b193c", // PROSPECÇÃO
  "0c052a78-68b7-4d78-9032-d1a1d92f4ee0", // 2ª TENTATIVA
  "a1c59a1f-56d7-4662-bcc8-151884cc5c6c", // 3ª TENTATIVA
  "0af5bc24-7dc3-4980-ad99-669b99870706", // 2ª TENTATIVA LEAD
  "7d5c7641-6df9-443c-b861-f99373d5d72c", // 3ª TENTATIVA LEAD
  "bc72f4c0-1dab-4ce2-9031-929329356656", // AGENDAMENTO
  "ed28e112-bd3b-4310-a1f0-8a7311e47735", // FOLLOW UP
  "31fe9649-7ca3-406c-bbba-7a4830e9ac94", // Finalizados
];


async function fetchCardsForStage(stageId: string): Promise<any[]> {
  const allCards: any[] = [];
  let page = 1;

  while (true) {
    const path =
      `cards?limit=100&page=${page}` +
      `&where%5BpipelineId%5D=${PIPELINE_ID}` +
      `&where%5BpipelineStageId%5D=${stageId}` +
      `&where%5BisArchived%5D=false` +
      `&include=contact`;

    const data = await digisacGet(path);
    if (!data?.data?.length) break;

    allCards.push(...data.data);
    const lastPage = data.lastPage ?? 1;
    if (page >= lastPage) break;
    page++;
  }

  return allCards;
}

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


function extractLossReason(card: any, contact: any): { reasonId: string | null; reasonName: string | null } {
  const reasonId =
    card?.reasonId ??
    card?.reason_id ??
    card?.lossReasonId ??
    card?.loss_reason_id ??
    card?.finishReasonId ??
    card?.finish_reason_id ??
    card?.reason?.id ??
    card?.lossReason?.id ??
    card?.finishReason?.id ??
    contact?.reasonId ??
    null;

  const reasonName =
    card?.reasonName ??
    card?.reason_name ??
    card?.lossReasonName ??
    card?.loss_reason_name ??
    card?.finishReasonName ??
    card?.finish_reason_name ??
    card?.reason?.name ??
    card?.lossReason?.name ??
    card?.finishReason?.name ??
    contact?.reasonName ??
    null;

  return {
    reasonId: reasonId ? String(reasonId) : null,
    reasonName: reasonName ? String(reasonName) : null,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const startedAt = new Date().toISOString();

  const { data: logEntry } = await supabase
    .from("sync_log")
    .insert({ started_at: startedAt, status: "running" })
    .select("id")
    .single();
  const logId = logEntry?.id;

  try {
    const { data: vendors } = await supabase.from("vendors").select("id, key, name");

    // Fetch ALL cards by stage (avoids pagination duplicates from pipeline-wide queries)
    const allCards: any[] = [];
    for (const stageId of PIPELINE_STAGES) {
      const stageCards = await fetchCardsForStage(stageId);
      console.log(`Stage ${stageId.slice(0, 8)}: ${stageCards.length} cards`);
      allCards.push(...stageCards);
    }
    console.log(`Fetched ${allCards.length} cards from ${PIPELINE_STAGES.length} stages`);

    const seenCardIds = new Set<string>();
    const now = new Date().toISOString();
    let upsertErrors = 0;
    let upsertErrorDetails: string[] = [];
    let individualRetryOk = 0;
    let individualRetryFail = 0;

    // Build all card rows first (dedup by ID to avoid "cannot affect row a second time")
    const rowMap = new Map<string, any>();
    for (const card of allCards) {
      if (rowMap.has(card.id)) continue; // skip duplicate IDs
      const contact = card.contact ?? {};
      const phone = extractPhone(contact);
      const lossReason = extractLossReason(card, contact);
      seenCardIds.add(card.id);

      rowMap.set(card.id, {
        id: card.id,
        contact_id: card.contactId ?? null,
        pipeline_stage_id: card.pipelineStageId,
        owner_id: card.ownerId,
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
      });
    }
    const allRows = Array.from(rowMap.values());
    console.log(`Unique cards after dedup: ${allRows.length} (from ${allCards.length} fetched)`);

    // Batch upsert ALL cards, retry individually on failure
    for (let i = 0; i < allRows.length; i += 50) {
      const batch = allRows.slice(i, i + 50);
      const { error } = await supabase.from("cards").upsert(batch, { onConflict: "id" });
      if (error) {
        console.error(`Upsert batch ${i / 50} error: ${error.message} | ${error.details} | ${error.code}`);
        upsertErrors++;
        upsertErrorDetails.push(`batch${i / 50}:${error.message}:${error.code}`);
        // Retry each card individually to salvage what we can
        for (const row of batch) {
          const { error: singleErr } = await supabase.from("cards").upsert([row], { onConflict: "id" });
          if (singleErr) {
            individualRetryFail++;
            if (individualRetryFail <= 3) {
              console.error(`Individual fail: ${row.id} | ${singleErr.message} | ${singleErr.code}`);
            }
          } else {
            individualRetryOk++;
          }
        }
      }
    }
    // Mark cards not seen in Digisac as archived
    // This includes ALL stages (including Finalizados) — if Digisac doesn't have
    // the card as non-archived, Supabase shouldn't either.
    // The seenCardIds set contains all non-archived cards from Digisac across all stages.
    const allActiveIds: string[] = [];
    let readOffset = 0;
    while (true) {
      const { data: page } = await supabase
        .from("cards")
        .select("id")
        .eq("is_archived", false)
        .range(readOffset, readOffset + 999);

      if (!page?.length) break;
      allActiveIds.push(...page.map((c: any) => c.id));
      if (page.length < 1000) break;
      readOffset += 1000;
    }

    // Step 2: filter to find IDs not seen in current sync
    const toArchive = allActiveIds.filter((id) => !seenCardIds.has(id));

    // Step 3: archive in batches
    if (toArchive.length > 0) {
      for (let i = 0; i < toArchive.length; i += 100) {
        const batch = toArchive.slice(i, i + 100);
        await supabase
          .from("cards")
          .update({ is_archived: true, synced_at: now })
          .in("id", batch);
      }
      console.log(`Archived ${toArchive.length} cards not in Digisac`);
    }

    // NOTE: Phone dedup removed — Digisac is source of truth, Supabase must mirror it exactly

    if (logId) {
      await supabase
        .from("sync_log")
        .update({
          completed_at: new Date().toISOString(),
          cards_fetched: allCards.length,
          vendors_processed: vendors?.length ?? 0,
          status: upsertErrors > 0 ? "completed_with_errors" : "completed",
          error_message: upsertErrors > 0 ? `${upsertErrors} upsert batch(es) failed` : null,
        })
        .eq("id", logId);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        cards_fetched: allCards.length,
        cards_unique: allRows.length,
        cards_duplicates: allCards.length - allRows.length,
        vendors_processed: vendors?.length ?? 0,
        upsert_errors: upsertErrors,
        upsert_error_details: upsertErrorDetails,
        individual_retry_ok: individualRetryOk,
        individual_retry_fail: individualRetryFail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    if (logId) {
      await supabase
        .from("sync_log")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error_message: String(error),
        })
        .eq("id", logId);
    }

    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
