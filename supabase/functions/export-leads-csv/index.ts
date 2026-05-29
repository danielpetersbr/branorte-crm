// export-leads-csv v2 - One row per lead, clean data
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_events?select=created_at,contact_name,contact_phone,event_type,ad_source,vendor_name,reason&created_at=gte.${since}&order=created_at.asc&limit=1000`,
    { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
  );

  if (!r.ok) return new Response("Error", { status: 500, headers: corsHeaders });

  const events: any[] = await r.json();

  // Group by phone - one row per lead with latest status
  const leads = new Map<string, {
    phone: string; name: string; firstSeen: string; lastEvent: string;
    status: string; ad: string; vendor: string; reason: string;
  }>();

  for (const e of events) {
    const phone = e.contact_phone || "";
    if (!phone) continue;

    if (!leads.has(phone)) {
      leads.set(phone, {
        phone,
        name: e.contact_name || "",
        firstSeen: e.created_at,
        lastEvent: e.created_at,
        status: e.event_type,
        ad: e.ad_source || "",
        vendor: e.vendor_name || "",
        reason: e.reason || "",
      });
    } else {
      const lead = leads.get(phone)!;
      lead.lastEvent = e.created_at;
      lead.status = e.event_type;
      if (e.contact_name && !lead.name) lead.name = e.contact_name;
      if (e.ad_source) lead.ad = e.ad_source;
      if (e.vendor_name) lead.vendor = e.vendor_name;
      if (e.reason) lead.reason = e.reason;
    }
  }

  const statusLabel: Record<string, string> = {
    ia_started: "Em Atendimento IA",
    ia_transferred: "Transferido p/ Vendedor",
    ia_finished: "IA Encerrou",
  };

  function fmtDate(iso: string): string {
    const dt = new Date(iso);
    const d = dt.getUTCDate().toString().padStart(2, "0");
    const m = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
    const y = dt.getUTCFullYear();
    const h = dt.getUTCHours().toString().padStart(2, "0");
    const min = dt.getUTCMinutes().toString().padStart(2, "0");
    return `${d}/${m}/${y} ${h}:${min}`;
  }

  // Sort by firstSeen desc (newest first)
  const sorted = Array.from(leads.values()).sort(
    (a, b) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime()
  );

  const header = '"Data Entrada","Lead","Telefone","Status","Anuncio","Vendedor","Motivo"';
  const rows = sorted.map((l) => {
    const name = l.name.replace(/"/g, "'");
    const vendor = l.vendor.replace(/"/g, "'");
    const reason = l.reason.replace(/"/g, "'");
    return `"'${fmtDate(l.firstSeen)}","${name}","${l.phone}","${statusLabel[l.status] || l.status}","${l.ad}","${vendor}","${reason}"`;
  });

  return new Response(header + "\n" + rows.join("\n"), {
    headers: { ...corsHeaders, "Content-Type": "text/csv; charset=utf-8" },
  });
});
