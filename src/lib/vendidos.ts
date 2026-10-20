export type SituacaoVendido = 'na_empresa' | 'embarcado' | 'entregue' | 'sem_info' | 'cancelado'
export type PedidoVendido = {
  id: string; clienteId: string; numero: string; orcamento: string; cliente: string
  vendedor: string; vendedor2: string | null; dataVenda: string | null
  telefone: string; cidade: string; estado: string; produto: string
  etapas: string[]; situacao: SituacaoVendido; entregaEm: string | null
}
export type DadosVendidos = {
  pedidos: PedidoVendido[]; vendedores: string[] | null; consultadoEm: string
  producaoDisponivel: boolean; entregasDisponiveis: boolean
}
export const SITUACOES_VENDIDOS: Record<SituacaoVendido, string> = {
  na_empresa: 'Na empresa', embarcado: 'Embarcado', entregue: 'Entregue ao cliente',
  sem_info: 'Sem informação de produção', cancelado: 'Produção cancelada',
}
export const ETAPAS_VENDIDOS: Record<string,string> = {
  PPCP:'PPCP', ORDEM_PRODUCAO:'Ordem de produção', PROJETOS_PADROES:'Projetos padrões', EM_PROJETO:'Em projeto',
  PROJETO_CONCLUIDO:'Projeto concluído', SOLDA:'Solda', MONTAGEM:'Montagem', EXPEDICAO:'Expedição',
  ORGANIZANDO_TRANSPORTE:'Organizando transporte', ENTREGUE:'Embarcado', CANCELADO:'Cancelado',
}
const ETAPAS_INTERNAS = new Set(Object.keys(ETAPAS_VENDIDOS).filter(e=>!['ENTREGUE','CANCELADO'].includes(e)))
export function situacaoVendido(etapas: string[], entregaEm: string | null): SituacaoVendido {
  if (entregaEm) return 'entregue'
  const ativas = etapas.filter(e=>e!=='CANCELADO')
  if (ativas.some(e=>ETAPAS_INTERNAS.has(e))) return 'na_empresa'
  if (ativas.length && ativas.every(e=>e==='ENTREGUE')) return 'embarcado'
  if (etapas.length && !ativas.length) return 'cancelado'
  return 'sem_info'
}
export type FiltrosVendidos = { mes: string; vendedor: string; situacao: string; busca: string }
export function filtrarPedidosVendidos(pedidos: PedidoVendido[], filtros: FiltrosVendidos, incluirSituacao = true) {
  const busca=filtros.busca.trim().toLocaleLowerCase('pt-BR')
  return pedidos.filter(p=>(!filtros.mes||p.dataVenda?.slice(0,7)===filtros.mes)
    &&(!filtros.vendedor||[p.vendedor,p.vendedor2].includes(filtros.vendedor))
    &&(!incluirSituacao||!filtros.situacao||p.situacao===filtros.situacao)
    &&(!busca||[p.numero,p.orcamento,p.cliente,p.telefone,p.telefone.replace(/\D/g,''),p.cidade,p.estado,p.produto].join(' ').toLocaleLowerCase('pt-BR').includes(busca)))
}
export function contagemVendidos(pedidos: PedidoVendido[], situacao?: SituacaoVendido) {
  const rows=situacao?pedidos.filter(p=>p.situacao===situacao):pedidos
  return { clientes: new Set(rows.map(p=>p.clienteId)).size, pedidos:rows.length }
}
