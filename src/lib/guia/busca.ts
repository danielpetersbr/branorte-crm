/**
 * Guia do Vendedor — busca global e filtros.
 *
 * Funções PURAS, testáveis, sem React e sem Supabase. O vendedor está no meio
 * de um atendimento: ele digita como fala ("gado confinamento", "ingrediente
 * que não pode ir para aves"), erra acento e abrevia. A busca tem que aguentar.
 *
 * Duas camadas:
 *   1. ATALHO SEMÂNTICO — a frase descreve uma INTENÇÃO ("o que não entra na
 *      fábrica"). Vira filtro, não busca textual.
 *   2. BUSCA TEXTUAL — pontuada por onde o termo bateu (nome > sinônimo >
 *      resumo > corpo), para "milho" não devolver primeiro "raspa de mandioca"
 *      só porque a palavra milho aparece no meio do texto.
 */
import { ATALHOS_BUSCA } from './catalogo'
import type {
  CategoriaMateria, CompatBranorte, Especie, GuiaAnimal, GuiaMateria,
  ItemGuia, MisturadorIndicado, NivelRisco, StatusConteudo,
} from './tipos'

/** Minúsculo, sem acento, sem pontuação. `Óleo/Gordura` → `oleo gordura`. */
export function normalizar(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(s: string): string[] {
  // "de", "da", "para" e afins só atrapalham o score.
  const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as',
    'em', 'no', 'na', 'para', 'pra', 'por', 'com', 'que', 'um', 'uma'])
  return normalizar(s).split(' ').filter(t => t.length > 1 && !PARADAS.has(t))
}

export interface Atalho { rotulo: string; filtro: Record<string, string> }

/**
 * Detecta intenção. Só dispara com casamento forte (a frase do atalho está
 * contida na consulta, ou vice-versa) — senão qualquer busca por "sal"
 * cairia no atalho de misturador.
 */
export function detectarAtalho(consulta: string): Atalho | null {
  const q = normalizar(consulta)
  if (q.length < 4) return null
  for (const a of ATALHOS_BUSCA) {
    for (const termo of a.termos) {
      const t = normalizar(termo)
      if (q.includes(t) || (t.includes(q) && q.length >= t.length * 0.7)) {
        return { rotulo: a.rotulo, filtro: a.filtro }
      }
    }
  }
  return null
}

/** Pesos por onde o termo casou. Nome vale muito mais que corpo do texto. */
const PESO = { nome: 100, nomeInicio: 40, sinonimo: 60, grupo: 25, resumo: 12, corpo: 4 }

function pontuar(termo: string, campos: {
  nome: string; sinonimos: string[]; grupo: string; resumo: string; corpo: string
}): number {
  const nome = normalizar(campos.nome)
  let s = 0
  if (nome === termo) s += PESO.nome * 2
  else if (nome.startsWith(termo)) s += PESO.nome + PESO.nomeInicio
  else if (nome.includes(termo)) s += PESO.nome
  if (campos.sinonimos.some(x => normalizar(x).includes(termo))) s += PESO.sinonimo
  if (normalizar(campos.grupo).includes(termo)) s += PESO.grupo
  if (normalizar(campos.resumo).includes(termo)) s += PESO.resumo
  if (campos.corpo.includes(termo)) s += PESO.corpo
  return s
}

/** Texto adicional pesquisável de um animal (já normalizado). */
function corpoAnimal(a: GuiaAnimal): string {
  return normalizar([
    a.classificacao, a.finalidade, a.regiao, a.argumento, a.processo, a.resumo_30s,
    a.explicar_cliente, a.consumo_ref,
    ...a.sistemas, ...a.fases, ...a.tipos_alimentacao, ...a.materias_comuns,
    ...a.restricoes, ...a.equipamentos,
  ].filter(Boolean).join(' '))
}

function corpoMateria(m: GuiaMateria): string {
  return normalizar([
    m.funcao, m.composicao, m.regiao, m.armazenamento, m.granulometria,
    m.compat_motivo, m.alerta, m.resumo_30s, m.explicar_cliente, m.forma_fisica,
    ...m.especies, ...m.restricoes, ...m.equipamentos, ...Object.values(m.inclusao ?? {}),
  ].filter(Boolean).join(' '))
}

export function animalParaItem(a: GuiaAnimal, nomeGrupo: string): ItemGuia {
  return {
    tipo: 'animal', slug: a.slug, nome: a.nome, resumo: a.resumo,
    emoji: a.emoji, imagem_slug: a.imagem_slug, grupo: nomeGrupo,
    status: a.status, pendente_validacao: a.pendente_validacao,
    semRetrato: a.tipo === 'categoria',
  }
}

export function materiaParaItem(m: GuiaMateria, nomeGrupo: string): ItemGuia {
  return {
    tipo: 'materia', slug: m.slug, nome: m.nome, resumo: m.resumo,
    emoji: m.emoji, imagem_slug: m.imagem_slug, grupo: nomeGrupo,
    status: m.status, pendente_validacao: m.pendente_validacao,
    nivel_risco: m.nivel_risco, compat_branorte: m.compat_branorte,
  }
}

export interface Filtros {
  especie?: Especie | null
  subgrupo?: string | null
  sistema?: string | null
  fase?: string | null
  categoria?: CategoriaMateria | null
  regiao?: string | null
  materia?: string | null
  equipamento?: string | null
  risco?: NivelRisco | null
  compat?: CompatBranorte | null
  misturador?: MisturadorIndicado | null
  propriedade?: string | null
  restritoPara?: string | null
  status?: StatusConteudo | null
  soFavoritos?: boolean
}

export const FILTROS_VAZIOS: Filtros = {}

export function temFiltro(f: Filtros): boolean {
  return Object.entries(f).some(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
}

export function filtrarAnimais(lista: GuiaAnimal[], f: Filtros, favoritos: Set<string>): GuiaAnimal[] {
  return lista.filter(a => {
    if (f.especie && a.especie !== f.especie) return false
    if (f.subgrupo && a.subgrupo !== f.subgrupo) return false
    if (f.sistema && !a.sistemas.includes(f.sistema)) return false
    if (f.fase && !a.fases.includes(f.fase)) return false
    if (f.materia && !a.materias_comuns.includes(f.materia)) return false
    if (f.equipamento && !a.equipamentos.includes(f.equipamento)) return false
    if (f.status && a.status !== f.status) return false
    if (f.regiao && !normalizar(a.regiao ?? '').includes(normalizar(f.regiao))) return false
    if (f.soFavoritos && !favoritos.has(`animal:${a.slug}`)) return false
    // Filtros que só fazem sentido em matéria-prima zeram a lista de animais.
    if (f.categoria || f.risco || f.compat || f.misturador || f.propriedade || f.restritoPara) return false
    return true
  })
}

export function filtrarMaterias(lista: GuiaMateria[], f: Filtros, favoritos: Set<string>): GuiaMateria[] {
  return lista.filter(m => {
    if (f.categoria && m.categoria !== f.categoria) return false
    if (f.risco && m.nivel_risco !== f.risco) return false
    if (f.compat && m.compat_branorte !== f.compat) return false
    if (f.misturador && m.misturador_indicado !== f.misturador) return false
    if (f.equipamento && !m.equipamentos.includes(f.equipamento)) return false
    if (f.status && m.status !== f.status) return false
    if (f.especie && !m.especies.includes(f.especie)) return false
    if (f.regiao && !normalizar(m.regiao ?? '').includes(normalizar(f.regiao))) return false
    if (f.materia && m.slug !== f.materia) return false
    if (f.propriedade && (m as unknown as Record<string, unknown>)[f.propriedade] !== true) return false
    // "não pode ir para aves" = a espécie NÃO está na lista de compatíveis.
    if (f.restritoPara && m.especies.includes(f.restritoPara)) return false
    if (f.soFavoritos && !favoritos.has(`materia:${m.slug}`)) return false
    // Filtros exclusivos de animal zeram a lista de matérias.
    if (f.subgrupo || f.sistema || f.fase) return false
    return true
  })
}

export interface ResultadoBusca {
  itens: ItemGuia[]
  atalho: Atalho | null
}

/**
 * Busca global sobre as duas coleções.
 *
 * Sem consulta: devolve tudo (já filtrado), na ordem do catálogo.
 * Com consulta: exige que TODOS os termos casem em algum campo (AND), e ordena
 * pelo score. AND porque "gado confinamento" tem que trazer confinamento de
 * gado, não tudo que fala de gado.
 */
export function buscar(
  animais: GuiaAnimal[],
  materias: GuiaMateria[],
  consulta: string,
  filtros: Filtros,
  favoritos: Set<string>,
  rotuloGrupoAnimal: (a: GuiaAnimal) => string,
  rotuloGrupoMateria: (m: GuiaMateria) => string,
): ResultadoBusca {
  const atalho = detectarAtalho(consulta)
  const f: Filtros = atalho ? { ...filtros, ...(atalho.filtro as Filtros) } : filtros

  const animaisF = filtrarAnimais(animais, f, favoritos)
  const materiasF = filtrarMaterias(materias, f, favoritos)

  // Atalho puro (ex.: "o que não entra"): o texto era a intenção, não um termo.
  const termos = atalho ? [] : tokens(consulta)

  if (termos.length === 0) {
    return {
      atalho,
      itens: [
        ...animaisF.map(a => animalParaItem(a, rotuloGrupoAnimal(a))),
        ...materiasF.map(m => materiaParaItem(m, rotuloGrupoMateria(m))),
      ],
    }
  }

  const itens: ItemGuia[] = []

  for (const a of animaisF) {
    const corpo = corpoAnimal(a)
    const grupo = rotuloGrupoAnimal(a)
    let total = 0
    const bateuTodos = termos.every(t => {
      const s = pontuar(t, {
        nome: a.nome, sinonimos: a.sinonimos, grupo, resumo: a.resumo, corpo,
      })
      total += s
      return s > 0
    })
    if (bateuTodos) itens.push({ ...animalParaItem(a, grupo), score: total })
  }

  for (const m of materiasF) {
    const corpo = corpoMateria(m)
    const grupo = rotuloGrupoMateria(m)
    let total = 0
    const bateuTodos = termos.every(t => {
      const s = pontuar(t, {
        nome: m.nome, sinonimos: m.sinonimos, grupo, resumo: m.resumo, corpo,
      })
      total += s
      return s > 0
    })
    if (bateuTodos) itens.push({ ...materiaParaItem(m, grupo), score: total })
  }

  itens.sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || x.nome.localeCompare(y.nome, 'pt-BR'))
  return { itens, atalho }
}
