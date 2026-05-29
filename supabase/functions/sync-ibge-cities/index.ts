import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IBGEMunicipality {
  id: number;
  nome: string;
  microrregiao: {
    mesorregiao: {
      UF: {
        sigla: string;
        nome: string;
      }
    }
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting IBGE cities sync...');

    // Get all states from database
    const { data: states, error: statesError } = await supabase
      .from('br_states')
      .select('uf, name');

    if (statesError) {
      console.error('Error fetching states:', statesError);
      throw statesError;
    }

    let totalCitiesProcessed = 0;
    let totalStatesProcessed = 0;

    // Process each state
    for (const state of states) {
      console.log(`Processing state: ${state.uf} - ${state.name}`);
      
      try {
        // Fetch cities from IBGE API
        const ibgeResponse = await fetch(
          `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.uf}/municipios`,
          {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Supabase-Function/1.0'
            }
          }
        );

        if (!ibgeResponse.ok) {
          console.error(`IBGE API error for ${state.uf}: ${ibgeResponse.status} - ${ibgeResponse.statusText}`);
          continue;
        }

        const municipalities: IBGEMunicipality[] = await ibgeResponse.json();
        console.log(`Found ${municipalities.length} cities for ${state.uf}`);

        // Transform IBGE data to our format
        const cities = municipalities.map(municipality => ({
          ibge_id: municipality.id,
          name: municipality.nome,
          uf: state.uf,
          state_name: state.name,
          lat: null,
          lon: null
        }));

        // Upsert cities in batches
        const batchSize = 100;
        for (let i = 0; i < cities.length; i += batchSize) {
          const batch = cities.slice(i, i + batchSize);
          
          const { error: upsertError } = await supabase
            .from('br_cities')
            .upsert(batch, { 
              onConflict: 'ibge_id',
              ignoreDuplicates: false 
            });

          if (upsertError) {
            console.error(`Error upserting batch for ${state.uf}:`, upsertError);
            throw upsertError;
          }
        }

        totalCitiesProcessed += cities.length;
        totalStatesProcessed += 1;
        
        console.log(`Successfully processed ${cities.length} cities for ${state.uf}`);
        
        // Add small delay to avoid overwhelming the IBGE API
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Error processing state ${state.uf}:`, error);
        // Continue with other states even if one fails
      }
    }

    console.log(`Sync completed: ${totalStatesProcessed} states, ${totalCitiesProcessed} cities`);

    // Return success response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sync completed successfully`,
        stats: {
          states_processed: totalStatesProcessed,
          cities_processed: totalCitiesProcessed,
          total_states: states.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Fatal error in sync-ibge-cities function:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error occurred',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});