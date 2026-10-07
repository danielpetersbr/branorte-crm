import type { CatalogoItemAdmin } from '../hooks/useCatalogoAdmin'
export interface ModeloCatalogo {
  id: number
  basename: string
  pacote: string
  voltagem: string
  is_master: boolean
  ativo: boolean
  foto_url: string | null
  producao_kgh: number | null
  total_equipamentos: number
  itens: Array<{ nome: string; qtd: number }>
}

// Fábricas são pacotes de orçamento, com versões mono/trifásicas. As linhas da
// tabela de preços não carregam a composição nem a foto desses pacotes.
export function fabricasDoCatalogo(items: CatalogoItemAdmin[], modelos: ModeloCatalogo[]): CatalogoItemAdmin[] {
  const fabricas = modelos.filter(m => /COMPACTA|MINI.*F[ÁA]BRICA/i.test(m.pacote) && m.itens?.length).map(m => ({
    id: -1_000_000 - m.id, modelo_id: m.id,
    categoria: 'COMPACTA', subcategoria: `${m.pacote}${m.is_master ? ' MASTER' : ''}`,
    nome_curto: m.basename, nome_completo: m.basename,
    specs: [
      ...(m.producao_kgh ? [`Produção: ${m.producao_kgh.toLocaleString('pt-BR')} kg/h`] : []),
      m.voltagem === 'monofasico' ? 'Monofásico' : 'Trifásico',
      ...m.itens.map(i => `${i.qtd} × ${i.nome}`),
    ],
    capacidade_kg: null, capacidade_litros: null, potencia_cv: null,
    motor_padrao_cv: null, motor_padrao_polos: null, motor_padrao_qtd: 1,
    valor: m.total_equipamentos, imagem_url: m.foto_url, foto_url: m.foto_url,
    ativo: m.ativo, ordem: m.id, ocorrencias: 0, is_oficial: true,
    descricao: null, acessorios_relacionados_ids: [], items_relacionados_ids: [],
    notas_curadoria: null, atualizado_por: null, atualizado_em: null,
    usa_inversor: false, funcao_opcoes: [], tamanho_codigo: null,
    ocultar_funcao_no_pdf: false, motor_id: null, preco_branorte_id: null, motores_extras: [],
  } satisfies CatalogoItemAdmin))
  return [...items.filter(i => i.categoria !== 'COMPACTA' || (
    i.preco_branorte_id == null && !i.is_virtual && !/^modelo_id=\d+/.test(i.notas_curadoria ?? '')
  )), ...fabricas]
}
