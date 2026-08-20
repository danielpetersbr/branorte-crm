/**
 * Motor do "Monte sua fábrica": respostas do produtor → linha de equipamentos
 * Branorte, do recebimento à expedição.
 *
 * Puro de propósito — nenhuma linha aqui toca React, Supabase ou `window`. Dá
 * pra rodar no `npm test` e é o que garante que a recomendação seja auditável.
 *
 * ── As três contas que sustentam tudo ──────────────────────────────────────
 *
 * 1) DEMANDA → CAPACIDADE. A jornada é o passo que muda tudo, não o rebanho:
 *    mil toneladas por mês em 26 dias × 8 h é uma fábrica; as mesmas mil em
 *    4 dias × 4 h é outra, quatro vezes maior. Por isso o quiz pergunta dias e
 *    horas antes de sugerir qualquer máquina.
 *
 * 2) CAPACIDADE → MOINHO. Vale a REGRA-MESTRA da fábrica: produção em kg/h =
 *    CV do moinho × 100. A escada de moinhos em `linha.ts` já traz a capacidade
 *    impressa de cada BNMM; aqui só se escolhe o primeiro que atende.
 *
 * 3) MOINHO → RESTO DA LINHA. Misturador ≈ metade da produção horária (duas
 *    bateladas por hora), caçamba = tamanho da batelada, caixa de ração = um
 *    dia de produção. Esses três encaixes foram conferidos contra os códigos
 *    reais das Compactas, não inventados: 100500 pareia 1.000 kg/h com
 *    misturador de 500 kg, 1501000 pareia 1.500 com 1.000, e assim por diante.
 *
 * ── O que este motor NÃO faz ───────────────────────────────────────────────
 * Não fala de preço (página pública, ver nota em `linha.ts`), não dimensiona
 * comprimento de transportador nem altura de elevador (depende do galpão, e
 * chutar isso seria mentir com número), e não formula ração — a composição de
 * partida vem do catálogo do estudo e serve só pra saber quanto do volume é
 * milho, o que decide o silo.
 */
import { participacaoParaKgPorTonelada } from '@/lib/venda-racao/calculo'
import { CATEGORIAS, formulaPadrao } from '@/lib/venda-racao/catalogo'
import {
  CACAMBAS, CAIXAS_RACAO, COMPACTAS, ESTEIRAS_SACARIA, MISTURADOR_HORIZONTAL,
  MISTURADOR_VERTICAL, MOINHOS, PRELIMPEZA_POR_RECEPCAO, PRE_LIMPEZAS,
  RECEPCAO_POR_PORTE, SILOS_MILHO, SILOS_RACAO, degrau, ehMaster,
  type CompactaSku,
} from './linha'
import type {
  ChaveEstacao, CompactaSugerida, Dimensionamento, Especie, Estacao,
  ItemLinha, RespostasQuiz, ResultadoQuiz,
} from './tipos'

// ---------------------------------------------------------------------------
// Constantes de projeto
// ---------------------------------------------------------------------------

/**
 * Folga operacional. É o mesmo 20% que o Estudo de Viabilidade já usa como
 * `dimensionamentoPadrao.margemOperacionalPct` — trocar de número entre as duas
 * telas faria o mesmo cliente receber duas fábricas diferentes no mesmo dia.
 */
export const FOLGA_OPERACIONAL_PCT = 20

/** Semanas por mês (52/12). Ninguém trabalha "4 semanas" — trabalha 4,33. */
export const SEMANAS_POR_MES = 52 / 12

/** Meses de entressafra que um silo de safra precisa atravessar. */
export const MESES_ENTRESSAFRA = 6

/** Densidade do milho a granel, em t/m³ — dimensiona a caixa de recepção. */
export const DENSIDADE_MILHO_T_M3 = 0.75

/** Bateladas de mistura por hora. Define o tamanho do misturador. */
export const BATELADAS_POR_HORA = 2

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

function dividir(a: number, b: number): number {
  const bb = num(b)
  if (bb === 0) return 0
  const r = num(a) / bb
  return Number.isFinite(r) ? r : 0
}

/** Formata kg como o produtor lê: 1.500 kg, ou 2,5 t quando passa de mil. */
export function kg(v: number): string {
  const x = Math.round(num(v))
  if (x >= 1000) {
    const t = x / 1000
    return `${t.toLocaleString('pt-BR', { maximumFractionDigits: t < 10 ? 1 : 0 })} t`
  }
  return `${x.toLocaleString('pt-BR')} kg`
}

export function inteiro(v: number): string {
  return Math.round(num(v)).toLocaleString('pt-BR')
}

function horas(v: number): string {
  const h = Math.floor(num(v))
  const m = Math.round((num(v) - h) * 60)
  if (h <= 0) return `${m} min`
  if (m <= 0) return `${h} h`
  return `${h} h ${m} min`
}

// ---------------------------------------------------------------------------
// Consumo de referência
// ---------------------------------------------------------------------------

/**
 * kg por animal por MÊS que o catálogo do estudo sugere pra essa fase.
 *
 * Não existe corte único de cabeças pra dizer se um lead é grande: 200 bovinos
 * de confinamento dão ~60 t/mês, 200 poedeiras dão menos de uma tonelada. É por
 * isso que o quiz pergunta a fase antes do número de animais.
 */
export function consumoDeReferencia(especie: Especie | null, categoria: string): number {
  if (!especie) return 0
  return CATEGORIAS[especie]?.find(c => c.chave === categoria)?.consumoMes ?? 0
}

/**
 * Quanto da fórmula é milho, em fração (0..1). Decide o silo de grão.
 *
 * Sai da MESMA composição de partida que o Estudo de Viabilidade usa — se a
 * Embrapa tiver fórmula pra aquela fase, é a dela; senão cai no padrão da
 * espécie. Milho triturado é 100% milho, por definição.
 */
export function fracaoMilho(especie: Especie | null, categoria: string): number {
  if (!especie) return 0
  if (especie === 'milho') return 1
  const itens = formulaPadrao(especie, categoria)
  const kgPorTon = itens
    .filter(i => /milho|sorgo/i.test(i.nome))
    .reduce((s, i) => s + participacaoParaKgPorTonelada(i.participacao, i.unidadeParticipacao), 0)
  // Sem composição conhecida, 60% é o padrão de bovinos — o degrau de silo
  // erra pra cima, então subestimar aqui seria pior que superestimar.
  return kgPorTon > 0 ? Math.min(1, kgPorTon / 1000) : 0.6
}

// ---------------------------------------------------------------------------
// Dimensionamento
// ---------------------------------------------------------------------------

export function calcularDimensionamento(r: RespostasQuiz): Dimensionamento {
  const demandaMensalKg = r.modo === 'direto'
    ? Math.max(0, num(r.toneladasMes)) * 1000
    : Math.max(0, num(r.numeroAnimais)) * Math.max(0, num(r.consumoPorAnimalMes))

  const diasPorMes = Math.max(0, num(r.diasPorSemana)) * SEMANAS_POR_MES
  const horasPorDia = Math.max(0, num(r.horasPorDia))

  const producaoPorDiaKg = dividir(demandaMensalKg, diasPorMes)
  const capacidadeMinimaKgH = dividir(producaoPorDiaKg, horasPorDia)
  const capacidadeAlvoKgH = capacidadeMinimaKgH * (1 + FOLGA_OPERACIONAL_PCT / 100)

  const maior = MOINHOS[MOINHOS.length - 1]
  const moinho = MOINHOS.find(m => m.kgh >= capacidadeAlvoKgH) ?? maior
  const acimaDaLinha = capacidadeAlvoKgH > maior.kgh

  const horasReaisPorDia = dividir(producaoPorDiaKg, moinho.kgh)

  return {
    demandaMensalKg,
    diasPorMes,
    producaoPorDiaKg,
    capacidadeMinimaKgH,
    capacidadeAlvoKgH,
    capacidadeEscolhidaKgH: moinho.kgh,
    horasReaisPorDia,
    utilizacaoPct: dividir(horasReaisPorDia, horasPorDia) * 100,
    acimaDaLinha,
  }
}

// ---------------------------------------------------------------------------
// Escolha da Compacta
// ---------------------------------------------------------------------------

/**
 * Qual FAMÍLIA de Compacta o produtor pediu, sem olhar capacidade ainda.
 *
 *   01 → moinho + misturador. O básico.
 *   02 → 01 + caçamba de pesagem (a máquina pesa a fórmula sozinha).
 *   03 → industrial: 02 + caixas de ração pronta + ENSACADEIRA.
 *
 * Quem vai ensacar cai na 03 porque ela é a única linha que embarca
 * ensacadeira de fábrica — não é upsell, é onde o equipamento existe.
 */
export function familiaCompacta(r: RespostasQuiz): '01' | '02' | '03' {
  if (r.expedicao === 'ensacada' || r.expedicao === 'ambos') return '03'
  if (r.pesagemAutomatica) return '02'
  return '01'
}

/**
 * MASTER = misturador horizontal. Mistura mais rápido e mais uniforme que o
 * vertical, e é isso que importa quando o que dá a dieta é pouca coisa bem
 * distribuída: núcleo e premix de ave e suíno entram a 6–7% da fórmula, e o que
 * não misturou direito vira lote fora de especificação.
 *
 * Bovino de pasto, com mineral em proporção maior e tolerância bem mais folgada,
 * roda no vertical sem drama — e sai mais barato. A tela mostra a outra opção
 * do mesmo tamanho de qualquer jeito; quem fecha isso é o vendedor.
 */
export function preferemHorizontal(especie: Especie | null): boolean {
  return especie === 'aves' || especie === 'suinos'
}

/** Ordem de tentativa: primeiro o que ele pediu, depois o que existe. */
function linhasCandidatas(familia: '01' | '02' | '03', master: boolean): string[] {
  // Nunca desce de família: 02 → 01 tiraria a caçamba que ele pediu.
  const numeros = familia === '01' ? ['01', '02', '03']
    : familia === '02' ? ['02', '03']
    : ['03']
  const out: string[] = []
  for (const n of numeros) {
    if (master) out.push(`${n} MASTER`, n)
    else out.push(n, `${n} MASTER`)
  }
  return out
}

/**
 * Dentro de uma produção, qual misturador. Alvo = duas bateladas por hora;
 * se a linha não tiver misturador tão grande, vai no maior que ela tem (e aí a
 * fábrica roda mais bateladas por hora, que é o que a 03 de 3.000 kg/h faz com
 * seus 1.000 kg).
 */
function escolherMisturador(candidatos: CompactaSku[]): CompactaSku {
  const alvo = dividir(candidatos[0].producaoKgH, BATELADAS_POR_HORA)
  const ordenados = [...candidatos].sort((a, b) => a.misturadorKg - b.misturadorKg)
  return ordenados.find(c => c.misturadorKg >= alvo) ?? ordenados[ordenados.length - 1]
}

export function escolherCompacta(r: RespostasQuiz, d: Dimensionamento): CompactaSugerida | null {
  // Quem só tritura milho não mistura nada — não existe Compacta pra isso, é
  // moinho com transporte. Fingir uma fábrica aqui venderia o que ele não usa.
  if (r.especie === 'milho') return null

  const familia = familiaCompacta(r)
  const master = preferemHorizontal(r.especie)
  const pedida = master ? `${familia} MASTER` : familia

  for (const linha of linhasCandidatas(familia, master)) {
    const naLinha = COMPACTAS.filter(c => c.linha === linha && c.producaoKgH >= d.capacidadeAlvoKgH)
    if (!naLinha.length) continue

    const menorProducao = Math.min(...naLinha.map(c => c.producaoKgH))
    const mesmaProducao = naLinha.filter(c => c.producaoKgH === menorProducao)
    const escolhida = escolherMisturador(mesmaProducao)

    const porques: string[] = [
      `Você precisa de ${inteiro(d.capacidadeMinimaKgH)} kg/h pra dar conta da rotina que descreveu. `
      + `Com a folga de ${FOLGA_OPERACIONAL_PCT}% que toda fábrica precisa ter, o degrau é `
      + `${inteiro(escolhida.producaoKgH)} kg/h.`,
    ]
    if (linha !== pedida) {
      porques.push(
        ehMaster(linha) && !master
          ? `Nessa produção a linha ${familia} só existe com misturador horizontal (MASTER).`
          : `A linha ${pedida} não chega nessa produção — sobe pra ${linha}.`,
      )
    }

    return {
      linha,
      codigo: escolhida.codigo,
      producaoKgH: escolhida.producaoKgH,
      misturadorKg: escolhida.misturadorKg,
      caixas: escolhida.caixas,
      porque: porques.join(' '),
      alternativas: mesmaProducao
        .filter(c => c.codigo !== escolhida.codigo)
        .map(c => ({ codigo: c.codigo, misturadorKg: c.misturadorKg })),
    }
  }

  // Acima de 5.000 kg/h não existe Compacta de catálogo: é projeto montado peça
  // a peça. Devolver null é o honesto — a tela mostra a linha avulsa.
  return null
}

// ---------------------------------------------------------------------------
// Recebimento
// ---------------------------------------------------------------------------

/**
 * Que caixa de recepção o porte da operação pede.
 *
 * A moega tem que engolir UMA ENTREGA — quem manda é o veículo que encosta, não
 * o consumo do mês. Quem come 84 t de milho por mês não recebe 84 t de uma vez:
 * recebe uma carreta de cada vez, várias vezes.
 */
export function porteDeRecepcao(milhoMesTon: number) {
  const t = Math.max(0, num(milhoMesTon))
  return RECEPCAO_POR_PORTE.find(p => t <= p.ateTonMes) ?? RECEPCAO_POR_PORTE[RECEPCAO_POR_PORTE.length - 1]
}

// ---------------------------------------------------------------------------
// Estações
// ---------------------------------------------------------------------------

function item(nome: string, porque: string, quantidade = 1, aProjetar = false): ItemLinha {
  return { nome, porque, quantidade, aProjetar }
}

/**
 * A linha inteira, estação por estação. Estação sem equipamento nenhum é
 * removida no fim (quem não estoca grão não vê "Armazenagem" vazia).
 */
export function montarEstacoes(
  r: RespostasQuiz, d: Dimensionamento, compacta: CompactaSugerida | null,
): Estacao[] {
  const brutas: Array<Omit<Estacao, 'ordem'>> = []
  const soMilho = r.especie === 'milho'
  const fMilho = fracaoMilho(r.especie, r.categoria)
  const milhoMesTon = dividir(d.demandaMensalKg * fMilho, 1000)

  // ---- 1) Recebimento -----------------------------------------------------
  const recebimento: ItemLinha[] = []
  const recepcao = porteDeRecepcao(milhoMesTon)
  if (r.recebimento === 'granel' || r.recebimento === 'propria') {
    recebimento.push(item(
      `Moega com caixa de recepção ${recepcao.codigo} — ${recepcao.m3} m³`,
      `Segura cerca de ${inteiro(recepcao.m3 * DENSIDADE_MILHO_T_M3)} t de milho — uma entrega de `
      + `${recepcao.veiculo} inteira, sem o caminhão ficar parado esperando.`,
    ))
    recebimento.push(item(
      'Caixa de entrada da moega com helicoide',
      'Puxa o grão do fundo da moega e joga no transporte. É ela que evita o serviço de pá.',
    ))
  } else if (r.recebimento === 'ensacado') {
    recebimento.push(item(
      'Suporte para big bag com funil',
      'O saco fica pendurado e escoa sozinho — dispensa carregar saco no ombro até a moega.',
    ))
    recebimento.push(item(
      'Moega de descarga manual',
      'Ponto único onde o saco é aberto e o grão entra na linha.',
    ))
  }
  if (recebimento.length) {
    brutas.push({
      chave: 'recebimento',
      titulo: 'Recebimento',
      resumo: 'Onde o grão entra na propriedade e encontra a fábrica.',
      itens: recebimento,
    })
  }

  // ---- 2) Pré-limpeza -----------------------------------------------------
  // Só faz sentido pra grão solto. Saco e big bag já vêm limpos do armazém.
  if (r.recebimento === 'granel' || r.recebimento === 'propria') {
    // Ela limpa o grão NA DESCARGA, então quem manda é a vazão de recebimento.
    // Dimensionar pela moagem dava 3 t/h numa fábrica com moega de 56 t — 18
    // horas pra limpar uma carga, com o motorista parado no pátio. O piso
    // continua sendo a moagem: nunca menor que o moinho consome.
    const alvoTonH = Math.max(
      PRELIMPEZA_POR_RECEPCAO[recepcao.m3] ?? 3,
      dividir(d.capacidadeEscolhidaKgH, 1000),
    )
    const pl = PRE_LIMPEZAS.find(p => p.tonH >= alvoTonH) ?? PRE_LIMPEZAS[PRE_LIMPEZAS.length - 1]
    const horasDescarga = dividir(recepcao.m3 * DENSIDADE_MILHO_T_M3, pl.tonH)
    brutas.push({
      chave: 'prelimpeza',
      titulo: 'Pré-limpeza',
      resumo: 'Tira palha, terra e pedra antes que cheguem no moinho.',
      itens: [item(
        `Máquina de pré-limpeza ${pl.tonH.toLocaleString('pt-BR')} t/h`,
        (r.recebimento === 'propria'
          ? 'Grão que veio direto da lavoura carrega palha e torrão, e pedra quebra martelo e rasga peneira. '
          : 'Palha e terra viram desgaste de martelo e peneira entupida. ')
        + `Nessa vazão a carga de ${recepcao.veiculo} passa em cerca de ${horas(horasDescarga)}.`,
      )],
    })
  }

  // ---- 3) Armazenagem -----------------------------------------------------
  const armazenagem: ItemLinha[] = []
  if (r.estoqueGrao && r.estoqueGrao !== 'nenhum') {
    const meses = r.estoqueGrao === 'safra' ? MESES_ENTRESSAFRA : 1
    const alvoTon = milhoMesTon * meses
    const maiorSilo = SILOS_MILHO[SILOS_MILHO.length - 1]
    const silo = SILOS_MILHO.find(s => s.ton >= alvoTon) ?? maiorSilo
    // Um silo só não dá conta acima do maior degrau. Cair no maior em silêncio
    // fazia a tela AFIRMAR que 368 t atravessam uma entressafra de 503 t.
    const unidades = silo.ton >= alvoTon ? 1 : Math.ceil(dividir(alvoTon, maiorSilo.ton))
    const consumo = milhoMesTon.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    armazenagem.push(item(
      `Silo de milho ${silo.ton.toLocaleString('pt-BR')} t — funil ${silo.funil === 'PLANO' ? 'fundo plano' : `${silo.funil}°`}`,
      (meses === 1
        ? `Você gasta cerca de ${consumo} t de milho por mês. `
        : `Enche na safra e atravessa a entressafra: ~${consumo} t/mês por ${MESES_ENTRESSAFRA} meses, `
          + `${alvoTon.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t no total. `)
      + (unidades > 1
        ? `Nesse volume não cabe em um silo só — são ${unidades} baterias, e o arranjo delas sai no projeto.`
        : ''),
      unidades,
    ))
    armazenagem.push(item(
      'Elevador de caneca',
      'Sobe o grão da moega até a boca do silo. Altura e capacidade saem do desenho do galpão.',
      1, true,
    ))
    if (!soMilho) {
      // Farelo de soja forma ponte e trava no funil raso — se for guardar a
      // granel, 60° não é preferência, é requisito.
      armazenagem.push(item(
        'Farelo de soja: silo de funil 60° (se for guardar a granel)',
        'Farelo empedra e forma ponte. Em funil de 45° ou fundo plano ele trava e ninguém descarrega.',
      ))
      armazenagem.push(item(
        'Núcleo, ureia e sal mineral: sacaria',
        'Vêm ensacados de fábrica e o volume é pequeno. Silo pra eles é dinheiro parado.',
      ))
    }
  } else if (!soMilho) {
    armazenagem.push(item(
      'Sem silo — o grão vai da moega direto pro moinho',
      'Você compra conforme usa. Se um dia decidir comprar milho na safra, o silo entra depois sem refazer a fábrica.',
    ))
  }
  if (armazenagem.length) {
    brutas.push({
      chave: 'armazenagem',
      titulo: 'Armazenagem de matéria-prima',
      resumo: 'Onde o grão espera até a hora de moer.',
      itens: armazenagem,
    })
  }

  // ---- 4) Moagem ----------------------------------------------------------
  const moinho = MOINHOS.find(m => m.kgh === d.capacidadeEscolhidaKgH) ?? MOINHOS[MOINHOS.length - 1]
  brutas.push({
    chave: 'moagem',
    titulo: 'Moagem',
    resumo: 'O moinho é quem manda na produção da fábrica inteira.',
    itens: [
      item(
        `Moinho de martelo ${moinho.codigo} — ${inteiro(moinho.kgh)} kg/h (${moinho.cv.toLocaleString('pt-BR')} CV)`,
        `Roda a sua produção do dia em ${horas(d.horasReaisPorDia)}, dentro das `
        + `${inteiro(num(r.horasPorDia))} h que você disse ter.`,
      ),
      item(
        'Jogo de peneiras',
        'A peneira define a granulometria. Trocar de peneira é trocar a textura da ração sem trocar de máquina.',
      ),
    ],
  })

  // ---- 5) Dosagem ---------------------------------------------------------
  if (!soMilho) {
    const bateladaKg = compacta?.misturadorKg ?? degrau(MISTURADOR_VERTICAL, dividir(d.capacidadeEscolhidaKgH, BATELADAS_POR_HORA))
    if (r.pesagemAutomatica) {
      const cacamba = degrau(CACAMBAS, bateladaKg)
      brutas.push({
        chave: 'dosagem',
        titulo: 'Dosagem e pesagem',
        resumo: 'A máquina pesa cada ingrediente antes de mandar pro misturador.',
        itens: [
          item(
            `Caçamba de pesagem ${inteiro(cacamba)} kg`,
            `Pesa a batelada inteira de ${kg(bateladaKg)} de uma vez. Fórmula errada é prejuízo que não aparece na nota.`,
          ),
          item(
            'Balança eletrônica com célula de carga',
            'É ela que lê o peso da caçamba. Vai à parte da caçamba no orçamento.',
          ),
        ],
      })
    } else {
      brutas.push({
        chave: 'dosagem',
        titulo: 'Dosagem e pesagem',
        resumo: 'Você pesa os ingredientes e joga no misturador.',
        itens: [item(
          'Balança de plataforma',
          'Funciona bem com poucos ingredientes. Se um dia a fórmula complicar, a caçamba de pesagem entra depois.',
        )],
      })
    }
  }

  // ---- 6) Mistura ---------------------------------------------------------
  if (!soMilho) {
    const bateladaKg = compacta?.misturadorKg ?? degrau(MISTURADOR_VERTICAL, dividir(d.capacidadeEscolhidaKgH, BATELADAS_POR_HORA))
    const horizontal = compacta ? ehMaster(compacta.linha) : preferemHorizontal(r.especie)
    const h = MISTURADOR_HORIZONTAL.find(m => m.kg >= bateladaKg) ?? MISTURADOR_HORIZONTAL[MISTURADOR_HORIZONTAL.length - 1]
    const v = degrau(MISTURADOR_VERTICAL, bateladaKg)

    const itens: ItemLinha[] = horizontal
      ? [item(
          `Misturador horizontal ${inteiro(h.litros)} L (carga de ${kg(h.kg)})`,
          'Mistura mais rápido e mais parelho. É o que a sua criação pede: o núcleo entra em pouca '
          + 'quantidade e tem que chegar igual em todo o lote.',
        )]
      : [item(
          `Misturador vertical ${inteiro(v)} kg`,
          `Dá conta de ${BATELADAS_POR_HORA} bateladas por hora, que é o ritmo do moinho que você vai ter.`,
        )]

    itens.push(horizontal
      ? item(`Também existe em vertical de ${inteiro(v)} kg`, 'Sai mais em conta; mistura mais devagar. O vendedor te mostra a diferença.')
      : item(`Também existe em horizontal de ${inteiro(h.litros)} L`, 'Mistura mais rápido e mais uniforme — é a versão MASTER da linha.'))

    brutas.push({
      chave: 'mistura',
      titulo: 'Mistura',
      resumo: 'Onde o milho moído vira ração de verdade.',
      itens,
    })
  }

  // ---- 7) Ração pronta ----------------------------------------------------
  const pronta: ItemLinha[] = []
  if (compacta?.caixas.length) {
    // A 03 já embarca as caixas — repetir outra medida aqui contradiria o
    // próprio código do produto que a tela acabou de mostrar.
    // O nome NÃO repete a contagem: a tela já imprime o "2×" do `quantidade`.
    // Escrito nos dois lugares, saía "2×2 caixas de 4 t".
    const cx = compacta.caixas
    pronta.push(item(
      `Caixa de ração pronta ${kg(cx[0])}`,
      `Já vêm com a ${compacta.linha}. Uma enche enquanto a outra ensaca — a fábrica não para.`,
      cx.length,
    ))
  } else {
    const alvo = d.producaoPorDiaKg
    const maiorCaixa = CAIXAS_RACAO[CAIXAS_RACAO.length - 1]
    if (alvo > maiorCaixa) {
      // Regra do dono: passou de ~5–6 t de ração pronta, é silo, não caixa.
      const s = SILOS_RACAO.find(x => x * 1000 >= alvo) ?? SILOS_RACAO[SILOS_RACAO.length - 1]
      pronta.push(item(
        `Silo de ração ${s.toLocaleString('pt-BR')} t — funil 60°`,
        `Você produz ${kg(alvo)} por dia. Acima de ${kg(maiorCaixa)} de ração pronta a indicação é silo, `
        + 'não caixa. E ração pronta só desce em funil de 60°.',
      ))
    } else {
      const cx = degrau(CAIXAS_RACAO, alvo)
      pronta.push(item(
        `Caixa de ração pronta ${kg(cx)}`,
        `Guarda a produção de um dia (${kg(alvo)}) sem você ter que ensacar na mesma hora.`,
      ))
    }
  }
  brutas.push({
    chave: 'racao_pronta',
    titulo: 'Ração pronta',
    resumo: 'Um pulmão entre a mistura e a saída — é ele que desacopla o ritmo dos dois.',
    itens: pronta,
  })

  // ---- 8) Expedição -------------------------------------------------------
  const expedicao: ItemLinha[] = []
  if (r.expedicao === 'ensacada' || r.expedicao === 'ambos') {
    expedicao.push(item(
      'Ensacadeira de saco aberto com painel',
      'Enche e libera o saco no ponto. É o único jeito de ensacar sem parar a fábrica.',
    ))
    const esteira = d.producaoPorDiaKg > 4000 ? ESTEIRAS_SACARIA[1] : ESTEIRAS_SACARIA[0]
    expedicao.push(item(
      `Esteira transportadora de sacaria ${esteira.toLocaleString('pt-BR')} m`,
      'Leva o saco cheio da ensacadeira até a pilha ou a carroceria, sem carregar no braço.',
    ))
  }
  if (r.expedicao === 'granel' || r.expedicao === 'ambos') {
    expedicao.push(item(
      'Descarga a granel direto no vagão ou na carreta',
      'A ração cai da caixa pro vagão forrageiro e vai pro cocho. Zero saco, zero embalagem.',
    ))
    expedicao.push(item(
      'Rosca de descarga',
      'Diâmetro e comprimento saem do desenho: depende de onde o veículo encosta.',
      1, true,
    ))
  }
  if (expedicao.length) {
    brutas.push({
      chave: 'expedicao',
      titulo: 'Expedição',
      resumo: 'Como a ração sai da fábrica e chega no animal.',
      itens: expedicao,
    })
  }

  // ---- 9) Apoio -----------------------------------------------------------
  const apoio: ItemLinha[] = [
    item(
      compacta ? `Painel elétrico da linha ${compacta.linha}` : 'Painel elétrico',
      'Comanda e protege todos os motores. Vai sempre junto com a fábrica.',
    ),
    item(
      'Transportadores helicoidais (chupim e calha)',
      'São eles que ligam uma estação na outra. Quantos, de que diâmetro e de que comprimento '
      + 'depende de como as máquinas ficam no galpão — sai no projeto.',
      1, true,
    ),
  ]
  if (d.producaoPorDiaKg > 4000 || (r.estoqueGrao && r.estoqueGrao !== 'nenhum')) {
    apoio.push(item(
      'Passarela com guarda-corpo',
      'Acesso seguro pra manutenção em cima dos silos e das calhas.',
      1, true,
    ))
  }
  brutas.push({
    chave: 'apoio',
    titulo: 'O que liga tudo',
    resumo: 'Sem isto as estações são máquinas soltas, não uma fábrica.',
    itens: apoio,
  })

  // Numeração: só as estações do processo entram no fluxo. "O que liga tudo"
  // não é uma parada do grão, é infraestrutura — recebe ordem 0.
  let n = 0
  return brutas.map(e => ({
    ...e,
    ordem: e.chave === 'apoio' ? 0 : ++n,
  })) as Estacao[]
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export function montarAlertas(r: RespostasQuiz, d: Dimensionamento): string[] {
  const a: string[] = []

  if (d.acimaDaLinha) {
    a.push(
      `A rotina que você descreveu pede ${inteiro(d.capacidadeAlvoKgH)} kg/h — acima do maior moinho `
      + 'de catálogo. Dá pra fazer, mas vira projeto sob medida: nossa engenharia desenha com você.',
    )
  }

  if (d.utilizacaoPct > 0 && d.utilizacaoPct < 20 && !d.acimaDaLinha) {
    a.push(
      `Nessa configuração a fábrica trabalharia só ${horas(d.horasReaisPorDia)} dos `
      + `${inteiro(num(r.horasPorDia))} h que você reservou (${Math.round(d.utilizacaoPct)}% do tempo). `
      + 'Sobra máquina — vale conversar sobre um degrau menor rodando mais tempo, ou já dimensionar '
      + 'pensando em crescer.',
    )
  }

  if (d.horasReaisPorDia > num(r.horasPorDia)) {
    a.push(
      `Pra produzir ${kg(d.producaoPorDiaKg)} por dia esta fábrica precisa de `
      + `${horas(d.horasReaisPorDia)} — mais que as ${inteiro(num(r.horasPorDia))} h que você tem. `
      + 'Ou sobe um degrau de máquina, ou espalha a produção em mais dias.',
    )
  }

  const moinho = MOINHOS.find(m => m.kgh === d.capacidadeEscolhidaKgH)
  if (r.energia === 'monofasico' && moinho && moinho.cv > 15) {
    a.push(
      `Moinho de ${moinho.cv.toLocaleString('pt-BR')} CV não roda em monofásico — acima de 15 CV só existe `
      + 'trifásico. Antes de fechar a fábrica é preciso ver a entrada de energia da propriedade com a concessionária.',
    )
  }

  if (r.recebimento === 'propria') {
    a.push(
      'Grão colhido na propriedade precisa estar seco antes de moer (perto de 14% de umidade). '
      + 'A fábrica de ração não seca o grão — a secagem é uma etapa antes, fora desta linha.',
    )
  }

  if (r.modo === 'animais' && r.especie && r.especie !== 'milho') {
    const ref = consumoDeReferencia(r.especie, r.categoria)
    if (ref > 0 && Math.abs(num(r.consumoPorAnimalMes) - ref) < 0.001) {
      a.push(
        'O consumo por animal usado aqui é o valor de referência do nosso catálogo, não o do seu rebanho. '
        + 'O consumo real muda com peso, genética, fase e manejo — o vendedor confirma isso com você antes '
        + 'de qualquer proposta.',
      )
    }
  }

  return a
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/** O que ainda falta responder pra fechar a recomendação. */
export function faltando(r: RespostasQuiz): string[] {
  const f: string[] = []
  if (!r.especie) f.push('o que você produz')
  if (r.modo === 'animais' ? num(r.numeroAnimais) <= 0 : num(r.toneladasMes) <= 0) {
    f.push('quanto de ração você usa')
  }
  if (r.modo === 'animais' && num(r.consumoPorAnimalMes) <= 0) f.push('o consumo por animal')
  if (num(r.diasPorSemana) <= 0 || num(r.horasPorDia) <= 0) f.push('quantos dias e horas você quer trabalhar')
  if (!r.recebimento) f.push('como o milho chega na propriedade')
  if (!r.estoqueGrao) f.push('se você vai estocar grão')
  if (!r.expedicao) f.push('como a ração sai da fábrica')
  if (r.pesagemAutomatica === null) f.push('se você quer pesagem automática')
  return f
}

const VAZIO: Dimensionamento = {
  demandaMensalKg: 0, diasPorMes: 0, producaoPorDiaKg: 0,
  capacidadeMinimaKgH: 0, capacidadeAlvoKgH: 0, capacidadeEscolhidaKgH: 0,
  horasReaisPorDia: 0, utilizacaoPct: 0, acimaDaLinha: false,
}

export function calcularQuiz(r: RespostasQuiz): ResultadoQuiz {
  // Fora de escopo curto-circuita tudo: a Branorte só faz ração FARELADA, não
  // fabrica peletizadora nem extrusora, e peixe exige extrusão. Descobrir isto
  // aqui poupa o produtor de uma conversa que não ia dar em nada.
  if (r.foraDeEscopo) {
    return {
      completo: false, faltando: [], foraDeEscopo: r.foraDeEscopo,
      dimensionamento: VAZIO, estacoes: [], compacta: null, alertas: [],
    }
  }

  const pendencias = faltando(r)
  const dimensionamento = calcularDimensionamento(r)

  if (pendencias.length || dimensionamento.demandaMensalKg <= 0) {
    return {
      completo: false, faltando: pendencias, foraDeEscopo: null,
      dimensionamento, estacoes: [], compacta: null, alertas: [],
    }
  }

  const compacta = escolherCompacta(r, dimensionamento)
  return {
    completo: true,
    faltando: [],
    foraDeEscopo: null,
    dimensionamento,
    compacta,
    estacoes: montarEstacoes(r, dimensionamento, compacta),
    alertas: montarAlertas(r, dimensionamento),
  }
}

/** Estado inicial do quiz. Jornada nasce no padrão do estudo (26 dias × 4 h). */
export function respostasIniciais(): RespostasQuiz {
  return {
    especie: null,
    categoria: '',
    foraDeEscopo: null,
    modo: 'animais',
    numeroAnimais: 0,
    consumoPorAnimalMes: 0,
    toneladasMes: 0,
    diasPorSemana: 6,
    horasPorDia: 4,
    recebimento: null,
    estoqueGrao: null,
    expedicao: null,
    pesagemAutomatica: null,
    energia: null,
    nome: '',
    telefone: '',
    cidade: '',
    uf: '',
  }
}

/** Ordem das estações no fluxo — usada pela tela e pelos testes. */
export const ORDEM_ESTACOES: ChaveEstacao[] = [
  'recebimento', 'prelimpeza', 'armazenagem', 'moagem',
  'dosagem', 'mistura', 'racao_pronta', 'expedicao', 'apoio',
]
