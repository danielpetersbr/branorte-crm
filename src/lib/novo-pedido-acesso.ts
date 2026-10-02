export const CHAVE_NOVO_PEDIDO = 'menu.novo_pedido'

export function permissaoNovoPedido(permissoes: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(permissoes, CHAVE_NOVO_PEDIDO)) return permissoes[CHAVE_NOVO_PEDIDO] === true
  return permissoes['menu.controle'] === true
}

export function rotaPedidosVendedorPermitida(path: string, permitido: boolean): boolean {
  if (!permitido) return false
  const rota = path.replace(/\/+$/, '')
  return ['/controle/novo-pedido', '/controle/pedido-simples', '/controle/pedido-garantia', '/controle/pedidos'].includes(rota)
    || /^\/controle\/pedidos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rota)
}
