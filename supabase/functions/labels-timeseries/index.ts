import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') || '14');
    const labelId = url.searchParams.get('label_id');

    // Get time series data from whatsapp_labels_history
    let query = supabase
      .from('whatsapp_labels_history')
      .select('label_id, label_name, count, ts')
      .gte('ts', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('ts', { ascending: true });

    if (labelId) {
      query = query.eq('label_id', labelId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching time series:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by day and aggregate
    const dayMap = new Map();
    data?.forEach(row => {
      const day = new Date(row.ts).toISOString().split('T')[0];
      const key = `${day}-${row.label_id}`;
      
      if (!dayMap.has(key) || dayMap.get(key).count < row.count) {
        dayMap.set(key, {
          dia: day,
          id: row.label_id,
          name: row.label_name,
          count: row.count
        });
      }
    });

    const result = Array.from(dayMap.values()).sort((a, b) => a.dia.localeCompare(b.dia));

    return new Response(
      JSON.stringify({ ok: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in labels-timeseries:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});