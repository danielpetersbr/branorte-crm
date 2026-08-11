// GET /l/<slug>  (reescrito pro /api/l?s=<slug> no vercel.json)
//
// O link que o Daniel cola em site, formulario, bio, anuncio. No clique:
//   1. sorteia o proximo vendedor pela fila de ENTRADA
//      (RPC public.funil_pick_vendedor_inbound) -- ligado no painel OU em modo
//      "so recebe", nao bloqueado, funil_ativa e dentro da cota de parados,
//      com contador persistente;
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
// enviarEventoCapi saiu daqui em 11/08/2026: o evento do clique agora e
// responsabilidade da varredura (api/capi-conversa.ts). Esta rota volta a ter
// UM unico destino de rede fora do banco -- nenhum.
import { montarFbc, lerFbp } from './_lib/meta-capi.js'

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

/** Navegador EMBUTIDO da Meta (Facebook, Messenger, Instagram). O proprio
 *  User-Agent carimba: o clique 559, de 11/08/2026, chegou como
 *  "...Mobile/23G71 Safari/604.1 [FBAN/FBIOS;FBAV/573.0.0.47.73;...;IABMV/1]".
 *
 *  POR QUE IMPORTA: dentro desse webview o 302 pro wa.me NAO abre o WhatsApp. O
 *  wa.me resolve pra api.whatsapp.com, essa pagina tenta o esquema whatsapp:// e
 *  o webview recusa navegacao automatica pra esquema de app sem gesto do
 *  usuario. Sobra a tela "Abrir app / Baixar agora" da WhatsApp Inc, com DOIS
 *  botoes de download disputando o toque. Reproduzido pelo Daniel em 11/08/2026
 *  clicando no botao do Messenger.
 *
 *  NAO E MURO, e atrito: medido em 7 dias, esse publico converte 13,8% (290
 *  cliques -> 40 conversas), o MELHOR contexto do sistema (navegador normal:
 *  3,0%). A pessoa toca em "Abrir app" e segue. Entao a mudanca aqui vale por
 *  tirar um toque de um caminho que ja funciona -- nao e conserto de emergencia,
 *  e o risco de piorar precisa ficar em zero. Dai o fallback explicito abaixo.
 *
 *  Instagram entra na mesma lista: mesmo webview, mesma regra de esquema. */
const APP_META = /FBAN|FBAV|FB_IAB|FBIOS|IABMV|Instagram/i

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
    .select('id, slug, nome, mensagem, origem, ativo, fallback_telefone, capi_evento_clique, pixel_id')
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
  // O `sourceUrl` do evento saia daqui, montado com o req.headers.host. Agora
  // quem monta e a varredura, a partir do slug -- mesma coisa que ela ja faz
  // pro evento de conversa. Um campo a menos pra gravar no caminho do clique.

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
      return entregarWhatsapp(
        res, ua, repetido.vendedor_telefone, link.mensagem, repetido.vendedor_nome, repetido.codigo_num
      )
    }
  }

  // --- Sorteio do vendedor --------------------------------------------------
  // Fila de ENTRADA (`_inbound`), a mesma do botao FALAR COM CONSULTOR do quiz.
  // NAO e a `funil_pick_vendedor` crua: aquela serve tambem o quiz/handoff e o
  // leads/alp-dispatch, que enfileiram em outbound_dispatch e portanto fazem o
  // WhatsApp DO VENDEDOR abrir a conversa. Aqui quem abre e o cliente, entao a
  // fila pode incluir quem esta em modo "so recebe" -- vendedor restringido
  // pelo WhatsApp, que nao pode chamar numero novo mas atende normalmente quem
  // chama ele. Se ela nao devolver ninguem, vai pro fallback.
  let vendedorNome: string | null = null
  let vendedorTelefone: string | null = null
  try {
    const { data: pick } = await db.rpc('funil_pick_vendedor_inbound')
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

  // --- O evento pro Meta NAO sai daqui (mudou em 11/08/2026) ----------------
  // Ate hoje esta funcao dava `await enviarEventoCapi(...)` exatamente aqui,
  // antes do 302. O cliente ficava parado esperando o graph.facebook.com --
  // TIMEOUT_MS = 1200 em api/_lib/meta-capi.ts. Ate 1,2 segundo de espera pra
  // entregar uma ESTATISTICA. Quem clicou nao ganha nada com isso; quem clicou
  // quer o WhatsApp abrir.
  //
  // A doutrina da casa ja era essa e o /l/ e que estava fora dela. Do cabecalho
  // do api/capi-conversa.ts, sobre o evento de CONVERSA: "pendurar chamada HTTP
  // la dentro significa que uma indisponibilidade do Meta vira latencia (ou erro
  // engolido) no caminho de TODA mensagem de cliente. A varredura desacopla: se
  // o Meta cair, as linhas ficam pendentes e saem no minuto seguinte." Vale
  // igual aqui -- com o agravante de que la o prejudicado era um processo de
  // fundo, e aqui e o cliente olhando pra tela.
  //
  // O evento agora sai pela mesma varredura (cron 36, de 5 em 5 min), no bloco
  // "EVENTO DO CLIQUE" de api/capi-conversa.ts. Tudo que ele precisa ja esta
  // gravado na linha acima: fbc, fbp, ip, user_agent, codigo e, pelo link,
  // pixel_id e capi_evento_clique.
  //
  // NAO PERDE PRECISAO: la o evento vai com `quandoMs = created_at`, ou seja,
  // carimbado com a hora do CLIQUE e nao com a da varredura. O Meta aceita
  // evento de ate 7 dias; 5 min e ruido.
  //
  // O QUE NAO MUDOU, e nao pode mudar: o evento do clique continua sendo
  // 'ViewContent', nunca 'Lead'. Clique nao e lead -- medido nos 3 primeiros
  // dias, 75 cliques renderam 5 conversas reais. Chamar clique de Lead faz a
  // campanha perseguir quem TOCA no anuncio barato; foi assim que o criativo
  // &79 virou o melhor do Gerenciador e o pior do caixa. E o nome sai do link
  // (capi_evento_clique) quando o trafego nao e do Meta: o /l/branorte, do
  // OpenAI Ads, manda 'ViewContentChatGPT' pra nao engordar um evento padrao
  // que as campanhas do Meta otimizam.

  // Falhou o registro? O cliente vai pro WhatsApp do mesmo jeito. Perder o
  // rastreio e chato; perder o lead e inaceitavel. Sem clique gravado o codigo
  // nao casa com nada, entao nem selo nele.
  if (erroClique) {
    console.error('[link] clique nao registrado:', erroClique.message)
    return entregarWhatsapp(res, ua, telefoneDestino, link.mensagem, vendedorNome, null)
  }

  return entregarWhatsapp(res, ua, telefoneDestino, link.mensagem, vendedorNome, codigoNum)
}

function montarTexto(modelo: string, vendedor: string | null, codigoNum: number | null): string {
  let texto = String(modelo || '').replace(/\{vendedor\}/gi, primeiroNome(vendedor || 'consultor'))
  // Espaco ANTES do selo, sempre. O parser de "&CODIGO" que existe hoje e
  // guloso -- ja gravou '&79oi', '&88cade', '&utm_source' -- entao ele pega o &
  // e tudo que vier colado. Sem esse espaco, um texto terminado em "&LP" viraria
  // '&LP' + 17 invisiveis: parece '&LP' na tela e nao e igual a '&LP' em lugar
  // nenhum. O espaco faz qualquer parser de \S+ parar no lugar certo.
  if (codigoNum !== null) texto += ' ' + selarInvisivel(codigoNum)
  return texto
}

function montarUrl(telefone: string, modelo: string, vendedor: string | null, codigoNum: number | null): string {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(montarTexto(modelo, vendedor, codigoNum))}`
}

/** Esquema do APP. E o que o botao "Abrir app" da propria WhatsApp Inc dispara
 *  -- ou seja, ja esta provado que funciona dentro do webview da Meta quando o
 *  toque parte do usuario. O texto (com o selo invisivel) viaja igual. */
function montarUrlApp(telefone: string, modelo: string, vendedor: string | null, codigoNum: number | null): string {
  return `whatsapp://send?phone=${telefone}&text=${encodeURIComponent(montarTexto(modelo, vendedor, codigoNum))}`
}

/** UNICA saida do handler pro WhatsApp. Os tres caminhos (reuso, clique nao
 *  gravado e fluxo normal) passam por aqui pra nao divergirem com o tempo.
 *
 *  Navegador normal -> 302 pro wa.me, exatamente como sempre foi. Fora do
 *  webview da Meta o 302 abre o app e nao ha nada pra consertar; mexer ali seria
 *  risco puro em 233 cliques/semana.
 *
 *  Webview da Meta -> pagina de ~1KB que TENTA o esquema no carregamento. Se o
 *  webview deixar, o WhatsApp abre por cima e o cliente nao chega a ver pagina
 *  nenhuma -- que e o comportamento que o Daniel pediu. Se bloquear, sobra UM
 *  botao nosso apontando pro MESMO esquema, e o toque nele e justamente o gesto
 *  de usuario que faltava.
 *
 *  Tres decisoes de seguranca nessa pagina:
 *    1. o botao e <a href>, nao onclick -- JS bloqueado nao quebra a pagina;
 *    2. tem um link pequeno pro wa.me embaixo, que reproduz exatamente o
 *       comportamento de hoje. PIOR CASO desta mudanca = um toque, o mesmo que
 *       o cliente ja da hoje no "Abrir app" deles;
 *    3. nada de recurso externo (CSS, fonte, imagem): rede ruim de fazenda nao
 *       pode atrasar o unico botao que importa.
 *
 *  Cache-Control: vale o no-store setado no topo do handler, e agora o
 *  Vary: User-Agent que ja estava la deixou de ser decorativo -- esta resposta
 *  DE FATO varia por User-Agent. Um cache aqui entregaria o telefone de um
 *  vendedor pra todo mundo. */
function entregarWhatsapp(
  res: VercelResponse,
  ua: string,
  telefone: string,
  modelo: string,
  vendedor: string | null,
  codigoNum: number | null,
) {
  const web = montarUrl(telefone, modelo, vendedor, codigoNum)
  if (!APP_META.test(ua)) return res.redirect(302, web)

  const app = montarUrlApp(telefone, modelo, vendedor, codigoNum)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Abrindo o WhatsApp…</title>` +
      `<style>` +
      `*{box-sizing:border-box}` +
      `body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;` +
      `justify-content:center;gap:18px;padding:24px;text-align:center;background:#0b141a;color:#e9edef;` +
      `font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}` +
      `p{margin:0;font-size:16px;line-height:1.4;color:#8696a0}` +
      `.b{display:block;width:100%;max-width:340px;padding:17px 24px;border-radius:999px;` +
      `background:#25d366;color:#0b141a;font-size:18px;font-weight:600;text-decoration:none}` +
      `.s{font-size:14px;color:#8696a0;text-decoration:underline}` +
      `</style></head><body>` +
      `<p>Abrindo o WhatsApp…</p>` +
      `<a class="b" href="${escaparHtml(app)}">Abrir o WhatsApp</a>` +
      `<a class="s" href="${escaparHtml(web)}">Não abriu? Toque aqui</a>` +
      `<script>` +
      // location.replace, nao href: nao deixa esta pagina no historico, senao o
      // "voltar" do cliente cai nela de novo em vez de voltar pro anuncio.
      `try{location.replace(${JSON.stringify(app)})}catch(e){}` +
      `</script>` +
      `</body></html>`
  )
}
