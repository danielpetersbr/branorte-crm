// Conversions API do OpenAI Ads (evento server-side).
//
// POR QUE SERVER-SIDE, e nao o pixel de navegador deles: o /l/<slug> e um
// REDIRECT 302 -- o cliente nunca recebe HTML nosso, entao nao existe momento
// pro SDK rodar. Mesmo motivo do Meta, ver api/_lib/meta-capi.ts.
//
// E, principalmente: o lead da Branorte NAO nasce numa pagina. Ele nasce quando
// o produtor manda a primeira mensagem no WhatsApp. Nenhum pixel de navegador
// enxerga isso -- so o nosso servidor, que casa o clique com a conversa pelo
// selo invisivel.
//
// REGRA DESTE ARQUIVO (igual a do Meta): nada aqui pode derrubar o clique nem a
// varredura. Sem env configurada e no-op silencioso; erro de rede, HTTP 4xx/5xx
// e timeout viram console.error e nada mais.
//
// Configuracao (variaveis de ambiente na Vercel):
//   OPENAI_ADS_PIXEL_ID   id do pixel (Gerenciador de Anuncios > Conversoes)
//   OPENAI_ADS_API_KEY    chave da Conversions API (mesma tela)
//
// Contrato confirmado contra a API em 10/08/2026 com validate_only:
//   POST https://bzr.openai.com/v1/events?pid=<PIXEL_ID>
//   Authorization: Bearer <API_KEY>
//   { events: [ { id, type, timestamp_ms, action_source:'web', oppref,
//                 source_url, data:{type:'customer_action'}, user:{...} } ] }
// `data.type` so aceita 'contents' ou 'customer_action', e 'contents' e
// recusado para lead_created com event_type_data_mismatch.

const ENDPOINT = 'https://bzr.openai.com/v1/events';

/** A varredura nao pode ficar pendurada esperando o OpenAI. */
const TIMEOUT_MS = 2000;

export type EventoOpenAiAds = {
  /** Nome do evento. 'lead_created' e o que a conta tem configurado. */
  tipo: string;
  /** Chave de deduplicacao -- reusamos o codigo do clique. */
  eventId: string;
  /** Click id do OpenAI, capturado da URL no instante do clique.
   *
   *  Sem ele o evento chega ANONIMO: conta como conversao e nao credita anuncio
   *  nenhum. E aqui isso pesa mais que no Meta, porque a Conversions API do
   *  OpenAI PROIBE telefone -- nao existe o `ph` como rede de seguranca. */
  oppref: string | null;
  ip: string | null;
  userAgent: string | null;
  sourceUrl: string | null;
  /** Quando o fato ACONTECEU, em ms. A API recusa fora dos ultimos 7 dias. */
  quandoMs?: number | null;
};

export function openAiAdsConfigurado(): boolean {
  return Boolean(process.env.OPENAI_ADS_PIXEL_ID && process.env.OPENAI_ADS_API_KEY);
}

export async function enviarEventoOpenAiAds(ev: EventoOpenAiAds): Promise<'ok' | 'off' | 'erro'> {
  const pixel = process.env.OPENAI_ADS_PIXEL_ID;
  const chave = process.env.OPENAI_ADS_API_KEY;
  if (!pixel || !chave) return 'off';

  // Sem oppref o evento nao credita anuncio nenhum. Mandar assim so inflaria a
  // contagem de conversao da conta -- que e exatamente o defeito que o rastreio
  // inteiro existe pra evitar.
  if (!ev.oppref) return 'off';

  const evento: Record<string, unknown> = {
    id: ev.eventId,
    type: ev.tipo,
    timestamp_ms: Math.floor(ev.quandoMs || Date.now()),
    action_source: 'web',
    oppref: ev.oppref,
    data: { type: 'customer_action' },
  };
  if (ev.sourceUrl) evento.source_url = ev.sourceUrl;

  // PII: a doc e explicita -- "Don't send raw email addresses, raw external IDs,
  // phone numbers, or phone number hashes". O telefone do cliente NAO sai daqui
  // de forma nenhuma, nem hasheado. country fixo: a campanha e Brasil.
  const user: Record<string, unknown> = { country: 'BR' };
  if (ev.ip) user.ip_address = ev.ip;
  if (ev.userAgent) user.user_agent = ev.userAgent;
  evento.user = user;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(pixel)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ integration_source: 'branorte-crm', events: [evento] }),
      signal: abort.signal,
    });
    if (!r.ok) {
      // O corpo do erro lista campo a campo o que falhou. NUNCA logar a
      // requisicao: levaria a chave junto.
      const detalhe = await r.text().catch(() => '');
      console.error('[openai-ads] HTTP', r.status, detalhe.slice(0, 300));
      return 'erro';
    }
    return 'ok';
  } catch (e) {
    console.error('[openai-ads] falhou:', e instanceof Error ? e.message : String(e));
    return 'erro';
  } finally {
    clearTimeout(timer);
  }
}
