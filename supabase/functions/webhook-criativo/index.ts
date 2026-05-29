// webhook-criativo — UPSERT em auditoria.criativos
//
// Uso: POST /functions/v1/webhook-criativo
//
// Body aceito (flexível):
// {
//   "codigo": "&38",                    // OBRIGATÓRIO — o código que aparece na mensagem do cliente
//   "nome_oficial": "Mini Fábrica JR - Aves",   // Nome oficial do criativo (opcional)
//   "headline": "Monte sua fábrica...",          // Título do anúncio (opcional)
//   "source_url": "https://fb.com/ads/123",     // URL do anúncio (opcional)
//   "image_url": "https://...",                  // Thumbnail (opcional)
//   "source_id": "fb_ad_123",                    // ID externo (opcional)
//   "notas": "texto livre",                      // Observações (opcional)
//   "ativo": true                                // Default true
// }
//
// Também aceita array pra batch: [{...}, {...}]

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeCodigo(raw: string): string {
  if (!raw) return "";
  let c = String(raw).trim();
  // Aceita: &38, &&38, 38, #LP38
  c = c.replace(/^(&+|#)/, "");
  if (/^[0-9]+$/.test(c)) return `&${c}`;
  if (/^LP/i.test(c)) return `#${c.toUpperCase()}`;
  return c.startsWith("&") || c.startsWith("#") ? c : `&${c}`;
}

async function upsertCriativo(SUPABASE_URL: string, SERVICE_KEY: string, item: any) {
  const codigo = normalizeCodigo(item.codigo ?? item.code ?? item.id ?? "");
  if (!codigo) {
    return { ok: false, error: "codigo required", item };
  }

  const row: Record<string, unknown> = {
    codigo,
    nome_oficial: item.nome_oficial ?? item.name ?? item.nome ?? null,
    headline: item.headline ?? item.title ?? null,
    source_url: item.source_url ?? item.url ?? null,
    image_url: item.image_url ?? item.thumbnail_url ?? item.thumbnail ?? null,
    source_id: item.source_id ?? item.external_id ?? null,
    notas: item.notas ?? item.notes ?? null,
    ativo: item.ativo !== undefined ? item.ativo : true,
    updated_at: new Date().toISOString(),
  };

  // Remove null fields for cleaner upsert
  Object.keys(row).forEach((k) => row[k] === null && delete row[k]);

  // Upsert by codigo (unique key)
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/criativos?on_conflict=codigo`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
        "Content-Profile": "auditoria",
        "Prefer": "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    },
  );
  const body = await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    codigo,
    response: body.substring(0, 400),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Only POST allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    const payload = await req.json();
    const items = Array.isArray(payload) ? payload : [payload];

    const results = [];
    for (const item of items) {
      results.push(await upsertCriativo(SUPABASE_URL, SERVICE_KEY, item));
    }

    const success = results.filter((r) => r.ok).length;
    const failed = results.length - success;

    return new Response(
      JSON.stringify({
        ok: failed === 0,
        total: results.length,
        success,
        failed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
