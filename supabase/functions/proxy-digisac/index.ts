import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Digisac API config — set these as Supabase secrets:
// DIGISAC_API_URL e.g. "https://mbranorte2.digisac.io"
// DIGISAC_TOKEN   e.g. "Bearer eyJ..."
const DIGISAC_API_URL = Deno.env.get("DIGISAC_API_URL") ?? "https://mbranorte2.digisac.io";
const DIGISAC_TOKEN = Deno.env.get("DIGISAC_API_TOKEN") ?? Deno.env.get("DIGISAC_TOKEN") ?? "";
const DIGISAC_PIPELINE_ID = Deno.env.get("DIGISAC_PIPELINE_ID") ?? "3a4c7704-935c-4b61-88d9-bf82e0c0dd11";

async function digisacRequest(path: string, method = "GET", body?: unknown) {
  const url = `${DIGISAC_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${DIGISAC_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Digisac ${path} → ${res.status}: ${text}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function digisacRequestWithFallback(paths: string[], method = "GET", body?: unknown) {
  let lastError: unknown = null;

  for (const path of paths) {
    try {
      return await digisacRequest(path, method, body);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? new Error(`Digisac fallback failed for paths [${paths.join(", ")}]: ${lastError.message}`)
    : new Error(`Digisac fallback failed for paths [${paths.join(", ")}]`);
}

interface PipelineStats {
  counts: Record<string, number>;
  values: Record<string, number>;
  totalValue: number;
  wonValue: number;
  lostValue: number;
  wonCount: number;
  lostCount: number;
}

const normalizeName = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function getDigisacTotal(resp: any, fallback = 0) {
  // Digisac returns { data, total, limit, skip, currentPage, lastPage }
  // "total" is at the root level, NOT inside "pagination"
  const candidates = [
    resp?.total,
    resp?.count,
    resp?.pagination?.total,
    resp?.meta?.total,
  ];

  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return fallback;
}

// Queue stats using /contacts?query= pattern (matches Digisac's native dashboard exactly)
// Uses the same Sequelize query format that Digisac's "Filas de atendimento" tab uses
async function fetchContactCount(deptId: string, userId: string | null): Promise<number> {
  const ticketWhere: Record<string, unknown> = { departmentId: deptId };
  if (userId === null) {
    ticketWhere.userId = { $eq: null };
  } else {
    ticketWhere.userId = userId;
  }

  const query = JSON.stringify({
    where: { visible: true },
    include: [
      {
        model: "currentTicket",
        where: ticketWhere,
        include: [{ model: "department", required: true }],
        required: true,
      },
      { model: "service", required: true },
    ],
    paginate: false,
    withTotal: true,
    offset: 0,
    limit: 1,
  });

  const resp = await digisacRequest(`/api/v1/contacts?query=${encodeURIComponent(query)}`);
  return resp?.total ?? 0;
}

async function fetchQueueStats(deptId: string) {
  // 1. Get users first
  const usersResp = await digisacRequest("/api/v1/users?limit=100&include=departments");
  const allUsers = Array.isArray(usersResp?.data) ? usersResp.data : [];

  const deptUsers = allUsers.filter((u: any) => {
    const depts = Array.isArray(u.departments) ? u.departments : [];
    return depts.some((d: any) => d?.id === deptId);
  });
  console.log(`[SLA] Users in dept: ${deptUsers.length} (${deptUsers.map((u: any) => u.name).join(", ")})`);

  // 2. Fire ALL /contacts queries in parallel (queue + per-user)
  const [inQueue, ...perUserResps] = await Promise.all([
    // Queue = contacts with currentTicket where userId IS NULL
    fetchContactCount(deptId, null).catch(() => 0),
    // Per-user counts
    ...deptUsers.map((user: any) =>
      fetchContactCount(deptId, user.id)
        .then((count) => ({ userId: user.id, name: user.name, count, status: user.status ?? "offline" }))
        .catch(() => ({ userId: user.id, name: user.name, count: 0, status: user.status ?? "offline" }))
    ),
  ]);

  const perUserResults = perUserResps as Array<{ userId: string; name: string; count: number; status: string }>;
  const sumPerUser = perUserResults.reduce((acc, u) => acc + u.count, 0);
  const totalOpen = sumPerUser + inQueue;

  console.log(`[SLA] Total open: ${totalOpen}, Per-user sum: ${sumPerUser}, Queue: ${inQueue}`);
  for (const u of perUserResults) {
    console.log(`[SLA]   ${u.name}: ${u.count} contacts (${u.status})`);
  }

  return { totalOpen, inQueue, deptUsers: allUsers, perUserResults };
}

async function fetchDigisacServiceSteps() {
  const resp = await digisacRequestWithFallback([
    "/api/v1/service-steps",
    "/api/service-steps",
  ]);

  const rows = Array.isArray(resp) ? resp : (Array.isArray((resp as any)?.data) ? (resp as any).data : []);

  return rows
    .map((step: any) => ({
      id: step?.id != null ? String(step.id) : "",
      name: String(step?.name ?? step?.title ?? ""),
    }))
    .filter((step: { id: string; name: string }) => step.id && step.name);
}

async function syncPipelineStagesByName(supabase: ReturnType<typeof createClient>) {
  const { data: stages, error: stagesErr } = await supabase
    .from("pipeline_stages")
    .select("id,name,digisac_service_step_id");

  if (stagesErr || !stages) {
    console.warn("[StageSync] Could not load pipeline_stages:", stagesErr?.message);
    return new Map<string, string>();
  }

  const serviceSteps = await fetchDigisacServiceSteps();
  const byName = new Map<string, string>();

  for (const step of serviceSteps) {
    byName.set(normalizeName(step.name), step.id);
  }

  const resolved = new Map<string, string>();

  for (const stage of stages as Array<{ id: string; name: string; digisac_service_step_id: string | null }>) {
    const existing = stage.digisac_service_step_id ? String(stage.digisac_service_step_id) : null;
    if (existing) {
      resolved.set(stage.id, existing);
      continue;
    }

    const matched = byName.get(normalizeName(stage.name));
    if (!matched) continue;

    const { error: updateErr } = await supabase
      .from("pipeline_stages")
      .update({ digisac_service_step_id: matched })
      .eq("id", stage.id);

    if (updateErr) {
      console.warn(`[StageSync] Failed updating stage ${stage.id}:`, updateErr.message);
      continue;
    }

    resolved.set(stage.id, matched);
  }

  console.info(`[StageSync] Sync finished. service-steps=${serviceSteps.length}, matched=${resolved.size}`);
  return resolved;
}

async function resolveServiceStepId(
  supabase: ReturnType<typeof createClient>,
  stageId: string,
): Promise<string | null> {
  const { data: stageData, error: stageFetchErr } = await supabase
    .from("pipeline_stages")
    .select("digisac_service_step_id")
    .eq("id", stageId)
    .single();

  if (!stageFetchErr && stageData?.digisac_service_step_id) {
    return String(stageData.digisac_service_step_id);
  }

  const resolvedMap = await syncPipelineStagesByName(supabase);
  return resolvedMap.get(stageId) ?? null;
}


async function fetchDigisacCardsForPipeline(pipelineId: string): Promise<PipelineStats> {
  const counts: Record<string, number> = {};
  const values: Record<string, number> = {};
  let totalValue = 0;
  let wonValue = 0;
  let lostValue = 0;
  let wonCount = 0;
  let lostCount = 0;

  function processCards(rows: any[]) {
    for (const card of rows) {
      const stageId = card?.pipelineStageId ?? card?.pipeline_stage_id ?? null;
      if (!stageId) continue;
      const key = String(stageId);
      counts[key] = (counts[key] ?? 0) + 1;

      const val = Number(card?.totalValue ?? card?.total_value ?? 0);
      values[key] = (values[key] ?? 0) + val;
      totalValue += val;

      const finished = card?.finishedAt ?? card?.finished_at ?? null;
      if (finished) {
        if (card?.success === true) { wonValue += val; wonCount++; }
        else if (card?.success === false) { lostValue += val; lostCount++; }
      }
    }
  }

  // First page to get total/lastPage
  const firstQuery = `/api/v1/cards?limit=100&page=1&where%5BpipelineId%5D=${pipelineId}&where%5BisArchived%5D=false`;
  const firstResp = await digisacRequest(firstQuery);
  const firstRows = Array.isArray(firstResp?.data) ? firstResp.data : [];
  processCards(firstRows);

  const lastPage = Number(firstResp?.lastPage ?? 1);
  console.log(`[Funnel] Page 1: ${firstRows.length} cards, lastPage=${lastPage}`);

  // Fetch remaining pages in parallel batches of 10
  if (lastPage > 1) {
    const BATCH = 10;
    for (let start = 2; start <= lastPage; start += BATCH) {
      const end = Math.min(start + BATCH - 1, lastPage);
      const promises = [];
      for (let p = start; p <= end; p++) {
        promises.push(
          digisacRequest(`/api/v1/cards?limit=100&page=${p}&where%5BpipelineId%5D=${pipelineId}&where%5BisArchived%5D=false`)
            .then((r: any) => Array.isArray(r?.data) ? r.data : [])
            .catch(() => [] as any[])
        );
      }
      const results = await Promise.all(promises);
      for (const rows of results) processCards(rows);
    }
  }

  const totalCards = Object.values(counts).reduce((s, v) => s + v, 0);
  console.log(`[Funnel] Total: ${totalCards} cards, value=${totalValue}, won=${wonCount}(${wonValue}), lost=${lostCount}(${lostValue})`);

  return { counts, values, totalValue, wonValue, lostValue, wonCount, lostCount };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Use external Supabase (where the data lives) if configured, otherwise fallback
    const supabaseUrl = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { action } = body;

    // ─── Move card to a pipeline stage ───────────────────────────────────────
    if (action === "move-card") {
      const { card_id, stage_id } = body;

      if (!card_id || !stage_id) {
        return new Response(
          JSON.stringify({ error: "Missing card_id or stage_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Optimistically update Supabase first
      const { error: dbError } = await supabase
        .from("cards")
        .update({ pipeline_stage_id: stage_id })
        .eq("id", card_id);

      if (dbError) {
        return new Response(
          JSON.stringify({ error: dbError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Sync to Digisac — the pipeline_stage_id in Supabase IS the same UUID as pipelineStageId in Digisac
      if (DIGISAC_TOKEN) {
        try {
          console.info(`[MoveCard] Syncing card ${card_id} to Digisac stage ${stage_id}`);
          await digisacRequestWithFallback(
            [`/api/v1/cards/${card_id}`, `/api/cards/${card_id}`],
            "PUT",
            { pipelineStageId: stage_id }
          );
          console.info(`[MoveCard] ✅ Digisac sync OK for card ${card_id} → stage ${stage_id}`);
        } catch (e) {
          console.warn(`[MoveCard] ❌ Digisac sync failed (non-critical):`, e);
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Finish (win/lose) a card ─────────────────────────────────────────────
    // ─── Update stage mapping (admin) ───────────────────────────────────────
    if (action === "update-stage-mapping") {
      const { mappings } = body as { mappings: { stage_id: string; digisac_service_step_id: string | null }[] };

      if (!Array.isArray(mappings)) {
        return new Response(
          JSON.stringify({ error: "Missing mappings array" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const errors: string[] = [];
      for (const m of mappings) {
        const { error } = await supabase
          .from("pipeline_stages")
          .update({ digisac_service_step_id: m.digisac_service_step_id })
          .eq("id", m.stage_id);
        if (error) errors.push(`${m.stage_id}: ${error.message}`);
      }

      if (errors.length > 0) {
        console.warn("[StageMapping] Errors:", errors);
        return new Response(
          JSON.stringify({ success: false, errors }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.info(`[StageMapping] ✅ Updated ${mappings.length} stages`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Finish (win/lose) a card ─────────────────────────────────────────────
    if (action === "finish-card") {
      const { card_id, success: isSuccess, lossReason, subjectId } = body;

      if (!card_id) {
        return new Response(
          JSON.stringify({ error: "Missing card_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Stage IDs for "Finalizados" and statuses
      const FINALIZADOS_STAGE_ID = "31fe9649-7ca3-406c-bbba-7a4830e9ac94";
      const STATUS_WON_ID = "4ba0375e-0a11-4341-8b9d-f7a49bf1713c";
      const STATUS_LOST_ID = "fce9fc62-aa1a-44cd-bc93-b553e6a0bad2";

      // Get the card's contact_id before archiving
      let contactId: string | null = null;
      const { data: cardData } = await supabase
        .from("cards")
        .select("contact_id, raw_data")
        .eq("id", card_id)
        .single();
      if (cardData) contactId = cardData.contact_id;

      // Archive the card locally + update raw_data with success/reason
      const existingRaw = (cardData?.raw_data as Record<string, unknown>) || {};
      const updatePayload: Record<string, unknown> = {
        is_archived: false,
        pipeline_stage_id: FINALIZADOS_STAGE_ID,
        raw_data: {
          ...existingRaw,
          success: isSuccess,
          finishedAt: new Date().toISOString(),
          reasonName: lossReason || null,
        },
      };
      if (!isSuccess && lossReason) updatePayload.loss_reason = lossReason;

      const { error: dbError } = await supabase
        .from("cards")
        .update(updatePayload)
        .eq("id", card_id);

      if (dbError) {
        return new Response(
          JSON.stringify({ error: dbError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Sync to Digisac if token is available
      if (DIGISAC_TOKEN) {
        // 1. Move card to "Finalizados" stage + set won/lost status in Digisac
        const statusId = isSuccess ? STATUS_WON_ID : STATUS_LOST_ID;
        try {
          await digisacRequest(`/api/v1/cards/${card_id}`, "PUT", {
            pipelineStageId: FINALIZADOS_STAGE_ID,
            statusId,
            success: isSuccess,
            isArchived: false, // Keep card visible — do NOT auto-archive
          });
          console.log(`[FinishCard] ✅ Card ${card_id} moved to Finalizados (${isSuccess ? "WON" : "LOST"}) in Digisac`);
        } catch (e) {
          console.warn(`[FinishCard] ❌ PUT card failed, trying PATCH:`, String(e).substring(0, 100));
          try {
            await digisacRequest(`/api/v1/cards/${card_id}`, "PATCH", {
              pipelineStageId: FINALIZADOS_STAGE_ID,
              statusId,
              success: isSuccess,
              isArchived: false,
            });
            console.log(`[FinishCard] ✅ PATCH worked for card ${card_id}`);
          } catch (e2) {
            console.warn(`[FinishCard] ❌ Could not move card in Digisac:`, String(e2).substring(0, 100));
          }
        }

        // 2. Close the ticket (atendimento) in Digisac if we have a contactId
        if (contactId) {
          try {
            const closeBody: Record<string, unknown> = {};
            if (subjectId) closeBody.ticketTopicIds = [subjectId];
            await digisacRequest(`/api/v1/contacts/${contactId}/ticket/close`, "POST", closeBody);
            console.log(`[FinishCard] Ticket closed via /api/v1/contacts/${contactId}/ticket/close`);
          } catch (e) {
            console.warn("[FinishCard] Digisac ticket close failed (non-critical):", e);
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Get SLA tickets from Vendas department ─────────────────────────────
    if (action === "get-tickets-sla") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const VENDAS_DEPT_ID = "19b13490-a20c-449a-81fd-272541b936ac";
      const deptId = body?.department_id ?? VENDAS_DEPT_ID;

      try {
        const { totalOpen, inQueue, deptUsers, perUserResults } = await fetchQueueStats(deptId);

        // Build users map for status info
        const usersMap: Record<string, { name: string; status: string; departments: string[] }> = {};
        if (Array.isArray(deptUsers)) {
          for (const u of deptUsers) {
            const deptNames = Array.isArray(u.departments)
              ? u.departments.map((d: any) => d?.name || "").filter(Boolean)
              : [];
            usersMap[u.id] = {
              name: u.name,
              status: u.status ?? u.availability ?? (u.isOnline ? "online" : "offline"),
              departments: deptNames,
            };
          }
        }

        // Build vendors list from per-user results
        const vendors = perUserResults
          .filter((u) => u.count > 0)
          .map((u) => ({
            vendorId: u.userId,
            vendorName: u.name,
            status: usersMap[u.userId]?.status ?? u.status,
            departments: usersMap[u.userId]?.departments ?? [],
            ticketCount: u.count,
            avgWaitingTime: 0,
            avgMessagingTime: 0,
          }))
          .sort((a, b) => b.ticketCount - a.ticketCount);

        // Add queue entry if there are unassigned tickets
        if (inQueue > 0) {
          vendors.push({
            vendorId: "unassigned",
            vendorName: "Sem atendente (Fila)",
            status: "queue",
            departments: [],
            ticketCount: inQueue,
            avgWaitingTime: 0,
            avgMessagingTime: 0,
          });
        }

        // Summary stats
        const onlineCount = Object.values(usersMap).filter(u => u.status === "online").length;
        const awayCount = Object.values(usersMap).filter(u => u.status === "away" || u.status === "busy").length;
        const offlineCount = Object.values(usersMap).filter(u => u.status === "offline").length;
        const withTickets = perUserResults.filter(u => u.count > 0).length;
        const withoutTickets = Math.max(0, perUserResults.length - withTickets);

        return new Response(
          JSON.stringify({
            summary: {
              totalOpen,
              inQueue,
              onlineCount,
              awayCount,
              offlineCount,
              withTickets,
              withoutTickets,
            },
            vendors,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.warn("Digisac tickets SLA error:", e);
        return new Response(
          JSON.stringify({ error: "Digisac tickets endpoint unavailable", fallback: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    if (action === "get-funnel-counts") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const pipelineId = body?.pipeline_id ?? DIGISAC_PIPELINE_ID;
      const stats = await fetchDigisacCardsForPipeline(String(pipelineId));

      return new Response(
        JSON.stringify({
          pipeline_id: pipelineId,
          counts_by_stage_id: stats.counts,
          values_by_stage_id: stats.values,
          total_cards: Object.values(stats.counts).reduce((sum, value) => sum + value, 0),
          total_value: stats.totalValue,
          won_value: stats.wonValue,
          lost_value: stats.lostValue,
          won_count: stats.wonCount,
          lost_count: stats.lostCount,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── List ticket topics (assuntos de chamado) from Digisac ─────────────
    if (action === "list-subjects") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const resp = await digisacRequest("/api/v1/ticket-topics?limit=100");
        const subjects = Array.isArray(resp?.data) ? resp.data : [];
        console.log(`[Subjects] Found ${subjects.length} ticket-topics`);
        return new Response(
          JSON.stringify({ subjects }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.error("[Subjects] Error:", e);
        return new Response(
          JSON.stringify({ error: String(e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Generic proxy GET for API discovery ────────────────────────────────
    if (action === "proxy-get") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { path: apiPath } = body;
      if (!apiPath) {
        return new Response(
          JSON.stringify({ error: "Missing path" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const resp = await digisacRequest(apiPath);
        return new Response(
          JSON.stringify(resp),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: String(e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Get open tickets for a contact ─────────────────────────────────────
    if (action === "get-open-tickets") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { contact_id } = body;
      if (!contact_id) {
        return new Response(
          JSON.stringify({ error: "Missing contact_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const queryContact = encodeURIComponent(String(contact_id));
        const candidates = [
          `/api/v1/tickets?where%5BcontactId%5D=${queryContact}&where%5BisOpen%5D=true&limit=10`,
          `/api/v1/tickets?where%5BcontactId%5D=${queryContact}&limit=30`,
          `/api/tickets?where%5BcontactId%5D=${queryContact}&where%5BisOpen%5D=true&limit=10`,
        ];

        let rawTickets: any[] = [];
        for (const path of candidates) {
          try {
            const resp = await digisacRequest(path);
            const arr = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
            console.log(`[GetOpenTickets] path=${path} count=${arr.length}`);
            if (arr.length > 0) {
              rawTickets = arr;
              break;
            }
          } catch (err) {
            console.warn(`[GetOpenTickets] path failed: ${path} -> ${String(err)}`);
          }
        }

        if (rawTickets[0]) {
          const t = rawTickets[0] as any;
          console.log(`[GetOpenTickets] sample isOpen=${String(t?.isOpen)} status=${String(t?.status)} closedAt=${String(t?.closedAt)} finishedAt=${String(t?.finishedAt)} endedAt=${String(t?.endedAt)}`);
        }

        const openTickets = rawTickets.filter((t: any) => {
          const status = String(t?.status || "").toLowerCase();
          if (t?.isOpen === false) return false;
          if (["closed", "finished", "resolved", "done", "cancelled", "canceled"].includes(status)) return false;
          return true;
        });

        const mapped = openTickets.map((t: any) => ({
          id: t.id,
          protocol: t.protocol || null,
          startedAt: t.startedAt || t.createdAt || null,
          departmentId: t.departmentId || null,
          userId: t.userId || null,
        }));

        console.log(`[GetOpenTickets] contact_id=${contact_id} open=${mapped.length}`);
        return new Response(
          JSON.stringify({ tickets: mapped }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: String(e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Discover close-ticket endpoint (diagnostic) ──────────────────────
    if (action === "discover-close-ticket") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { contact_id } = body;
      if (!contact_id) {
        return new Response(
          JSON.stringify({ error: "Missing contact_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Raw fetch that never throws - returns status + body text
      async function probe(path: string, method: string, reqBody?: unknown): Promise<{ path: string; method: string; status: number; body: string }> {
        try {
          const url = `${DIGISAC_API_URL}${path}`;
          const res = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${DIGISAC_TOKEN}`, "Content-Type": "application/json" },
            body: reqBody ? JSON.stringify(reqBody) : undefined,
          });
          const text = await res.text();
          return { path, method, status: res.status, body: text.substring(0, 500) };
        } catch (e) {
          return { path, method, status: 0, body: String(e) };
        }
      }

      try {
        // 1. Fetch open ticket with ALL fields
        const ticketsResp = await digisacRequest(`/api/v1/tickets?where%5BcontactId%5D=${contact_id}&where%5BisOpen%5D=true&limit=5`);
        const tickets = Array.isArray(ticketsResp?.data) ? ticketsResp.data : [];
        console.log(`[Discover] Found ${tickets.length} open tickets`);

        if (tickets.length === 0) {
          return new Response(
            JSON.stringify({ success: false, message: "No open tickets" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const ticket = tickets[0];
        console.log(`[Discover] FULL TICKET OBJECT:\n${JSON.stringify(ticket, null, 2)}`);
        console.log(`[Discover] Ticket keys: ${Object.keys(ticket).join(", ")}`);

        const ticketId = ticket.id;
        const transferId = ticket.currentTicketTransferId || ticket.current_ticket_transfer_id || null;
        const serviceId = ticket.serviceId || ticket.service_id || null;
        const conversationId = ticket.conversationId || ticket.conversation_id || null;

        console.log(`[Discover] ticketId=${ticketId}, transferId=${transferId}, serviceId=${serviceId}, conversationId=${conversationId}`);

        const closeBody = { isOpen: false, ticketTopicId: "test" };
        const endBody = { endedAt: new Date().toISOString(), isOpen: false };

        // 2. Probe ALL candidate endpoints (run in parallel batches)
        const candidates: Array<{ path: string; method: string; body?: unknown }> = [
          // Ticket endpoints
          { path: `/api/v1/tickets/${ticketId}`, method: "PUT", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}`, method: "PATCH", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}/close`, method: "POST", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}/close`, method: "PUT", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}/finish`, method: "POST", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}/finish`, method: "PUT", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}/end`, method: "POST", body: closeBody },
          { path: `/api/v1/tickets/${ticketId}`, method: "DELETE" },
          // Transfer endpoints
          ...(transferId ? [
            { path: `/api/v1/ticket-transfers/${transferId}/close`, method: "POST", body: closeBody },
            { path: `/api/v1/ticket-transfers/${transferId}/close`, method: "PUT", body: closeBody },
            { path: `/api/v1/ticket-transfers/${transferId}`, method: "PUT", body: endBody },
            { path: `/api/v1/ticket-transfers/${transferId}`, method: "PATCH", body: endBody },
            { path: `/api/v1/ticket-transfers/${transferId}/finish`, method: "POST", body: closeBody },
            { path: `/api/v1/ticket-transfers/${transferId}/end`, method: "POST", body: closeBody },
          ] : []),
          // Service endpoints
          ...(serviceId ? [
            { path: `/api/v1/services/${serviceId}`, method: "PUT", body: closeBody },
            { path: `/api/v1/services/${serviceId}`, method: "PATCH", body: closeBody },
            { path: `/api/v1/services/${serviceId}/close`, method: "POST", body: closeBody },
          ] : []),
          // Conversation endpoints
          ...(conversationId ? [
            { path: `/api/v1/conversations/${conversationId}/close`, method: "POST", body: closeBody },
            { path: `/api/v1/conversations/${conversationId}`, method: "PUT", body: closeBody },
          ] : []),
          // Contact-level endpoints
          { path: `/api/v1/contacts/${contact_id}/close-ticket`, method: "POST", body: closeBody },
          { path: `/api/v1/contacts/${contact_id}/tickets/close`, method: "POST", body: closeBody },
          // Legacy API paths (no /v1)
          { path: `/api/tickets/${ticketId}`, method: "PUT", body: closeBody },
          { path: `/api/tickets/${ticketId}/close`, method: "POST", body: closeBody },
          { path: `/api/tickets/${ticketId}/finish`, method: "POST", body: closeBody },
        ];

        const results = [];
        // Run probes in batches of 5 to avoid rate limits
        for (let i = 0; i < candidates.length; i += 5) {
          const batch = candidates.slice(i, i + 5);
          const batchResults = await Promise.all(
            batch.map(c => probe(c.path, c.method, c.body))
          );
          results.push(...batchResults);
        }

        // Log all results
        for (const r of results) {
          const icon = r.status >= 200 && r.status < 300 ? "✅" : r.status === 404 ? "❌404" : `⚠️${r.status}`;
          console.log(`[Discover] ${icon} ${r.method} ${r.path} → ${r.status}: ${r.body.substring(0, 200)}`);
        }

        const successes = results.filter(r => r.status >= 200 && r.status < 300);
        console.log(`[Discover] SUCCESS count: ${successes.length}`);

        return new Response(
          JSON.stringify({ 
            ticket_keys: Object.keys(ticket),
            ticket_id: ticketId,
            transfer_id: transferId,
            service_id: serviceId,
            conversation_id: conversationId,
            probes: results.map(r => ({ method: r.method, path: r.path, status: r.status, body: r.body.substring(0, 200) })),
            successes: successes.map(r => ({ method: r.method, path: r.path, status: r.status })),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.error("[Discover] Error:", e);
        return new Response(
          JSON.stringify({ error: String(e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Close ticket in Digisac ────────────────────────────────────────────
    // Official endpoint: POST /api/v1/contacts/{contactId}/ticket/close
    // Body: { "ticketTopicIds": "subject-uuid" }
    if (action === "close-ticket") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { contact_id, subject_id } = body;
      if (!contact_id) {
        return new Response(
          JSON.stringify({ error: "Missing contact_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const closeBody: Record<string, unknown> = {};
        if (subject_id) {
          closeBody.ticketTopicIds = subject_id;
        }

        console.log(`[CloseTicket] POST /api/v1/contacts/${contact_id}/ticket/close with body:`, JSON.stringify(closeBody));

        const result = await digisacRequest(
          `/api/v1/contacts/${contact_id}/ticket/close`,
          "POST",
          closeBody
        );

        console.log(`[CloseTicket] Success:`, JSON.stringify(result).substring(0, 500));

        return new Response(
          JSON.stringify({ success: true, result }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.error("[CloseTicket] Error:", e);
        return new Response(
          JSON.stringify({ success: false, message: String(e) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Import contacts without pipeline card into the pipeline ──────────
    if (action === "import-to-pipeline") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const VENDAS_DEPT_ID = "19b13490-a20c-449a-81fd-272541b936ac";
      const pipelineId = body?.pipeline_id ?? DIGISAC_PIPELINE_ID;
      const targetStageId = body?.stage_id; // first stage to place cards into

      if (!targetStageId) {
        return new Response(
          JSON.stringify({ error: "Missing stage_id (which pipeline stage to import into)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        // 1. Get all existing pipeline card contactIds
        const existingContactIds = new Set<string>();
        let page = 1;
        let lastPage = 1;
        do {
          const resp = await digisacRequest(
            `/api/v1/cards?limit=100&page=${page}&where%5BpipelineId%5D=${pipelineId}&where%5BisArchived%5D=false&include=contact`
          );
          const rows = Array.isArray(resp?.data) ? resp.data : [];
          for (const card of rows) {
            const cId = card?.contactId ?? card?.contact_id ?? card?.contact?.id;
            if (cId) existingContactIds.add(String(cId));
          }
          lastPage = Number(resp?.lastPage ?? 1);
          page++;
        } while (page <= lastPage);

        console.log(`[Import] Existing pipeline cards: ${existingContactIds.size}`);

        // 2. Get all contacts with open tickets in Vendas dept
        const contactsQuery = JSON.stringify({
          where: { visible: true },
          include: [
            {
              model: "currentTicket",
              where: { departmentId: VENDAS_DEPT_ID },
              include: [{ model: "department", required: true }],
              required: true,
            },
            { model: "service", required: true },
          ],
          paginate: true,
          offset: 0,
          limit: 500,
        });

        const contactsResp = await digisacRequest(`/api/v1/contacts?query=${encodeURIComponent(contactsQuery)}`);
        const allContacts = Array.isArray(contactsResp?.data) ? contactsResp.data : [];
        console.log(`[Import] Total contacts with open tickets: ${allContacts.length}`);

        // 3. Filter contacts that DON'T have a pipeline card
        const missing = allContacts.filter((c: any) => !existingContactIds.has(String(c.id)));
        console.log(`[Import] Contacts without pipeline card: ${missing.length}`);

        // 4. Create cards for each missing contact (batch of 5 to avoid rate limits)
        let created = 0;
        let errors = 0;
        const BATCH_SIZE = 5;

        for (let i = 0; i < missing.length; i += BATCH_SIZE) {
          const batch = missing.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (contact: any) => {
              const contactId = contact.id;
              const contactName = contact.name || contact.pushName || "Sem nome";
              const phone = contact.number || contact.phone || "";
              const ownerId = contact.currentTicket?.userId || null;

              try {
                const cardBody: Record<string, unknown> = {
                  pipelineId,
                  pipelineStageId: targetStageId,
                  contactId,
                  subject: contactName,
                };
                if (ownerId) cardBody.ownerId = ownerId;

                await digisacRequest("/api/v1/cards", "POST", cardBody);
                console.log(`[Import] ✅ Created card for ${contactName} (${phone})`);
                return true;
              } catch (e) {
                console.warn(`[Import] ❌ Failed for ${contactName}: ${String(e).substring(0, 100)}`);
                return false;
              }
            })
          );
          created += results.filter(Boolean).length;
          errors += results.filter((r) => !r).length;
        }

        console.log(`[Import] Done: created=${created}, errors=${errors}`);

        return new Response(
          JSON.stringify({
            success: true,
            total_contacts: allContacts.length,
            already_in_pipeline: existingContactIds.size,
            missing: missing.length,
            created,
            errors,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.error("[Import] Error:", e);
        return new Response(
          JSON.stringify({ error: String(e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Dashboard summary (funnel + queue in one call) ───────────────────
    if (action === "get-dashboard-summary") {
      if (!DIGISAC_TOKEN) {
        return new Response(
          JSON.stringify({ error: "DIGISAC_TOKEN not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const VENDAS_DEPT_ID = "19b13490-a20c-449a-81fd-272541b936ac";
      const pipelineId = body?.pipeline_id ?? DIGISAC_PIPELINE_ID;
      const deptId = body?.department_id ?? VENDAS_DEPT_ID;

      // Fetch funnel stats and queue stats in parallel
      const [funnelStats, queueData] = await Promise.all([
        fetchDigisacCardsForPipeline(String(pipelineId)).catch((e) => {
          console.warn("[DashSummary] Funnel error:", e);
          return null;
        }),
        fetchQueueStats(deptId).catch((e) => {
          console.warn("[DashSummary] Queue error:", e);
          return null;
        }),
      ]);

      // Build funnel response
      const funnel = funnelStats
        ? {
            total_cards: Object.values(funnelStats.counts).reduce((s, v) => s + v, 0),
            total_value: funnelStats.totalValue,
            won_count: funnelStats.wonCount,
            won_value: funnelStats.wonValue,
            lost_count: funnelStats.lostCount,
            lost_value: funnelStats.lostValue,
            counts_by_stage: funnelStats.counts,
            values_by_stage: funnelStats.values,
          }
        : null;

      // Build queue response
      let queue = null;
      if (queueData) {
        const usersMap: Record<string, { name: string; status: string }> = {};
        if (Array.isArray(queueData.deptUsers)) {
          for (const u of queueData.deptUsers) {
            usersMap[u.id] = {
              name: u.name,
              status: u.status ?? u.availability ?? (u.isOnline ? "online" : "offline"),
            };
          }
        }
        const onlineCount = Object.values(usersMap).filter((u) => u.status === "online").length;
        const offlineCount = Object.values(usersMap).filter((u) => u.status === "offline").length;

        const agents = queueData.perUserResults.map((u) => ({
          id: u.userId,
          name: u.name,
          status: usersMap[u.userId]?.status ?? u.status,
          tickets: u.count,
        }));

        queue = {
          total_open: queueData.totalOpen,
          in_queue: queueData.inQueue,
          online: onlineCount,
          offline: offlineCount,
          agents,
        };
      }

      // Build daily evolution (last 30 days) from Supabase cards table
      let daily: { date: string; novos: number; finalizados: number }[] = [];
      try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const since = thirtyDaysAgo.toISOString();

        const FINALIZADOS_ID = "31fe9649-7ca3-406c-bbba-7a4830e9ac94";

        // Fetch new cards (created in last 30 days)
        const { data: newCards } = await supabase
          .from("cards")
          .select("created_at")
          .gte("created_at", since);

        // Fetch finalized cards (in Finalizados stage with finishedAt in raw_data)
        const { data: finCards } = await supabase
          .from("cards")
          .select("raw_data, synced_at")
          .eq("pipeline_stage_id", FINALIZADOS_ID);

        // Build day map
        const dayMap = new Map<string, { novos: number; finalizados: number }>();
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          dayMap.set(key, { novos: 0, finalizados: 0 });
        }

        for (const c of newCards ?? []) {
          const key = c.created_at?.slice(0, 10);
          if (key && dayMap.has(key)) dayMap.get(key)!.novos++;
        }

        for (const c of finCards ?? []) {
          const raw = c.raw_data as Record<string, unknown> | null;
          const finAt = (raw?.finishedAt as string) ?? c.synced_at;
          const key = finAt?.slice(0, 10);
          if (key && dayMap.has(key)) dayMap.get(key)!.finalizados++;
        }

        daily = Array.from(dayMap.entries()).map(([date, vals]) => ({
          date,
          ...vals,
        }));
      } catch (e) {
        console.warn("[DashSummary] Daily evolution error:", e);
      }

      return new Response(
        JSON.stringify({ funnel, queue, daily, timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
