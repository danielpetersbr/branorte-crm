import { foneCanon } from './fone-canon'
import { maisAdiantada, nomeCanonicoEtiqueta } from './mapa-etiquetas'
import { FUNIL_ATIVO, ordemDe, statusDaEtiqueta } from './wa-funil'

export interface EtiquetaOrcamentoWa {
  vendedor_nome: string
  etiqueta_id_wascript: number
  etiqueta_nome: string
  etiqueta_nome_normalizado: string
}

export interface ChatOrcamentoWa {
  vendedor_nome: string
  phone: string
  label_ids: string[] | null
}

export interface OrcamentoComFone {
  vendedor_nome: string | null
  cliente_fone: string | null
}

export type IndiceEtiquetasOrcamentos = Map<string, Set<string>>

export const vendedorEtiqueta = (nome: string | null | undefined) =>
  (nome ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase()

const chave = (vendedor: string, fone: string) => `${vendedor}::${fone}`

export function indexarEtiquetasOrcamentos(catalogo: EtiquetaOrcamentoWa[], chats: ChatOrcamentoWa[]): IndiceEtiquetasOrcamentos {
  const nomes = new Map(catalogo.map(e => [chave(vendedorEtiqueta(e.vendedor_nome), String(e.etiqueta_id_wascript)), nomeCanonicoEtiqueta(e.etiqueta_nome_normalizado || e.etiqueta_nome)]))
  const indice: IndiceEtiquetasOrcamentos = new Map()
  for (const c of chats) {
    const fone = foneCanon(c.phone)
    if (!fone) continue
    const vendedor = vendedorEtiqueta(c.vendedor_nome)
    const id = chave(vendedor, fone)
    const etiquetas = indice.get(id) ?? new Set<string>()
    for (const labelId of c.label_ids ?? []) {
      const nome = nomes.get(chave(vendedor, String(labelId)))
      if (nome) etiquetas.add(nome)
    }
    indice.set(id, etiquetas)
  }
  return indice
}

export function opcoesEtiquetasOrcamentos(catalogo: EtiquetaOrcamentoWa[]) {
  const nomes = new Map<string, string>()
  for (const e of catalogo) {
    const valor = nomeCanonicoEtiqueta(e.etiqueta_nome_normalizado || e.etiqueta_nome)
    if (valor && !nomes.has(valor)) nomes.set(valor, e.etiqueta_nome)
  }
  return [...nomes].map(([nome, label]) => ({ value: `etiqueta:${nome}`, label }))
    .sort((a, b) => ordemDe(a.value.slice(9)) - ordemDe(b.value.slice(9)) || a.label.localeCompare(b.label, 'pt-BR'))
}

// Preserva links vindos do dashboard, mas resolve cada um nas etiquetas reais.
export function filtroEtiquetaOrcamento(valor: string | null): string {
  if (!valor) return ''
  const antigos: Record<string, string> = {
    aberto: 'aberto', orcamento: 'etiqueta:ORCAMENTO ENVIADO', quente: 'etiqueta:FOLLOW UP',
    lead_quente: 'etiqueta:LEAD QUENTE', novo: 'etiqueta:NOVO LEAD',
    vendido: 'etiqueta:VENDIDO', perdido: 'perdido', sem_etiqueta: 'sem_etiqueta',
  }
  return antigos[valor] ?? (valor.startsWith('etiqueta:') ? `etiqueta:${nomeCanonicoEtiqueta(valor.slice(9))}` : '')
}

/** Consulta sempre o WhatsApp do vendedor responsável pelo orçamento. */
export function detalharEtiquetasOrcamento(o: OrcamentoComFone, indice: IndiceEtiquetasOrcamentos, catalogo: EtiquetaOrcamentoWa[]) {
  const fone = foneCanon(o.cliente_fone)
  const vendedor = vendedorEtiqueta(o.vendedor_nome)
  const etiquetas = fone ? indice.get(chave(vendedor, fone)) : undefined
  if (!etiquetas) return { conversaLocalizada: false, nomes: [] as string[] }
  const nomes = opcoesEtiquetasOrcamentos(catalogo.filter(e => vendedorEtiqueta(e.vendedor_nome) === vendedor))
    .filter(e => etiquetas.has(e.value.slice(9))).map(e => e.label)
  return { conversaLocalizada: true, nomes }
}

/** Mesma prioridade do mapa: a etapa mais avançada prevalece sobre etiquetas avulsas. */
export function etiquetaPrincipalOrcamento(nomes: string[]): string | null {
  if (!nomes.length) return null
  const principal = maisAdiantada(nomes.map(nomeCanonicoEtiqueta))
  return nomes.find(nome => nomeCanonicoEtiqueta(nome) === principal) ?? null
}

export function passaEtiquetaOrcamento(o: OrcamentoComFone, filtro: string, indice: IndiceEtiquetasOrcamentos): boolean {
  if (!filtro) return true
  const fone = foneCanon(o.cliente_fone)
  const etiquetas = fone ? indice.get(chave(vendedorEtiqueta(o.vendedor_nome), fone)) : undefined
  if (filtro === 'sem_etiqueta') return etiquetas !== undefined && etiquetas.size === 0
  if (!etiquetas) return false
  if (filtro === 'aberto') {
    // O preset do Kanban inclui Interesse Futuro. As demais etiquetas de
    // encerramento prevalecem quando coexistem com uma etapa ativa.
    return [...etiquetas].some(e => FUNIL_ATIVO.has(e))
      && ![...etiquetas].some(e => !FUNIL_ATIVO.has(e) && statusDaEtiqueta(e) === 'FECHADO')
  }
  if (filtro === 'perdido') return !etiquetas.has('VENDIDO')
    && [...etiquetas].some(e => !FUNIL_ATIVO.has(e) && statusDaEtiqueta(e) === 'FECHADO')
  return filtro.startsWith('etiqueta:') && etiquetas.has(filtro.slice(9))
}
