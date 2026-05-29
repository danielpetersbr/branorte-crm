import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data, error } = await supa.from('ext_release').select('version, released_at, notes').eq('id', 1).single()
  if (error || !data) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'no_release' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({ ok: true, version: data.version, released_at: data.released_at, notes: data.notes }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
