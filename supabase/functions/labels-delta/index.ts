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

    // Get the last two snapshots per label for delta calculation
    const { data, error } = await supabase
      .from('whatsapp_labels_history')
      .select('label_id, label_name, count, ts')
      .gte('ts', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .order('ts', { ascending: false });

    if (error) {
      console.error('Error fetching delta data:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by label_id and get the two most recent entries
    const labelMap = new Map();
    data?.forEach(row => {
      if (!labelMap.has(row.label_id)) {
        labelMap.set(row.label_id, []);
      }
      const entries = labelMap.get(row.label_id);
      if (entries.length < 2) {
        entries.push(row);
      }
    });

    // Calculate deltas
    const result = Array.from(labelMap.entries()).map(([labelId, entries]) => {
      const [current, previous] = entries;
      return {
        id: labelId,
        name: current.label_name,
        count_now: current.count,
        count_prev: previous?.count || 0,
        delta: current.count - (previous?.count || 0)
      };
    }).sort((a, b) => b.delta - a.delta);

    return new Response(
      JSON.stringify({ ok: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in labels-delta:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});