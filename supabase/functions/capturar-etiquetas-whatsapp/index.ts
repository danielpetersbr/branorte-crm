import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuração dos tokens WaScript por vendedor (mapeamento correto)
const WASCRIPT_TOKENS = {
  'eder': "1737484288214-5c09c79e4a04d4e5167082bdb5813964",
  'edilsonjr': "1751651601078-74dbe9f054d0ee9d60a98b09f4c34bd8",
  'edilson jr': "1751651601078-74dbe9f054d0ee9d60a98b09f4c34bd8",
  'junior': "1751651601078-74dbe9f054d0ee9d60a98b09f4c34bd8",
  'alvaro': "1751387001230-cbcbe0ea5564553c48d9ba6cdfaca889",
  'álvaro': "1751387001230-cbcbe0ea5564553c48d9ba6cdfaca889",
  'daniel': "", 
  'gustavo': "1737476706499-ab668ba289b89925084072d0b6662ec9",
  'jardel': "1737659615179-5db225351ba0bdada09f774351f71372",
  'pedro': "1752159247481-f92663b691974f1997937745ec7eb92a",
  'ia': "",
  'i.a': ""
};

interface EtiquetaWhatsApp {
  id: string;
  name: string;
  count: number;
  color?: number;
  hexColor?: string;
  colorIndex?: number;
}

interface CapturaDados {
  vendedor: string;
  etiquetas: EtiquetaWhatsApp[];
  total_etiquetas: number;
  success: boolean;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Iniciando captura de etiquetas WhatsApp de todos os vendedores...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Buscar vendedores ativos
    const { data: vendedores, error: vendedoresError } = await supabase
      .from('perfis_usuarios')
      .select('id, nome, email')
      .eq('tipo', 'vendedor');

    if (vendedoresError) {
      console.error('❌ Erro ao buscar vendedores:', vendedoresError);
      throw vendedoresError;
    }

    console.log(`📋 Encontrados ${vendedores.length} vendedores para capturar dados`);

    const resultados: CapturaDados[] = [];

    // Capturar dados de cada vendedor
    for (const vendedor of vendedores) {
      try {
        console.log(`🔄 Processando vendedor: ${vendedor.nome}`);

        // Buscar token para o vendedor (case-insensitive)
        const vendedorKey = vendedor.nome.toLowerCase();
        const token = WASCRIPT_TOKENS[vendedorKey];
        
        console.log(`🔍 Buscando token para ${vendedor.nome} (key: ${vendedorKey}): ${token ? 'encontrado' : 'não encontrado'}`);
        
        if (!token) {
          console.log(`⚠️ Token não configurado para ${vendedor.nome}, pulando...`);
          resultados.push({
            vendedor: vendedor.nome,
            etiquetas: [],
            total_etiquetas: 0,
            success: false,
            error: 'Token não configurado'
          });
          continue;
        }

        // Fazer request para API WaScript usando o endpoint correto para etiquetas
        const response = await fetch('https://api-whatsapp.wascript.com.br/api/listar-etiquetas/' + token, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          console.error(`❌ Erro na API WaScript para ${vendedor.nome}:`, response.status);
          resultados.push({
            vendedor: vendedor.nome,
            etiquetas: [],
            total_etiquetas: 0,
            success: false,
            error: `API Error: ${response.status}`
          });
          continue;
        }

        const data = await response.json();
        const etiquetas: EtiquetaWhatsApp[] = data.etiquetas || data.labels || [];

        console.log(`📊 ${vendedor.nome}: ${etiquetas.length} etiquetas capturadas`);

        // Salvar cada etiqueta na tabela histórico
        const dadosParaInserir = etiquetas.map(etiqueta => ({
          vendedor_nome: vendedor.nome,
          vendedor_id: vendedor.id,
          etiqueta_nome: etiqueta.name.toUpperCase(),
          quantidade: etiqueta.count || 0,
          fonte_dados: 'WASCRIPT',
          total_etiquetas: etiquetas.length,
          observacoes: `Captura automática via API WaScript - ${new Date().toISOString()}`
        }));

        const { error: insertError } = await supabase
          .from('whatsapp_etiquetas_historico')
          .insert(dadosParaInserir);

        if (insertError) {
          console.error(`❌ Erro ao salvar dados do ${vendedor.nome}:`, insertError);
          resultados.push({
            vendedor: vendedor.nome,
            etiquetas,
            total_etiquetas: etiquetas.length,
            success: false,
            error: insertError.message
          });
        } else {
          console.log(`✅ Dados do ${vendedor.nome} salvos com sucesso!`);
          resultados.push({
            vendedor: vendedor.nome,
            etiquetas,
            total_etiquetas: etiquetas.length,
            success: true
          });
        }

        // Pequena pausa entre requests
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Erro ao processar ${vendedor.nome}:`, error);
        resultados.push({
          vendedor: vendedor.nome,
          etiquetas: [],
          total_etiquetas: 0,
          success: false,
          error: error.message
        });
      }
    }

    const sucessos = resultados.filter(r => r.success).length;
    const falhas = resultados.filter(r => !r.success).length;

    console.log(`🎯 Captura finalizada: ${sucessos} sucessos, ${falhas} falhas`);

    return new Response(JSON.stringify({
      success: true,
      message: `Captura concluída: ${sucessos} sucessos, ${falhas} falhas`,
      resultados,
      resumo: {
        total_vendedores: vendedores.length,
        sucessos,
        falhas,
        timestamp: new Date().toISOString()
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('❌ Erro geral na captura:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})