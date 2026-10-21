/**
 * Papel MARKETING (21/10/2026, pedido do Daniel): o acesso é SÓ o bloco "Marketing"
 * do menu — Visão geral, Atendimento, Vendas e pedidos, Análise Meta e Google,
 * Análise de campanhas, Catálogo e guias e Mapa.
 *
 * Esta lista é o guard de URL (App.tsx): quem é marketing e abre qualquer outra
 * rota por link volta pro Dashboard. ⚠️ Casar com MARKETING_GROUPS no Layout.tsx —
 * item lá sem rota aqui = clique que devolve pro início (o teste
 * marketing-acesso.test.ts trava isso).
 *
 * O menu e este guard só escolhem a TELA. O recorte do dado continua na RLS e nas
 * APIs, como para os outros papéis.
 */

// Rota exata (sem filhos): /controle não pode liberar /controle/financeiro,
// /controle/novo-pedido etc.; /funil não libera /funil/manual e /funil/relatorio.
const EXATAS = new Set([
  '/', '/dashboard', '/funil', '/controle', '/controle/rastreio', '/controle/vendas',
  '/controle/pedidos', '/vendidos', '/anuncios', '/campanhas', '/mapa-visual', '/perfil',
])

// Rota com filhos: o detalhe de um atendimento, as páginas de cada guia e o
// mapa por estado abrem dentro da mesma tela.
const COM_FILHOS = ['/atendimentos', '/mapa-visitas', '/guia']

// Detalhe de pedido (só leitura). A edição (/controle/pedidos/editar/:id) fica fora.
const DETALHE_PEDIDO = /^\/controle\/pedidos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function rotaMarketingPermitida(path: string): boolean {
  const rota = path.length > 1 ? path.replace(/\/+$/, '') : path
  if (rota === '/guia/admin' || rota.startsWith('/guia/admin/')) return false   // revisão do guia é de quem edita
  if (EXATAS.has(rota)) return true
  if (COM_FILHOS.some(pre => rota === pre || rota.startsWith(pre + '/'))) return true
  return DETALHE_PEDIDO.test(rota)
}
