import { getValorPedido, type Pedido } from './calculos'

/** Uma venda física por pedido. Para tempos por vendedor, filtre o vendedor antes de deduplicar. */
export function pedidosFisicos(pedidos: Pedido[]): Pedido[] {
  const vistos = new Set<string>()
  return pedidos.filter(p => {
    if (p.status === 'CANCELADO' || p._isAjuste || vistos.has(p.id)) return false
    vistos.add(p.id)
    return true
  })
}

const texto = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
const existente = (descricao: string) => /\bEXISTENTE\b/.test(texto(descricao))
const quantidade = (v: number | null | undefined) => {
  if (v == null) return 1
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const valorIntegral = (p: Pedido) => getValorPedido({ ...p, _valorOverride: undefined })

/** Valor integral da venda na data do fechamento; acréscimos datados têm lançamento próprio. */
export function valorVendaFisica(p: Pedido): number {
  return getValorPedido({ ...p, _valorOverride: undefined, ajuste_valor: p.ajuste_data ? 0 : p.ajuste_valor })
}

export function normalizarOrigem(origem: string | null | undefined): string {
  const original = (origem || '').trim()
  const chave = texto(original).replace(/_/g, ' ').replace(/\s+/g, ' ')
  if (!chave || ['N/D', 'NAO INFORMADO', 'NAO LEMBRA'].includes(chave)) return 'Não informado'
  if (['FACEBOOK', 'INSTAGRAM', 'META ADS'].includes(chave)) return 'Meta ADS'
  if (chave === 'JA ERA CLIENTE') return 'Já era cliente'
  if (chave === 'GOOGLE') return 'Google'
  if (chave === 'INDICACAO') return 'Indicação'
  if (chave === 'SITE') return 'Site'
  return original.replace(/_/g, ' ')
}

/** Mantém a agregação monetária das linhas ativas; o limite Top 10 pertence só ao ranking. */
export function agruparVendasPorEstado(pedidosAtivos: Pedido[]): Array<{ estado: string; valor: number; quantidade: number }> {
  const grupos = new Map<string, { estado: string; valor: number; quantidade: number }>()
  for (const pedido of pedidosAtivos) {
    const estado = pedido.estado?.trim().toUpperCase() || 'N/D'
    const grupo = grupos.get(estado) || { estado, valor: 0, quantidade: 0 }
    grupo.valor += getValorPedido(pedido); grupo.quantidade += 1; grupos.set(estado, grupo)
  }
  return [...grupos.values()].sort((a, b) => b.valor - a.valor)
}

/** Identificação textual: o DTO original não tem modelo ou categoria estruturados. */
export function classificarFabrica(descricao: string, valor: number): string | null {
  const d = texto(descricao)
  if (existente(descricao)) return null
  // "Painel para Compacta" nomeia um componente; "Compacta com painel" nomeia a fábrica.
  const inicioFabrica = d.search(/\b(?:COMPACTA|FABRICA)\b/)
  const nomeAnterior = inicioFabrica < 0 ? d : d.slice(0, inicioFabrica)
  const componente = /\b(?:PENEIRAS?|MARTELOS?)\b/.test(nomeAnterior) || categoriasEquipamento.some(c => c.pattern.test(nomeAnterior))
  if (componente && !/^CONJUNTO\s+COMPLETO\b/.test(d)) return null
  if (/\bMINI\s+FABRICA\b/.test(d)) return 'Mini Fábrica de Ração'
  const compacta = d.match(/\bCOMPACTA\s+0?([123])\b(?:\s+(MASTER)\b)?/)
  if (compacta) return `Compacta ${compacta[1]}${compacta[2] ? ' Master' : ''}`
  if (/\bCOMPACTA\b/.test(d)) return d.includes('MASTER') ? 'Fábrica Master' : 'OUTROS'
  if (/\bFABRICA\b.*\bRACAO\b/.test(d)) return d.includes('MASTER') ? 'Fábrica Master' : 'Fábrica de Ração'
  if (/\bMASTER\b/.test(d) && valor > 100000) return 'Fábrica Master'
  return null
}

export function agruparFabricasVendidas(pedidos: Pedido[]): Array<{ fabrica: string; quantidade: number }> {
  const grupos = new Map<string, number>()
  const somar = (fabrica: string, qtd: number) => { if (qtd > 0) grupos.set(fabrica, (grupos.get(fabrica) || 0) + qtd) }
  for (const pedido of pedidosFisicos(pedidos)) {
    const valor = valorIntegral(pedido)
    let temFabricaDetalhada = false
    for (const item of pedido.equipamentos_detalhados || []) {
      const fabrica = classificarFabrica(item.descricao || '', valor)
      if (!fabrica) continue
      temFabricaDetalhada = true
      somar(fabrica, quantidade(item.quantidade))
    }
    if (!temFabricaDetalhada) {
      const fabrica = classificarFabrica(pedido.descricao_equipamento || '', valor)
      if (fabrica) somar(fabrica, 1)
    }
  }
  return [...grupos].map(([fabrica, quantidade]) => ({ fabrica, quantidade })).sort((a, b) => b.quantidade - a.quantidade)
}

const categoriasEquipamento = [
  { pattern: /MOINHO\s*MARTELO|MOINHO\s*\d+\s*CV|TRITURADOR\s+DE\s+GR/i, nome: 'Moinhos' },
  { pattern: /MISTURADOR/i, nome: 'Misturadores' },
  { pattern: /SILO(?!\s*DE\s*FILTRO)/i, nome: 'Silos' },
  { pattern: /ELEVADOR/i, nome: 'Elevadores' },
  { pattern: /TRANSPORTADOR|HELICOIDAL|HELICOIDE|ESTEIRA\s*TRANSPORT|CHUPIM|CHUPINS|ROSCA\s/i, nome: 'Transportadores/Chupins' },
  { pattern: /ENSACADEIR/i, nome: 'Ensacadeiras' },
  { pattern: /MOEGA|CAIXA\s+ENTRADA\s+MOEGA/i, nome: 'Moegas' },
  { pattern: /PR[ÉE]\s*-?\s*LIMPEZA/i, nome: 'Pré-Limpeza' },
  { pattern: /SUPORTE.*BAG|BAG.*SUPORTE/i, nome: 'Suportes de Bag' },
  { pattern: /CA[ÇC]AMBA|PESAGEM|C[ÉE]LULA\s+DE\s+CARGA/i, nome: 'Caçambas/Pesagem' },
  { pattern: /PAINEL/i, nome: 'Painéis Elétricos' },
  { pattern: /MOTOR(ES)?\s+(MONO|TRI)F[ÁA]SIC/i, nome: 'Motores' },
]

/** Valores integrais dos itens associados; não representam crédito ou comissão de um vendedor. */
export function agruparEquipamentosVendidos(pedidos: Pedido[]): Array<{ equipamento: string; quantidade: number; valor: number }> {
  const grupos = new Map<string, { equipamento: string; quantidade: number; valor: number }>()
  const somar = (equipamento: string, quantidade: number, valor: number) => {
    const grupo = grupos.get(equipamento) || { equipamento, quantidade: 0, valor: 0 }
    grupo.quantidade += quantidade; grupo.valor += valor; grupos.set(equipamento, grupo)
  }
  for (const pedido of pedidosFisicos(pedidos)) {
    const descricao = (pedido.descricao_equipamento || '').toUpperCase()
    const valorPedido = valorIntegral(pedido)
    const ehFabrica = classificarFabrica(descricao, valorPedido) !== null
    const itens = pedido.equipamentos_detalhados || []
    if (itens.length) {
      for (const item of itens) {
        const desc = (item.descricao || '').toUpperCase().trim()
        const qtd = quantidade(item.quantidade)
        if (!desc || !qtd || existente(desc)) continue
        if (classificarFabrica(desc, valorPedido)) continue
        const valorItem = (Number(item.valor) || 0) * qtd
        if (/^ACESS[ÓO]RIO|^FRETE|^DESCONTO|^INSTALA[ÇC][ÃA]O|^TREINAMENTO|^GARANTIA/i.test(desc)) {
          if (valorItem > 0) somar('Acessórios', qtd, valorItem)
          continue
        }
        const categoria = categoriasEquipamento.find(c => c.pattern.test(desc))
        if (categoria) somar(categoria.nome, qtd, valorItem)
        else if (valorItem >= 1000 && !ehFabrica) somar('Outros Equipamentos', qtd, valorItem)
      }
    } else if (!ehFabrica && descricao && !existente(descricao)) {
      const categoria = categoriasEquipamento.find(c => c.pattern.test(descricao))
      if (categoria) somar(categoria.nome, 1, valorPedido)
    }
  }
  return [...grupos.values()].sort((a, b) => b.valor - a.valor)
}
