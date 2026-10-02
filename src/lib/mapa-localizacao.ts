export type LocalizacaoMapa =
  | { tipo: 'coordenadas'; lat: number; lng: number }
  | { tipo: 'linkCurtoGoogleMaps'; mensagem: string }
  | { tipo: 'endereco'; endereco: string }
  | { tipo: 'invalido'; mensagem: string }

const NUMERO = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i
const HOSTS_MAPS = new Set(['google.com', 'www.google.com', 'maps.google.com', 'google.com.br', 'www.google.com.br', 'maps.google.com.br'])
const invalidar = (): LocalizacaoMapa => ({
  tipo: 'invalido',
  mensagem: 'Informe um endereço ou coordenadas válidas: latitude de -90 a 90 e longitude de -180 a 180.',
})

function coordenadas(latitude: string, longitude: string): LocalizacaoMapa {
  const valores = [latitude.trim(), longitude.trim()]
  if (!valores.every(v => NUMERO.test(v))) return invalidar()
  const [lat, lng] = valores.map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return invalidar()
  return { tipo: 'coordenadas', lat, lng }
}

function parCoordenadas(texto: string): LocalizacaoMapa {
  let t = texto.replace(/^loc:\s*/i, '').trim()
  if (t.startsWith('(') || t.endsWith(')')) {
    if (!t.startsWith('(') || !t.endsWith(')')) return invalidar()
    t = t.slice(1, -1).trim()
  }
  const partes = t.includes(';') ? t.split(';').map(p => p.replace(',', '.')) : t.split(',')
  return partes.length === 2 ? coordenadas(partes[0], partes[1]) : invalidar()
}

function pareceCoordenada(texto: string): boolean {
  if (/^loc:/i.test(texto) || /^(?:[+-]?Infinity|NaN)\b/i.test(texto) || /^\(\s*[+\-\d.]/.test(texto)) return true
  // Uma rua com número continua sendo endereço; pares iniciados por números/sinais são coordenadas.
  return /^[+\-\d.]/.test(texto) && (
    /^[+\-]/.test(texto) && /[,;]/.test(texto)
    || /^[+\-\d.eE,;\s]+$/.test(texto) && /[,;\s]/.test(texto)
    || /[,;]\s*(?:[+\-\d.]|NaN\b|Infinity\b)/i.test(texto)
  )
}

function pareceUrl(texto: string): boolean {
  return /^(?:https?:|[a-z][a-z\d+.-]*:\/\/|javascript:|data:|file:|\/\/|www\.|maps\.|goo\.gl\b|google\.)/i.test(texto)
}

/** Interpretação local: nunca abre links nem entrega uma URL à busca de endereços. */
export function parseLocalizacaoMapa(texto: string): LocalizacaoMapa {
  const t = texto.trim()
  if (!t) return invalidar()
  if (!pareceUrl(t)) return pareceCoordenada(t) ? parCoordenadas(t) : { tipo: 'endereco', endereco: t }

  let url: URL
  let caminho: string
  try {
    if (!/^https?:\/\//i.test(t)) return invalidar()
    url = new URL(t)
    caminho = decodeURIComponent(url.pathname + url.search + url.hash)
  } catch {
    return invalidar()
  }
  if (url.username || url.password || url.port) return invalidar()
  const host = url.hostname.toLowerCase()
  if ((host === 'maps.app.goo.gl' && url.pathname.length > 1) || (host === 'goo.gl' && /^\/maps\/.+/.test(url.pathname))) {
    return {
      tipo: 'linkCurtoGoogleMaps',
      mensagem: 'Abra o link no Google Maps e copie o endereço completo ou as coordenadas.',
    }
  }
  if (!HOSTS_MAPS.has(host) || !(url.pathname === '/' && host.startsWith('maps.') || /^\/maps(?:\/|$)/.test(url.pathname))) return invalidar()

  // !3d/!4d identifica o lugar; @ pode ser apenas o centro da câmera.
  if (/!3d|!4d/.test(caminho)) {
    const ponto = caminho.match(/!3d([^!/?&#]*)!4d([^!/?&#]*)/)
    return ponto ? coordenadas(ponto[1], ponto[2]) : invalidar()
  }
  const consulta = (url.searchParams.get('q') ?? url.searchParams.get('query'))?.trim()
  if (consulta && pareceCoordenada(consulta)) return parCoordenadas(consulta)
  if (caminho.includes('@')) {
    const centro = caminho.match(/@([^,/?&#]*),([^,/?&#]*)/)
    return centro ? coordenadas(centro[1], centro[2]) : invalidar()
  }
  if (consulta && !pareceUrl(consulta)) return { tipo: 'endereco', endereco: consulta }
  return invalidar()
}
