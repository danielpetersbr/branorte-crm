// Define os atributos especificos por categoria do catalogo Branorte.
// Cada atributo vira uma "spec" estruturada no formato "Label: Valor [unidade]".
// Mantem retro-compat: specs livres continuam funcionando.

export type AtributoTipo = 'number' | 'text' | 'select'

export interface AtributoDef {
  key: string                  // chave interna (ex: 'capacidade_ton')
  label: string                // label visivel (ex: 'Capacidade')
  unidade?: string             // sufixo (ex: 'ton', 'm', 'kg/h')
  tipo: AtributoTipo
  opcoes?: string[]            // pra tipo=select
  placeholder?: string
  hint?: string
}

// Categorias do catalogo (case-insensitive — normalizamos pra UPPER)
export const ATRIBUTOS_POR_CATEGORIA: Record<string, AtributoDef[]> = {
  SILO: [
    { key: 'capacidade_ton', label: 'Capacidade', unidade: 'toneladas', tipo: 'number', placeholder: '200' },
    { key: 'tipo_silo', label: 'Tipo', tipo: 'select', opcoes: ['Cilíndrico', 'Geométrico', 'Chupim', 'Quadrado'] },
    { key: 'material', label: 'Material armazenado', tipo: 'select', opcoes: ['Milho', 'Soja', 'Ração', 'Grão (genérico)', 'Farelo', 'Casca'] },
    { key: 'diametro_m', label: 'Diâmetro', unidade: 'm', tipo: 'number', placeholder: '4.5' },
    { key: 'altura_m', label: 'Altura', unidade: 'm', tipo: 'number', placeholder: '8' },
    { key: 'cone_angulo', label: 'Ângulo do cone', unidade: '°', tipo: 'number', placeholder: '45' },
  ],
  TRANSPORTADOR: [
    { key: 'tipo_transp', label: 'Tipo', tipo: 'select', opcoes: ['Helicoidal (Chupim)', 'Calha TH', 'Elevador', 'Correia', 'Redler'] },
    { key: 'comprimento_m', label: 'Comprimento', unidade: 'm', tipo: 'number', placeholder: '6' },
    { key: 'diametro_pol', label: 'Diâmetro', unidade: 'pol', tipo: 'number', placeholder: '6' },
    { key: 'inclinacao_grau', label: 'Inclinação', unidade: '°', tipo: 'select', opcoes: ['0', '15', '30', '45', '60', '90'] },
    { key: 'capacidade_th', label: 'Capacidade', unidade: 't/h', tipo: 'number', placeholder: '5' },
    { key: 'funcao', label: 'Função', tipo: 'select', opcoes: ['Alimentação', 'Descarga', 'Pulmão', 'Recepção', 'Geral'] },
  ],
  MOINHO: [
    { key: 'tipo_moinho', label: 'Tipo', tipo: 'select', opcoes: ['Martelo'], hint: 'Todos os moinhos Branorte são de martelo' },
    { key: 'capacidade_kgh', label: 'Capacidade', unidade: 'kg/h', tipo: 'number', placeholder: '1000', hint: 'Pen 3mm milho: 7,5CV=1.000 | 10CV=1.400 | 15CV=1.800 | 20CV=2.000 | 30CV=3.600 | 50CV=5.000 | 75CV=7.500 | 100CV=10.000' },
    { key: 'peneira_mm', label: 'Peneira', unidade: 'mm', tipo: 'select', opcoes: ['1.2', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '8', '10', '12', '16'], hint: 'Padrão: 3,0mm. Peneira menor = moagem mais fina, menor produção' },
    { key: 'martelos_qtd', label: 'Quantidade de martelos', tipo: 'number', placeholder: '24', hint: '7,5CV=16 | 10CV=12 | 15CV=12 | 20CV=16 | 30CV=24 | 50CV=36 | 75CV=48 | 100CV=64' },
    { key: 'funil_l', label: 'Funil dosador', unidade: 'Lts', tipo: 'number', placeholder: '50', hint: '7,5-10CV=50L | 15-20CV=100L | 75CV=45L' },
    { key: 'aspiracao', label: 'Aspiração', tipo: 'select', opcoes: ['Sim', 'Não'] },
  ],
  MISTURADOR: [
    { key: 'tipo_mist', label: 'Tipo', tipo: 'select', opcoes: ['Vertical', 'Horizontal'] },
    { key: 'capacidade_kg_lote', label: 'Capacidade', unidade: 'kg/lote', tipo: 'number', placeholder: '500' },
    { key: 'pulmao', label: 'Caçamba pulmão', tipo: 'select', opcoes: ['Com pulmão', 'Sem pulmão'] },
    { key: 'tempo_mistura_min', label: 'Tempo de mistura', unidade: 'min', tipo: 'number', placeholder: '15' },
  ],
  CAIXA: [
    { key: 'tipo_caixa', label: 'Tipo', tipo: 'select', opcoes: ['Recepção', 'Picados', 'Pulmão', 'Pesagem'] },
    { key: 'volume_m3', label: 'Volume', unidade: 'm³', tipo: 'number', placeholder: '5' },
    { key: 'dimensoes', label: 'Dimensões (LxAxP)', tipo: 'text', placeholder: '2x2x1.5 m' },
  ],
  ELEVADOR: [
    { key: 'altura_m', label: 'Altura de elevação', unidade: 'm', tipo: 'number', placeholder: '12' },
    { key: 'capacidade_th', label: 'Capacidade', unidade: 't/h', tipo: 'number', placeholder: '10' },
    { key: 'tipo_elev', label: 'Tipo', tipo: 'select', opcoes: ['Caçamba', 'Z', 'Helicoidal vertical'] },
  ],
  ALIMENTADOR: [
    { key: 'tipo_alim', label: 'Tipo', tipo: 'select', opcoes: ['Vibratório', 'Helicoidal', 'Correia'] },
    { key: 'capacidade_kgh', label: 'Capacidade', unidade: 'kg/h', tipo: 'number', placeholder: '500' },
    { key: 'comprimento_m', label: 'Comprimento', unidade: 'm', tipo: 'number', placeholder: '2' },
  ],
  CACAMBA: [
    { key: 'volume_l', label: 'Volume', unidade: 'litros', tipo: 'number', placeholder: '1000' },
    { key: 'pesagem', label: 'Pesagem', tipo: 'select', opcoes: ['Com célula de carga', 'Sem pesagem'] },
  ],
  'PRE-LIMPEZA': [
    { key: 'capacidade_th', label: 'Capacidade', unidade: 't/h', tipo: 'number', placeholder: '10' },
    { key: 'peneiras_qtd', label: 'Peneiras', tipo: 'number', placeholder: '2' },
  ],
  DESCARGA: [
    { key: 'tipo_desc', label: 'Tipo', tipo: 'select', opcoes: ['Granel', 'Big Bag', 'Saco'] },
    { key: 'capacidade_th', label: 'Capacidade', unidade: 't/h', tipo: 'number', placeholder: '5' },
  ],
  PASSARELA: [
    { key: 'comprimento_m', label: 'Comprimento', unidade: 'm', tipo: 'number', placeholder: '6' },
    { key: 'altura_m', label: 'Altura', unidade: 'm', tipo: 'number', placeholder: '4' },
    { key: 'largura_m', label: 'Largura', unidade: 'm', tipo: 'number', placeholder: '0.8' },
  ],
  ENSACADEIRA: [
    { key: 'capacidade_sacos_h', label: 'Capacidade', unidade: 'sacos/h', tipo: 'number', placeholder: '200' },
    { key: 'peso_saco_kg', label: 'Peso por saco', unidade: 'kg', tipo: 'number', placeholder: '25' },
  ],
  PENEIRA: [
    { key: 'capacidade_th', label: 'Capacidade', unidade: 't/h', tipo: 'number', placeholder: '5' },
    { key: 'malha_mm', label: 'Malha', unidade: 'mm', tipo: 'number', placeholder: '3' },
  ],
  MOEGA: [
    { key: 'capacidade_th', label: 'Capacidade', unidade: 't/h', tipo: 'number', placeholder: '20' },
    { key: 'volume_m3', label: 'Volume', unidade: 'm³', tipo: 'number', placeholder: '15' },
  ],
}

// Marcador invisivel pra identificar specs estruturadas
const ATR_PREFIX = '@'

// Serializa atributos pra string de spec. Ex: { capacidade_ton: 200 } → "Capacidade: 200 toneladas"
export function atributoParaSpec(def: AtributoDef, valor: string): string {
  if (!valor || !valor.trim()) return ''
  const unit = def.unidade ? ` ${def.unidade}` : ''
  return `${def.label}: ${valor}${unit}`
}

// Parseia specs existentes e retorna mapa de atributos preenchidos pra essa categoria
export function parseSpecsParaAtributos(specs: string[], categoria: string): {
  atributos: Record<string, string>
  specsLivres: string[]
} {
  const defs = ATRIBUTOS_POR_CATEGORIA[categoria.toUpperCase()] || []
  const atributos: Record<string, string> = {}
  const specsLivres: string[] = []

  for (const spec of specs) {
    let matched = false
    for (const def of defs) {
      // Match "Label: valor [unidade?]"
      const re = new RegExp(`^\\s*${escapeRegex(def.label)}\\s*:\\s*(.+?)\\s*${def.unidade ? escapeRegex(def.unidade) : ''}\\s*$`, 'i')
      const m = spec.match(re)
      if (m) {
        atributos[def.key] = m[1].trim()
        matched = true
        break
      }
    }
    if (!matched) specsLivres.push(spec)
  }

  return { atributos, specsLivres }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Serializa atributos+specsLivres de volta para array de specs
export function atributosParaSpecs(
  atributos: Record<string, string>,
  specsLivres: string[],
  categoria: string,
): string[] {
  const defs = ATRIBUTOS_POR_CATEGORIA[categoria.toUpperCase()] || []
  const out: string[] = []
  for (const def of defs) {
    const v = atributos[def.key]
    if (v && String(v).trim()) {
      out.push(atributoParaSpec(def, String(v).trim()))
    }
  }
  for (const s of specsLivres) if (s.trim()) out.push(s)
  return out
}
