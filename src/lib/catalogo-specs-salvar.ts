/**
 * Monta o `specs` de um catalogo_item na hora de SALVAR o modal do Admin do Catálogo,
 * sem reescrever o que o admin não mexeu (29/09/2026).
 *
 * O modal separa as specs em atributos estruturados (parseSpecsParaAtributos) e
 * specs livres, e no save junta de volta com atributosParaSpecs. Essa ida-e-volta
 * PERDE informação: "Capacidade 0,75 ton./h (pen 3,0mm)" (item 12, 7,5 CV) volta
 * como "Capacidade: 0.75 kg/h" — o número fica, a unidade vira kg/h e o parêntese
 * some —, e "Capacidade 5.000 kg/h (na densidade do milho e peneira 3,0mm)" (item
 * 34) perde a ressalva e muda de lugar. Como o texto de `specs` é exatamente o que
 * o cliente lê no PDF, abrir um item só para trocar o título e clicar Salvar
 * alterava a proposta.
 *
 * Regra: linha estruturada cujo valor não mudou volta com o TEXTO ORIGINAL; se
 * nada mudou (atributos, specs livres e categoria), o array original volta inteiro,
 * na mesma ordem. Só o que o admin alterou é re-serializado no formato
 * "Label: valor unidade". Sem item carregado (modo criar) ou com a categoria
 * trocada, vale o atributosParaSpecs de sempre.
 */
import {
  ATRIBUTOS_POR_CATEGORIA,
  atributoParaSpec,
  atributosParaSpecs,
  parseSpecsParaAtributos,
} from './categoria-atributos'

/** O que o item tinha no banco quando o modal abriu. */
export interface SpecsCarregadas {
  categoria: string
  specs: string[]
}

const normCategoria = (c: string) => c.trim().toUpperCase()
const limpo = (v: string | undefined) => (v ?? '').trim()

export function montarSpecsParaSalvar(
  atributos: Record<string, string>,
  specsLivres: string[],
  categoria: string,
  carregado: SpecsCarregadas | null,
): string[] {
  const livres = specsLivres.filter(s => s.trim().length > 0)
  if (!carregado || normCategoria(carregado.categoria) !== normCategoria(categoria)) {
    return atributosParaSpecs(atributos, livres, categoria)
  }

  // Mesma chamada do reset do modal (com a categoria DO BANCO, como lá): é contra
  // isto que "mudou?" é medido. Usar a do formulário quebraria com um espaço a
  // mais digitado ("MOINHO "), que muda a busca das definições mas não a categoria.
  const cat = carregado.categoria
  const original = parseSpecsParaAtributos(carregado.specs, cat)
  const defs = ATRIBUTOS_POR_CATEGORIA[cat.toUpperCase()] || []
  const mesmoValor = (key: string) => limpo(atributos[key]) === limpo(original.atributos[key])

  const livresOriginais = original.specsLivres.filter(s => s.trim().length > 0)
  const livresIguais = livres.length === livresOriginais.length
    && livres.every((s, i) => s === livresOriginais[i])
  if (livresIguais && defs.every(d => mesmoValor(d.key))) return [...carregado.specs]

  // Texto original de cada atributo. Quando duas linhas caem no mesmo atributo, o
  // parse fica com o valor da ÚLTIMA — aqui também, para texto e valor baterem.
  const linhaOriginal = new Map<string, string>()
  for (const s of carregado.specs) {
    const key = Object.keys(parseSpecsParaAtributos([s], cat).atributos)[0]
    if (key) linhaOriginal.set(key, s)
  }

  const out: string[] = []
  for (const def of defs) {
    const v = limpo(atributos[def.key])
    if (!v) continue
    const texto = linhaOriginal.get(def.key)
    out.push(texto !== undefined && mesmoValor(def.key) ? texto : atributoParaSpec(def, v))
  }
  return [...out, ...livres]
}
