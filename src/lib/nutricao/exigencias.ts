/**
 * EXIGÊNCIAS NUTRICIONAIS — o que a fórmula precisa ENTREGAR, por fase.
 *
 * É a outra metade do painel: `ingredientes.ts` diz o que cada matéria-prima
 * TEM, isto diz o que o animal PRECISA. Sem os dois, o semáforo não existe —
 * saber que a fórmula tem 13% de proteína não vale nada sem saber se 13% serve
 * pra fase em questão.
 *
 * FONTE ÚNICA (suínos): Embrapa Suínos e Aves / EMATER-RS — BIPERS nº 12
 * (dez/1999), Tabelas 28 a 32, "Limites de nutrientes", que por sua vez citam
 * Ludke et al. (1997). São tabelas de MÍNIMO e MÁXIMO — exatamente o formato que
 * o painel precisa, e não uma média que teria de ser interpretada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE AVES E BOVINOS ESTÃO VAZIOS
 *
 * Não achei tabela de exigência de ave nem de bovino em fonte aberta com o mesmo
 * grau de confiança. As referências existem — Rostagno (Tabelas Brasileiras para
 * Aves e Suínos, UFV) e BR-CORTE/CQBAL — mas estão atrás de paywall, e escrever
 * "PB mínima 18%" de memória citando Rostagno é exatamente o que os protocolos
 * deste projeto proíbem.
 *
 * O painel trata a ausência como ausência: mostra o valor CALCULADO da fórmula
 * (que depende só do banco de ingredientes, e esse existe pras três espécies) e
 * diz que não há meta cadastrada, em vez de pintar de verde por falta de
 * critério. Verde sem meta seria pior que cinza — daria a impressão de aprovado.
 *
 * Quando as tabelas entrarem, só este arquivo muda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NÍVEL NUTRICIONAL
 *
 * A fonte publica cada fase em mais de um nível ("Alto", "Normal", e em algumas
 * fases "Alto p/ castrados" e "Alto p/ fêmeas"). Aqui está o **Normal**, que é o
 * de uso geral. Os outros níveis não foram cadastrados ainda; a diferença entre
 * eles é real (lisina de terminação vai de 0,60% no Normal a 0,69% no Alto para
 * castrados), então usar Normal como se fosse único é uma simplificação — está
 * declarada no `nota` de cada entrada em vez de escondida.
 */
import type { Especie } from '@/lib/venda-racao/tipos'
import type { ChaveNutriente } from './tipos'

/** Faixa aceitável de um nutriente. Ausência de `min` ou `max` = sem limite daquele lado. */
export interface Meta {
  min?: number
  max?: number
}

export interface ExigenciaNutricional {
  especie: Especie
  /** Chaves de categoria (catalogo.ts) que usam esta exigência. */
  categorias: string[]
  nome: string
  /** Instituição + ano. Sem isto, não entra. */
  fonte: string
  nota?: string
  metas: Partial<Record<ChaveNutriente, Meta>>
}

/**
 * Tabelas 28 a 32 do BIPERS 12, nível "Normal".
 *
 * Percentuais em MATÉRIA NATURAL — é a base em que a ração é misturada e a
 * mesma base do banco de ingredientes de monogástrico. Comparar direto é válido.
 */
const FONTE_SUINOS =
  'Embrapa Suínos e Aves / EMATER-RS — BIPERS nº 12 (dez/1999), Tabelas 28 a 32, '
  + '"Limites de nutrientes" (fonte primária: Ludke et al., 1997), nível nutricional Normal'

export const EXIGENCIAS: ExigenciaNutricional[] = [
  {
    especie: 'suinos', categorias: ['pre_inicial'], nome: 'Pré-inicial',
    fonte: FONTE_SUINOS,
    nota: 'Pós-desmame. É a ração mais exigente e mais cara do ciclo — 1,15% de lisina contra 0,60% da terminação.',
    metas: {
      emSuinos: { min: 3300, max: 3400 },
      proteinaBruta: { min: 17.00, max: 21.00 },
      fibraBruta: { max: 4.00 },
      calcio: { min: 0.80, max: 0.90 },
      fosforo: { min: 0.70 },
      fosforoDisponivel: { min: 0.400 },
      sodio: { min: 0.15, max: 0.35 },
      lisina: { min: 1.15 },
      metionina: { min: 0.29 },
      metioninaCistina: { min: 0.58 },
      treonina: { min: 0.75 },
      triptofano: { min: 0.21 },
    },
  },
  {
    especie: 'suinos', categorias: ['inicial'], nome: 'Inicial (creche)',
    fonte: FONTE_SUINOS,
    metas: {
      emSuinos: { min: 3250, max: 3350 },
      proteinaBruta: { min: 17.00, max: 19.00 },
      fibraBruta: { max: 4.00 },
      calcio: { min: 0.75, max: 0.85 },
      fosforo: { min: 0.60 },
      fosforoDisponivel: { min: 0.32 },
      sodio: { min: 0.15, max: 0.35 },
      lisina: { min: 0.95 },
      metionina: { min: 0.27 },
      metioninaCistina: { min: 0.54 },
      treonina: { min: 0.62 },
      triptofano: { min: 0.17 },
    },
  },
  {
    especie: 'suinos', categorias: ['crescimento'], nome: 'Crescimento',
    fonte: FONTE_SUINOS,
    nota: 'A fonte separa "Alto p/ castrados" (lisina 0,80%) e "Alto p/ fêmeas" (0,90%). Aqui está o Normal.',
    metas: {
      emSuinos: { min: 3250, max: 3350 },
      proteinaBruta: { min: 14.50, max: 16.00 },
      fibraBruta: { max: 4.00 },
      calcio: { min: 0.60, max: 0.70 },
      fosforo: { min: 0.50 },
      fosforoDisponivel: { min: 0.23 },
      sodio: { min: 0.15 },
      lisina: { min: 0.75 },
      metionina: { min: 0.23 },
      metioninaCistina: { min: 0.46 },
      treonina: { min: 0.50 },
      triptofano: { min: 0.13 },
    },
  },
  {
    especie: 'suinos', categorias: ['terminacao'], nome: 'Terminação',
    fonte: FONTE_SUINOS,
    nota: 'A fase que mais pesa no custo total — é onde o animal come mais. A fonte separa castrados (lisina 0,69%) e fêmeas (0,74%); aqui está o Normal.',
    metas: {
      emSuinos: { min: 3200, max: 3350 },
      proteinaBruta: { min: 13.00, max: 14.50 },
      fibraBruta: { max: 4.00 },
      calcio: { min: 0.50, max: 0.60 },
      fosforo: { min: 0.40 },
      fosforoDisponivel: { min: 0.15 },
      sodio: { min: 0.15 },
      lisina: { min: 0.60 },
      metionina: { min: 0.18 },
      metioninaCistina: { min: 0.39 },
      treonina: { min: 0.42 },
      triptofano: { min: 0.11 },
    },
  },
  {
    especie: 'suinos', categorias: ['gestacao'], nome: 'Matriz em gestação',
    fonte: FONTE_SUINOS,
    nota: 'Energia bem mais baixa (2.800 kcal) porque a matriz é arraçoada RESTRITA — engordar a porca prenha prejudica o parto.',
    metas: {
      emSuinos: { min: 2800, max: 2900 },
      proteinaBruta: { min: 12.00, max: 14.00 },
      calcio: { min: 0.64, max: 0.74 },
      fosforo: { min: 0.53 },
      fosforoDisponivel: { min: 0.28 },
      sodio: { min: 0.17 },
      lisina: { min: 0.54 },
      metionina: { min: 0.16 },
      metioninaCistina: { min: 0.31 },
      treonina: { min: 0.35 },
      triptofano: { min: 0.10 },
    },
  },
  {
    especie: 'suinos', categorias: ['lactacao'], nome: 'Matriz em lactação',
    fonte: FONTE_SUINOS,
    nota: 'Pico de consumo e o maior cálcio do ciclo (0,88%) — a porca está produzindo leite. A fonte tem ainda um nível "Intermediário".',
    metas: {
      emSuinos: { min: 3250, max: 3350 },
      proteinaBruta: { min: 14.50, max: 16.00 },
      calcio: { min: 0.88, max: 1.00 },
      fosforo: { min: 0.58 },
      fosforoDisponivel: { min: 0.39 },
      sodio: { min: 0.19 },
      lisina: { min: 0.72 },
      metionina: { min: 0.20 },
      metioninaCistina: { min: 0.40 },
      treonina: { min: 0.50 },
      triptofano: { min: 0.14 },
    },
  },
  {
    especie: 'suinos', categorias: ['reprodutores'], nome: 'Reposição / reprodutores',
    fonte: FONTE_SUINOS,
    nota: 'A fonte publica esta fase junto com gestação (Tabela 31), num nível único.',
    metas: {
      emSuinos: { min: 3150, max: 3300 },
      proteinaBruta: { min: 15.00, max: 17.00 },
      calcio: { min: 0.80, max: 0.90 },
      fosforo: { min: 0.60 },
      fosforoDisponivel: { min: 0.35 },
      sodio: { min: 0.15 },
      lisina: { min: 0.80 },
      metionina: { min: 0.24 },
      metioninaCistina: { min: 0.52 },
      treonina: { min: 0.56 },
      triptofano: { min: 0.15 },
    },
  },
]

/**
 * A exigência que vale pra esta espécie e categoria, ou `null`.
 *
 * `null` NÃO é erro — é o estado normal de aves e bovinos hoje. Quem consome
 * precisa tratar isso como "sem meta cadastrada" e mostrar cinza, nunca verde.
 */
export function exigenciaDe(especie: Especie, categoria: string): ExigenciaNutricional | null {
  return EXIGENCIAS.find(e => e.especie === especie && e.categorias.includes(categoria)) ?? null
}

/** Espécies que já têm alguma exigência cadastrada. Alimenta o aviso da tela. */
export function especiesComExigencia(): Especie[] {
  return [...new Set(EXIGENCIAS.map(e => e.especie))]
}
