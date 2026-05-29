import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔄 Iniciando sincronização de etiquetas Wascript...');

    // Buscar todos os vendedores com tokens configurados
    const { data: vendedores, error: vendedoresError } = await supabase
      .from('perfis_usuarios')
      .select('id, nome, token_api')
      .neq('token_api', null);

    if (vendedoresError) {
      console.error('❌ Erro ao buscar vendedores:', vendedoresError);
      throw vendedoresError;
    }

    console.log('👥 Vendedores encontrados:', vendedores?.length || 0);

    const resultadosSincronizacao = [];

    for (const vendedor of vendedores || []) {
      if (!vendedor.token_api) continue;

      try {
        console.log(`🔄 Sincronizando etiquetas do ${vendedor.nome}...`);

        // Chamar API Wascript para buscar etiquetas
        const wascriptResponse = await fetch(`https://wascript.com.br/api/whatsapp/labels?token=${vendedor.token_api}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!wascriptResponse.ok) {
          console.error(`❌ Erro na API Wascript para ${vendedor.nome}:`, wascriptResponse.status);
          continue;
        }

        const etiquetasWascript = await wascriptResponse.json();
        console.log(`📊 ${vendedor.nome}: ${etiquetasWascript.length} etiquetas encontradas`);

        // Mapear etiquetas relevantes para o funil
        const etiquetasFunil = ['PROSPECÇÃO', 'NOVO LEAD', 'FOLLOW UP', 'VENDIDOS'];
        const etiquetasStatus = ['ABERTO', 'FECHADO'];
        const etiquetasClassificacao = ['QUENTE', 'MORNO', 'FRIO'];
        const etiquetasRelevantes = [...etiquetasFunil, ...etiquetasStatus, ...etiquetasClassificacao];

        const contadoresEtiquetas = {
          // Funil
          PROSPECÇÃO: 0,
          'NOVO LEAD': 0,
          'FOLLOW UP': 0,
          VENDIDOS: 0,
          // Status
          ABERTO: 0,
          FECHADO: 0,
          // Classificação
          QUENTE: 0,
          MORNO: 0,
          FRIO: 0
        };

        // Processar etiquetas da API Wascript
        etiquetasWascript.forEach((etiqueta: any) => {
          const nomeEtiqueta = etiqueta.name?.toUpperCase().trim();
          
          if (etiquetasRelevantes.includes(nomeEtiqueta)) {
            contadoresEtiquetas[nomeEtiqueta as keyof typeof contadoresEtiquetas] = etiqueta.count || 0;
          }
        });

        // Salvar/atualizar dados no banco para cada etiqueta
        for (const [etiquetaNome, quantidade] of Object.entries(contadoresEtiquetas)) {
          const { error: upsertError } = await supabase
            .from('etiquetas_whatsapp_sincronizadas')
            .upsert({
              vendedor_id: vendedor.id,
              vendedor_nome: vendedor.nome,
              etiqueta_nome: etiquetaNome,
              quantidade: quantidade,
              data_sincronizacao: new Date().toISOString(),
              token_usado: vendedor.token_api
            }, {
              onConflict: 'vendedor_id,etiqueta_nome'
            });

          if (upsertError) {
            console.error(`❌ Erro ao salvar etiqueta ${etiquetaNome} para ${vendedor.nome}:`, upsertError);
          }
        }

        resultadosSincronizacao.push({
          vendedor: vendedor.nome,
          vendedor_id: vendedor.id,
          etiquetas_sincronizadas: Object.keys(contadoresEtiquetas).length,
          contadores: contadoresEtiquetas,
          sucesso: true
        });

        console.log(`✅ ${vendedor.nome}: Sincronização concluída`);

      } catch (error) {
        console.error(`❌ Erro ao sincronizar ${vendedor.nome}:`, error);
        resultadosSincronizacao.push({
          vendedor: vendedor.nome,
          vendedor_id: vendedor.id,
          erro: error.message,
          sucesso: false
        });
      }
    }

    console.log('✅ Sincronização completa:', resultadosSincronizacao);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Sincronização de etiquetas concluída',
        resultados: resultadosSincronizacao,
        total_vendedores: vendedores?.length || 0,
        sincronizados_com_sucesso: resultadosSincronizacao.filter(r => r.sucesso).length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Erro geral na sincronização:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        details: 'Erro ao sincronizar etiquetas do Wascript'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});