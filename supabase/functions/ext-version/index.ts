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
  const { data, error } = await supa.from('ext_release').select('version, released_at, notes, paused').eq('id', 1).single()
  if (error || !data) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'no_release' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }
  // Config global de comportamento da extensao (tabela wa_avaliacao_config, editavel no /disparos).
  let avaliacaoMaster = true
  let autoProspecAtiva = true
  let atalhoAtivo = true
  let funilMaster = false   // Automacao do Funil: OPT-IN, nasce DESLIGADA pra todos
  let funilDryRun = true    // Funil: comeca em dry-run (computa/loga/notifica, NAO aplica etiqueta)
  const avaliacaoVendedores: Record<string, boolean> = {}
  const funilVendedores: Record<string, boolean> = {}
  const prospecVendedores: Record<string, boolean> = {}
  try {
    const { data: av } = await supa.from('wa_avaliacao_config').select('ativa, auto_prospec_ativa, atalho_ativo, funil_auto_ativa, funil_dry_run').eq('id', 1).maybeSingle()
    if (av && typeof av.ativa === 'boolean') avaliacaoMaster = av.ativa
    if (av && typeof av.auto_prospec_ativa === 'boolean') autoProspecAtiva = av.auto_prospec_ativa
    if (av && typeof av.atalho_ativo === 'boolean') atalhoAtivo = av.atalho_ativo
    if (av && typeof av.funil_auto_ativa === 'boolean') funilMaster = av.funil_auto_ativa
    if (av && typeof av.funil_dry_run === 'boolean') funilDryRun = av.funil_dry_run
  } catch (_e) { /* defaults */ }
  try {
    const { data: vs } = await supa.from('vendor_dispatch_status').select('vendedor_nome, avaliacao_ativa, funil_ativa, prospec_ativa')
    for (const v of (vs ?? [])) {
      if (v && v.vendedor_nome) {
        const nome = String(v.vendedor_nome).toUpperCase().trim()
        avaliacaoVendedores[nome] = v.avaliacao_ativa !== false   // avaliacao: opt-out (default ligado)
        funilVendedores[nome] = v.funil_ativa === true            // funil: opt-in (default desligado)
        prospecVendedores[nome] = v.prospec_ativa !== false        // prospeccao: opt-out (default ligado)
      }
    }
  } catch (_e) { /* mapa vazio = todos default */ }
  const version = data.paused ? '0.0.0' : data.version
  return new Response(JSON.stringify({ ok: true, version, released_at: data.released_at, notes: data.notes, paused: !!data.paused, avaliacao_auto_ativa: avaliacaoMaster, avaliacao_vendedores: avaliacaoVendedores, auto_prospec_ativa: autoProspecAtiva, prospec_vendedores: prospecVendedores, atalho_ativo: atalhoAtivo, funil_auto_ativa: funilMaster, funil_vendedores: funilVendedores, funil_dry_run: funilDryRun }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
