/** O menu de Vendas não abre as rotas de Pedidos dos papéis restritos do App. */
export const podeNavegarPedidosVendas = (papel: string | null | undefined, podePedidos: boolean): boolean =>
  podePedidos && (papel === 'admin' || papel === 'financeiro' || papel === 'marketing' || papel === 'vendor')

export const linhasVisiveisVendas = <T,>(linhas: T[], contexto: string, expandido: string | null): T[] =>
  contexto && contexto === expandido ? linhas : linhas.slice(0, 50)
