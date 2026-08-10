// POST /api/capi-conversa  — varredura que avisa o Meta quando o clique virou
// CONVERSA DE VERDADE.
//
// POR QUE UMA VARREDURA E NAO O GATILHO:
// quem carimba matched_at e o gatilho link_rota_casar_msg(), em wa_chat_messages
// -- a tabela onde a frota inteira grava. Pendurar chamada HTTP la dentro
// significa que uma indisponibilidade do Meta vira latencia (ou erro engolido)
// no caminho de TODA mensagem de cliente. A varredura desacopla: se o Meta cair,
// as linhas ficam pendentes e saem no minuto seguinte.
//
// ⚠️ SO MANDA O QUE E CONFIAVEL. O filtro exige match_via in ('codigo','texto').
// Medido em 05-07/08/2026: dos 10 casamentos existentes, os 3 por 'codigo' eram
// todos reais e os 7 por 'janela' eram todos de OUTRA origem (Instagram,
// Facebook, quiz, e ate um fornecedor prospectando a Branorte). Mandar 'janela'
// pro Meta seria ensinar o algoritmo a caçar o lead errado -- pior que nao
// mandar nada. Se um dia o casamento por janela for consertado e virar
// confiavel, e AQUI que o nome entra na lista.
//
// ATRIBUICAO SEM fbc (mudou em 07/08/2026). Antes exigia fbc e, por isso, das 3
// conversas provadas por selo apenas 1 chegou ao Meta: so 4 dos 77 cliques do
// dia trouxeram fbclid, todos de placement Instagram. Os de Facebook Right
// Column vinham sem -- e a linha sem fbc nunca entrava na lista de pendentes,
// entao capi_enviado_at ficava NULL pra sempre: sumia em silencio, sem retry e
// sem marca.
//
// O que resolve e o `ph`: telefone do cliente em SHA-256. Ele ja estava gravado
// em cliente_telefone e nao era selecionado. A spec da CAPI atribui por `ph` sem
// precisar de fbc. Quando o fbc existe ele continua indo junto -- e o sinal mais
// forte, o `ph` e a rede.
//
// PRE-REQUISITO QUE JA ESTA NO AR: o guarda de datacenter em api/l.ts. Soltar
// este portao ANTES dele significaria mandar ao Meta conversas nascidas de
// clique de robo. A ordem importa e nao pode ser invertida.
//
// O telefone NUNCA sai daqui legivel: quem hasheia e montarEvento(), e o hash e
// de mao unica.
//
// Chamado por pg_cron (padrao da casa: net.http_post de dentro do banco).
// Protegido por segredo compartilhado -- este endpoint escreve na conta de
// anuncios, nao pode ficar aberto.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
// Extensao .js OBRIGATORIA (ESM em producao) -- ver comentario em api/l.ts.
import { enviarEventoCapi, capiConfigurada } from './_lib/meta-capi.js'
// Extensao .js OBRIGATORIA aqui tambem -- ESM em producao.
import { enviarEventoOpenAiAds, openAiAdsConfigurado } from './_lib/openai-ads.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Graus de certeza que podem virar conversao no Meta. Ver cabecalho.
 *
 *  'texto' saiu: a constraint link_rota_click_via_ck so aceita
 *  ('codigo','janela'), entao esse valor NUNCA pode aparecer numa linha. Ficar
 *  na lista dava a impressao de que havia um segundo caminho confiavel quando
 *  so existe um. */
const CONFIAVEIS = ['codigo']

/** Teto por rodada. Com ~7 conversas/semana isso nunca morde; existe pro caso
 *  de a varredura ficar dias parada e voltar com fila. */
const LOTE = 50

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  const segredo = process.env.CAPI_SWEEP_SECRET
  if (!segredo || req.headers['x-capi-secret'] !== segredo) {
    return res.status(401).json({ erro: 'nao autorizado' })
  }
  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ erro: 'sem banco' })
  // Os dois destinos sao independentes: se SO o Meta estiver sem env, o OpenAI
  // Ads ainda tem que rodar. Sair aqui deixaria o segundo bloco inalcancavel.
  if (!capiConfigurada() && !openAiAdsConfigurado()) {
    return res.status(200).json({ pulado: 'nenhum destino configurado (sem env)' })
  }

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })

  const { data: pendentes, error } = capiConfigurada() ? await db
    .from('link_rota_click')
    .select('id, codigo, fbc, fbp, ip, user_agent, cliente_telefone, matched_at, match_via, link_rota(nome, origem, slug, capi_evento_conversa)')
    .not('matched_at', 'is', null)
    .is('capi_enviado_at', null)
    // Precisa de PELO MENOS UM identificador de pessoa. Antes exigia fbc e
    // perdia 2 de cada 3 conversas reais; agora fbc, fbp OU telefone serve.
    .or('fbc.not.is.null,fbp.not.is.null,cliente_telefone.not.is.null')
    .in('match_via', CONFIAVEIS)
    .order('matched_at', { ascending: true })
    .limit(LOTE)
    : { data: [] as Array<Record<string, any>>, error: null }

  if (error) return res.status(500).json({ erro: error.message })

  let enviados = 0
  let falhas = 0

  // Sem `return` quando a lista vem vazia: o bloco do OpenAI Ads vem depois e
  // tem pendencias PROPRIAS. Sair aqui deixava ele inalcancavel na maioria das
  // rodadas -- que e justamente o caso comum (nada pendente pro Meta).
  for (const p of (pendentes || []) as Array<Record<string, any>>) {
    const link = Array.isArray(p.link_rota) ? p.link_rota[0] : p.link_rota
    const r = await enviarEventoCapi({
      // 'Lead' e o certo pro trafego que veio de anuncio do META -- e o evento
      // que as campanhas dele otimizam. Para link de OUTRO canal o nome vem do
      // proprio link (link_rota.capi_evento_conversa): o /l/branorte, do OpenAI
      // Ads, manda 'LeadChatGPT'.
      //
      // POR QUE ISSO IMPORTA: este evento leva `ph`, o telefone hasheado. O Meta
      // casa esse telefone com gente que viu anuncio DELE e credita a conversa a
      // campanha dele -- ou seja, o ChatGPT paga o lead e o Gerenciador do Meta
      // exibe como se fosse dele. Evento custom aparece no Gerenciador de
      // Eventos (da pra medir) e nao entra na otimizacao (nao contamina).
      nome: link?.capi_evento_conversa || 'Lead',
      // Sufixo -c: o evento do CLIQUE ja usou o codigo puro. Sem isso, um
      // reprocessamento poderia colidir com ele na deduplicacao do Meta.
      eventId: `${p.codigo}-c`,
      fbc: p.fbc,
      // O _fbp do instante do clique. O Gerenciador de Eventos reclamou
      // explicitamente da falta dele (07/08/2026, qualidade 5,0/10): ele existe
      // mesmo quando o clique nao trouxe fbclid, entao cobre justamente o caso
      // que o fbc nao cobre.
      fbp: p.fbp,
      // Entra legivel e sai como SHA-256 dentro de montarEvento().
      telefone: p.cliente_telefone,
      ip: p.ip,
      userAgent: p.user_agent,
      sourceUrl: link?.slug ? `https://branorte-crm.vercel.app/l/${link.slug}` : null,
      // O fato aconteceu quando a mensagem chegou, nao agora.
      quandoMs: p.matched_at ? new Date(p.matched_at).getTime() : null,
      custom: {
        content_name: link?.nome || 'link de roteamento',
        content_category: link?.origem || 'Link',
        // Aparece no Gerenciador e deixa auditar de que grau de certeza veio.
        match_via: p.match_via,
      },
    })

    if (r === 'ok') enviados++
    else falhas++

    // Marca SEMPRE, inclusive no erro: senao a proxima rodada reenvia o mesmo
    // evento e o Meta passa a contar duas vezes. Perder um evento e chato;
    // inflar conversao e o defeito que este endpoint inteiro existe pra evitar.
    // O resultado fica gravado pra dar pra achar e reprocessar na mao.
    await db
      .from('link_rota_click')
      .update({ capi_enviado_at: new Date().toISOString(), capi_resultado: r })
      .eq('id', p.id)
  }

  // --- Mesma conversa, agora pro OPENAI ADS ---------------------------------
  // Lista SEPARADA, e nao um segundo destino dentro do laco acima, por dois
  // motivos: as pendencias sao diferentes (o Meta manda tudo que tem fbc/fbp/
  // telefone; aqui so serve quem tem `oppref`) e um destino nao pode ficar
  // preso ao outro -- linha ja enviada ao Meta some daquele filtro e nunca mais
  // seria olhada por este.
  //
  // Nao existe rede de seguranca aqui: a Conversions API do OpenAI proibe
  // telefone, entao clique sem `oppref` nao tem como ser atribuido. Mandar
  // assim mesmo so inflaria a contagem de conversao da conta.
  let openaiEnviados = 0
  let openaiFalhas = 0
  if (openAiAdsConfigurado()) {
    const { data: pendentesOa } = await db
      .from('link_rota_click')
      .select('id, codigo, oppref, ip, user_agent, matched_at, link_rota(slug)')
      .not('matched_at', 'is', null)
      .not('oppref', 'is', null)
      .is('openai_enviado_at', null)
      .in('match_via', CONFIAVEIS)
      .order('matched_at', { ascending: true })
      .limit(LOTE)

    for (const p of (pendentesOa || []) as Array<Record<string, any>>) {
      const link = Array.isArray(p.link_rota) ? p.link_rota[0] : p.link_rota
      const r = await enviarEventoOpenAiAds({
        tipo: 'lead_created',
        // Sufixo -o: o mesmo codigo ja identifica o evento do clique e o do
        // Meta. Sem isso um reprocessamento colidiria na deduplicacao deles.
        eventId: `${p.codigo}-o`,
        oppref: p.oppref,
        ip: p.ip,
        userAgent: p.user_agent,
        sourceUrl: link?.slug ? `https://branorte-crm.vercel.app/l/${link.slug}` : null,
        // O fato aconteceu quando a mensagem chegou. A API recusa qualquer
        // coisa fora dos ultimos 7 dias.
        quandoMs: p.matched_at ? new Date(p.matched_at).getTime() : null,
      })

      if (r === 'ok') openaiEnviados++
      else openaiFalhas++

      // Marca SEMPRE, inclusive em erro -- mesma regra do Meta.
      await db
        .from('link_rota_click')
        .update({ openai_enviado_at: new Date().toISOString(), openai_resultado: r })
        .eq('id', p.id)
    }
  }

  return res.status(200).json({ enviados, falhas, openaiEnviados, openaiFalhas })
}
