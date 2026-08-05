/**
 * ANÁLISE NUTRICIONAL DA FÓRMULA — o que esta mistura entrega ao animal.
 *
 * Funções PURAS, sem React e sem Supabase, no mesmo padrão de
 * `lib/venda-racao/calculo.ts`. Entra a lista de ingredientes com percentual,
 * sai o perfil da mistura, o status contra a exigência da fase e a lista do que
 * não deu pra calcular.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA CENTRAL DESTE ARQUIVO: COBERTURA PARCIAL
 *
 * A conta é uma média ponderada trivial:
 *     nutriente da fórmula = Σ (participação_i / 100 × nutriente_i)
 *
 * A armadilha não é a conta, é o que fazer quando FALTA dado. Numa fórmula com
 * 70% de milho (cadastrado) e 30% de núcleo (sem composição), a soma da proteína
 * dá 5,55%. Escrever "5,55% de PB" na tela é MENTIRA — o correto é "pelo menos
 * 5,55%, com 70% da fórmula analisada".
 *
 * E a assimetria que decide o semáforo:
 *
 *   MÍNIMO  — cobertura parcial ainda permite APROVAR. Se o que eu conheço já
 *             entrega 18% de proteína, o resto da fórmula só pode somar. Dá pra
 *             afirmar "atende o mínimo" com segurança.
 *   MÁXIMO  — cobertura parcial NUNCA permite aprovar. O que falta pode ser
 *             justamente o que estoura o teto.
 *
 * Por isso `avaliar()` trata mínimo e máximo de formas diferentes de propósito.
 * Tratar os dois igual daria verde em fórmula que ninguém verificou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BASE MUDA CONFORME O NUTRIENTE
 *
 * Percentual (proteína, cálcio…) sai em MATÉRIA NATURAL: é a base em que a ração
 * é misturada e a mesma das exigências do BIPERS. Ponderar por participação
 * direto está certo.
 *
 * NDT é, por definição da tabela de ruminante, % da MATÉRIA SECA. Ponderar NDT
 * pela participação em matéria natural dá número errado sempre que os
 * ingredientes têm umidades diferentes. Aqui ele é ponderado pela MASSA DE
 * MATÉRIA SECA que cada ingrediente traz — que é o que a definição pede.
 */
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import {
  NUTRIENTES, lerNutriente, type ChaveNutriente, type Valor,
} from './tipos'
import { acharIngrediente, semComposicao, type IngredienteNutricional } from './ingredientes'
import { exigenciaDe, type ExigenciaNutricional, type Meta } from './exigencias'
import { verificarSeguranca, temBloqueio, type AlertaSeguranca } from './seguranca'

export type StatusNutriente =
  /** Dentro da faixa. */
  | 'ok'
  /** Dentro, mas a menos de 5% da borda — vale olhar. */
  | 'limite'
  /** Fora da faixa, com certeza. */
  | 'fora'
  /** Falta composição de parte da fórmula: não dá pra concluir. */
  | 'incompleto'
  /** Não há exigência cadastrada pra esta espécie/fase. */
  | 'sem_meta'

export interface LinhaNutriente {
  chave: ChaveNutriente
  rotulo: string
  unidade: '%' | 'kcal/kg'
  casas: number
  grupo: string
  /** Valor da fórmula. `null` quando NENHUM ingrediente tinha o dado. */
  valor: Valor
  meta: Meta | null
  status: StatusNutriente
  /** % da fórmula cujo ingrediente tinha este nutriente cadastrado. */
  coberturaPct: number
  /** Nomes dos ingredientes que não tinham este dado. */
  faltando: string[]
  /** Explicação curta do status, pronta pra tela. */
  observacao?: string
}

export interface AnaliseFormula {
  /** Só os nutrientes que fazem sentido pra espécie. */
  linhas: LinhaNutriente[]
  alertas: AlertaSeguranca[]
  /** true quando há ingrediente proibido pra espécie. */
  bloqueada: boolean
  exigencia: ExigenciaNutricional | null
  /**
   * % da fórmula com composição DE VERDADE — ingrediente no banco E com perfil
   * preenchido.
   *
   * Não é "% reconhecido": ureia e núcleo estão cadastrados (é assim que a
   * camada de segurança os enxerga) mas têm perfil vazio. Contá-los aqui dava
   * "100% da fórmula tem composição cadastrada" numa tela em que todo nutriente
   * mostrava 21% — divergência que só apareceu dirigindo a tela de verdade.
   */
  coberturaGeralPct: number
  /** % da fórmula cujo ingrediente o banco ao menos reconhece. */
  reconhecidoPct: number
  /** Ingredientes da fórmula que o banco não conhece. */
  naoCadastrados: string[]
  /** Ingredientes conhecidos, mas sem nenhum nutriente cadastrado. */
  semComposicao: string[]
  /** Matéria seca da mistura, %. `null` quando nenhum ingrediente tem o dado. */
  materiaSecaPct: Valor
  /** % da fórmula com matéria seca conhecida — o `materiaSecaPct` só vale com isto. */
  coberturaMateriaSecaPct: number
  /** true quando dá pra dizer alguma coisa. Fórmula vazia devolve false. */
  aplicavel: boolean
}

/** Participação em % da fórmula, seja qual for a unidade digitada. */
function pctDe(i: IngredienteFormula): number {
  const v = Number(i.participacao)
  if (!Number.isFinite(v) || v <= 0) return 0
  if (i.unidadeParticipacao === 'pct') return v
  if (i.unidadeParticipacao === 'kg_t') return v / 10
  return v / 10000 // g_t
}

interface ItemResolvido {
  nome: string
  pct: number
  ing: IngredienteNutricional | null
}

/**
 * Soma ponderada de um nutriente.
 *
 * Devolve o total e a cobertura — quanto da fórmula, em pontos percentuais,
 * tinha aquele dado. Sem a cobertura o total é um número solto que não dá pra
 * interpretar.
 */
function somar(itens: ItemResolvido[], chave: ChaveNutriente): {
  valor: Valor; cobertura: number; faltando: string[]
} {
  let total = 0
  let cobertura = 0
  let algum = false
  const faltando: string[] = []

  for (const it of itens) {
    if (it.pct <= 0) continue
    const v = it.ing ? lerNutriente(it.ing.perfil, chave, 'MN') : null
    if (v == null) { faltando.push(it.nome); continue }
    total += (it.pct / 100) * v
    cobertura += it.pct
    algum = true
  }
  return { valor: algum ? total : null, cobertura, faltando }
}

/**
 * NDT da mistura, em % da matéria seca.
 *
 * Ponderado pela MASSA DE MATÉRIA SECA de cada ingrediente, não pela
 * participação em matéria natural — é o que a definição de NDT exige. Ignorar
 * isso erra pouco quando todos os ingredientes são secos e erra muito assim que
 * entra um úmido.
 */
function somarNdt(itens: ItemResolvido[]): {
  valor: Valor; cobertura: number; faltando: string[]
} {
  let numerador = 0
  let massaMs = 0
  let coberturaMn = 0
  let algum = false
  const faltando: string[] = []

  for (const it of itens) {
    if (it.pct <= 0) continue
    const ndt = it.ing?.perfil.ndt ?? null
    const ms = it.ing?.perfil.materiaSeca ?? null
    if (ndt == null || ms == null) { faltando.push(it.nome); continue }
    const kgMs = (it.pct / 100) * (ms / 100)
    numerador += kgMs * ndt
    massaMs += kgMs
    coberturaMn += it.pct
    algum = true
  }
  if (!algum || massaMs <= 0) return { valor: null, cobertura: 0, faltando }
  return { valor: numerador / massaMs, cobertura: coberturaMn, faltando }
}

/** Quanta folga da borda ainda conta como "no limite" (amarelo). */
const MARGEM_AMARELO = 0.05

/**
 * Decide o semáforo de um nutriente.
 *
 * A regra de cobertura parcial está explicada no cabeçalho do arquivo e é o
 * ponto mais fácil de errar: mínimo pode ser aprovado com cobertura parcial,
 * máximo não pode.
 */
function avaliar(
  valor: Valor, meta: Meta | null, cobertura: number,
): { status: StatusNutriente; observacao?: string } {
  if (!meta || (meta.min == null && meta.max == null)) {
    return {
      status: 'sem_meta',
      observacao: valor == null ? undefined : 'Sem meta cadastrada para esta espécie e fase.',
    }
  }
  if (valor == null) {
    return { status: 'incompleto', observacao: 'Nenhum ingrediente da fórmula tem este dado cadastrado.' }
  }

  const completa = cobertura >= 99.99
  const faltou = Math.max(0, 100 - cobertura)

  /**
   * Folga numérica ao comparar com a borda.
   *
   * Sem isto, uma fórmula que o otimizador deixou EXATAMENTE no piso (é o que um
   * solver de custo mínimo faz — ele para na restrição) aparecia como "fora"
   * aqui, porque o arredondamento da participação para 4 casas empurrava o
   * último dígito pra baixo. Discordância entre dois módulos do mesmo sistema
   * sobre a mesma fórmula, por 2×10⁻⁵ de cálcio.
   *
   * A folga é RELATIVA ao alvo porque o erro também é: ele nasce do
   * arredondamento da participação, amplificado pelo teor do ingrediente.
   *
   * 1×10⁻⁵ do alvo = 0,001%. Em cálcio de terminação isso é 0,000005 ponto
   * percentual — nenhum nutricionista chamaria de diferença. E é 5.000 vezes
   * menor que a faixa do amarelo (5%), então nada que esteja de fato apertado
   * passa despercebido.
   */
  const eps = (alvo: number) => Math.max(1e-9, Math.abs(alvo) * 1e-5)

  // ── mínimo ──────────────────────────────────────────────────────────────
  if (meta.min != null && valor < meta.min - eps(meta.min)) {
    if (!completa) {
      return {
        status: 'incompleto',
        observacao:
          `Abaixo do mínimo de ${meta.min} considerando só os ${cobertura.toFixed(1)}% da fórmula que `
          + `têm este dado. Os ${faltou.toFixed(1)}% restantes podem cobrir a diferença — não dá pra `
          + 'afirmar que está deficiente.',
      }
    }
    return {
      status: 'fora',
      observacao: `Abaixo do mínimo de ${meta.min}. Faltam ${(meta.min - valor).toFixed(3)}.`,
    }
  }

  // ── máximo ──────────────────────────────────────────────────────────────
  if (meta.max != null && valor > meta.max + eps(meta.max)) {
    // Passou do teto SÓ com o que se conhece: o que falta só somaria. Certeza.
    return {
      status: 'fora',
      observacao: `Acima do máximo de ${meta.max}. Excedeu em ${(valor - meta.max).toFixed(3)}.`,
    }
  }
  if (meta.max != null && !completa) {
    return {
      status: 'incompleto',
      observacao:
        `Dentro do teto de ${meta.max} considerando ${cobertura.toFixed(1)}% da fórmula. Os `
        + `${faltou.toFixed(1)}% sem composição podem estourar o limite — teto só pode ser aprovado `
        + 'com a fórmula inteira analisada.',
    }
  }

  // ── dentro ──────────────────────────────────────────────────────────────
  const perto = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * MARGEM_AMARELO
  if ((meta.min != null && perto(valor, meta.min)) || (meta.max != null && perto(valor, meta.max))) {
    return {
      status: 'limite',
      observacao: completa
        ? 'Dentro da faixa, mas a menos de 5% da borda.'
        : `Dentro da faixa e a menos de 5% da borda, considerando ${cobertura.toFixed(1)}% da fórmula.`,
    }
  }
  if (!completa) {
    return {
      status: 'ok',
      observacao:
        `Atende o mínimo já com os ${cobertura.toFixed(1)}% analisados — o resto da fórmula só pode somar.`,
    }
  }
  return { status: 'ok' }
}

/**
 * Analisa a fórmula inteira.
 *
 * `categoria` é a chave do catálogo (ex.: 'terminacao'). Sem exigência
 * cadastrada pra espécie/fase, as linhas saem com status 'sem_meta' e o valor
 * calculado — que já é útil sozinho: o vendedor vê a proteína da fórmula mesmo
 * sem meta pra comparar.
 */
export function analisarFormula(
  itens: IngredienteFormula[], especie: Especie, categoria: string,
): AnaliseFormula {
  const resolvidos: ItemResolvido[] = itens
    .map(i => ({ nome: (i.nome || '').trim(), pct: pctDe(i), ing: acharIngrediente(i.nome || '') }))
    .filter(r => r.nome && r.pct > 0)

  const exigencia = exigenciaDe(especie, categoria)
  const alertas = verificarSeguranca(itens, especie)

  const naoCadastrados = [...new Set(resolvidos.filter(r => !r.ing).map(r => r.nome))]
  // "Sem composição" = NENHUM nutriente cadastrado. Não dá pra testar só a
  // matéria seca: núcleo com garantia de rótulo traz cálcio e fósforo e não traz
  // MS — tem composição parcial, e parcial não é nenhuma.
  const semComposicaoLista = [...new Set(
    resolvidos.filter(r => r.ing && semComposicao(r.ing)).map(r => r.ing!.nome),
  )]
  const totalPct = resolvidos.reduce((s, r) => s + r.pct, 0)
  const pctReconhecido = resolvidos.filter(r => r.ing).reduce((s, r) => s + r.pct, 0)
  const pctComPerfil = resolvidos
    .filter(r => r.ing && !semComposicao(r.ing))
    .reduce((s, r) => s + r.pct, 0)

  const linhas: LinhaNutriente[] = NUTRIENTES
    // `Especie` inclui 'milho' (produto sem animal), que nenhuma linha declara —
    // por isso a comparação é por string em vez do include tipado.
    .filter(d => !d.especies?.length || (d.especies as string[]).includes(especie))
    .map(d => {
      const { valor, cobertura, faltando } = d.chave === 'ndt'
        ? somarNdt(resolvidos)
        : somar(resolvidos, d.chave)
      const meta = exigencia?.metas[d.chave] ?? null
      const { status, observacao } = avaliar(valor, meta, cobertura)
      return {
        chave: d.chave, rotulo: d.rotulo, unidade: d.unidade, casas: d.casas, grupo: d.grupo,
        valor, meta, status, coberturaPct: cobertura,
        faltando: [...new Set(faltando)], observacao,
      }
    })

  // Matéria seca da mistura — mesma ponderação simples dos percentuais, porque
  // MS já é medida sobre a matéria natural.
  let msTotal = 0
  let msCobertura = 0
  let temMs = false
  for (const r of resolvidos) {
    const ms = r.ing?.perfil.materiaSeca ?? null
    if (ms == null) continue
    msTotal += (r.pct / 100) * ms
    msCobertura += r.pct
    temMs = true
  }

  return {
    linhas,
    alertas,
    bloqueada: temBloqueio(alertas),
    exigencia,
    coberturaGeralPct: totalPct > 0 ? (pctComPerfil / totalPct) * 100 : 0,
    reconhecidoPct: totalPct > 0 ? (pctReconhecido / totalPct) * 100 : 0,
    naoCadastrados,
    semComposicao: semComposicaoLista,
    materiaSecaPct: temMs ? msTotal : null,
    coberturaMateriaSecaPct: msCobertura,
    aplicavel: resolvidos.length > 0,
  }
}

/** Só as linhas que têm algo pra dizer — tira o ruído de nutriente sem dado nenhum. */
export function linhasComConteudo(a: AnaliseFormula): LinhaNutriente[] {
  return a.linhas.filter(l => l.valor != null || l.meta != null)
}

/**
 * Resumo de uma linha só, pro cabeçalho do painel.
 * Conta o que está fora, o que está no limite e o que não deu pra concluir.
 */
export function resumo(a: AnaliseFormula): { fora: number; limite: number; incompleto: number; ok: number } {
  const c = { fora: 0, limite: 0, incompleto: 0, ok: 0 }
  for (const l of linhasComConteudo(a)) {
    if (l.status === 'fora') c.fora++
    else if (l.status === 'limite') c.limite++
    else if (l.status === 'incompleto') c.incompleto++
    else if (l.status === 'ok') c.ok++
  }
  return c
}
