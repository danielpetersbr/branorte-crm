import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAGE_PRIORITY: Record<string, number> = {
  "d7be7021-3542-4e10-8a20-94c40cccb45a": 1,
  "36d89975-c339-47e0-9d85-0e19b29b193c": 2,
  "0c052a78-68b7-4d78-9032-d1a1d92f4ee0": 3,
  "a1c59a1f-56d7-4662-bcc8-151884cc5c6c": 4,
  "fc84b46a-32ce-4d8b-b02b-9556df50afe2": 5,
  "0af5bc24-7dc3-4980-ad99-669b99870706": 6,
  "7d5c7641-6df9-443c-b861-f99373d5d72c": 7,
  "bc72f4c0-1dab-4ce2-9031-929329356656": 8,
  "ed28e112-bd3b-4310-a1f0-8a7311e47735": 9,
};
const FINALIZED_STAGE = "31fe9649-7ca3-406c-bbba-7a4830e9ac94";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();

  // Body can include specific IDs to archive, or empty for auto-detect
  let forceIds: string[] = [];
  try {
    const body = await req.json();
    forceIds = body?.ids ?? [];
  } catch { /* no body */ }

  if (forceIds.length > 0) {
    // Archive specific IDs
    for (let i = 0; i < forceIds.length; i += 50) {
      const batch = forceIds.slice(i, i + 50);
      const { error } = await supabase
        .from("cards")
        .update({
          pipeline_stage_id: FINALIZED_STAGE,
          loss_reason: "DUPLICADO - Limpeza automática",
          synced_at: now,
          raw_data: { success: false, reasonName: "Duplicado", finishedAt: now, dedup_archived: true },
        })
        .in("id", batch);
      if (error) console.error("Error:", error.message);
    }
    return new Response(
      JSON.stringify({ ok: true, archived: forceIds.length, mode: "forced" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Auto-detect duplicates
  const { data: pipelineCards, error } = await supabase
    .from("cards")
    .select("id, contact_phone, pipeline_stage_id, total_value_cents, last_message_at, created_at")
    .neq("pipeline_stage_id", FINALIZED_STAGE)
    .eq("is_archived", false);

  if (error || !pipelineCards) {
    return new Response(
      JSON.stringify({ ok: false, error: error?.message ?? "No cards" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const byPhone = new Map<string, any[]>();
  for (const c of pipelineCards) {
    const phone = (c.contact_phone ?? "").trim();
    if (phone.length >= 8) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(c);
    }
  }

  const dedupIds: string[] = [];
  for (const [, group] of byPhone) {
    if (group.length < 2) continue;
    group.sort((a: any, b: any) => {
      const pa = STAGE_PRIORITY[a.pipeline_stage_id] ?? 0;
      const pb = STAGE_PRIORITY[b.pipeline_stage_id] ?? 0;
      if (pa !== pb) return pb - pa;
      const va = a.total_value_cents ?? 0;
      const vb = b.total_value_cents ?? 0;
      if (va !== vb) return vb - va;
      const ma = a.last_message_at ?? "";
      const mb = b.last_message_at ?? "";
      return mb.localeCompare(ma);
    });
    for (let i = 1; i < group.length; i++) {
      dedupIds.push(group[i].id);
    }
  }

  if (dedupIds.length > 0) {
    for (let i = 0; i < dedupIds.length; i += 50) {
      const batch = dedupIds.slice(i, i + 50);
      await supabase
        .from("cards")
        .update({
          pipeline_stage_id: FINALIZED_STAGE,
          loss_reason: "DUPLICADO - Dedup automático",
          synced_at: now,
          raw_data: { success: false, reasonName: "Duplicado", finishedAt: now, dedup_archived: true },
        })
        .in("id", batch);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      total_pipeline: pipelineCards.length,
      phones_with_dupes: byPhone.size - [...byPhone.values()].filter(g => g.length === 1).length,
      archived: dedupIds.length,
      mode: "auto",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
