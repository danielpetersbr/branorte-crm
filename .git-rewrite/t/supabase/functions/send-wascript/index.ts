import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WASCRIPT_BASE = "https://api-whatsapp.wascript.com.br";

interface VendorInfo {
  token: string;
  vendor_name: string | null;  // nome em vendors.name (UPPERCASE-ish)
  vendor_id: string | null;
}

async function getVendorInfo(supabase: any, vendorId?: string, phone?: string): Promise<VendorInfo> {
  // Caminho 1: vendor_id direto (preferencial)
  if (vendorId) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name, wascript_token")
      .eq("id", vendorId)
      .single();
    if (error || !data?.wascript_token) throw new Error("Vendedor não encontrado ou sem token WaScript");
    return { token: data.wascript_token, vendor_name: data.name ?? null, vendor_id: data.id };
  }

  // Caminho 2: descobre vendedor pelo dono do card relacionado ao phone
  if (phone) {
    const digits = phone.replace(/\D/g, "").slice(-10);
    const { data: card } = await supabase
      .from("cards")
      .select("owner_id")
      .like("phone", `%${digits}`)
      .limit(1)
      .maybeSingle();

    if (card?.owner_id) {
      const { data: vendor } = await supabase
        .from("vendors")
        .select("id, name, wascript_token")
        .eq("id", card.owner_id)
        .single();
      if (vendor?.wascript_token) {
        return { token: vendor.wascript_token, vendor_name: vendor.name ?? null, vendor_id: vendor.id };
      }
    }
  }

  // Caminho 3 (fallback): primeiro vendedor com token cadastrado
  const { data: fallback } = await supabase
    .from("vendors")
    .select("id, name, wascript_token")
    .not("wascript_token", "is", null)
    .limit(1)
    .single();

  if (fallback?.wascript_token) {
    return { token: fallback.wascript_token, vendor_name: fallback.name ?? null, vendor_id: fallback.id };
  }
  throw new Error("Nenhum vendedor com token WaScript configurado");
}

// Atualiza auditoria.auditoria_atendimentos.responsavel quando o vendedor envia
// uma mensagem via Wascript pra um telefone. Resolve o nome canônico via
// auditoria.vendedores. Só preenche se responsável atual for NULL — não
// sobrescreve atribuições manuais nem da Ana V16.22.
async function marcarVendedorNoAtendimento(
  supabase: any,
  phone: string,
  vendorNameRaw: string | null,
): Promise<{ updated: number; nome_canonico: string | null }> {
  if (!vendorNameRaw) return { updated: 0, nome_canonico: null };
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return { updated: 0, nome_canonico: null };

  // Resolve nome canônico (UPPER do primeiro nome → "Pedro Della Giustina")
  const firstUp = vendorNameRaw.trim().split(/\s+/)[0]?.toUpperCase();
  if (!firstUp) return { updated: 0, nome_canonico: null };

  const { data: vendList } = await supabase
    .schema("auditoria").from("vendedores").select("nome, ativo");
  const canonico = (vendList ?? [])
    .filter((v: any) => v.ativo !== false)
    .map((v: any) => v.nome as string)
    .find((nome: string) => nome.trim().split(/\s+/)[0]?.toUpperCase() === firstUp);
  const nomeCanonico = canonico ?? vendorNameRaw;

  // Variantes de telefone (com/sem 9 móvel BR)
  const variants = new Set<string>([digits]);
  if (digits.length === 12 && digits.startsWith("55")) {
    variants.add(digits.slice(0, 4) + "9" + digits.slice(4));
  }
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
    variants.add(digits.slice(0, 4) + digits.slice(5));
  }

  const { data: candidates } = await supabase
    .schema("auditoria").from("auditoria_atendimentos")
    .select("id, telefone_norm, responsavel")
    .in("telefone_norm", [...variants])
    .is("responsavel", null);

  const ids = (candidates ?? []).map((c: any) => c.id);
  if (ids.length === 0) return { updated: 0, nome_canonico: nomeCanonico };

  const { error: upErr } = await supabase
    .schema("auditoria").from("auditoria_atendimentos")
    .update({ responsavel: nomeCanonico })
    .in("id", ids);
  if (upErr) return { updated: 0, nome_canonico: nomeCanonico };

  return { updated: ids.length, nome_canonico: nomeCanonico };
}

async function wascriptPost(token: string, endpoint: string, body: Record<string, unknown>) {
  const url = `${WASCRIPT_BASE}${endpoint}/${token}`;
  console.log(`[WASCRIPT] POST ${url}`, JSON.stringify(body));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`[WASCRIPT] response ${res.status}: ${text.substring(0, 500)}`);

  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    throw new Error(json?.message || json?.error || `WaScript HTTP ${res.status}`);
  }
  return json;
}

async function dispatchMessage(token: string, schedule: any) {
  const { phone, message_type, message_text, media_url, file_name } = schedule;

  switch (message_type) {
    case "text": {
      if (!message_text) throw new Error("Mensagem de texto é obrigatória");
      return wascriptPost(token, "/api/enviar-texto", { phone, message: message_text });
    }
    case "image": {
      if (!media_url) throw new Error("URL da imagem é obrigatória");
      return wascriptPost(token, "/api/enviar-imagem", {
        phone,
        base64: media_url,
        message: message_text || undefined,
      });
    }
    case "video": {
      if (!media_url) throw new Error("URL do vídeo é obrigatória");
      return wascriptPost(token, "/api/enviar-video", {
        phone,
        base64: media_url,
        message: message_text || undefined,
      });
    }
    case "audio": {
      if (!media_url) throw new Error("URL do áudio é obrigatória");
      return wascriptPost(token, "/api/enviar-audio", { phone, base64: media_url });
    }
    case "document": {
      if (!media_url) throw new Error("URL do documento é obrigatória");
      return wascriptPost(token, "/api/enviar-documento", {
        phone,
        base64: media_url,
        name: file_name || undefined,
      });
    }
    default:
      throw new Error(`Tipo de mensagem não suportado: ${message_type}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (action === "send-now") {
      const vendor = await getVendorInfo(supabase, body.vendor_id, body.phone);
      const result = await dispatchMessage(vendor.token, body);
      // v2 (2026-05-19): após enviar, marca o vendedor como responsável no
      // atendimento. Resolve o problema da coluna VENDEDOR ficar vazia mesmo
      // depois do vendedor já ter mandado mensagem pelo Zap.
      const responsavelUpdate = await marcarVendedorNoAtendimento(
        supabase, body.phone, vendor.vendor_name,
      );
      return new Response(JSON.stringify({
        success: true,
        result,
        atendimentos_atualizados: responsavelUpdate.updated,
        vendedor_aplicado: responsavelUpdate.nome_canonico,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create") {
      const { phone, flow_name, message_type, message_text, media_url, file_name, mime_type, send_at, contact_name, created_by, vendor_id } = body;
      if (!phone || !send_at) throw new Error("phone e send_at são obrigatórios");
      if (message_type === "text" && !message_text) throw new Error("Mensagem é obrigatória para tipo texto");
      if (["image", "video", "audio", "document"].includes(message_type) && !media_url) {
        throw new Error("Arquivo é obrigatório para tipo mídia");
      }

      const { data, error } = await supabase
        .from("smart_flow_schedules")
        .insert({
          phone,
          flow_name: flow_name || null,
          message_type: message_type || "text",
          message_text: message_text || null,
          media_url: media_url || null,
          file_name: file_name || null,
          mime_type: mime_type || null,
          send_at,
          contact_name: contact_name || null,
          created_by: created_by || null,
          status: "pending",
        })
        .select("id")
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, id: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel") {
      const { id } = body;
      const { error } = await supabase
        .from("smart_flow_schedules")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending");
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Ação desconhecida: ${action}`);
  } catch (err: any) {
    console.error("[send-wascript] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
