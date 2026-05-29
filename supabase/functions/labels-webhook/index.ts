import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    console.log('📩 Webhook de etiquetas recebido:', body);

    // Payload esperado:
    // { contactId: "uuid", phone: "+5551999...", actions: [{ labelCode: "PROSPECCAO", type: "add" }, ...] }
    const { contactId, phone, actions } = body;
    
    if (!Array.isArray(actions)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Actions deve ser um array" }), 
        { status: 400, headers: corsHeaders }
      );
    }

    let finalContactId = contactId;

    // Se não tiver contactId mas tiver telefone, buscar o contato
    if (!finalContactId && phone) {
      console.log('🔍 Buscando contato por telefone:', phone);
      
      const { data: contact, error: contactError } = await supabase
        .from('leads_webhook')
        .select('id')
        .eq('telefone', phone)
        .single();

      if (contactError) {
        console.error('❌ Erro ao buscar contato:', contactError);
        return new Response(
          JSON.stringify({ ok: false, error: 'Contato não encontrado' }), 
          { status: 404, headers: corsHeaders }
        );
      }

      finalContactId = contact.id;
    }

    if (!finalContactId) {
      return new Response(
        JSON.stringify({ ok: false, error: "contactId ou phone é obrigatório" }), 
        { status: 400, headers: corsHeaders }
      );
    }

    // Processar cada ação
    for (const action of actions) {
      const { labelCode, type } = action || {};
      
      if (!labelCode || !type) {
        console.warn('⚠️ Ação inválida ignorada:', action);
        continue;
      }

      console.log(`🏷️ Processando: ${type} ${labelCode} para contato ${finalContactId}`);

      try {
        const { error } = await supabase.rpc("apply_label_event", {
          p_contact_id: finalContactId,
          p_label_code: labelCode,
          p_op: type
        });

        if (error) {
          console.error(`❌ Erro ao aplicar ${type} ${labelCode}:`, error);
          throw error;
        }

        console.log(`✅ ${type} ${labelCode} aplicado com sucesso`);
      } catch (actionError) {
        console.error(`❌ Erro na ação ${type} ${labelCode}:`, actionError);
        // Continuar com próximas ações mesmo se uma falhar
      }
    }

    return new Response(
      JSON.stringify({ 
        ok: true, 
        processedActions: actions.length,
        contactId: finalContactId 
      }), 
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    console.error('❌ Erro geral no webhook:', error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }), 
      { status: 500, headers: corsHeaders }
    );
  }
});