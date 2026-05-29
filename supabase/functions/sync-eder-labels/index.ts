import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Label {
  id: string;
  name: string;
  count: number;
  hexColor: string;
  colorIndex: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔄 Iniciando sincronização de etiquetas do Eder...');

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
    console.log('📦 Resposta da API:', JSON.stringify(data, null, 2));

    if (!data.success || !data.etiquetas) {
      throw new Error('Formato de resposta inválido da API WaScript');
    }

    const labels: Label[] = data.etiquetas;
    console.log(`💾 Fazendo upsert de ${labels.length} etiquetas...`);

    // Verificar mudanças na etiqueta ORÇAMENTO ENVIADO para histórico
    console.log('🔍 Verificando mudanças em ORÇAMENTO ENVIADO...');
    const orcamentoEnviadoLabel = labels.find(label => 
      label.name.toUpperCase().includes('ORÇAMENTO ENVIADO')
    );

    // Verificar mudanças na etiqueta CONVERSA POR LIGAÇÃO para histórico
    console.log('🔍 Verificando mudanças em CONVERSA POR LIGAÇÃO...');
    const conversaPorLigacaoLabel = labels.find(label => 
      label.name.toUpperCase().includes('CONVERSA POR LIGAÇÃO')
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

      if (newOrcamentos > 0) {
        console.log(`📈 Detectados ${newOrcamentos} novos orçamentos enviados`);
        
        // Inserir novos registros na tabela orcamentos_enviados_historico
        const orcamentosRecords = Array.from({ length: newOrcamentos }, (_, i) => ({
          id_contato: `eder_contact_${Date.now()}_${i}`,
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

        // Registrar eventos na tabela lead_label_events para o gráfico
        const labelEvents = Array.from({ length: newOrcamentos }, (_, i) => ({
          number: `eder_${Date.now()}_${i}`,
          label_name: 'ORÇAMENTO ENVIADO',
          action: 'add'
        }));

        const { error: eventsError } = await supabase
          .from('lead_label_events')
          .insert(labelEvents);

        if (eventsError) {
          console.error('⚠️ Erro ao registrar eventos de etiquetas:', eventsError);
        } else {
          console.log(`✅ Registrados ${newOrcamentos} eventos de etiquetas`);
        }
      }
    }

    // Processar mudanças na etiqueta CONVERSA POR LIGAÇÃO
    if (conversaPorLigacaoLabel) {
      // Buscar contagem anterior para detectar mudanças
      const { data: previousConversaLabel } = await supabase
        .from('whatsapp_labels')
        .select('count')
        .eq('id', conversaPorLigacaoLabel.id)
        .single();

      const previousConversaCount = previousConversaLabel?.count || 0;
      const currentConversaCount = conversaPorLigacaoLabel.count;
      const newConversas = currentConversaCount - previousConversaCount;

      if (newConversas > 0) {
        console.log(`📞 Detectadas ${newConversas} novas conversas por ligação`);
        
        // Registrar eventos na tabela lead_label_events para o gráfico
        const conversaEvents = Array.from({ length: newConversas }, (_, i) => ({
          number: `eder_conversa_${Date.now()}_${i}`,
          label_name: 'CONVERSA POR LIGAÇÃO',
          action: 'add'
        }));

        const { error: conversaEventsError } = await supabase
          .from('lead_label_events')
          .insert(conversaEvents);

        if (conversaEventsError) {
          console.error('⚠️ Erro ao registrar eventos de conversa por ligação:', conversaEventsError);
        } else {
          console.log(`✅ Registrados ${newConversas} eventos de conversa por ligação`);
        }
      }
    }

    // Fazer upsert das etiquetas na tabela whatsapp_labels
    if (labels.length > 0) {
      const { error } = await supabase
        .from('whatsapp_labels')
        .upsert(
          labels.map(label => ({
            id: label.id,
            name: label.name,
            count: label.count,
            hex_color: label.hexColor,
            color_index: label.colorIndex,
            updated_at: new Date().toISOString()
          })),
          { onConflict: 'id', ignoreDuplicates: false }
        );

      if (error) {
        console.error('❌ Erro no upsert:', error);
        throw error;
      }

      // Salvar snapshot no histórico
      const { error: historyError } = await supabase
        .from('whatsapp_labels_history')
        .insert(
          labels.map(label => ({
            label_id: label.id,
            label_name: label.name,
            count: label.count,
            ts: new Date().toISOString()
          }))
        );

      if (historyError) {
        console.error('⚠️ Erro ao salvar histórico:', historyError);
      } else {
        console.log('📊 Snapshot salvo no histórico para análise temporal');
      }
    }

    console.log('✅ Sincronização concluída com sucesso!');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Etiquetas sincronizadas com sucesso',
        count: labels.length,
        labels: labels
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('❌ Erro na sincronização:', error);
    
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