import type { CatalogoItem } from '../hooks/useCatalogo'
import type { PrecoBranorte } from '../hooks/usePrecosBranorte'
import { recomendarMotorChupim, type MaterialChupim, type InclinacaoChupim } from './calcChupim'
import { CHUPIM_MATERIAL_PADRAO, CHUPIM_INCLINACAO_PADRAO } from './motor-do-preco'
import { encontrarCatalogoProjeto3D } from './projeto-3d-catalogo-match'

/** The price table contains nominal conveyor sizes missing from catalogo_items.
 * Negative ids identify UI options only; the quotation stores the real price FK.
 */
export function catalogoProjeto3DComTransportadores(catalogo: readonly CatalogoItem[], precos: readonly PrecoBranorte[], material: MaterialChupim = CHUPIM_MATERIAL_PADRAO, inclinacao: InclinacaoChupim = CHUPIM_INCLINACAO_PADRAO): CatalogoItem[] {
  const result = [...catalogo]
  for (const price of precos) {
    if (!price.ativo || price.categoria !== 'TRANSPORTADOR' || !Number.isInteger(price.id) || price.id <= 0) continue
    const match = price.descricao.trim().match(/^(chupim|TH)\s+(\d{2,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*m$/i)
    if (!match || price.subcategoria !== (match[1].toUpperCase() === 'TH' ? 'TH' : 'CHUPIM')) continue
    if (catalogo.some(item => item.ativo && item.is_oficial && item.preco_branorte_id === price.id)) continue
    const diameter = Number(match[2])
    const length = Number(match[3].replace(',', '.'))
    if (!(diameter > 0) || !(length > 0)) continue
    const th = price.subcategoria === 'TH'
    const recommended = th ? null : recomendarMotorChupim(price.descricao, price.capacidade, material, inclinacao)
    const motorCv = th ? price.motor_cv : recommended?.cvMotor ?? null
    const name = `TRANSPORTADOR HELICOIDAL ${th ? 'CALHA TH ' : ''}${diameter} X ${String(length).replace('.', ',')} M`
    const photo = catalogo.find(item => {
      if (!item.ativo || !item.is_oficial || item.categoria !== 'TRANSPORTADOR' || !item.foto_url) return false
      if (/INOX|AMPLIA[ÇC]|SUPORTE|BIG\s*BAG|ADAPTA/i.test(`${item.nome_curto} ${item.nome_completo ?? ''}`)) return false
      const title = item.nome_curto.match(/(\d{2,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*M\b/i)
      if (!title || Number(title[1]) !== diameter) return false
      const photoName = `TRANSPORTADOR HELICOIDAL ${th ? 'CALHA TH ' : ''}${diameter} X ${title[2]} M`
      return encontrarCatalogoProjeto3D({ nome: photoName, origem_projeto3d: {
        exportId: 'foto-representativa', projectId: '', projectName: '', floorId: '', floorName: '', sourceId: '',
        catalogId: 'foto-representativa', sequence: 1, kind: 'equipment', sourceName: photoName,
        sourceSpecifications: [], resolution: 'pendente',
      } }, [item]) !== null
    })?.foto_url ?? null
    const specs = [
      `Diâmetro: ${diameter} mm`, `Comprimento: ${String(length).replace('.', ',')} metros.`,
      ...(th ? [] : ['Construção: Tubo em chapa n. 14', 'Hélice em chapa expandida, unidas por mancais.', 'Funil de entrada medindo 500 mm x 500 mm']),
      ...(price.capacidade ? [`Capacidade/Produção: ${price.capacidade}`] : []),
      ...(th ? [price.potencia || motorCv ? `Acionamento: potência ${price.potencia || `${motorCv} CV`} (motorredutor incluso)` : 'Acionamento: (incluso)'] : motorCv ? [`Acionamento: potência ${motorCv} CV 4 polos (motor não incluso)`] : []),
    ]
    result.push({
      id: -price.id - 1, categoria: price.categoria, subcategoria: price.subcategoria,
      nome_curto: name, nome_completo: name, specs,
      capacidade_kg: null, capacidade_litros: null, potencia_cv: motorCv,
      motor_padrao_cv: motorCv, motor_padrao_polos: th ? price.motor_polos ?? 4 : 4, motor_padrao_qtd: 1,
      valor: Number(price.valor_equipamento ?? 0), imagem_url: photo, foto_url: photo,
      ativo: true, is_oficial: true, ordem: price.ordem, ocorrencias: 0, descricao: price.descricao,
      acessorios_relacionados_ids: [], usa_inversor: false, funcao_opcoes: [],
      tamanho_codigo: `${th ? 'TH' : 'HELICOIDAL'}_${diameter}x${length}`,
      ocultar_funcao_no_pdf: false, motor_id: null, preco_branorte_id: price.id, motores_extras: [],
    })
  }
  return result
}
