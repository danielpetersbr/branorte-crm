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
  ip: string | null;
  userAgent: string | null;
  /** URL que o cliente abriu (o proprio /l/<slug>). */
  sourceUrl: string | null;
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

/** Dispara o evento. NUNCA lanca — o retorno so serve pra log e teste. */
export async function enviarEventoCapi(ev: EventoCapi): Promise<'ok' | 'off' | 'erro'> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return 'off';

  // user_data precisa de pelo menos um identificador. Aqui nao ha PII nenhuma
  // (no clique eu ainda nao sei quem e o cliente), entao nada disto e hasheado:
  // fbc, fbp, IP e user-agent o Meta recebe em claro por especificacao.
  const userData: Record<string, string> = {};
  if (ev.fbc) userData.fbc = ev.fbc;
  if (ev.fbp) userData.fbp = ev.fbp;
  if (ev.ip) userData.client_ip_address = ev.ip;
  if (ev.userAgent) userData.client_user_agent = ev.userAgent;
  if (Object.keys(userData).length === 0) return 'off';

  const corpo: Record<string, unknown> = {
    data: [
      {
        event_name: ev.nome,
        event_time: Math.floor(Date.now() / 1000),
        event_id: ev.eventId,
        action_source: 'website',
        ...(ev.sourceUrl ? { event_source_url: ev.sourceUrl } : {}),
        user_data: userData,
        ...(ev.custom ? { custom_data: ev.custom } : {}),
      },
    ],
    access_token: token,
  };
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
