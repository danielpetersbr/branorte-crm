import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const wascriptToken = Deno.env.get('WASCRIPT_TOKEN')!;

    if (!wascriptToken) {
      console.error('❌ WASCRIPT_TOKEN não encontrado');
      return new Response(
        JSON.stringify({ ok: false, error: 'WASCRIPT_TOKEN não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as { 
      label_id: string; 
      numbers: string[]; 
      action?: "add" | "remove" 
    };

    const { label_id, numbers, action = "add" } = body;

    console.log('🏷️ Aplicando etiqueta:', { label_id, numbers, action });

    // Fazer request para API do WaScript
    const url = `https://api-whatsapp.wascript.com.br/api/modificar-etiquetas/${wascriptToken}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        action,
        label_id,
        numbers
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Erro na API WaScript:', response.status, data);
      return new Response(
        JSON.stringify({ ok: false, error: data }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Etiqueta aplicada com sucesso:', data);

    // Logar evento no banco para análise do funil
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Mapear ID para nome da etiqueta se necessário
      const pipelineLabels = ['PROSPECÇÃO', 'NOVO LEAD', 'FOLLOW UP', 'VENDIDOS'];
      let labelName = label_id;
      
      // Se for um ID numérico, tentar mapear para nome
      if (/^\d+$/.test(label_id)) {
        const labelMap: { [key: string]: string } = {
          '10': 'PROSPECÇÃO',
          '14': 'NOVO LEAD', 
          '4': 'FOLLOW UP',
          '6': 'VENDIDOS'
        };
        labelName = labelMap[label_id] || label_id;
      }

      // Só logar eventos para etapas do pipeline
      if (pipelineLabels.includes(labelName)) {
        for (const number of numbers) {
          await supabase.from('lead_label_events').insert({
            number: number,
            label_name: labelName,
            action: action
          });
        }
        console.log(`📊 Evento ${action} logado para etiqueta ${labelName} em ${numbers.length} contatos`);
      }
    } catch (logError) {
      console.error('⚠️ Erro ao logar evento (não crítico):', logError);
    }

    return new Response(
      JSON.stringify({ ok: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Erro geral:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error?.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})