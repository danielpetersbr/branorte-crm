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

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Método não permitido' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405 
      }
    );
  }

  try {
    // Inicializar cliente Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { token } = await req.json();
    
    if (!token || typeof token !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    console.log('🔧 Validando token:', token);

    // Testar o token fazendo uma requisição para a API
    const testUrl = `https://api-whatsapp.wascript.com.br/api/listar-etiquetas/${token}`;
    const testResponse = await fetch(testUrl);
    
    if (!testResponse.ok) {
      throw new Error(`Token inválido ou expirado`);
    }

    const testData = await testResponse.json();
    
    if (!testData.success) {
      throw new Error('Token não retornou dados válidos');
    }

    console.log('✅ Token validado com sucesso');

    // Salvar o token do Éder no perfil
    const { error: updateError } = await supabase
      .from('perfis_usuarios')
      .update({ token_api: token })
      .eq('id', '7f8e9d10-5a3b-4c2d-8e7f-9a0b1c2d3e4f')
      .eq('nome', 'Eder');

    if (updateError) {
      console.error('❌ Erro ao salvar token:', updateError);
      throw new Error('Erro ao salvar o token no perfil');
    }

    console.log('💾 Token salvo no perfil do Éder');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Token validado com sucesso!',
        etiquetas_encontradas: testData.etiquetas?.length || 0
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('❌ Erro na validação do token:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Erro ao validar token'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});