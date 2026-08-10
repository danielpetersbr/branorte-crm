// GET /l/<slug>  (reescrito pro /api/l?s=<slug> no vercel.json)
//
// O link que o Daniel cola em site, formulario, bio, anuncio. No clique:
//   1. sorteia o proximo vendedor pela MESMA fila do quiz e das ALPs
//      (RPC public.funil_pick_vendedor) -- ligado no painel + nao bloqueado +
//      funil_ativa + fatia > 0 + cota de parados, com contador persistente;
//   2. registra o clique (origem, utm, referer) com um codigo de rastreio;
//   3. manda o cliente pro wa.me DO VENDEDOR com o texto ja escrito, carregando
//      o codigo invisivel que depois casa o clique com a conversa.
//
// O que este endpoint NAO faz, de proposito: nao cria atendimento e nao dispara
// mensagem nenhuma. No clique eu ainda nao sei o telefone do cliente -- quem
// inicia a conversa e ELE. O atendimento nasce quando a mensagem chega e a
// extensao registra, como em qualquer contato de entrada.
//
// Deploy: push na main (auto-deploy Vercel).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
// Extensao .js OBRIGATORIA: o package.json e "type": "module" e o Node de
// producao resolve ESM de verdade. Sem ela o import morre com
// ERR_MODULE_NOT_FOUND -- e nem o tsc (moduleResolution: bundler) nem o tsx
// reclamam, entao o erro so aparece na function ja publicada.
import { novoCodigoNum, codigoLegivel, selarInvisivel } from './_lib/link-invisivel.js'
import { enviarEventoCapi, montarFbc, lerFbp } from './_lib/meta-capi.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Ninguem elegivel no painel -> central da Branorte (Edilson Jr).
 *  Mesmo fallback do /api/leads/alp-dispatch. Lead parado e ruim; perdido e pior. */
const FALLBACK_TELEFONE = '554888314825'

/** Clique repetido do mesmo visitante (voltar/tocar duas vezes) NAO pode queimar
 *  outra posicao do rodizio nem gerar um segundo codigo orfao. */
const REUSO_MIN = 2

/** Robo de preview de link (WhatsApp, Facebook, Google...) buscando a URL nao e
 *  cliente clicando. Se deixar passar, o simples ato de COLAR o link no
 *  WhatsApp ja consome um vendedor do rodizio e suja o relatorio. */
const BOTS = /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|linkedin|preview|embed|curl|wget|python-requests|aiohttp|httpx|okhttp|go-http|node-fetch|axios|headless|lighthouse|gtmetrix|pingdom|monitor/i

/** Faixas de datacenter que chegam DISFARCADAS de clique humano.
 *
 *  Medido em 07/08/2026 nos 77 primeiros cliques do /l/: 26 vieram de
 *  datacenter e 22 desses das faixas da PROPRIA Meta (AS32934). Eles mandam
 *  User-Agent de navegador real -- Android Chrome, Windows Chrome e iPhone
 *  Safari, todos com o mesmo referer legado "http://m.facebook.com" -- entao o
 *  BOTS acima, que olha so o User-Agent, nao pega nenhum.
 *
 *  O estrago era triplo:
 *    1. giravam o rodizio (20 posicoes de vendedor queimadas num unico dia);
 *    2. viravam evento na Conversions API com client_ip_address do datacenter,
 *       ensinando o otimizador do Meta com trafego que nao existe;
 *    3. sobravam como clique orfao, e o casamento por janela adotava esse orfao
 *       quando um cliente de verdade escrevia -- 3 conversas reais foram
 *       creditadas a cliques-fantasma.
 *
 *  Prova de que nao e gente: em 77 cliques, ZERO clique de datacenter casou por
 *  selo invisivel. Robo nao manda mensagem no WhatsApp depois.
 *
 *  Lista deliberadamente CURTA: so faixas inequivocas da Meta mais as que
 *  aparecerem medidas. Prefixo largo demais joga cliente de verdade no
 *  fallback e quebra a fila -- o erro caro e o falso positivo, nao o falso
 *  negativo. */
const INFRA_ANUNCIO = [
  '173.252.', '69.63.', '31.13.', '157.240.', '66.220.', '129.134.', // Meta / Facebook Inc.
  '35.16', '54.2',                                                   // AWS (medidos)
  '47.25',                                                           // Alibaba (medido)
]

function ehInfraDeAnuncio(ip: string | null): boolean {
  if (!ip) return false
  return INFRA_ANUNCIO.some(faixa => ip.startsWith(faixa))
}

function primeiroNome(nome: string): string {
  const n = String(nome || '').trim().split(/\s+/)[0] || ''
  return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : n
}

/** Macro do Meta que NAO foi substituida chega literal: utm_content='{{ad.id}}'.
 *  Acontece quando o link e aberto fora da entrega real -- previa do anuncio no
 *  Gerenciador, ou o gestor conferindo o destino. Guardar isso faz o relatorio
 *  exibir '{{ad.id}}' como se fosse um anuncio de verdade, com cliques e tudo.
 *  Medido em 07/08/2026: 2 dos 40 cliques do dia. */
function utm(v: unknown): string | null {
  const t = txt(v)
  return t && t.includes('{{') ? null : t
}

function txt(v: unknown): string | null {
  if (Array.isArray(v)) v = v[0]
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t.slice(0, 300) : null
}

/** Pagina neutra pros robos de preview. Nao sorteia vendedor, nao grava clique.
 *
 *  NAO PODE ser cacheavel. A resposta desta rota varia por User-Agent, e a chave
 *  de cache do CDN e so a URL: um `public, max-age` aqui faz o primeiro robo que
 *  passar CONGELAR esta pagina na URL, e todo cliente humano depois dele recebe
 *  "Abrindo o WhatsApp..." em vez de ir pro WhatsApp. Aconteceu em producao
 *  (05/08/2026): X-Vercel-Cache=HIT, Age=90, zero clique gravado.
 *  Por isso aqui NAO se mexe no Cache-Control -- vale o no-store do handler.
 *
 *  ⚠️ E PRECISA TER CONTEUDO DE VERDADE. Ate 10/08/2026 ela devolvia 398 bytes
 *  escritos "Abrindo o WhatsApp..." mais um <meta robots=noindex>. O robo de
 *  revisao do OpenAI Ads (OAI-SearchBot / ChatGPT-User / GPTBot -- todos casam
 *  no /bot/i acima) recebia isso como landing page do anuncio e REPROVOU os dois
 *  criativos com `landing_page_crawl_issue`. Pagina de robo nao e pagina
 *  descartavel: pra quem revisa anuncio, ELA e a landing. Tambem e o que o
 *  WhatsApp e o Facebook mostram na previa quando o link e colado. */
function escaparHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function paginaPreview(res: VercelResponse, nome: string, telefone: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Interpolar o nome cru quebrava o atributo se ele tivesse aspas -- vem do
  // painel, entao e texto de usuario.
  const n = escaparHtml(nome)
  const wa = `https://wa.me/${String(telefone).replace(/\D/g, '')}`
  const titulo = 'Branorte — Fábrica de ração própria na sua fazenda'
  const desc =
    'Equipamentos Branorte para o produtor fabricar a própria ração: ' +
    'misturador, moinho de martelo, transportador helicoidal, ensacadeira e silo. ' +
    'Fale com um consultor pelo WhatsApp e peça um orçamento.'
  return res.status(200).send(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escaparHtml(titulo)}</title>` +
      `<meta name="description" content="${escaparHtml(desc)}">` +
      `<meta property="og:type" content="website">` +
      `<meta property="og:title" content="${escaparHtml(titulo)}">` +
      `<meta property="og:description" content="${escaparHtml(desc)}">` +
      // Sem <meta robots=noindex>: quem revisa anuncio precisa conseguir avaliar
      // esta pagina, e noindex e sinal de "nao me considere".
      `</head><body>` +
      `<h1>Fábrica de ração própria na sua fazenda</h1>` +
      `<p>${escaparHtml(desc)}</p>` +
      `<h2>O que a Branorte fabrica</h2>` +
      `<ul>` +
      `<li>Fábricas de ração compactas, para pequena e média escala</li>` +
      `<li>Misturadores horizontais e verticais</li>` +
      `<li>Moinhos de martelo e trituradores de milho</li>` +
      `<li>Transportadores helicoidais e elevadores</li>` +
      `<li>Ensacadeiras, silos e caçambas de pesagem</li>` +
      `</ul>` +
      `<p>Atendemos gado de corte e leite, suínos, aves, ovinos e caprinos, ` +
      `com ração farelada. Há financiamento FINAME/BNDES.</p>` +
      `<p><a href="${wa}">Falar com um consultor no WhatsApp</a></p>` +
      `<p>Ao abrir este link, você é encaminhado a um consultor da Branorte no WhatsApp.</p>` +
      `<p>Campanha: ${n}</p>` +
      `</body></html>`
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vale pra TODAS as saidas desta rota (302, 404 e a pagina de robo). A
  // resposta e por visitante: nunca pode ficar em cache de CDN, senao todo
  // mundo recebe a resposta do primeiro que passou -- seja o vendedor do
  // primeiro clique, seja a pagina estatica que so o robo deveria ver.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  // Redundante com o no-store, mas declara a intencao: quem um dia reintroduzir
  // cache aqui precisa saber que a resposta depende do User-Agent.
  res.setHeader('Vary', 'User-Agent')

  const slug = (txt(req.query.s) || '').toLowerCase()
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    return res.status(404).send('Link não encontrado.')
  }
  if (!SUPA_URL || !SVC_KEY) {
    // Sem banco eu ainda nao deixo o cliente na mao.
    return res.redirect(302, `https://wa.me/${FALLBACK_TELEFONE}`)
  }

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })

  const { data: link } = await db
    .from('link_rota')
    .select('id, slug, nome, mensagem, origem, ativo, fallback_telefone, capi_evento_clique')
    .eq('slug', slug)
    .maybeSingle()

  if (!link) return res.status(404).send('Link não encontrado.')

  // Calculado ANTES da pagina de robo: ela agora mostra um link de WhatsApp, e o
  // numero tem que ser o da central -- nunca um do rodizio, senao um robo de
  // preview passaria a "escolher" vendedor sem ninguem ter clicado.
  const fallback = String(link.fallback_telefone || FALLBACK_TELEFONE).replace(/\D/g, '')

  const ua = String(req.headers['user-agent'] || '')
  if (req.method === 'HEAD' || BOTS.test(ua)) return paginaPreview(res, link.nome, fallback)

  // Link desligado no painel: nao roteia nem registra, mas ainda entrega o
  // cliente na central em vez de dar erro na cara dele.
  if (!link.ativo) return res.redirect(302, `https://wa.me/${fallback}`)

  const ip =
    txt((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]) ||
    txt(req.headers['x-real-ip']) ||
    null

  // Varredura de datacenter: nao registra, nao gira o rodizio, nao vira evento.
  // O redirect CONTINUA de proposito: se a heuristica errar com um cliente de
  // verdade, ele perde o rastreio e cai no fallback -- nunca a conversa.
  if (ehInfraDeAnuncio(ip)) return res.redirect(302, `https://wa.me/${fallback}`)

  // --- Assinatura do clique do anuncio (Meta) -------------------------------
  // O Meta gruda ?fbclid=... em todo clique que sai de um anuncio. E o UNICO
  // elo entre este clique e a campanha que o pagou -- e ele so existe AGORA,
  // nesta requisicao. Por isso vai gravado no clique tambem: quando a conversa
  // acontecer de verdade (matched_at), da pra mandar ao Meta o evento que
  // interessa, e nao so "alguem clicou".
  const fbclid = txt(req.query.fbclid)
  const fbc = montarFbc(fbclid)

  // Mesma ideia, do lado do OpenAI Ads: `oppref` e o click id deles, chega na
  // query string da URL de destino e SO existe agora. Passa pelo mesmo filtro de
  // macro nao substituida -- link aberto fora da entrega chega com o
  // placeholder literal, e gravar isso inventa um anuncio no relatorio.
  const oppref = utm(req.query.oppref)
  const sourceUrl = req.headers.host
    ? `https://${req.headers.host}/l/${slug}`
    : null

  // --- Reuso: mesmo visitante, mesmo link, ultimos REUSO_MIN minutos ---------
  // Devolve o MESMO vendedor e o MESMO codigo. Nao gira o rodizio de novo.
  if (ip) {
    const desde = new Date(Date.now() - REUSO_MIN * 60_000).toISOString()
    const { data: repetido } = await db
      .from('link_rota_click')
      .select('codigo_num, vendedor_nome, vendedor_telefone')
      .eq('link_id', link.id)
      .eq('ip', ip)
      .eq('user_agent', ua)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (repetido?.vendedor_telefone) {
      return res.redirect(
        302,
        montarUrl(repetido.vendedor_telefone, link.mensagem, repetido.vendedor_nome, repetido.codigo_num)
      )
    }
  }

  // --- Sorteio do vendedor --------------------------------------------------
  // Mesma RPC do quiz e das ALPs: o clique entra NA MESMA fila, nao numa
  // paralela. Se ela nao devolver ninguem, vai pro fallback.
  let vendedorNome: string | null = null
  let vendedorTelefone: string | null = null
  try {
    const { data: pick } = await db.rpc('funil_pick_vendedor')
    const escolha = Array.isArray(pick) && pick.length ? (pick[0] as { vendedor: string; telefone: string }) : null
    if (escolha?.telefone) {
      vendedorNome = String(escolha.vendedor).toUpperCase().trim()
      vendedorTelefone = String(escolha.telefone).replace(/\D/g, '')
    }
  } catch {
    /* cai no fallback abaixo */
  }

  const usouFallback = !vendedorTelefone
  const telefoneDestino = vendedorTelefone || fallback

  // --- Registra o clique ----------------------------------------------------
  // O _fbp e lido UMA vez e usado em dois lugares: no evento do clique, agora, e
  // gravado pro evento de CONVERSA, que sai por varredura horas depois. Antes
  // ele era lido e descartado -- e a conversa saia sem ele.
  const fbp = lerFbp(req.headers.cookie)
  const codigoNum = novoCodigoNum()
  const { error: erroClique } = await db.from('link_rota_click').insert({
    link_id: link.id,
    codigo_num: codigoNum,
    codigo: codigoLegivel(codigoNum),
    vendedor_nome: vendedorNome,
    vendedor_telefone: telefoneDestino,
    fallback: usouFallback,
    ip,
    user_agent: ua.slice(0, 300) || null,
    referer: txt(req.headers.referer),
    utm_source: utm(req.query.utm_source),
    utm_medium: utm(req.query.utm_medium),
    utm_campaign: utm(req.query.utm_campaign),
    utm_content: utm(req.query.utm_content),
    utm_term: utm(req.query.utm_term),
    fbclid,
    fbc,
    fbp,
    oppref,
  })

  // --- Evento pro Meta (Conversions API) ------------------------------------
  // Server-side de proposito: esta rota e um 302, o cliente nunca recebe HTML
  // nosso e um pixel de navegador nao teria onde rodar. Nao lanca, tem timeout
  // proprio e vira no-op sem META_PIXEL_ID/META_CAPI_TOKEN -- o redirect abaixo
  // acontece de qualquer jeito.
  //
  // O evento do CLIQUE e 'ViewContent', nao 'Lead', de proposito. Clique nao e
  // lead: medido nos 3 primeiros dias, 75 cliques renderam 5 conversas reais.
  // Chamar clique de Lead faz a campanha perseguir quem TOCA no anuncio barato
  // -- foi exatamente assim que o criativo &79 virou o melhor do Gerenciador e
  // o pior do caixa. 'Lead' e reservado pro evento da CONVERSA, que sai por
  // /api/capi-conversa quando o casamento clique<->mensagem e confiavel.
  //
  // O NOME do evento vem do link quando ele nao e de trafego do Meta. Ver
  // link_rota.capi_evento_clique: pro /l/branorte (OpenAI Ads, 10/08/2026) sai
  // 'ViewContentChatGPT' em vez de 'ViewContent', pra que o clique pago no
  // ChatGPT nao engorde um evento padrao que as campanhas do Meta otimizam.
  await enviarEventoCapi({
    nome: link.capi_evento_clique || 'ViewContent',
    eventId: codigoLegivel(codigoNum),
    fbc,
    fbp,
    ip,
    userAgent: ua || null,
    sourceUrl,
    custom: { content_name: link.nome, content_category: link.origem || 'Link' },
  })

  // Falhou o registro? O cliente vai pro WhatsApp do mesmo jeito. Perder o
  // rastreio e chato; perder o lead e inaceitavel. Sem clique gravado o codigo
  // nao casa com nada, entao nem selo nele.
  if (erroClique) {
    console.error('[link] clique nao registrado:', erroClique.message)
    return res.redirect(302, montarUrl(telefoneDestino, link.mensagem, vendedorNome, null))
  }

  return res.redirect(302, montarUrl(telefoneDestino, link.mensagem, vendedorNome, codigoNum))
}

function montarUrl(telefone: string, modelo: string, vendedor: string | null, codigoNum: number | null): string {
  let texto = String(modelo || '').replace(/\{vendedor\}/gi, primeiroNome(vendedor || 'consultor'))
  // Espaco ANTES do selo, sempre. O parser de "&CODIGO" que existe hoje e
  // guloso -- ja gravou '&79oi', '&88cade', '&utm_source' -- entao ele pega o &
  // e tudo que vier colado. Sem esse espaco, um texto terminado em "&LP" viraria
  // '&LP' + 17 invisiveis: parece '&LP' na tela e nao e igual a '&LP' em lugar
  // nenhum. O espaco faz qualquer parser de \S+ parar no lugar certo.
  if (codigoNum !== null) texto += ' ' + selarInvisivel(codigoNum)
  return `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`
}
