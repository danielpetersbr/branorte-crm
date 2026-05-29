import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ContactWebhookPayload {
  phone: string;
  external_id?: string;
  name?: string;
  email?: string;
  city?: string;
  state?: string;
  origin?: string;
  notes?: string;
  vendor_name?: string;
  vendor_email?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔄 Webhook Contatos - Requisição recebida:', req.method, new Date().toISOString());

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }), 
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse payload
    const payload: ContactWebhookPayload = await req.json();
    console.log('📋 Payload recebido:', JSON.stringify(payload, null, 2));

    // Validar campos obrigatórios
    if (!payload.phone) {
      return new Response(
        JSON.stringify({ error: 'Campo telefone é obrigatório' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Normalizar telefone para formato E.164
    let normalizedPhone = payload.phone.replace(/\D/g, '');
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('11')) {
      normalizedPhone = '55' + normalizedPhone;
    } else if (normalizedPhone.length === 10) {
      normalizedPhone = '5511' + normalizedPhone;
    } else if (!normalizedPhone.startsWith('55')) {
      normalizedPhone = '55' + normalizedPhone;
    }
    normalizedPhone = '+' + normalizedPhone;

    console.log(`📞 Telefone normalizado: ${payload.phone} -> ${normalizedPhone}`);

    // Buscar vendedor se informado
    let vendorId = null;
    if (payload.vendor_name || payload.vendor_email) {
      const { data: vendor } = await supabase
        .from('perfis_usuarios')
        .select('id, nome, email')
        .or(`nome.ilike.%${payload.vendor_name || ''}%,email.eq.${payload.vendor_email || ''}`)
        .single();
      
      if (vendor) {
        vendorId = vendor.id;
        console.log(`👤 Vendedor encontrado: ${vendor.nome} (ID: ${vendor.id})`);
      }
    }

    // Fazer upsert do contato usando a função do banco
    const { data: contactId, error: upsertError } = await supabase
      .rpc('upsert_contact', {
        p_phone: normalizedPhone,
        p_external_id: payload.external_id,
        p_name: payload.name,
        p_email: payload.email,
        p_city: payload.city,
        p_state: payload.state,
        p_origin: payload.origin,
        p_notes: payload.notes,
        p_vendor_id: vendorId
      });

    if (upsertError) {
      console.error('❌ Erro no upsert do contato:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Erro interno no servidor', details: upsertError }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`✅ Contato processado com ID: ${contactId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        contact_id: contactId,
        phone: normalizedPhone 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('💥 Erro no webhook de contatos:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno no servidor' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});