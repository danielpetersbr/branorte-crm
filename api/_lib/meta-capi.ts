// Conversions API do Meta (evento server-side).
//
// POR QUE SERVER-SIDE, e nao o pixel de navegador: /l/<slug> e um REDIRECT 302.
// O cliente nunca recebe HTML nosso, entao nao existe momento nenhum pro fbq()
// rodar. Transformar o redirect numa pagina-ponte pra hospedar o pixel ja
// custou producao uma vez (05/08/2026: o CDN congelou a pagina de robo e todo
// cliente humano ficou parado nela). A CAPI entrega o evento sem pagina, sem
// JS no cliente e sem bloqueador de anuncio no meio.
//
// REGRA DESTE ARQUIVO: nada aqui pode derrubar o clique. Sem env configurada e
// no-op silencioso; erro de rede, HTTP 4xx/5xx e timeout viram console.error e
// nada mais. Perder o evento e chato; perder o lead e inaceitavel.
//
// Configuracao (variaveis de ambiente na Vercel):
//   META_PIXEL_ID          id do dataset/pixel no Gerenciador de Eventos
//   META_CAPI_TOKEN        token da Conversions API (Eventos > Configuracoes)
//   META_TEST_EVENT_CODE   opcional: so enquanto testa na aba "Testar eventos"
//
// A API versionada fica congelada de proposito: subir de versao sozinho e como
// o Meta muda contrato sem avisar.

import { createHash } from 'node:crypto';

const GRAPH_VERSION = 'v21.0';

/** O clique nao pode esperar o Meta. Se em TIMEOUT_MS ele nao respondeu, o
 *  evento morre e o cliente segue pro WhatsApp. */
const TIMEOUT_MS = 1200;

export type EventoCapi = {
  /** Nome do evento padrao do Meta ('Lead', 'Contact', ...). */
  nome: string;
  /** Chave de deduplicacao. Usamos o codigo do clique: unico por clique, e o
   *  mesmo identificador que o dia em que existir um pixel de navegador aqui
   *  (ou o evento de "a conversa aconteceu de verdade") vai reusar. */
  eventId: string;
  /** fb.1.<ms>.<fbclid> — ver montarFbc(). */
  fbc: string | null;
  /** Cookie _fbp, quando existir. Num redirect quase nunca existe. */
  fbp?: string | null;
  /** Telefone do cliente EM CLARO. Esta funcao hasheia antes de mandar; o numero
   *  NUNCA sai daqui legivel. So existe no evento de CONVERSA -- no clique ainda
   *  nao se sabe quem e o cliente. Ver hashTelefone(). */
  telefone?: string | null;
  ip: string | null;
  userAgent: string | null;
  /** URL que o cliente abriu (o proprio /l/<slug>). */
  sourceUrl: string | null;
  /** Quando o evento ACONTECEU, em ms. Omitido = agora.
   *
   *  Existe por causa do evento de conversa, que e enviado por varredura e nao
   *  no instante do fato: mandar "agora" faria o Meta atribuir a conversa ao
   *  minuto da varredura em vez do minuto da mensagem. O Meta recusa qualquer
   *  coisa fora da janela de 7 dias (error_subcode 2804004). */
  quandoMs?: number | null;
  /** Aparece no Gerenciador de Eventos — serve pra separar link de link. */
  custom?: Record<string, string | number>;
};

/** fbc = a assinatura do clique no anuncio, no formato exigido pelo Meta:
 *  fb.<subdominio>.<timestamp_ms>.<fbclid>. O "1" do meio e fixo pra dominio
 *  sem subdominio contado.
 *
 *  Sem fbc o evento chega ANONIMO: conta como conversao, mas nao casa com
 *  anuncio nenhum e nao ensina nada ao algoritmo. E o unico campo aqui que
 *  vale de verdade pra atribuicao, entao ele e validado com rigor: fbclid vem
 *  da URL, ou seja, de qualquer um. */
export function montarFbc(fbclid: unknown, agoraMs: number = Date.now()): string | null {
  if (typeof fbclid !== 'string') return null;
  const limpo = fbclid.trim();
  // O fbclid real e base64url curto. Qualquer coisa fora disso e lixo ou
  // tentativa de injetar no payload.
  if (!limpo || limpo.length > 255 || !/^[A-Za-z0-9._-]+$/.test(limpo)) return null;
  return `fb.1.${Math.floor(agoraMs)}.${limpo}`;
}

/** ph = telefone do cliente, SHA-256 em hex minusculo, como o Meta exige.
 *
 *  POR QUE ELE EXISTE: sem fbc o evento chegava anonimo e nao creditava criativo
 *  nenhum. Medido em 07/08/2026: so 4 dos 77 cliques trouxeram fbclid -- os de
 *  placement Instagram. Os de Facebook Right Column vinham sem. Resultado: das 3
 *  conversas provadas por selo, 2 nunca chegaram ao Meta. O telefone ja estava
 *  gravado na linha e era o parametro de match que resolvia -- a spec da CAPI
 *  atribui por `ph` sem precisar de fbc.
 *
 *  NORMALIZACAO EXIGIDA PELO META: so digitos, com codigo do pais, sem '+',
 *  sem espaco, sem pontuacao. Hash de numero mal normalizado nao casa com nada e
 *  falha em SILENCIO -- o Meta responde 200 e simplesmente nao atribui.
 *
 *  O 9o digito: o Brasil tem numero movel com e sem ele circulando. NAO se
 *  inventa nem se remove digito aqui -- manda-se o numero como o cliente
 *  escreveu no WhatsApp, que e o mesmo que o Meta tem do cadastro dele.
 *
 *  Devolve null quando o numero nao e plausivel, em vez de mandar hash de lixo. */
export function hashTelefone(telefone: unknown): string | null {
  if (typeof telefone !== 'string') return null;
  let d = telefone.replace(/\D/g, '');
  if (!d) return null;
  // Numero brasileiro sem DDI (10 ou 11 digitos: DDD + 8 ou 9) ganha o 55.
  if (d.length === 10 || d.length === 11) d = '55' + d;
  // Fora de 11..15 digitos nao e telefone com DDI: 5511999999999 tem 13,
  // o menor com DDI plausivel tem 11. Acima de 15 viola o E.164.
  if (d.length < 11 || d.length > 15) return null;
  return createHash('sha256').update(d).digest('hex');
}

/** Le o cookie _fbp do header Cookie cru. */
export function lerFbp(cookieHeader: unknown): string | null {
  if (typeof cookieHeader !== 'string') return null;
  const m = cookieHeader.match(/(?:^|;\s*)_fbp=([^;]+)/);
  if (!m) return null;
  const v = decodeURIComponent(m[1]).trim();
  return /^fb\.\d+\.\d+\.\d+$/.test(v) ? v : null;
}

/** true quando ha pixel e token configurados. Fora isso tudo aqui e no-op. */
export function capiConfigurada(): boolean {
  return Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);
}

/** Monta o evento no formato do Meta. Exportado por causa do TESTE: e aqui que
 *  mora a falha silenciosa da CAPI — payload torto o Meta ACEITA com HTTP 200 e
 *  `events_received: 1`, e simplesmente nao atribui a anuncio nenhum. Erro que
 *  so aparece semanas depois como "a campanha nao otimiza".
 *
 *  Devolve null quando nao ha identificador nenhum: evento sem user_data o Meta
 *  recusa, e mandar assim so gasta chamada. */
export function montarEvento(ev: EventoCapi): Record<string, unknown> | null {
  // fbc, fbp, IP e user-agent o Meta recebe EM CLARO por especificacao -- nao
  // sao PII de cliente. O telefone e, e por isso passa por SHA-256 aqui dentro:
  // quem chama entrega o numero legivel e ele nunca sai deste escopo.
  const userData: Record<string, string> = {};
  if (ev.fbc) userData.fbc = ev.fbc;
  if (ev.fbp) userData.fbp = ev.fbp;
  const ph = hashTelefone(ev.telefone);
  if (ph) userData.ph = ph;
  if (ev.ip) userData.client_ip_address = ev.ip;
  if (ev.userAgent) userData.client_user_agent = ev.userAgent;
  // Mantido permissivo DE PROPOSITO. IP + user-agent sozinhos nao atribuem a
  // anuncio nenhum (o Meta responde 200 e nao credita nada), mas endurecer aqui
  // mataria o ViewContent de TODO clique sem fbclid -- e so 4 dos 77 cliques de
  // 07/08 trouxeram um. Quem precisa de identificador de pessoa e o evento de
  // CONVERSA, e la a exigencia esta no proprio filtro da varredura.
  if (Object.keys(userData).length === 0) return null;

  return {
    event_name: ev.nome,
    event_time: Math.floor((ev.quandoMs ?? Date.now()) / 1000),
    event_id: ev.eventId,
    action_source: 'website',
    ...(ev.sourceUrl ? { event_source_url: ev.sourceUrl } : {}),
    user_data: userData,
    ...(ev.custom ? { custom_data: ev.custom } : {}),
  };
}

/** Dispara o evento. NUNCA lanca — o retorno so serve pra log e teste. */
export async function enviarEventoCapi(ev: EventoCapi): Promise<'ok' | 'off' | 'erro'> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return 'off';

  const evento = montarEvento(ev);
  if (!evento) return 'off';

  const corpo: Record<string, unknown> = { data: [evento], access_token: token };
  // Enquanto existir, os eventos aparecem SO na aba de teste e nao entram na
  // otimizacao. Tirar a env quando terminar de conferir.
  if (process.env.META_TEST_EVENT_CODE) corpo.test_event_code = process.env.META_TEST_EVENT_CODE;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: abort.signal,
    });
    if (!r.ok) {
      // O corpo do erro do Meta e curto e diz exatamente o que falta.
      // NUNCA logar o corpo da requisicao: leva o access_token junto.
      const detalhe = await r.text().catch(() => '');
      console.error('[capi] HTTP', r.status, detalhe.slice(0, 300));
      return 'erro';
    }
    return 'ok';
  } catch (e) {
    console.error('[capi] falhou:', e instanceof Error ? e.message : String(e));
    return 'erro';
  } finally {
    clearTimeout(timer);
  }
}
