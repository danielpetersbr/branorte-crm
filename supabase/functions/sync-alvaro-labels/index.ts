import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔄 Iniciando sincronização das etiquetas do Álvaro...')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Token fixo do Álvaro conforme solicitado
    const alvaroToken = '1751387001230-cbcbe0ea5564553c48d9ba6cdfaca889'
    const vendedorId = '4dd59388-b37d-49cf-b0e4-caffaf0962a3' // ID do Álvaro
    
    console.log('🔑 Usando token do Álvaro:', alvaroToken)
    
    // Fazer chamada para a API WaScript
    console.log('📡 Fazendo request para API WaScript...')
    const response = await fetch(`https://api-whatsapp.wascript.com.br/api/listar-etiquetas/${alvaroToken}`)
    
    if (!response.ok) {
      throw new Error(`API WaScript retornou erro: ${response.status}`)
    }
    
    const data = await response.json()
    console.log('📦 Resposta da API:', data)
    
    if (!data.success || !data.etiquetas) {
      throw new Error('API retornou dados inválidos')
    }

    // Limpar cache antigo do Álvaro
    await supabase
      .from('whatsapp_labels_cache')
      .delete()
      .eq('vendor_slug', 'alvaro')

    // Limpar etiquetas sincronizadas antigas do Álvaro
    await supabase
      .from('etiquetas_whatsapp_sincronizadas')
      .delete()
      .eq('vendedor_id', vendedorId)

    console.log('🧹 Cache antigo limpo')

    // Processar e salvar as novas etiquetas
    const etiquetasParaSalvar = data.etiquetas.map((etiqueta: any) => ({
      vendedor_id: vendedorId,
      vendedor_nome: 'Alvaro',
      etiqueta_nome: etiqueta.name,
      quantidade: etiqueta.count,
      token_usado: alvaroToken,
      data_sincronizacao: new Date().toISOString()
    }))

    console.log(`💾 Salvando ${etiquetasParaSalvar.length} etiquetas na tabela sincronizada...`)
    
    const { error: syncError } = await supabase
      .from('etiquetas_whatsapp_sincronizadas')
      .insert(etiquetasParaSalvar)

    if (syncError) {
      console.error('❌ Erro ao salvar etiquetas sincronizadas:', syncError)
      throw syncError
    }

    // Salvar também no cache para compatibilidade
    const cacheData = data.etiquetas.map((etiqueta: any) => ({
      vendor_slug: 'alvaro',
      vendor_name: 'ÁLVARO',
      token: alvaroToken,
      label_slug: etiqueta.name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, ''),
      label_name: etiqueta.name,
      count: etiqueta.count,
      hex_color: etiqueta.hexColor,
      raw: etiqueta,
      synced_at: new Date().toISOString()
    }))

    console.log(`💾 Salvando ${cacheData.length} etiquetas no cache...`)
    
    const { error: cacheError } = await supabase
      .from('whatsapp_labels_cache')
      .insert(cacheData)

    if (cacheError) {
      console.error('❌ Erro ao salvar no cache:', cacheError)
      throw cacheError
    }

    // Contar total de etiquetas com contatos
    const totalContatos = data.etiquetas.reduce((sum: number, etiqueta: any) => sum + etiqueta.count, 0)
    const etiquetasAtivas = data.etiquetas.filter((etiqueta: any) => etiqueta.count > 0)

    console.log('✅ Sincronização concluída com sucesso!')
    
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Etiquetas do Álvaro sincronizadas com sucesso!',
        dados: {
          total_etiquetas: data.etiquetas.length,
          etiquetas_ativas: etiquetasAtivas.length,
          total_contatos: totalContatos,
          timestamp: new Date().toISOString(),
          token_usado: alvaroToken
        },
        etiquetas: data.etiquetas
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('❌ Erro na sincronização:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        message: 'Erro ao sincronizar etiquetas do Álvaro'
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }, 
        status: 500 
      }
    )
  }
})