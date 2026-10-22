// meta-gasto-sync — gasto do Meta (dia × anúncio), campanhas e anúncios direto da API, SEM o Chrome (22/10/2026).
// Mesmas regras do loader do PC (Branorte/backend/meta_gasto/meta-gasto-branorte.mjs):
//  - um dia por pedido (pedido de vários dias com time_increment=1 voltava com gasto errado em 21/10);
//  - cada dia conferido com o gasto da CONTA (tolerância 2% ou R$ 2); dia que não fecha não é gravado;
//  - a gravação (public.meta_gasto_gravar) nunca troca gasto/impressões > 0 por zero.
// Token: secret META_ADS_TOKEN (usuário do sistema "CRM Branorte", ads_read). Nunca vai pro log nem pra resposta.
// Quem chama: pg_cron, com Authorization: Bearer <vault alerta_entregar_bearer> (conferido por meta_gasto_chave_ok).
// Uso: POST /functions/v1/meta-gasto-sync?dias=3   (dias = hoje e os N-1 anteriores, no fuso de São Paulo; máx. 31)
import { createClient } from 'npm:@supabase/supabase-js@2'

const ACT = 'act_315635643399004'
const V = 'v21.0'
const diaSP = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const chave = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: ok } = await sb.rpc('meta_gasto_chave_ok', { p: chave })
  if (ok !== true) return json({ erro: 'não autorizado' }, 401)

  const u = new URL(req.url)
  const nDias = Math.min(31, Math.max(1, Number(u.searchParams.get('dias') || 3) || 3))
  const dias: string[] = []
  for (let i = nDias - 1; i >= 0; i--) dias.push(diaSP(new Date(Date.now() - i * 864e5)))
  const info: Record<string, unknown> = { origem: 'edge', desde: dias[0], ate: dias[dias.length - 1] }

  const token = Deno.env.get('META_ADS_TOKEN')
  // erro do Meta sem o token: a mensagem nunca carrega o access_token
  // erro passageiro do Meta ("An unknown error occurred" code 1/2, limite 4/17/32/613): espera e tenta de novo, até 3 vezes
  const buscar = async (url: string) => {
    for (let tentativa = 1; ; tentativa++) {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'access_token=' + token)
      const j = await r.json().catch(() => ({ error: { message: 'resposta não-JSON HTTP ' + r.status, code: 2 } }))
      if (!j?.error) return j
      if (tentativa < 3 && [1, 2, 4, 17, 32, 613].includes(Number(j.error.code))) { await new Promise((ok) => setTimeout(ok, 3000 * tentativa)); continue }
      throw new Error(`Meta: ${j.error.message} (${j.error.code ?? r.status}) [${url.split('?')[0].replace(/^.*\/v\d+\.\d+\//, '')}]`)
    }
  }
  // paging.next do Meta já traz o access_token: tira antes de reaproveitar
  const semToken = (next?: string | null) => (next ? next.replace(/([?&])access_token=[^&]*&?/, '$1').replace(/[?&]$/, '') : null)

  try {
    if (!token) throw new Error('secret META_ADS_TOKEN ausente')
    const campos = 'ad_id,ad_name,adset_name,campaign_id,campaign_name,objective,spend,impressions,inline_link_clicks,actions'
    const linhas: Record<string, unknown>[] = []
    const pulados: string[] = []
    for (const dia of dias) {
      const tr = encodeURIComponent(JSON.stringify({ since: dia, until: dia }))
      const conta = await buscar(`https://graph.facebook.com/${V}/${ACT}/insights?fields=spend&time_range=${tr}`)
      const gastoConta = Number(conta?.data?.[0]?.spend || 0)
      const doDia: Record<string, unknown>[] = []
      let url: string | null = `https://graph.facebook.com/${V}/${ACT}/insights?level=ad&fields=${campos}&time_range=${tr}&limit=500`
      for (let pag = 0; url && pag < 20; pag++) {
        const j = await buscar(url)
        for (const a of j?.data ?? []) {
          const ac = Object.fromEntries((a.actions ?? []).map((x: { action_type: string; value: string }) => [x.action_type, Number(x.value)]))
          doDia.push({
            data: dia, ad_id: a.ad_id, anuncio: a.ad_name, conjunto: a.adset_name, campanha: a.campaign_name,
            campanha_id: a.campaign_id ?? null, acoes: ac, objetivo: a.objective, gasto: Number(a.spend || 0),
            impressoes: Number(a.impressions || 0), cliques: Number(a.inline_link_clicks || 0),
            conversas: ac['onsite_conversion.messaging_conversation_started_7d'] ?? 0, leads_form: ac['lead'] ?? 0,
          })
        }
        url = semToken(j?.paging?.next)
      }
      const soma = doDia.reduce((s, l) => s + Number(l.gasto), 0)
      if (Math.abs(soma - gastoConta) > Math.max(2, gastoConta * 0.02)) {
        pulados.push(`${dia} (anúncios R$ ${soma.toFixed(2)} × conta R$ ${gastoConta.toFixed(2)})`)
        continue
      }
      linhas.push(...doDia)
    }
    info.pulados = pulados.join('; ')

    // campanhas: situação e orçamento/dia (da campanha, ou soma dos conjuntos ativos)
    const campanhas: Record<string, unknown>[] = []
    let cu: string | null = `https://graph.facebook.com/${V}/${ACT}/campaigns?fields=id,name,objective,effective_status,daily_budget,`
      + `adsets.limit(100){daily_budget,effective_status}&limit=50`
    for (let pag = 0; cu && pag < 40; pag++) {
      const j = await buscar(cu)
      for (const c of j?.data ?? []) {
        const conj = (c.adsets?.data ?? []).filter((s: { effective_status: string; daily_budget?: string }) => s.effective_status === 'ACTIVE' && s.daily_budget)
        const orc = c.daily_budget ? Number(c.daily_budget) / 100
          : (conj.length ? conj.reduce((s: number, x: { daily_budget: string }) => s + Number(x.daily_budget) / 100, 0) : null)
        campanhas.push({ campanha_id: c.id, nome: c.name, objetivo: c.objective ?? null, status: c.effective_status ?? null, orcamento_dia: orc })
      }
      cu = semToken(j?.paging?.next)
    }

    // anúncios com gasto no período: situação, conjunto e o criativo (imagem 600 px e publicação) — 50 por pedido
    const ids = [...new Set(linhas.map((l) => String(l.ad_id)))]
    const anuncios: Record<string, unknown>[] = []
    const fAd = 'id,name,effective_status,campaign_id,adset{id,name,effective_status,daily_budget},'
      + 'creative.thumbnail_width(600).thumbnail_height(600){thumbnail_url,image_url,effective_object_story_id,object_type}'
    for (let i = 0; i < ids.length; i += 50) {
      const j = await buscar(`https://graph.facebook.com/${V}/?ids=${ids.slice(i, i + 50).join(',')}&fields=${encodeURIComponent(fAd)}`)
      for (const a of Object.values(j ?? {}) as any[]) {
        anuncios.push({
          ad_id: a.id, nome: a.name, status: a.effective_status ?? null, campanha_id: a.campaign_id ?? null,
          conjunto_id: a.adset?.id ?? null, conjunto: a.adset?.name ?? null, conjunto_status: a.adset?.effective_status ?? null,
          conjunto_orcamento_dia: a.adset?.daily_budget ? Number(a.adset.daily_budget) / 100 : null,
          thumb_url: a.creative?.image_url || a.creative?.thumbnail_url || null,
          post_id: a.creative?.effective_object_story_id ?? null, tipo_criativo: a.creative?.object_type ?? null,
        })
      }
    }

    const { data: res, error } = await sb.rpc('meta_gasto_gravar', { p: { linhas, campanhas, anuncios, info } })
    if (error) throw new Error('gravar: ' + error.message)
    return json({ ok: true, dias, pulados, ...res })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 500)
    info.erro = msg
    await sb.rpc('meta_gasto_gravar', { p: { info } })
    return json({ ok: false, erro: msg }, 500)
  }
})
