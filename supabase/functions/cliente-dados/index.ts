import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

function normTel(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!SHARED_SECRET || auth !== SHARED_SECRET) return json({ error: 'unauthorized' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const TABLE = 'cliente_dados_visita'

  // GET ?all=1 -> lista TODOS os valores (pro kanban) | ?visitar=1 tambem filtra so quem e pra visitar
  // GET ?telefone=... -> carrega dados de um cliente
  if (req.method === 'GET') {
    const url = new URL(req.url)
    if (url.searchParams.get('all') === '1') {
      let q = sb.from(TABLE).select('telefone, valor_negociando, cidade, estado, interesse, vendedor_nome, visitar, visita_obrigatoria, lat, lng, nome')
      if (url.searchParams.get('visitar') === '1') q = q.eq('visitar', true)
      const { data, error } = await q
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, lista: data ?? [] })
    }

    // ────────────────────────────────────────────────────────────────────────────
    // GET ?orcamentos=1&tel=a,b,c -> valor do ULTIMO ORCAMENTO por telefone (canonico)
    //
    // (17/09/2026) A extensao mostrava valor so de `cliente_dados_visita.valor_negociando`,
    // que e digitado a mao no formulario "Dados pra visita": 144 telefones. O CRM web mostra
    // outra coisa — o valor do ultimo orcamento GERADO, automatico, via RPC
    // `orcamentos_por_telefone_canon`. Por isso o mesmo cliente aparecia com valor num lugar
    // e sem valor no outro. Medido nos chats ativos de 30 dias: 497 tem orcamento contra 144
    // com valor manual, somando R$ 52,1 mi de pipeline que o Kanban da extensao nao via.
    //
    // Rota ADITIVA: nao toca no ?all=1, no ?telefone= nem no POST.
    //
    // O "canon" e a mesma chave do CRM (src/lib/fone-canon.ts): sem DDI 55, sem o 9 do
    // celular, 10 digitos. Sem isso os dois lados nunca casam o mesmo cliente — e um
    // telefone estrangeiro NAO tem canon, porque o slice fabricaria um DDD brasileiro falso.
    // ────────────────────────────────────────────────────────────────────────────
    if (url.searchParams.get('orcamentos') === '1') {
      const brutos = String(url.searchParams.get('tel') ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean)

      const canon = (p: string): string | null => {
        const bruto = String(p ?? '').trim()
        const d = bruto.replace(/\D/g, '')
        if (d.length < 10) return null
        if (bruto.startsWith('+') && !d.startsWith('55')) return null
        let n = (d.length >= 12 && d.startsWith('55')) ? d.slice(2) : d
        if (n.length === 11 && n[2] === '9') n = n.slice(0, 2) + n.slice(3)
        if (n.length > 10) n = n.slice(-10)
        return n.length === 10 ? n : null
      }

      const canons = [...new Set(brutos.map(canon).filter((c): c is string => !!c))]
      if (canons.length === 0) return json({ ok: true, lista: [] })
      if (canons.length > 3000) return json({ error: 'too_many', max: 3000 }, 400)

      const { data, error } = await sb.rpc('orcamentos_por_telefone_canon', { p_canons: canons })
      if (error) return json({ error: error.message }, 500)

      const lista = (data ?? [])
        .filter((r: any) => Number(r?.ultimo_valor) > 0)
        .map((r: any) => ({
          canon: String(r.fone_canon),
          valor: Number(r.ultimo_valor),
          numero: r.ultimo_numero ?? null,
          em: r.ultimo_em ?? null,
          qtd: Number(r.qtd ?? 0),
        }))
      return json({ ok: true, lista })
    }

    const tel = normTel(url.searchParams.get('telefone'))
    if (!tel) return json({ error: 'telefone_required' }, 400)
    const { data, error } = await sb.from(TABLE).select('*').eq('telefone', tel).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, dados: data ?? null })
  }

  // POST {telefone, ...} -> upsert | POST {action:'delete', telefone} -> apaga o cadastro
  if (req.method === 'POST') {
    let body: any
    try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
    const tel = normTel(body.telefone)
    if (!tel) return json({ error: 'telefone_required' }, 400)

    if (body.action === 'delete') {
      const { error } = await sb.from(TABLE).delete().eq('telefone', tel)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, deleted: true })
    }

    // ────────────────────────────────────────────────────────────────────────────
    // v10 (19/08/2026) — CHAVE AUSENTE PRESERVA A COLUNA.
    //
    // Ate a v9 toda coluna era escrita INCONDICIONALMENTE: quem mandasse um POST sem
    // `cidade` gravava null em cima da cidade do cliente. Isso ja era uma bomba com o
    // botao Salvar (se o GET falhasse, os inputs estavam vazios) e virou perda de dado
    // garantida com o autosave do bloco QUALIFICACAO: o painel se reconstroi com os
    // inputs zerados em troca de aba/sub-aba/reabrir, e um POST disparado nessa janela
    // zerava cidade, interesse, valor_negociando e `visitar` — tirando o cliente do mapa,
    // sem nenhum aviso na tela (o GET repunha os valores 300ms depois).
    // Medido por agente critico em 19/08/2026 contra o arquivo real.
    //
    // Agora: presente no body => grava (inclusive '' ou null, que e como se LIMPA de
    // proposito). Ausente => a coluna nem entra no upsert e o valor atual sobrevive.
    // O botao Salvar e o autoSalvarInteressePerfil mandam todos os campos, entao o
    // comportamento deles nao muda.
    // ────────────────────────────────────────────────────────────────────────────
    const tem = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
    if (tem('visita_obrigatoria') && typeof body.visita_obrigatoria !== 'boolean') {
      return json({ error: 'visita_obrigatoria_invalid' }, 400)
    }
    const clean = (v: unknown) => { const s = String(v ?? '').trim(); return s ? s : null }
    const num = (v: unknown) => {
      if (v === '' || v === null || v === undefined) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    // qualificacao: objeto JSON (nao array, nao string) OU null pra limpar.
    const QUALIFICACAO_MAX_BYTES = 8192
    let qualificacao: unknown = undefined
    if (tem('qualificacao')) {
      const q = body.qualificacao
      if (q === null) {
        qualificacao = null
      } else if (typeof q === 'object' && !Array.isArray(q)) {
        let serial: unknown
        try { serial = JSON.stringify(q) } catch { return json({ error: 'qualificacao_invalid' }, 400) }
        if (typeof serial !== 'string') return json({ error: 'qualificacao_invalid' }, 400)
        const bytes = new TextEncoder().encode(serial).length
        if (bytes > QUALIFICACAO_MAX_BYTES) {
          return json({ error: 'qualificacao_too_large', bytes, max_bytes: QUALIFICACAO_MAX_BYTES }, 400)
        }
        qualificacao = q
      } else {
        return json({ error: 'qualificacao_invalid' }, 400)
      }
    }

    const row: Record<string, unknown> = { telefone: tel, updated_at: new Date().toISOString() }
    if (tem('nome'))          row.nome = clean(body.nome)
    if (tem('cidade'))        row.cidade = clean(body.cidade)
    if (tem('estado'))        row.estado = body.estado ? String(body.estado).toUpperCase().trim().slice(0, 2) : null
    if (tem('interesse'))     row.interesse = clean(body.interesse)
    if (tem('valor_negociando')) row.valor_negociando = num(body.valor_negociando)
    if (tem('visitar'))       row.visitar = typeof body.visitar === 'boolean' ? body.visitar : true
    if (tem('visita_obrigatoria')) row.visita_obrigatoria = body.visita_obrigatoria
    // Retirar "Pode visitar" vence inputs contraditórios. Ausência das duas
    // flags não altera a intenção atual nos autosaves das outras informações.
    if (body.visitar === false) row.visita_obrigatoria = false
    else if (body.visita_obrigatoria === true) row.visitar = true
    if (tem('vendedor_nome')) row.vendedor_nome = clean(body.vendedor_nome)
    if (tem('etiquetas'))     row.etiquetas = Array.isArray(body.etiquetas) ? body.etiquetas.filter(Boolean) : null
    if (qualificacao !== undefined) row.qualificacao = qualificacao

    // INSERT de cliente novo: sem `visitar` no body o default da coluna e quem manda.
    // So invalida lat/lng quando a cidade/UF REALMENTE vem no body e mudou — antes
    // um POST sem cidade comparava contra null e zerava a geolocalizacao a toa.
    const { data: existing } = await sb.from(TABLE).select('cidade,estado').eq('telefone', tel).maybeSingle()
    if (existing) {
      const mudouCidade = tem('cidade') && existing.cidade !== row.cidade
      const mudouEstado = tem('estado') && existing.estado !== row.estado
      if (mudouCidade || mudouEstado) { row.lat = null; row.lng = null }
    }

    const { data, error } = await sb.from(TABLE).upsert(row, { onConflict: 'telefone' }).select().maybeSingle()
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, dados: data })
  }

  return json({ error: 'method_not_allowed' }, 405)
})
