// Escape de texto que entra em HTML montado na mão (popup do Leaflet, divIcon…).
//
// Por que existe (29/09/2026): MapaVisitas, MapaDaViagem e FreteMapa tinham, cada um,
// uma cópia de `esc` que só trocava < > &. Só que o nome do cliente vai DENTRO de
// atributo — title="${esc(c.cliente)}" — e o Leaflet põe o popup por innerHTML.
// Um orçamento com cliente `Joao" onmouseover="…` fechava o atributo e rodava JS
// com a sessão de quem abriu o mapa (admin incluso). Aspas precisam sair também.
// Um helper só, testado, pra ninguém mais copiar a versão capenga.

const ENTIDADE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Deixa o texto seguro pra ir tanto no corpo quanto dentro de atributo (aspas
 * simples ou duplas). null/undefined viram '' — os chamadores usam
 * `esc(x) || '—'` pra mostrar o traço quando não tem valor.
 */
export function escHtml(s: string | number | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, c => ENTIDADE[c])
}
