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
 * FONTE (poedeiras): Embrapa Suínos e Aves — Circular Técnica 55, "Alimentos e
 * Alimentação de Galinhas Poedeiras em Sistemas Orgânicos de Produção",
 * Tabela 1. Cobre 4 fases da poedeira.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE AINDA ESTÁ VAZIO: FRANGO DE CORTE E BOVINOS
 *
 * Não achei tabela de exigência dessas duas em fonte aberta com o mesmo grau de
 * confiança. As referências existem — Rostagno (Tabelas Brasileiras para Aves e
 * Suínos, UFV) e BR-CORTE/CQBAL — mas estão atrás de paywall, e escrever "PB
 * mínima 18%" de memória citando Rostagno é exatamente o que os protocolos deste
 * projeto proíbem.
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

const FONTE_POEDEIRAS =
  'Embrapa Suínos e Aves — Circular Técnica 55, "Alimentos e Alimentação de Galinhas '
  + 'Poedeiras em Sistemas Orgânicos de Produção", Tabela 1 (linhagem Embrapa 051)'

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

  // ═══════════════════════ POEDEIRAS ═══════════════════════
  //
  // Embrapa CIT 55, Tabela 1. A própria fonte apresenta a linhagem Embrapa 051
  // "a título de exemplo" e o contexto é PRODUÇÃO ORGÂNICA — está dito no `nota`
  // de cada entrada, não escondido. Linhagem comercial convencional exige mais.
  //
  // O cálcio confirma, por outra fonte, o que `formulacoes-racao.ts` já dizia:
  // poedeira em produção precisa de 3,4%+ de cálcio. Duas fontes independentes
  // chegando no mesmo número é o tipo de coincidência que dá confiança.
  {
    especie: 'aves', categorias: ['poedeira_inicial'], nome: 'Poedeira — inicial (0 a 6 semanas)',
    fonte: FONTE_POEDEIRAS,
    nota: 'Linhagem Embrapa 051 em sistema ORGÂNICO, apresentada pela própria fonte como exemplo. Linhagem comercial convencional costuma exigir mais.',
    metas: {
      emAves: { min: 2850, max: 2900 },
      proteinaBruta: { min: 20.0, max: 20.5 },
      fibraBruta: { max: 5.0 },
      calcio: { min: 0.75, max: 0.80 },
      fosforoDisponivel: { min: 0.42 },
      sodio: { min: 0.15 },
      lisina: { min: 0.90 },
      metionina: { min: 0.35 },
      metioninaCistina: { min: 0.65 },
      triptofano: { min: 0.20 },
    },
  },
  {
    especie: 'aves', categorias: ['poedeira_crescimento'], nome: 'Poedeira — crescimento (7 a 18 semanas)',
    fonte: FONTE_POEDEIRAS,
    nota: 'Linhagem Embrapa 051 em sistema ORGÂNICO. É a fase de menor exigência do ciclo — 14% de PB contra 20% da inicial.',
    metas: {
      emAves: { min: 2700, max: 2750 },
      proteinaBruta: { min: 14.0, max: 14.5 },
      fibraBruta: { max: 5.0 },
      calcio: { min: 0.85, max: 0.90 },
      fosforoDisponivel: { min: 0.36 },
      sodio: { min: 0.15 },
      lisina: { min: 0.70 },
      metionina: { min: 0.25 },
      metioninaCistina: { min: 0.55 },
      triptofano: { min: 0.15 },
    },
  },
  {
    especie: 'aves', categorias: ['postura'], nome: 'Poedeira em produção (19 a 45 semanas)',
    fonte: FONTE_POEDEIRAS,
    nota: 'Linhagem Embrapa 051 em sistema ORGÂNICO. O CÁLCIO DÁ O SALTO AQUI: de 0,85% na recria para 3,4-3,6% — é o que forma a casca do ovo. Depois de 46 semanas a fonte sobe para 3,7-3,8% e baixa a proteína para 15,0-15,5%.',
    metas: {
      emAves: { min: 2800, max: 2850 },
      proteinaBruta: { min: 15.5, max: 16.0 },
      fibraBruta: { max: 5.0 },
      calcio: { min: 3.4, max: 3.6 },
      fosforoDisponivel: { min: 0.42 },
      sodio: { min: 0.15 },
      lisina: { min: 0.75 },
      metionina: { min: 0.32 },
      metioninaCistina: { min: 0.63 },
      triptofano: { min: 0.16 },
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
