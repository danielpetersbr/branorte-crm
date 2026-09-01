// prospeccao-extensao v6 — 01/09/2026
//
// v6: HISTORICO DA NEGOCIACAO. Duas acoes novas pro drawer do chat:
//   `negociacao_historico` -> linha do tempo (notas + orcamentos + etiquetas)
//   `negociacao_nota`      -> vendedor anota por que a negociacao esta parada
// A identidade continua saindo do wa_self_wid — a nota e gravada pro vendedor
// DONO do WhatsApp logado, nao pro nome que o cliente mandar.
//
// v3: a ação `orcamentos` passa `p_so_esperando` adiante (chip "Esperando você"
// da lista nova, que abre POR CIMA da coluna de conversas). Sem este repasse o
// chip existiria na tela e o servidor devolveria a lista inteira — o mesmo tipo
// de mentira do "Parado 30d+" que dizia 39 e entregava 500.
//
// v2: acao `sem_whatsapp`. A auditoria mediu que 9 de 12 aberturas da feature
// cairam em numero SEM WhatsApp (75%). Sem marcar, o proximo vendedor gasta o
// mesmo clique no mesmo numero morto — e cada tentativa e mais uma consulta
// contra a conta dele, que e vetor de ban.
//
// As duas telas que o vendedor abre DENTRO do WhatsApp:
//   PROSPECÇÃO  -> escolhe UF, reserva 1 contato, abre, ou pula
//   MEUS ORÇAMENTOS -> clientes pra quem ele fez orçamento, com a última conversa
//
// ⚠️ IDENTIDADE. Esta função NÃO acredita no `vendedor_nome` que o cliente manda.
// A identidade sai de `wa_self_wid` — o WhatsApp que está REALMENTE logado, lido
// de WPP.whatsapp.UserPrefs.getMaybeMeUser — resolvido no banco por
// `vendedor_por_wid()`. Medido em 18/08: 10 dos 11 vendedores têm
// vendors.telefone == wid observado, com 1 wid distinto em 7 dias.
//
// O `vendedor_nome` continua sendo aceito, mas SÓ pra registrar divergência.
// Se ele disser IGOR e o WhatsApp for do DANIEL, a operação sai para o DANIEL e a
// divergência fica gravada. É o oposto do que o resto do sistema faz hoje.
//
// Fail-closed: wid ausente, malformado ou desconhecido = 401, zero escrita.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? Deno.env.get('SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-extension-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// comparação de segredo em tempo constante: `===` em string vaza o tamanho do
// prefixo comum pelo tempo de resposta
function segredoBate(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!segredoBate(auth, SHARED_SECRET)) return json({ error: 'unauthorized' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const { action, wa_self_wid, vendedor_nome } = body ?? {}
  if (!action) return json({ error: 'missing_action' }, 400)

  // ── IDENTIDADE ────────────────────────────────────────────────────────────
  const wid = String(wa_self_wid ?? '').replace(/\D/g, '')
  if (wid.length < 10 || wid.length > 15) {
    return json({ error: 'sem_identidade', msg: 'Abra o WhatsApp Web e aguarde carregar.' }, 401)
  }
  const { data: vendorId, error: eWid } = await sb.rpc('vendedor_por_wid', { p_wid: wid })
  if (eWid) { console.error('vendedor_por_wid', eWid); return json({ error: 'erro_identidade' }, 500) }
  if (!vendorId) {
    console.warn(`wid desconhecido: ${wid} (disse ser ${vendedor_nome ?? '?'})`)
    return json({ error: 'wid_desconhecido', msg: 'Este WhatsApp não está cadastrado como vendedor.' }, 401)
  }

  // registra o que ele DISSE ser, e acusa se não bate. Não muda nada.
  if (vendedor_nome) {
    sb.rpc('vendedor_registrar_wid', { p_nome: String(vendedor_nome), p_wid: wid })
      .then(({ error }) => { if (error) console.error('registrar_wid', error) })
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args)
    if (error) { console.error(fn, error); throw new Error(error.message) }
    return data
  }

  try {
    switch (action) {
      // ── PROSPECÇÃO ───────────────────────────────────────────────────────
      case 'ufs':
        return json({ ok: true, ufs: await rpc('prospeccao_ufs_de', { p_vendor: vendorId }) })

      case 'reservar': {
        const uf = String(body.uf ?? '').trim().toUpperCase()
        if (!/^[A-Z]{2}$/.test(uf)) return json({ ok: false, erro: 'uf_invalida' }, 400)
        return json(await rpc('prospeccao_reservar_de', { p_vendor: vendorId, p_uf: uf }))
      }

      // PRÓXIMO = solta a atual e pega outra. Duas operações, uma chamada: se
      // fossem duas idas, uma queda de rede entre elas deixaria o vendedor sem
      // reserva nenhuma e sem saber.
      case 'proximo': {
        const uf = String(body.uf ?? '').trim().toUpperCase()
        await rpc('prospeccao_soltar_de', { p_vendor: vendorId, p_motivo: String(body.motivo ?? 'pulou') })
        if (!/^[A-Z]{2}$/.test(uf)) return json({ ok: true, soltou: true })
        return json(await rpc('prospeccao_reservar_de', { p_vendor: vendorId, p_uf: uf }))
      }

      case 'soltar':
        return json(await rpc('prospeccao_soltar_de',
          { p_vendor: vendorId, p_motivo: String(body.motivo ?? 'devolvido') }))

      case 'minha':
        return json({ ok: true, reserva: await rpc('prospeccao_minha_de', { p_vendor: vendorId }) })

      case 'nao_contatar':
        return json(await rpc('contato_nao_contatar_marcar_de', {
          p_vendor: vendorId, p_telefone: String(body.telefone ?? ''),
          p_motivo: String(body.motivo ?? 'pediu_para_nao_contatar'), p_obs: body.obs ?? null,
        }))

      // O numero nao tem WhatsApp: tira do pool de TODO MUNDO, nao só deste vendedor.
      case 'sem_whatsapp':
        return json(await rpc('contato_marcar_sem_whatsapp', {
          p_vendor: vendorId, p_telefone: String(body.telefone ?? ''),
        }))

      // ── MEUS ORÇAMENTOS ──────────────────────────────────────────────────
      case 'orcamentos':
        return json({
          ok: true,
          clientes: await rpc('meus_clientes_orcamento', {
            p_vendor: vendorId,
            p_busca: body.busca ?? null,
            p_so_sem_conversa: body.so_sem_conversa === true,
            p_dias_parado: body.dias_parado != null && Number.isFinite(Number(body.dias_parado)) ? Number(body.dias_parado) : null,
            // v3: chips "Esperando você" e "Precisa de ação". Sem este repasse os
            // dois filtravam nada e a lista voltava inteira — o chip diria 83 e a
            // tela mostraria 300.
            p_so_esperando: body.so_esperando === true,
            p_so_acao: body.so_acao === true,
            // v4: os filtros que a lista da lateral oferece. Todos opcionais e
            // todos aplicados NO BANCO — recortar no navegador faria o contador
            // do chip discordar da lista assim que batesse o teto de 300.
            p_etiqueta: body.etiqueta ?? null,
            p_uf: body.uf ?? null,
            p_ano_min: body.ano_min != null && Number.isFinite(Number(body.ano_min)) ? Number(body.ano_min) : null,
            p_ano_max: body.ano_max != null && Number.isFinite(Number(body.ano_max)) ? Number(body.ano_max) : null,
            // v5: mes do orcamento (1..12). Junto com o ano responde "quem eu
            // orcei em agosto" -- e o recorte acontece ANTES do agrupamento, entao
            // o contador de orcamentos da linha passa a falar do periodo escolhido.
            p_mes: body.mes != null && Number.isFinite(Number(body.mes)) ? Number(body.mes) : null,
            p_sem_encerrados: body.sem_encerrados === true,
            p_ordem: ['acao','parado','recente','antigo','nome'].includes(String(body.ordem)) ? String(body.ordem) : 'acao',
            p_limit: Math.min(Math.max(Number(body.limit) || 200, 1), 500),
            p_offset: Math.max(Number(body.offset) || 0, 0),
          }),
        })

      case 'orcamentos_resumo':
        return json({ ok: true, resumo: await rpc('meus_clientes_orcamento_resumo', { p_vendor: vendorId }) })

      // v4: o mapa dos seletores (etiquetas, UFs e anos com contagem). Conta a
      // carteira INTEIRA, sem aplicar o filtro escolhido -- se a faceta se
      // filtrasse, escolher MT zeraria os outros 26 estados.
      case 'orcamentos_facetas':
        return json({ ok: true, facetas: await rpc('meus_clientes_orcamento_facetas', { p_vendor: vendorId }) })

      // ── HISTORICO DA NEGOCIACAO (drawer no chat) ─────────────────────────
      case 'negociacao_historico':
        return json({
          ok: true,
          eventos: await rpc('negociacao_historico', {
            p_telefone: String(body.telefone ?? ''),
            p_limit: Math.min(Math.max(Number(body.limit) || 80, 1), 200),
          }),
        })

      case 'negociacao_nota': {
        const nota = String(body.nota ?? '').trim()
        if (!nota) return json({ ok: false, erro: 'nota_vazia' }, 400)
        if (nota.length > 2000) return json({ ok: false, erro: 'nota_grande' }, 400)
        return json(await rpc('negociacao_nota_criar', {
          p_vendor: vendorId,
          p_telefone: String(body.telefone ?? ''),
          p_nota: nota,
          p_motivo: body.motivo ? String(body.motivo).slice(0, 60) : null,
        }))
      }

      default:
        return json({ error: 'acao_desconhecida', action }, 400)
    }
  } catch (e) {
    console.error('prospeccao-extensao', action, e)
    return json({ ok: false, erro: 'erro_interno' }, 500)
  }
})
