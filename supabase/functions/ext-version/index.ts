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
  // COTA DE PARADOS: quem a cota zerou tambem para de prospectar. Prospectar e
  // abrir cliente novo — nao faz sentido barrar o lead que chega e deixar ele ir
  // buscar mais. FAIL-OPEN: se a leitura falhar, ninguem e cortado.
  const cortadosPelaCota = new Set<string>()
  try {
    const { data: cota } = await supa.from('vendor_roteamento_efetivo').select('vendedor_nome, fator_cota')
    for (const c of (cota ?? [])) {
      if (c && c.vendedor_nome && Number(c.fator_cota) === 0) {
        cortadosPelaCota.add(String(c.vendedor_nome).toUpperCase().trim())
      }
    }
  } catch (_e) { /* fail-open: sem cortes */ }
  try {
    const { data: vs } = await supa.from('vendor_dispatch_status').select('vendedor_nome, avaliacao_ativa, funil_ativa, prospec_ativa, online, bloqueado')
    for (const v of (vs ?? [])) {
      if (v && v.vendedor_nome) {
        const nome = String(v.vendedor_nome).toUpperCase().trim()
        // DESLIGADO no painel = nao gera CLIENTE NOVO. So isso.
        // 2026-08-04: o toggle do /disparos so barrava o roteamento. A prospeccao
        // automatica seguia rodando na extensao do vendedor desligado, abrindo
        // conversa nova o dia inteiro — e no /atendimentos parecia que o sistema
        // estava mandando lead pra quem estava desligado.
        const ligado = v.online === true && v.bloqueado !== true
        // Avaliacao e automacao do funil NAO entram nessa regra de proposito:
        // mexem em conversa que ja existe (etiqueta, pedido de avaliacao). Vendedor
        // desligado continua trabalhando a carteira dele.
        avaliacaoVendedores[nome] = v.avaliacao_ativa !== false   // avaliacao: opt-out (default ligado)
        funilVendedores[nome] = v.funil_ativa === true            // funil: opt-in (default desligado)
        // prospeccao: so pra quem esta ligado E nao foi zerado pela cota de parados
        prospecVendedores[nome] = ligado && !cortadosPelaCota.has(nome) && v.prospec_ativa !== false
      }
    }
  } catch (_e) { /* mapa vazio = todos default */ }
  const version = data.paused ? '0.0.0' : data.version
  return new Response(JSON.stringify({ ok: true, version, released_at: data.released_at, notes: data.notes, paused: !!data.paused, avaliacao_auto_ativa: avaliacaoMaster, avaliacao_vendedores: avaliacaoVendedores, auto_prospec_ativa: autoProspecAtiva, prospec_vendedores: prospecVendedores, atalho_ativo: atalhoAtivo, funil_auto_ativa: funilMaster, funil_vendedores: funilVendedores, funil_dry_run: funilDryRun }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
