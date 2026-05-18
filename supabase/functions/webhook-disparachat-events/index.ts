// webhook-disparachat-events v24 (2026-05-18) — dedup bidirecional FB↔WA
//   v24: FB chega ~0.5s ANTES do WA. Quando o WA chega, procura órfão FB do
//        mesmo nome em <90s e faz MERGE (UPDATE), em vez de criar duplicata.
//        A dedup anterior (v23) só cobria WA→FB.
//   v20: lead chegava com responsavel=null se IA não transferiu, ficava órfão
//   v21: auto-atribui EXCETO ia_started (mas IA quase nunca transfere → continuava órfão)
//   v22: auto-atribui INCLUSIVE em ia_started — vendedor vê o lead desde o início, mesmo IA atendendo
//   v23 (Ana V16.22+): Ana qualifica 100% antes do handoff via atribuir_vendedor — NÃO auto-atribuir em
//        ia_started senão vendedor aparece atribuído antes da Ana decidir.
//        Também mapeia novos campos da Ana: cf.finalidade → finalidade_fabrica, cf.interesse_principal
//        → motivo_contato, tag LEAD-QUENTE/MORNO/FRIO → quando_investir, cf.quantidade → quantos_animais.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BAD_VENDOR_VALUES = new Set(["indefinido", "n/a", "n/d", "null", "none", "nada", "", "undefined"]);
function sanitizeVendor(name: unknown): string | null {
  if (name === null || name === undefined) return null;
  const s = String(name).trim();
  if (!s) return null;
  if (BAD_VENDOR_VALUES.has(s.toLowerCase())) return null;
  return s;
}

function normalizePhone(raw: string): string {
  let digits = String(raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = "+" + digits.slice(1).replace(/\D/g, "");
  else digits = digits.replace(/\D/g, "");
  if (digits.startsWith("+55")) { /* ok */ }
  else if (digits.startsWith("55") && digits.length >= 12) digits = "+" + digits;
  else if (!digits.startsWith("+")) digits = "+55" + digits;
  return digits;
}

function normalizePhoneBR(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55")) {
    return digits.slice(0, 4) + "9" + digits.slice(4);
  }
  if (digits.length === 11 && digits[2] === "9") {
    return "55" + digits;
  }
  if (digits.length === 10) {
    return "55" + digits.slice(0, 2) + "9" + digits.slice(2);
  }
  return digits;
}

function extractAdCode(text: string): string | null {
  if (!text) return null;
  const m1 = text.match(/&(\d+)/);
  if (m1) return `&${m1[1]}`;
  const m2 = text.match(/#LP(\w+)/i);
  if (m2) return `#LP${m2[1].toUpperCase()}`;
  return null;
}

function normalizeAdCode(raw: string): string | null {
  const c = String(raw || "").trim();
  if (!c) return null;
  if (/^&\d+$/.test(c)) return c;
  if (/^#LP\w+$/i.test(c)) return c.toUpperCase().replace("#lp", "#LP");
  const mAmp = c.match(/^&+(\d+)$/);
  if (mAmp) return `&${mAmp[1]}`;
  if (/^\d+$/.test(c)) return `&${c}`;
  const mLp = c.match(/^lp(\w+)$/i);
  if (mLp) return `#LP${mLp[1].toUpperCase()}`;
  const extracted = extractAdCode(c);
  if (extracted) return extracted;
  if (c.length <= 12 && /^[a-zA-Z0-9_#&\-\.]+$/.test(c)) return c;
  return null;
}

function extractQualifFromTags(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  const upTags = tags.map((t) => String(t).toUpperCase());
  if (upTags.includes("LEAD-QUENTE")) return "Quente";
  if (upTags.includes("LEAD-MORNO")) return "Morno";
  if (upTags.includes("LEAD-FRIO")) return "Frio";
  if (upTags.includes("CLIENTE")) return "Cliente";
  return null;
}

async function lookupCriativo(SUPABASE_URL: string, SERVICE_KEY: string, adCode: string | null): Promise<Record<string, unknown> | null> {
  if (!adCode) return null;
  const codigo = adCode.replace(/^&/, "");
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/criativos?codigo=eq.${encodeURIComponent(codigo)}&select=codigo,nome_oficial,headline,source_url,image_url,source_id&limit=1`,
      { headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Accept-Profile": "auditoria" } },
    );
    if (!r.ok) return null;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length > 0) return arr[0];
  } catch {}
  return null;
}

const TAG_MAP: Record<string, { event_type: string; reason?: string; status?: string; status_legacy?: string; tentativa?: number; como_finalizou?: string }> = {
  "IA ATENDENDO":         { event_type: "ia_started",    status: "Pendente-IA",  status_legacy: "ia_atendendo" },
  "INICIO-ATENDIMENTO":   { event_type: "ia_started",    status: "Pendente-IA",  status_legacy: "ia_atendendo" },
  "HUMANO":               { event_type: "ia_transferred",status: "Transferido",  status_legacy: "transferido"  },
  "IA FINALIZOU":         { event_type: "ia_finished",   status: "Resolvido",    status_legacy: "resolvido",   como_finalizou: "Em-andamento" },
  "ATENDIMENTO-FINALIZADO":{event_type: "ia_finished",   status: "Resolvido",    status_legacy: "resolvido",   como_finalizou: "Em-andamento" },
  "ENCERRADO INATIVIDADE":{ event_type: "ia_finished",   status: "Sem-Resposta", status_legacy: "resolvido", reason: "inatividade",        como_finalizou: "Sem-resposta" },
  "ENCERRADO CLIENTE":    { event_type: "ia_finished",   status: "Resolvido",    status_legacy: "resolvido", reason: "cliente_encerrou",   como_finalizou: "Em-andamento" },
  "SEM-INTERESSE":        { event_type: "ia_finished",   status: "Resolvido",    status_legacy: "resolvido", reason: "sem_interesse",      como_finalizou: "Perdido" },
  "DUPLICADO":            { event_type: "ia_finished",   status: "Resolvido",    status_legacy: "resolvido", reason: "duplicado",          como_finalizou: "Perdido" },
  "LEAD-QUENTE":          { event_type: "lead_classified", reason: "quente" },
  "LEAD-MORNO":           { event_type: "lead_classified", reason: "morno" },
  "LEAD-FRIO":            { event_type: "lead_classified", reason: "frio" },
  "1ºTENTATIVA":          { event_type: "ia_1a_tentativa", status: "Sem-Resposta", status_legacy: "ia_atendendo", reason: "1a_tentativa", tentativa: 1 },
  "2ºTENTATIVA":          { event_type: "ia_2a_tentativa", status: "Sem-Resposta", status_legacy: "ia_atendendo", reason: "2a_tentativa", tentativa: 2 },
  "3ºTENTATIVA":          { event_type: "ia_3a_tentativa", status: "Sem-Resposta", status_legacy: "ia_atendendo", reason: "3a_tentativa", tentativa: 3 },
  "NUNCA-RESPONDEU":      { event_type: "ia_nunca_respondeu", status: "Sem-Resposta", status_legacy: "resolvido", reason: "nunca_respondeu", tentativa: 99, como_finalizou: "Sem-resposta" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const reqId = crypto.randomUUID().slice(0, 8);
  const log = (msg: string) => console.log(`[wh][${reqId}] ${msg}`);

  try {
    const payload = await req.json();
    log(`IN: ${JSON.stringify(payload).substring(0, 500)}`);

    const tag = payload.tag ?? payload.event_type ?? "IA ATENDENDO";
    const phoneRaw =
      payload.contact?.phone ??
      payload.contact?.primary_whatsapp ??
      payload.contact?.whatsapp_number ??
      payload.phone ??
      payload.contact_id ??
      "unknown";
    const name =
      (payload.contact?.full_name ??
        payload.contact?.name ??
        [payload.contact?.first_name, payload.contact?.last_name].filter(Boolean).join(" ") ??
        payload.name ??
        payload.contact_name ??
        "")
        .trim() || null;
    const contactIdExternal = String(payload.contact?.id ?? "") || null;
    const firstMsg = payload.conversation?.first_message ?? payload.message ?? "";
    const lastMsg = payload.conversation?.last_message ?? null;
    const channel = payload.conversation?.channel ?? "whatsapp";
    const channelNumber = payload.conversation?.channel_number ?? payload.channel_number ?? null;
    const cf = payload.contact?.custom_fields ?? {};
    const contactTags = payload.contact?.tags ?? [];
    const vendorRaw = cf.vendedor_designado ?? cf.nome_vendedor ?? payload.vendor_name ?? null;
    const vendorName = sanitizeVendor(vendorRaw);

    if (phoneRaw === "unknown" || !phoneRaw) {
      return new Response(
        JSON.stringify({ ok: true, skip: "no phone/contact_id", received: payload }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tagUp = String(tag).trim().toUpperCase();
    const entry = Object.entries(TAG_MAP).find(([k]) => k.toUpperCase() === tagUp);
    const cfg = entry ? entry[1] : { event_type: "ia_started", status: "ia_atendendo" };

    const normalizedPhone = normalizePhone(phoneRaw);
    const normalizedPhoneDigits = normalizePhoneBR(phoneRaw);
    const adFromMsg = extractAdCode(firstMsg);
    const adFromCustomField =
      cf.Anuncio ?? cf.anuncio ?? cf["Anúncio"] ?? cf["anúncio"] ??
      cf.criativo ?? cf.Criativo ?? cf.criativo_fb ?? cf.criativo_codigo ?? cf.codigo_anuncio ?? null;
    const ad = adFromMsg ?? (adFromCustomField ? normalizeAdCode(String(adFromCustomField)) : null);
    const nowIso = new Date().toISOString();

    const criativoData = await lookupCriativo(SUPABASE_URL, SERVICE_KEY, ad);

    const results: Record<string, unknown> = {};

    // V20: respondeu_a_ia só é true se tem mensagem real do cliente
    const realLastMsg = (lastMsg ?? firstMsg ?? "").trim();
    const hasRealMessage = realLastMsg.length > 0;
    const respondeuAiV20 = cfg.event_type !== "ia_started" && hasRealMessage;

    const leadEventRow = {
      contact_phone: normalizedPhone,
      contact_name: name,
      event_type: cfg.event_type,
      ad_source: ad,
      vendor_name: cfg.event_type === "ia_transferred" ? vendorName : null,
      reason: cfg.reason ?? null,
      metadata: {
        channel,
        channel_number: channelNumber,
        tag_original: tag,
        replyagent_contact_id: contactIdExternal,
        custom_fields: cf,
        contact_tags: contactTags,
      },
    };
    try {
      const r1 = await fetch(`${SUPABASE_URL}/rest/v1/lead_events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Prefer": "return=minimal" },
        body: JSON.stringify(leadEventRow),
      });
      results.lead_events = r1.status;
    } catch (e) { results.lead_events_error = String(e); }

    const conversationSynthetic = `ra:${contactIdExternal ?? normalizedPhoneDigits}`;
    // V23: Ana V16.22 salva quantidade como `quantidade` (não `quantidade_animais`)
    const cfQuantidade = cf.quantidade ?? cf.quantidade_animais ?? null;
    const hasEnrichmentData = !!(cf.animal && cfQuantidade && cf.formulacao);
    const isFinished = cfg.event_type === "ia_finished" || cfg.event_type === "ia_nunca_respondeu";

    const qualifFromEvent = mapQualificacao(tagUp, cfg.reason);
    const qualifFromTags = extractQualifFromTags(contactTags);
    const finalQualif = qualifFromEvent ?? qualifFromTags;

    // V23: extrair "quando_investir" das tags de temperatura aplicadas pela Ana
    const extractQuandoFromTags = (tags: unknown): string | null => {
      if (!Array.isArray(tags)) return null;
      const up = tags.map((t) => String(t).toUpperCase());
      if (up.includes("LEAD-QUENTE")) return "Agora";
      if (up.includes("LEAD-MORNO")) return "Em até 3 meses";
      if (up.includes("LEAD-FRIO")) return "Pesquisando";
      return null;
    };

    // V23: derivar motivo_contato — tenta cf direto, senão deriva de campos presentes
    const deriveMotivoContato = (): string | null => {
      // 1. Tenta cf.motivo_contato ou cf.interesse_principal direto
      if (cf.motivo_contato) return String(cf.motivo_contato);
      const interesse = String(cf.interesse_principal ?? "").toLowerCase();
      if (interesse === "fabrica_racao") return "Montar uma Fábrica";
      if (interesse === "equipamento") {
        const eq = cf.equipamento ? ` ${cf.equipamento}` : "";
        return `Equipamento${eq}`.trim();
      }
      // 2. FALLBACK: deriva pela presença de campos (Ana V16.22 mapeia atributo→field)
      if (cf.equipamento) return `Equipamento ${cf.equipamento}`.trim();
      if (cf.animal || cf.formulacao) return "Montar uma Fábrica";
      return null;
    };

    // V23: derivar finalidade_fabrica — várias chaves possíveis
    const deriveFinalidadeFabrica = (): string | null => {
      // Tenta múltiplas chaves de slug
      const raw = cf.finalidade ?? cf.finalidade_fabrica ?? cf.finalidade_da_fabrica
        ?? cf["finalidade-da-fabrica"] ?? cf["deseja-produzir"] ?? null;
      const fin = String(raw ?? "").toLowerCase().trim();
      if (!fin) return null;
      if (fin === "consumo_proprio" || fin.includes("consumo")) return "Fábrica para consumo";
      if (fin === "revenda" || fin.includes("revenda") || fin.includes("vender")) return "Fábrica para revenda";
      if (fin === "misto" || fin.includes("misto")) return "Fábrica para consumo e revenda";
      // Se for texto livre que não match, retorna ele mesmo
      return raw ? String(raw) : null;
    };

    // AUTO-ATRIBUIÇÃO (v23): só atribui DEPOIS que IA transferiu ou em eventos terminais.
    // V22 atribuía SEMPRE inclusive em ia_started → causava bug de "vendedor atribuído antes
    // da Ana qualificar". Como agora a Ana V16.22 qualifica 100% antes do handoff via tool
    // atribuir_vendedor, esse RPC já cuida da atribuição na hora certa — não precisa forçar.
    // Anti-duplicidade: se cliente já tem responsavel salvo, mantém o atual (não reatribui).
    let assignedVendor: string | null = vendorName;
    const podeAutoAtribuir = !vendorName && !!name && cfg.event_type !== "ia_started";
    if (podeAutoAtribuir) {
      try {
        // Check se já existe atendimento com responsavel pra esse telefone
        const checkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/auditoria_atendimentos?telefone_norm=eq.${normalizedPhoneDigits}&responsavel=not.is.null&select=responsavel&limit=1`,
          { headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Accept-Profile": "auditoria" } },
        );
        const existing = checkRes.ok ? await checkRes.json() : [];
        if (Array.isArray(existing) && existing[0]?.responsavel) {
          // Cliente já tem vendedor responsável — mantém o atual (não reatribui)
          assignedVendor = existing[0].responsavel;
        } else {
          // Sem vendedor: chama RPC pra distribuir
          const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_atribuir_vendedor_ana`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY },
            body: JSON.stringify({
              p_cliente_phone: normalizedPhoneDigits,
              p_cliente_nome: name,
              p_first_message: firstMsg || null,
              p_interesse: cf.equipamento ?? cf.formulacao ?? null,
              p_dados: { criativo: ad, channel, tag_original: tag, custom_fields: cf },
            }),
          });
          if (rpcRes.ok) {
            const rpcOut = await rpcRes.json();
            if (rpcOut?.success && rpcOut.vendedor_nome) {
              assignedVendor = rpcOut.vendedor_nome;
              results.auto_atribuicao = { vendedor: rpcOut.vendedor_nome, card_id: rpcOut.card_id, recorrente: rpcOut.cliente_recorrente };
            }
          } else {
            results.auto_atribuicao_erro = `RPC ${rpcRes.status}`;
          }
        }
      } catch (e) { results.auto_atribuicao_erro = String(e); }
    }

    const atendimentoRow: Record<string, unknown> = {
      data: nowIso,
      nome: name,
      telefone: normalizedPhone,
      conversation_id_disparachat: conversationSynthetic,
      responsavel: assignedVendor,
      respondeu_a_ia: respondeuAiV20,  // V20: só true se hasRealMessage
      transferred_by_ai: cfg.event_type === "ia_transferred",
      qual_animal: cf.animal ?? null,
      quantidade: cfQuantidade,                  // V23: aceita cf.quantidade OU cf.quantidade_animais
      quantos_animais: cfQuantidade,             // V23: popular ambos (CRM lê dos dois)
      o_que_precisa: cf.formulacao ?? cf.equipamento ?? null,
      finalidade_fabrica: deriveFinalidadeFabrica(),       // V23: mapeia cf.finalidade
      motivo_contato: deriveMotivoContato(),               // V23: mapeia cf.interesse_principal
      quando_investir: extractQuandoFromTags(contactTags), // V23: mapeia tag LEAD-QUENTE/MORNO/FRIO
      channel_type: channel,
      criativo_codigo: ad,
      criativo_facebook: criativoData ?? null,
      last_message_at: nowIso,
      last_message_text: lastMsg ?? firstMsg ?? null,
      status_atendimento: cfg.status ?? "Pendente-IA",
      qualificacao: finalQualif,
      tentativa_n: cfg.tentativa ?? null,
      ai_context_summary: (() => {
        const parts = [];
        if (cf.animal && cfQuantidade) parts.push(`${cf.animal} · ${cfQuantidade} · ${cf.formulacao ?? "n/d"}`);
        if (cfg.tentativa) {
          if (cfg.tentativa === 99) parts.push("💀 NUNCA RESPONDEU");
          else parts.push(`🔁 ${cfg.tentativa}ª tentativa`);
        }
        return parts.length ? parts.join(" | ") : null;
      })(),
      last_synced_at: nowIso,
      needs_enrichment: !hasEnrichmentData,
      updated_at: nowIso,
    };
    if (isFinished) {
      atendimentoRow.finished_at = nowIso;
      if (cfg.como_finalizou) atendimentoRow.como_finalizou = cfg.como_finalizou;
      // V20: se finalizou sem mensagem real do cliente → marca como Sem-Resposta
      if (!hasRealMessage && (!cf.animal || cf.animal === "")) {
        atendimentoRow.status_atendimento = "Sem-Resposta";
        atendimentoRow.como_finalizou = "Sem-resposta";
      }
    }
    // V23 DEDUP: chatbotsystem dispara ~simultaneamente 2 webhooks pro mesmo lead
    // (1) Facebook sem telefone (channel=facebook, telefone_norm vazio)
    // (2) WhatsApp com telefone (channel=whatsapp, telefone_norm preenchido)
    // → Pula a inserção do Facebook órfão se existe WhatsApp row mesmo nome <10min
    if (channel === "facebook" && (!normalizedPhoneDigits || normalizedPhoneDigits === "") && name) {
      try {
        const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
        const dupCheck = await fetch(
          `${SUPABASE_URL}/rest/v1/auditoria_atendimentos?nome=eq.${encodeURIComponent(name)}&channel_type=eq.whatsapp&data=gte.${tenMinAgo}&select=id&limit=1`,
          { headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Accept-Profile": "auditoria" } },
        );
        if (dupCheck.ok) {
          const dupRows = await dupCheck.json();
          if (Array.isArray(dupRows) && dupRows.length > 0) {
            log(`SKIP fb_orphan: dup com WhatsApp ${dupRows[0].id}`);
            return new Response(
              JSON.stringify({ ok: true, skip: "fb_orphan_dup_avoided", whatsapp_row: dupRows[0].id, results }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      } catch (e) { results.dedup_check_error = String(e); }
    }

    try {
      const existsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/auditoria_atendimentos?telefone_norm=eq.${normalizedPhoneDigits}&select=id&limit=1`,
        { headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Accept-Profile": "auditoria" } },
      );
      const existingRows = existsRes.ok ? await existsRes.json() : [];
      let existingId = Array.isArray(existingRows) && existingRows[0]?.id;

      // V24 DEDUP BIDIRECIONAL: o ChatbotSystem dispara 2 webhooks ~simultâneos:
      // (1) channel=facebook (sem phone, ~0.5s ANTES)
      // (2) channel=whatsapp (com phone)
      // A dedup anterior (linha ~349) só pegava o caso WA→FB. Agora cobrimos
      // FB→WA: quando o WA chega e não acha pelo telefone, procura um FB
      // órfão do mesmo nome criado nos últimos 90s e merge nele (UPDATE),
      // em vez de criar duplicata.
      if (!existingId && channel === "whatsapp" && name && normalizedPhoneDigits) {
        try {
          const cutoff = new Date(Date.now() - 90_000).toISOString();
          // ATENÇÃO: telefone_norm do órfão é string vazia "" (não NULL).
          // Generaliza pra QUALQUER canal não-whatsapp (facebook, instagram, etc.)
          // que tenha o mesmo nome e chegou nos últimos 90s sem telefone.
          const orphanRes = await fetch(
            `${SUPABASE_URL}/rest/v1/auditoria_atendimentos?nome=eq.${encodeURIComponent(name)}&channel_type=neq.whatsapp&or=(telefone_norm.is.null,telefone_norm.eq.)&data=gte.${cutoff}&select=id,channel_type&order=data.desc&limit=1`,
            { headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Accept-Profile": "auditoria" } },
          );
          if (orphanRes.ok) {
            const orphanRows = await orphanRes.json();
            if (Array.isArray(orphanRows) && orphanRows[0]?.id) {
              existingId = orphanRows[0].id;
              results.orphan_merged = { id: orphanRows[0].id, was_channel: orphanRows[0].channel_type };
              log(`MERGE ${orphanRows[0].channel_type}_orphan ${orphanRows[0].id} → enriquecendo com dados WA`);
            }
          }
        } catch (e) { results.orphan_check_error = String(e); }
      }

      if (existingId) {
        // UPDATE: NÃO sobrescrever 'data' (primeiro contato original).
        // Só atualiza campos de estado atual (last_message_at, status, vendor, etc).
        const { data: _origData, ...updateRow } = atendimentoRow as Record<string, unknown>;
        void _origData;
        const r2 = await fetch(
          `${SUPABASE_URL}/rest/v1/auditoria_atendimentos?id=eq.${existingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Content-Profile": "auditoria", "Prefer": "return=minimal" },
            body: JSON.stringify(updateRow),
          },
        );
        results.auditoria_atendimentos = `UPDATE ${r2.status}`;
      } else {
        const r2 = await fetch(`${SUPABASE_URL}/rest/v1/auditoria_atendimentos`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Content-Profile": "auditoria", "Prefer": "return=minimal" },
          body: JSON.stringify(atendimentoRow),
        });
        results.auditoria_atendimentos = `INSERT ${r2.status}`;
      }
    } catch (e) { results.auditoria_atendimentos_error = String(e); }

    return new Response(
      JSON.stringify({ ok: true, event: cfg.event_type, phone: normalizedPhone, name, ad, criativo: criativoData?.nome_oficial ?? null, qualif: finalQualif, vendor: assignedVendor, vendor_original: vendorName, has_real_msg: hasRealMessage, respondeu: respondeuAiV20, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});

function mapQualificacao(tagUp: string, reason?: string): string | null {
  if (tagUp === "LEAD-QUENTE" || reason === "quente") return "Quente";
  if (tagUp === "LEAD-MORNO" || reason === "morno") return "Morno";
  if (tagUp === "LEAD-FRIO" || reason === "frio") return "Frio";
  return null;
}
