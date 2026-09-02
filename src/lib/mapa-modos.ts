/**
 * Modos de visualização do mapa de visitas.
 *
 * São ORTOGONAIS aos filtros: trocar entre "Só orçados" e "Vendidos" não muda o
 * modo, e trocar o modo não muda o que está filtrado.
 *
 *   estado — 1 cor por UF, bolinha. É o padrão: mostra a distribuição geográfica
 *            sem afirmar nada sobre idade ou valor.
 *   idade  — cor pela idade do orçamento, bolinha. Quatro faixas.
 *   valor  — o modo antigo: ⭐ ≥100 mil, 💎 ≥300 mil, cor pela idade (3 faixas).
 */

export type ModoMapa = 'estado' | 'idade' | 'valor' | 'etiqueta'

export const MODOS: [ModoMapa, string, string][] = [
  ['estado', '🗺️ Por estado', 'Uma cor por estado. Bolinhas iguais, sem destaque de valor.'],
  ['idade', '⏱️ Por idade', 'Cor pela idade do orçamento: até 1 mês, 1–3 meses, até 1 ano, mais de 1 ano.'],
  ['valor', '⭐ Por valor', 'Destaca o valor orçado: estrela ≥100 mil, diamante ≥300 mil.'],
  // 01/09/2026 — cor pela etiqueta do WhatsApp (a principal da conversa). É o
  // modo que faz a legenda virar "todas as etiquetas" e cada linha dela, filtro.
  ['etiqueta', '🏷️ Por etiqueta', 'Cor pela etiqueta do WhatsApp do cliente. Sem conversa sincronizada = cinza claro; com conversa e sem etiqueta = cinza escuro.'],
]

// ─────────────────────────────────────────────────────────────────────────────
// CORES POR ESTADO
//
// Não são 27 cores. Nenhuma paleta categórica distingue 27 hues — acima de ~8 o
// olho não separa e a cor vira ruído. Num mapa isso nem é preciso: a POSIÇÃO já
// diz qual é o estado. O que precisa contrastar é estado VIZINHO de vizinho.
//
// Isso é coloração de mapa, e o grafo dos estados brasileiros é planar: 4 cores
// bastam (verificado — nenhum par de vizinhos divide cor). As 4 saem da paleta
// validada, nos slots blue/yellow/magenta/green, e passam todos os pares nos dois
// temas (CVD e visão normal). Trocar por "27 cores bonitas" quebra os dois.
// ─────────────────────────────────────────────────────────────────────────────

/** Grupo de cor de cada UF — vizinhos nunca caem no mesmo grupo. */
export const GRUPO_COR_UF: Record<string, 0 | 1 | 2 | 3> = {
  AC: 0, AP: 0, BA: 0, CE: 0, DF: 0, MA: 0, MT: 0, RR: 0, SC: 0, SP: 0,
  MG: 1, PA: 1, PE: 1, PR: 1, RN: 1, RO: 1, RS: 1, SE: 1,
  AL: 2, AM: 2, ES: 2, GO: 2, PB: 2, PI: 2,
  MS: 3, RJ: 3, TO: 3,
}

const UF_CLARO = ['#2a78d6', '#eda100', '#e87ba4', '#008300'] as const
const UF_ESCURO = ['#3987e5', '#c98500', '#d55181', '#008300'] as const

/** Cinza para quem não tem UF conhecida — ausência de dado não ganha cor de dado. */
export const UF_SEM_ESTADO_CLARO = '#9ca3af'
export const UF_SEM_ESTADO_ESCURO = '#8b8f98'

export function corDoEstado(uf: string | null | undefined, escuro: boolean): string {
  const u = (uf || '').trim().toUpperCase()
  const g = GRUPO_COR_UF[u]
  if (g === undefined) return escuro ? UF_SEM_ESTADO_ESCURO : UF_SEM_ESTADO_CLARO
  return (escuro ? UF_ESCURO : UF_CLARO)[g]
}

// ─────────────────────────────────────────────────────────────────────────────
// FAIXAS DE IDADE (modo "por idade")
//
// O modo antigo tinha 3 faixas e jogava tudo acima de 3 meses em cinza. Com o
// acervo de 2012 em diante isso virou um bloco só: 3 mil pinos cinza. A quarta
// faixa separa "velho mas do ano" de "muito velho".
// ─────────────────────────────────────────────────────────────────────────────

export type FaixaIdade4 = 'ate1mes' | 'ate3meses' | 'ate1ano' | 'mais1ano' | 'sem-data'

export const FAIXAS_IDADE4: { id: FaixaIdade4; rotulo: string; maxDias: number | null }[] = [
  { id: 'ate1mes', rotulo: 'Até 1 mês', maxDias: 30 },
  { id: 'ate3meses', rotulo: '1 a 3 meses', maxDias: 90 },
  { id: 'ate1ano', rotulo: '3 meses a 1 ano', maxDias: 365 },
  { id: 'mais1ano', rotulo: 'Mais de 1 ano', maxDias: null },
]

const COR_FAIXA4_CLARO: Record<FaixaIdade4, string> = {
  ate1mes: '#22c55e',      // verde — mesmo do modo antigo
  ate3meses: '#ef4444',    // vermelho — mesmo do modo antigo
  ate1ano: '#f97316',      // laranja — a faixa nova
  mais1ano: '#9ca3af',     // cinza
  'sem-data': '#9ca3af',
}
const COR_FAIXA4_ESCURO: Record<FaixaIdade4, string> = {
  ate1mes: '#22c55e',
  ate3meses: '#ef4444',
  ate1ano: '#fb8b3c',
  mais1ano: '#8b8f98',
  'sem-data': '#8b8f98',
}

export function faixaIdade4(dias: number | null): FaixaIdade4 {
  if (dias == null) return 'sem-data'
  if (dias <= 30) return 'ate1mes'
  if (dias <= 90) return 'ate3meses'
  if (dias <= 365) return 'ate1ano'
  return 'mais1ano'
}

export function corDaFaixa4(f: FaixaIdade4, escuro: boolean): string {
  return (escuro ? COR_FAIXA4_ESCURO : COR_FAIXA4_CLARO)[f]
}

export function rotuloFaixa4(f: FaixaIdade4): string {
  return FAIXAS_IDADE4.find(x => x.id === f)?.rotulo ?? 'Sem data'
}
