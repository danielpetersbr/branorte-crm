// Origem do atendimento → rótulo e cor da barra ORIGENS (e das opções do filtro "Origem") em /atendimentos.
//
// (21/10/2026) O botão de WhatsApp do site passou a dizer de onde veio a visita (script no rodapé do
// mbranorte.com.br; o banco grava em auditoria.origem_lead_ana): Site, Google, Google Ads, YouTube, TikTok,
// LinkedIn, ChatGPT/IA, E-mail, Link no WhatsApp, Outros buscadores, Outros sites (Instagram, Facebook e
// Meta ADS já existiam). "Google Ads" e "Link no WhatsApp" tinham que vir ANTES das regras genéricas de
// "google"/"whatsapp": senão a barra somava o anúncio do Google em "Google" e o filtro "Google" (que busca o
// texto exato) não mostrava os leads que ele contava.

export function normalizeOrigem(raw: string | null | undefined): string {
  if (!raw) return 'Não identificado'
  const s = raw.toLowerCase().trim()
  if (s.includes('1144') || s.includes('8878')) return 'WhatsApp (48) 8878-1144'
  if (s.includes('4502') || s.includes('3658')) return 'WhatsApp (48) 3658-4502'
  // (28/09) lead que chegou direto no WhatsApp da ANA (IA), sem anúncio
  if (s.includes('whatsapp') && /\bana\b/.test(s)) return 'WhatsApp ANA'
  if (s === 'link no whatsapp') return 'Link no WhatsApp'
  if (s.includes('whatsapp')) return 'WhatsApp'
  if (s === 'meta ads' || s === 'meta') return 'Meta ADS'
  if (s.includes('instagram') && s.includes('formul')) return 'Instagram'
  if (s.includes('instagram')) return 'Instagram'
  if (s.includes('facebook') && s.includes('formul')) return 'Facebook Form'
  if (s === 'facebook') return 'Facebook'
  if (s === 'google ads') return 'Google Ads'
  if (s.includes('google')) return 'Google'
  if (s.includes('não identif') || s === 'nao identificou' || s === 'não identificou') return 'Não identificado'
  return raw
}

export const ORIGEM_COLORS: Record<string, string> = {
  'WhatsApp (48) 8878-1144': '#25D366',
  'WhatsApp (48) 3658-4502': '#128C7E',
  'WhatsApp ANA': '#0F9D58',
  'WhatsApp': '#25D366',
  'Meta ADS': '#1877F2',
  'Facebook': '#1877F2',
  'Facebook Form': '#4267B2',
  'Instagram': '#E1306C',
  'Google': '#4285F4',
  'Não identificado': '#6B7280',
  // origens do site (21/10/2026)
  'Site': '#0EA5E9',
  'Google Ads': '#F9AB00',
  'YouTube': '#FF0000',
  'TikTok': '#00C2BA',
  'LinkedIn': '#0A66C2',
  'ChatGPT/IA': '#10A37F',
  'E-mail': '#EA4335',
  'Link no WhatsApp': '#34B7F1',
  'Outros buscadores': '#8B5CF6',
  'Outros sites': '#A16207',
}

export function corOrigem(label: string): string {
  return ORIGEM_COLORS[label] ?? '#6B7280'
}
