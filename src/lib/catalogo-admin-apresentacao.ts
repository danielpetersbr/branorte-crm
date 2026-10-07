const NOMES_CATEGORIAS: Record<string, string> = {
  TRANSPORTADOR: 'Transportadores', ELEVADOR: 'Elevadores de caneca', SILO: 'Silos',
  PAINEL_ELETRICO: 'Painéis elétricos', COMPACTA: 'Fábricas compactas', CAIXA: 'Caixas',
  PLASTICO: 'Equipamentos para plástico', MISTURADOR: 'Misturadores', MOINHO: 'Moinhos',
  BALANCA: 'Balanças', ALIMENTADOR: 'Alimentadores', CACAMBA_PESAGEM: 'Caçambas de pesagem',
  OUTROS: 'Diversos', PRE_LIMPEZA: 'Pré-limpeza', DESCARGA: 'Descargas',
  SUPORTE_BAG: 'Suportes de Big Bag', ENSACADEIRA: 'Ensacadeiras', ESTEIRA: 'Esteiras',
  MOEGA: 'Moegas', PASSARELA: 'Passarelas', ELEVADOR_SACARIA: 'Elevadores de sacaria',
  ACESSORIO: 'Acessórios', HELICOIDE: 'Helicoides',
}
export const nomeCategoria = (categoria: string) => NOMES_CATEGORIAS[categoria] || categoria.replace(/_/g, ' ')

interface ItemBusca {
  id: number
  nome_curto: string | null
  nome_completo: string | null
  categoria: string | null
  subcategoria: string | null
}

export function correspondeBuscaCatalogo(item: ItemBusca, busca: string): boolean {
  const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const alvo = normalizar(`${item.id} ${item.nome_curto ?? ''} ${item.nome_completo ?? ''} ${item.categoria ?? ''} ${nomeCategoria(item.categoria ?? '')} ${item.subcategoria ?? ''}`)
  return normalizar(busca).trim().split(/\s+/).every(termo => alvo.includes(termo.replace(/^#/, '')))
}

export function resumirCatalogo(items: Array<{ ativo: boolean; is_oficial: boolean; foto_url: string | null }>) {
  const resumo = { todos: 0, 'sem-foto': 0, inativos: 0, comFoto: 0 }
  for (const item of items) {
    if (!item.ativo) { resumo.inativos++; continue }
    resumo.todos++
    resumo[item.foto_url ? 'comFoto' : 'sem-foto']++
  }
  return resumo
}
