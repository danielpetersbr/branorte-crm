import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.2';

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
    console.log('🚀 Auto-sync para orçamentos enviados iniciado');

    // Inicializar cliente Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar o token específico do Éder
    const { data: ederProfile, error: profileError } = await supabase
      .from('perfis_usuarios')
      .select('token_api')
      .eq('id', '7f8e9d10-5a3b-4c2d-8e7f-9a0b1c2d3e4f')
      .eq('nome', 'Eder')
      .single();

    if (profileError || !ederProfile?.token_api) {
      throw new Error('Token da API WaScript do Éder não configurado');
    }

    const apiToken = ederProfile.token_api;
    console.log('📡 Fazendo request para API WaScript...');
    
    // Fazer request para a API WaScript
    const apiUrl = `https://api-whatsapp.wascript.com.br/api/listar-etiquetas/${apiToken}`;
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`Erro na API WaScript: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();

    if (!data.success || !data.etiquetas) {
      throw new Error('Formato de resposta inválido da API WaScript');
    }

    // Verificar mudanças na etiqueta ORÇAMENTO ENVIADO
    console.log('🔍 Verificando mudanças em ORÇAMENTO ENVIADO...');
    const orcamentoEnviadoLabel = data.etiquetas.find((label: any) => 
      label.name.toUpperCase().includes('ORÇAMENTO ENVIADO')
    );

    if (orcamentoEnviadoLabel) {
      // Buscar contagem anterior para detectar mudanças
      const { data: previousLabel } = await supabase
        .from('whatsapp_labels')
        .select('count')
        .eq('id', orcamentoEnviadoLabel.id)
        .single();

      const previousCount = previousLabel?.count || 0;
      const currentCount = orcamentoEnviadoLabel.count;
      const newOrcamentos = currentCount - previousCount;

      console.log(`📊 Contagem anterior: ${previousCount}, atual: ${currentCount}, diferença: ${newOrcamentos}`);

      if (newOrcamentos > 0) {
        console.log(`📈 Detectados ${newOrcamentos} novos orçamentos enviados`);
        
        // Inserir novos registros na tabela orcamentos_enviados_historico
        const orcamentosRecords = Array.from({ length: newOrcamentos }, (_, i) => ({
          id_contato: `eder_auto_${Date.now()}_${i}`,
          etiqueta: 'ORÇAMENTO ENVIADO'
        }));

        const { error: orcamentosError } = await supabase
          .from('orcamentos_enviados_historico')
          .insert(orcamentosRecords);

        if (orcamentosError) {
          console.error('⚠️ Erro ao registrar orçamentos no histórico:', orcamentosError);
        } else {
          console.log(`✅ Registrados ${newOrcamentos} novos orçamentos no histórico`);
        }

        // Atualizar a contagem na tabela whatsapp_labels
        const { error: updateError } = await supabase
          .from('whatsapp_labels')
          .upsert({
            id: orcamentoEnviadoLabel.id,
            name: orcamentoEnviadoLabel.name,
            count: currentCount,
            hex_color: orcamentoEnviadoLabel.hexColor,
            color_index: orcamentoEnviadoLabel.colorIndex,
            updated_at: new Date().toISOString()
          });

        if (updateError) {
          console.error('⚠️ Erro ao atualizar whatsapp_labels:', updateError);
        }
      } else {
        console.log('📊 Nenhuma mudança detectada na contagem de orçamentos');
      }
    } else {
      console.log('⚠️ Etiqueta ORÇAMENTO ENVIADO não encontrada');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Sincronização automática concluída',
        newOrcamentos: orcamentoEnviadoLabel ? (orcamentoEnviadoLabel.count - (previousLabel?.count || 0)) : 0
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('❌ Erro na sincronização automática:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Erro interno do servidor'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});