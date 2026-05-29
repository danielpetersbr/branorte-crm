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
    const { token } = await req.json()
    
    if (!token) {
      throw new Error('Token é obrigatório')
    }

    console.log(`🔄 Iniciando sincronização para token: ${token}`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Gerar sync_run_id único para esta execução
    const syncRunId = crypto.randomUUID()
    console.log(`🆔 Sync Run ID: ${syncRunId}`)

    // Fazer chamada para API WaScript com quebra de cache
    const timestamp = Date.now()
    const apiUrl = `https://api-whatsapp.wascript.com.br/api/listar-etiquetas/${token}?ts=${timestamp}`
    
    console.log(`📡 Fazendo request para: ${apiUrl}`)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout
    
    const response = await fetch(apiUrl, {
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': 'Supabase-EdgeFunction/1.0'
      },
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`API WaScript erro HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    console.log(`📦 Resposta recebida:`, data)
    
    if (!data.success) {
      throw new Error(`API WaScript retornou success: false - ${data.message || 'Erro desconhecido'}`)
    }
    
    if (!Array.isArray(data.etiquetas)) {
      throw new Error('Resposta da API não contém array de etiquetas válido')
    }

    const startTime = Date.now()
    let upsertCount = 0
    let deactivatedCount = 0
    
    // Processar cada etiqueta
    for (const item of data.etiquetas) {
      try {
        // Normalizar dados conforme especificação
        const externalId = String(item.id || item.external_id || '')
        const name = item.name || item.nome || ''
        const leadCount = Number.isFinite(item.count) ? item.count : 0
        const hexColor = item.hexColor || null
        const colorIndex = Number.isFinite(item.colorIndex) ? item.colorIndex : null
        
        if (!externalId || !name) {
          console.warn('⚠️ Item ignorado por falta de ID ou nome:', item)
          continue
        }
        
        // UPSERT da etiqueta - verificar se já existe
        const { data: existing } = await supabase
          .from('whatsapp_labels')
          .select('id')
          .eq('token', token)
          .eq('external_id', externalId)
          .single()

        const upsertData = {
          token,
          external_id: externalId,
          name,
          lead_count: leadCount,
          hex_color: hexColor,
          color_index: colorIndex,
          is_active: true,
          last_synced_at: new Date().toISOString(),
          raw_json: item,
          sync_run_id: syncRunId
        }

        // Se existe, incluir o ID na atualização
        if (existing) {
          upsertData.id = existing.id
        }

        const { error: upsertError } = await supabase
          .from('whatsapp_labels')
          .upsert(upsertData, {
            onConflict: 'token,external_id'
          })
        
        if (upsertError) {
          console.error('❌ Erro no upsert:', upsertError)
          throw upsertError
        }
        
        upsertCount++
        
      } catch (itemError) {
        console.error('❌ Erro processando item:', item, itemError)
        throw itemError
      }
    }
    
    // Desativar etiquetas que não vieram neste sync
    const { data: deactivatedData, error: deactivateError } = await supabase
      .from('whatsapp_labels')
      .update({ is_active: false })
      .eq('token', token)
      .neq('sync_run_id', syncRunId)
      .eq('is_active', true)
      .select('id')
    
    if (deactivateError) {
      console.error('❌ Erro ao desativar etiquetas antigas:', deactivateError)
      throw deactivateError
    }
    
    deactivatedCount = deactivatedData?.length || 0
    
    const syncTime = Date.now() - startTime
    
    // Buscar etiquetas ativas finais
    const { data: activeLabels, error: selectError } = await supabase
      .from('whatsapp_labels')
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .order('lead_count', { ascending: false })
      .order('name')
    
    if (selectError) {
      console.error('❌ Erro ao buscar etiquetas ativas:', selectError)
      throw selectError
    }

    console.log(`✅ Sincronização concluída em ${syncTime}ms`)
    console.log(`📊 Estatísticas: ${upsertCount} upserts, ${deactivatedCount} desativadas, ${activeLabels?.length || 0} ativas`)
    
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Sincronização concluída com sucesso',
        data: {
          token,
          sync_run_id: syncRunId,
          sync_time_ms: syncTime,
          stats: {
            upserted: upsertCount,
            deactivated: deactivatedCount,
            active_total: activeLabels?.length || 0
          },
          labels: activeLabels || [],
          last_synced_at: new Date().toISOString()
        }
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
    
    let errorMessage = 'Erro interno na sincronização'
    let statusCode = 500
    
    if (error.name === 'AbortError') {
      errorMessage = 'Timeout na API WaScript (15s)'
      statusCode = 408
    } else if (error.message) {
      errorMessage = error.message
    }
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }, 
        status: statusCode 
      }
    )
  }
})