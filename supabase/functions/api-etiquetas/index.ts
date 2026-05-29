
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface EtiquetaData {
  name: string;
  count: number;
}

interface EtiquetasPayload {
  sellerId: string;
  etiquetas: EtiquetaData[];
  timestamp: number;
}

serve(async (req) => {
  console.log('API Etiquetas - Requisição recebida:', req.method, new Date().toISOString());

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Método não permitido' 
    }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Verificar autenticação Bearer Token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Token de autorização obrigatório'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('Token recebido:', token.substring(0, 10) + '...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validar se o token corresponde a um vendedor válido
    const { data: vendedor, error: vendedorError } = await supabase
      .from('perfis_usuarios')
      .select('id, nome')
      .eq('token_api', token)
      .single();

    if (vendedorError || !vendedor) {
      console.log('Token inválido ou vendedor não encontrado:', vendedorError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Token inválido'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Vendedor autenticado:', vendedor.nome);

    // Processar payload
    const payload: EtiquetasPayload = await req.json();
    console.log('Payload recebido:', JSON.stringify(payload, null, 2));

    // Validar payload
    if (!payload.sellerId || !Array.isArray(payload.etiquetas) || !payload.timestamp) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Payload inválido. Campos obrigatórios: sellerId, etiquetas, timestamp'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verificar se sellerId corresponde ao vendedor autenticado
    if (payload.sellerId !== vendedor.id && payload.sellerId !== vendedor.nome) {
      return new Response(JSON.stringify({
        success: false,
        error: 'sellerId não corresponde ao token fornecido'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Processar cada etiqueta
    const dataAtual = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const processedCount = await processarEtiquetas(supabase, vendedor.id, payload.etiquetas, dataAtual);

    console.log(`Processadas ${processedCount} etiquetas para ${vendedor.nome}`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Etiquetas recebidas com sucesso',
      processed: processedCount,
      vendedor: vendedor.nome,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Erro ao processar etiquetas:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Erro interno do servidor'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processarEtiquetas(
  supabase: any, 
  vendedorId: string, 
  etiquetas: EtiquetaData[], 
  data: string
): Promise<number> {
  let processedCount = 0;

  for (const etiqueta of etiquetas) {
    try {
      // Inserir ou atualizar no histórico diário
      const { error } = await supabase
        .from('historico_etiquetas_diario')
        .upsert({
          vendedor_id: vendedorId,
          data: data,
          etiqueta: etiqueta.name.toUpperCase(),
          quantidade: etiqueta.count,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'vendedor_id,data,etiqueta'
        });

      if (error) {
        console.error(`Erro ao processar etiqueta ${etiqueta.name}:`, error);
      } else {
        console.log(`Etiqueta processada: ${etiqueta.name} = ${etiqueta.count}`);
        processedCount++;
      }
    } catch (error) {
      console.error(`Erro ao processar etiqueta ${etiqueta.name}:`, error);
    }
  }

  return processedCount;
}
