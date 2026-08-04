// DIMENSIONAMENTO DE FÁBRICA DE RAÇÃO
//
// O caminho que o vendedor percorre na cabeça, virado em conta. Ditado pelo
// Daniel em 2026-08-04, na ordem em que ele pensa:
//
//   1. quanto de ração o cliente consome por mês
//   2. quanto ele QUER trabalhar ("três dias na semana, quatro horas por dia")
//   3. → daí sai a produção por HORA que a fábrica precisa ter
//   4. margem a mais, se ele quiser folga
//   5. da formulação sai o % de cada matéria-prima → capacidade dos silos
//   6. o que chega a granel e o que chega ensacado
//
// O PASSO 2 É O QUE MUDA TUDO e costuma ficar escondido: dois clientes com o
// MESMO rebanho compram máquinas diferentes por causa da jornada. Por isso é
// pergunta na tela, não constante no código.
//
// O catálogo entra por PARÂMETRO (não por import do banco) pra este arquivo
// continuar puro e testável — e porque preço e modelo mudam, então a verdade é a
// tabela `precos_branorte`, nunca uma lista copiada aqui.

/** Semanas por mês. 52/12 — não 4, que perde ~8% do ano. */
export const SEMANAS_MES = 52 / 12

export interface Jornada {
  diasPorSemana: number
  horasPorDia: number
  /** Folga pedida pelo cliente, em % sobre a produção necessária. */
  margemPct?: number
}

export interface Producao {
  horasPorMes: number
  /** Sem a margem — o que o consumo exige. */
  kgHoraBase: number
  /** Com a margem — o que a máquina tem que entregar. */
  kgHoraNecessaria: number
  margemPct: number
}

/**
 * Passo 3 do método: consumo + jornada → kg/h.
 *
 * Devolve `null` quando a jornada não fecha (0 dia ou 0 hora): melhor não
 * responder do que dividir por zero e mostrar Infinity como se fosse máquina.
 */
export function producaoNecessaria(
  consumoMensalKg: number,
  j: Jornada,
): Producao | null {
  const horasPorMes = j.diasPorSemana * SEMANAS_MES * j.horasPorDia
  if (!Number.isFinite(horasPorMes) || horasPorMes <= 0) return null
  if (!Number.isFinite(consumoMensalKg) || consumoMensalKg <= 0) return null

  const base = consumoMensalKg / horasPorMes
  const margemPct = Math.max(0, j.margemPct ?? 0)
  return {
    horasPorMes,
    kgHoraBase: base,
    kgHoraNecessaria: base * (1 + margemPct / 100),
    margemPct,
  }
}

// ── catálogo (o que vem de precos_branorte) ──────────────────────────────────

export interface ItemCatalogo {
  id?: number | string
  modelo: string | null
  /** Texto cru da coluna: "5000KG/H", "42.47 ton", "75 M³", "1300". */
  capacidade: string | null
  categoria: string | null
  subcategoria: string | null
  funilTipo: string | null
  motorCv: number | null
  valor: number | null
}

/**
 * Lê o número da coluna `capacidade`, que é TEXTO livre e mistura unidade:
 * "5000KG/H", "42.47 ton", "75 M³", "1300" (kg, sem unidade). Devolve sempre em
 * KG pra poder comparar — sem isso, 42.47 (toneladas) pareceria menor que 1300.
 */
export function capacidadeEmKg(texto: string | null): number | null {
  if (!texto) return null
  const m = texto.replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const t = texto.toLowerCase()
  if (t.includes('ton')) return n * 1000
  if (t.includes('m³') || t.includes('m3')) return null   // volume não vira massa sem densidade
  return n                                                 // kg ou kg/h
}

/** Menor moinho que ENTREGA a produção pedida. */
export function escolherMoinho(kgHora: number, catalogo: ItemCatalogo[]): ItemCatalogo | null {
  const moinhos = catalogo
    .filter(i => (i.categoria ?? '').toUpperCase() === 'MOINHO')
    .map(i => ({ i, kgh: capacidadeEmKg(i.capacidade) }))
    .filter((x): x is { i: ItemCatalogo; kgh: number } => x.kgh != null && x.kgh > 0)
    .sort((a, b) => a.kgh - b.kgh)

  // A REGRA-MESTRA "produção = CV × 100" é regra de bolso e DIVERGE do catálogo
  // em vários modelos (BNMM130 são 7,5 CV pra 300 kg/h; BNMM315 são 20 CV pra
  // 1.700). Quem manda é a coluna `capacidade`.
  return moinhos.find(x => x.kgh >= kgHora)?.i ?? null
}

// ── matérias-primas: silo, granel, ou sacaria ────────────────────────────────

export type Recebimento = 'granel' | 'ensacado'

export interface NecessidadeMateria {
  nome: string
  participacaoPct: number
  /** Quanto entra por mês, em kg. */
  kgPorMes: number
  /** Quanto precisa ficar guardado, pelos dias de estoque pedidos. */
  kgEstocar: number
  recebimento: Recebimento
  /** Silo indicado, ou null quando vai pra sacaria / não há silo que sirva. */
  silo: ItemCatalogo | null
  /** Quantos silos desse modelo. */
  quantidadeSilos: number
  /**
   * Combinação de silos MENORES que atende o mesmo volume com menos sobra.
   * Existe porque "o menor que cabe sozinho" às vezes é absurdo: pra 45 t de
   * milho o catálogo pula de 42,47 t direto pra 196,5 t — 4× o necessário.
   * Dois de 28 t resolvem. Quem decide é o vendedor; a conta mostra as duas.
   */
  alternativa: { silo: ItemCatalogo; quantidade: number } | null
  /** Por que caiu nessa recomendação — vai pra tela, não é log. */
  observacao: string | null
}

/**
 * Produto industrializado chega em SACO e fica na sacaria. Dimensionar silo pra
 * núcleo é erro clássico: o volume é pequeno e o produto não é a granel.
 * Regra do dono, 2026-06-10.
 */
const SEMPRE_ENSACADO = /n[úu]cleo|premix|ur[ée]ia|sal\s|sal$|mineral|aditivo|adsorvente|metionina|lisina|colina|antioxidante|anticocc/i

/**
 * Farelo de soja EMPEDRA e forma ponte no silo — exige funil de 60°. Indicar
 * 45° ou fundo plano pra farelo trava o escoamento na fábrica do cliente.
 * Regra do dono, confirmada na coluna `funil_tipo`.
 */
const EXIGE_FUNIL_60 = /farelo\s+de\s+soja|farelo\s+de\s+algod[ãa]o|farelo\s+de\s+trigo/i

export function exigeFunil60(nome: string): boolean {
  return EXIGE_FUNIL_60.test(nome)
}

export function vaiParaSacaria(nome: string): boolean {
  return SEMPRE_ENSACADO.test(nome)
}

/** Silos de matéria-prima que servem pra este ingrediente, do menor pro maior. */
function silosServiveis(nome: string, catalogo: ItemCatalogo[]) {
  const so60 = exigeFunil60(nome)
  return catalogo
    .filter(i => (i.categoria ?? '').toUpperCase() === 'SILO'
              && (i.subcategoria ?? '').toUpperCase() === 'MILHO')
    .filter(i => !so60 || String(i.funilTipo ?? '') === '60')
    .map(i => ({ i, kg: capacidadeEmKg(i.capacidade) }))
    .filter((x): x is { i: ItemCatalogo; kg: number } => x.kg != null && x.kg > 0)
    .sort((a, b) => a.kg - b.kg)
}

export interface EntradaFormula {
  nome: string
  participacaoPct: number
}

/**
 * Passo 5 e 6: da formulação sai quanto entra de cada matéria-prima, e daí a
 * capacidade de silo. `diasEstoque` é quantos dias de produção o cliente quer
 * guardar (safra costuma pedir muito mais que compra mensal).
 */
export function necessidadesDeMateria(
  formula: EntradaFormula[],
  consumoMensalKg: number,
  diasEstoque: number,
  catalogo: ItemCatalogo[],
  recebimentoPorNome: Record<string, Recebimento> = {},
): NecessidadeMateria[] {
  const porDia = consumoMensalKg / 30

  return formula.map(f => {
    const kgPorMes = consumoMensalKg * (f.participacaoPct / 100)
    const kgEstocar = porDia * (f.participacaoPct / 100) * Math.max(1, diasEstoque)
    const sacaria = vaiParaSacaria(f.nome)
    const recebimento: Recebimento =
      recebimentoPorNome[f.nome] ?? (sacaria ? 'ensacado' : 'granel')

    if (sacaria || recebimento === 'ensacado') {
      return {
        nome: f.nome, participacaoPct: f.participacaoPct, kgPorMes, kgEstocar,
        recebimento, silo: null, quantidadeSilos: 0, alternativa: null,
        observacao: sacaria
          ? 'Produto industrializado — chega ensacado e fica na sacaria. Não entra silo.'
          : 'Marcado como ensacado — fica na sacaria.',
      }
    }

    const opcoes = silosServiveis(f.nome, catalogo)
    if (!opcoes.length) {
      return {
        nome: f.nome, participacaoPct: f.participacaoPct, kgPorMes, kgEstocar,
        recebimento, silo: null, quantidadeSilos: 0, alternativa: null,
        observacao: exigeFunil60(f.nome)
          ? 'Precisa de funil 60° (empedra) e não há silo 60° no catálogo pra esse volume. Falar com a fábrica.'
          : 'Não achei silo pra esse volume no catálogo.',
      }
    }

    const nota60 = exigeFunil60(f.nome)
      ? 'Funil 60° obrigatório: o produto empedra e forma ponte.' : null

    // Um silo que dê conta sozinho costuma ser melhor que vários pequenos.
    const unico = opcoes.find(o => o.kg >= kgEstocar)
    if (unico) {
      // ...mas nem sempre: o catálogo tem degraus enormes. Quando o único que
      // cabe passa de 1,8× o necessário, mostra também a combinação de menores
      // que chega mais perto — sem escolher pelo vendedor.
      let alternativa: { silo: ItemCatalogo; quantidade: number } | null = null
      if (unico.kg > kgEstocar * 1.8) {
        const menores = opcoes.filter(o => o.kg < unico.kg)
        const cand = menores[menores.length - 1]
        if (cand) {
          const qtd = Math.ceil(kgEstocar / cand.kg)
          // Mais de 4 silos deixa de ser economia e vira obra.
          if (qtd > 1 && qtd <= 4 && cand.kg * qtd < unico.kg) {
            alternativa = { silo: cand.i, quantidade: qtd }
          }
        }
      }
      return {
        nome: f.nome, participacaoPct: f.participacaoPct, kgPorMes, kgEstocar,
        recebimento, silo: unico.i, quantidadeSilos: 1, alternativa,
        observacao: alternativa
          ? [nota60, `Sobra muita capacidade: ${alternativa.quantidade}× o de `
              + `${alternativa.silo.capacidade} chega mais perto.`]
              .filter(Boolean).join(' ')
          : nota60,
      }
    }
    const maior = opcoes[opcoes.length - 1]
    return {
      nome: f.nome, participacaoPct: f.participacaoPct, kgPorMes, kgEstocar,
      recebimento, silo: maior.i, alternativa: null,
      quantidadeSilos: Math.ceil(kgEstocar / maior.kg),
      observacao: `Nenhum silo isolado dá conta: ${Math.ceil(kgEstocar / maior.kg)}× o maior do catálogo.`,
    }
  })
}

// ── ração pronta: caixa ou silo ──────────────────────────────────────────────

export interface ArmazenagemPronta {
  kgArmazenar: number
  tipo: 'caixa' | 'silo_racao'
  item: ItemCatalogo | null
  quantidade: number
  observacao: string
}

/**
 * Regra do dono (2026-06-10): as caixas PADRÃO são 2, 4 e 5 t. Acima de 5 t de
 * ração pronta, indicar SILO DE RAÇÃO (todos funil 60°), não caixa.
 */
export const LIMITE_CAIXA_KG = 5000

export function armazenagemRacaoPronta(
  kgArmazenar: number,
  catalogo: ItemCatalogo[],
): ArmazenagemPronta {
  if (kgArmazenar <= LIMITE_CAIXA_KG) {
    const caixas = catalogo
      .filter(i => (i.categoria ?? '').toUpperCase() === 'CAIXA'
                && (i.subcategoria ?? '').toUpperCase() === 'PICADOS')
      .map(i => ({ i, kg: capacidadeEmKg(i.capacidade) }))
      .filter((x): x is { i: ItemCatalogo; kg: number } => x.kg != null && x.kg > 0)
      .sort((a, b) => a.kg - b.kg)
    const escolha = caixas.find(c => c.kg >= kgArmazenar) ?? null
    return {
      kgArmazenar, tipo: 'caixa', item: escolha?.i ?? null, quantidade: escolha ? 1 : 0,
      observacao: 'Até 5 t de ração pronta o padrão é caixa.',
    }
  }

  const silos = catalogo
    .filter(i => (i.categoria ?? '').toUpperCase() === 'SILO'
              && (i.subcategoria ?? '').toUpperCase() === 'RACAO')
    .map(i => ({ i, kg: capacidadeEmKg(i.capacidade) }))
    .filter((x): x is { i: ItemCatalogo; kg: number } => x.kg != null && x.kg > 0)
    .sort((a, b) => a.kg - b.kg)
  const unico = silos.find(s => s.kg >= kgArmazenar)
  if (unico) {
    return {
      kgArmazenar, tipo: 'silo_racao', item: unico.i, quantidade: 1,
      observacao: 'Acima de 5 t de ração pronta é silo de ração (funil 60°), não caixa.',
    }
  }
  const maior = silos[silos.length - 1]
  return {
    kgArmazenar, tipo: 'silo_racao', item: maior?.i ?? null,
    quantidade: maior ? Math.ceil(kgArmazenar / maior.kg) : 0,
    observacao: 'Acima de 5 t é silo de ração. Volume grande: mais de um silo.',
  }
}

// ── expedição ────────────────────────────────────────────────────────────────

export type Expedicao = 'ensacada' | 'granel' | 'bag'

export const EXPEDICAO_INFO: Record<Expedicao, { rotulo: string; precisa: string }> = {
  ensacada: { rotulo: 'Ensacada', precisa: 'Ensacadeira (saco aberto, com painel) + esteira de sacaria' },
  granel:   { rotulo: 'A granel', precisa: 'Silo de ração + descarga (sem ensaque)' },
  bag:      { rotulo: 'Big bag',  precisa: 'Suporte de bag + transportador de enchimento' },
}

// ── o pacote inteiro ─────────────────────────────────────────────────────────

export interface EntradaDimensionamento {
  consumoMensalKg: number
  jornada: Jornada
  formula: EntradaFormula[]
  diasEstoqueMateria: number
  /** Quanto de ração PRONTA o cliente quer guardar (kg). */
  kgRacaoPronta: number
  expedicao: Expedicao[]
  recebimentoPorNome?: Record<string, Recebimento>
}

export interface Dimensionamento {
  producao: Producao | null
  moinho: ItemCatalogo | null
  materias: NecessidadeMateria[]
  racaoPronta: ArmazenagemPronta
  expedicao: Expedicao[]
  /** O que impede de fechar equipamento. Vazio = dá pra orçar. */
  pendencias: string[]
}

export function dimensionar(e: EntradaDimensionamento, catalogo: ItemCatalogo[]): Dimensionamento {
  const producao = producaoNecessaria(e.consumoMensalKg, e.jornada)
  const moinho = producao ? escolherMoinho(producao.kgHoraNecessaria, catalogo) : null
  const materias = necessidadesDeMateria(
    e.formula, e.consumoMensalKg, e.diasEstoqueMateria, catalogo, e.recebimentoPorNome,
  )
  const racaoPronta = armazenagemRacaoPronta(e.kgRacaoPronta, catalogo)

  // Pendência é o que FALTA pra fechar, dito na língua do vendedor — não erro
  // de sistema. Enquanto tiver pendência, o número na tela é ponto de partida
  // de conversa, não orçamento.
  const pendencias: string[] = []
  if (!e.consumoMensalKg) pendencias.push('Falta o consumo mensal de ração do cliente.')
  if (!e.jornada.diasPorSemana || !e.jornada.horasPorDia) {
    pendencias.push('Falta saber quantos dias e quantas horas por dia ele quer trabalhar.')
  }
  if (!e.formula.length) pendencias.push('Falta a formulação — sem ela não dá pra dimensionar silo.')
  if (producao && !moinho) {
    pendencias.push(
      `A produção pedida (${Math.round(producao.kgHoraNecessaria)} kg/h) passa do maior moinho do catálogo. ` +
      'Falar com a fábrica.',
    )
  }
  if (!e.expedicao.length) pendencias.push('Falta definir a expedição: ensacada, granel ou big bag.')
  for (const m of materias) {
    if (!m.silo && m.recebimento === 'granel') pendencias.push(`${m.nome}: ${m.observacao}`)
  }
  return { producao, moinho, materias, racaoPronta, expedicao: e.expedicao, pendencias }
}
