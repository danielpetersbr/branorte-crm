/**
 * Construção e migração do estado do formulário do estudo.
 *
 * `novoEstudo` monta um input completo a partir dos defaults da empresa — é o
 * que a página usa ao abrir e ao trocar de produto. `normalizarInput` garante
 * que um estudo salvo há meses (ou uma simulação do antigo módulo de
 * precificação) volte a abrir sem quebrar.
 */
import {
  CATEGORIAS, CONFIG_PADRAO, ESPECIES, formulaPadrao, mesclarConfig, normalizarStatus,
} from './catalogo'
import { emDiasISO, hojeISO } from './formato'
import type {
  AjusteCenario, ConfigEstudo, CustoOpcional, Especie, EstudoInput, FasePlantel,
  IngredienteFormula, Necessidade,
} from './tipos'

export function categoriaPadrao(especie: Especie): string {
  return CATEGORIAS[especie]?.[0]?.chave ?? 'outro'
}

/** kg/animal/mês de REFERÊNCIA da fase. Nunca é verdade sobre o cliente. */
export function consumoSugerido(especie: Especie, categoria: string): number {
  return CATEGORIAS[especie]?.find(c => c.chave === categoria)?.consumoMes ?? 0
}

/**
 * Consumo de referência do catálogo JÁ na unidade que o estudo está usando.
 *
 * O catálogo é sempre kg/MÊS. Entregar esse número cru numa tela configurada em
 * "kg por dia" é o erro de 30x: 2,7 kg/mês de frango inicial vira "2,7 kg por
 * ave por dia" e o estudo dimensiona uma fábrica que o cliente não precisa.
 */
export function consumoSugeridoNaBase(
  especie: Especie,
  categoria: string,
  base: 'mes' | 'dia' | 'ciclo',
  dias: number,
): number {
  return converterConsumo(consumoSugerido(especie, categoria), 'mes', base, dias)
}

/**
 * Converte um consumo por animal de uma base pra outra.
 *
 * ⚠️ ISTO FALTAVA, e era o defeito mais caro da tela. O catálogo dá o consumo
 * em kg/MÊS (2,7 kg/mês de frango inicial = ~90 g por ave por dia, que confere
 * com a realidade). Mas ao trocar "Unidade do consumo" para "kg por dia" o
 * campo continuava com 2,7 — passando a significar 2,7 kg por ave POR DIA.
 *
 * Medido com o caso real do Daniel: 15.000 aves davam **1.665 t/mês** em vez
 * de 55,5 t/mês. Trinta vezes maior. Um estudo assim dimensiona (e orça) uma
 * fábrica absurdamente fora do que o cliente precisa.
 *
 * `dias` é a duração do ciclo, usada só quando alguma ponta é 'ciclo'.
 */
export function converterConsumo(
  valor: number,
  de: 'mes' | 'dia' | 'ciclo',
  para: 'mes' | 'dia' | 'ciclo',
  dias: number,
): number {
  if (de === para) return valor
  const v = Number(valor) || 0
  if (v <= 0) return v
  const d = Number(dias) > 0 ? Number(dias) : 30

  // normaliza pra kg/dia e volta pra base de destino
  const porDia = de === 'dia' ? v : de === 'mes' ? v / 30 : v / d
  const fim = para === 'dia' ? porDia : para === 'mes' ? porDia * 30 : porDia * d

  // 3 casas: é a precisão que o campo mostra. Sem arredondar, trocar a unidade
  // ida e volta acumulava dízima e o número "andava" sozinho.
  return Math.round(fim * 1000) / 1000
}

export function novoEstudo(
  configBruta: Partial<ConfigEstudo> | null | undefined,
  especie: Especie = 'bovinos',
  vendedorNome = '',
): EstudoInput {
  const cfg = mesclarConfig(configBruta ?? CONFIG_PADRAO)
  const categoria = categoriaPadrao(especie)
  const semAnimais = ESPECIES.find(e => e.chave === especie)?.semAnimais === true

  return {
    identificacao: {
      clienteNome: '', clienteEmpresa: '', clienteCidade: '', clienteUf: '',
      clienteTelefone: '', vendedorNome,
      data: hojeISO(),
      validade: emDiasISO(cfg.validadeDias),
      observacoesInternas: '',
    },
    produto: { especie, categoria, categoriaLivre: '' },
    necessidade: {
      modo: semAnimais ? 'direto' : 'animais',
      numeroAnimais: 0,
      consumoPorAnimal: consumoSugerido(especie, categoria),
      baseConsumo: 'mes',
      dias: 30,
      consumoConfirmado: false,
      margemSegurancaPct: 0,
      quantidadeInformada: 0,
      unidadeQuantidade: 'kg',
      periodoQuantidade: 'mes',
      pesoSaco: cfg.pesoSacoPadrao,
    },
    atual: {
      modo: 'compra',
      preco: 0,
      unidadePreco: 'saco',
      pesoSacoCompra: cfg.pesoSacoPadrao,
      frete: { ativo: false, valor: 0 },
      descarga: { ativo: false, valor: 0 },
      outros: { ativo: false, valor: 0 },
      perdasPct: 0,
      custoManualPorKg: 0,
      observacoes: '',
    },
    formula: {
      formulaId: null,
      nome: '',
      itens: formulaPadrao(especie, categoria),
      milhoPreco: 1.08,
      milhoUnidadePreco: 'kg',
      milhoPesoSaca: 60,
    },
    custos: {
      ...cfg.custosPadrao,
      custosFixosMensais: { ativo: false, valor: 0 },
    },
    dimensionamento: { ...cfg.dimensionamentoPadrao },
    investimento: {
      equipamentos: 0, frete: 0, montagem: 0,
      instalacaoEletrica: 0, obraCivil: 0, outros: 0,
      modoFinanciamento: 'sem',
      custoFinanceiroInformado: 0,
    },
    cenarios: cfg.cenarios,
    status: 'rascunho',
  }
}

/**
 * Troca de produto preservando o que o vendedor já digitou de cliente, cenário
 * atual e investimento — só o que é específico da espécie é resetado.
 */
export function trocarEspecie(
  atual: EstudoInput, especie: Especie, cfgBruta: Partial<ConfigEstudo> | null | undefined,
): EstudoInput {
  // Clicar no card da espécie JÁ selecionada não é troca — e antes daqui esse
  // clique-à-toa resetava a fórmula pra `formulaPadrao()` e desmarcava o consumo
  // confirmado. O vendedor perdia ingredientes que tinha digitado sem entender
  // por quê. Trocar de verdade continua zerando, que é o certo: fórmula de aves
  // não serve pra bovinos.
  if (atual.produto.especie === especie) return atual

  mesclarConfig(cfgBruta ?? CONFIG_PADRAO)
  const categoria = categoriaPadrao(especie)
  const semAnimais = ESPECIES.find(e => e.chave === especie)?.semAnimais === true

  return {
    ...atual,
    produto: { especie, categoria, categoriaLivre: '' },
    necessidade: {
      ...atual.necessidade,
      modo: semAnimais ? 'direto' : atual.necessidade.modo,
      consumoPorAnimal: consumoSugerido(especie, categoria),
      // o consumo voltou a ser referência de catálogo: precisa ser reconfirmado
      consumoConfirmado: false,
      // fase de aves não existe em bovinos: o plantel por fase morre junto
      fases: [],
    },
    formula: {
      ...atual.formula, formulaId: null, nome: '', porFase: undefined,
      itens: formulaPadrao(especie, categoria),
    },
  }
}

// ---------------------------------------------------------------------------
// Fases (ciclo completo / mais de uma fase)
// ---------------------------------------------------------------------------

/**
 * Aplica a seleção de fases da etapa do produto em TODO o input.
 *
 * Cada fase marcada ganha sua linha de plantel — matriz, creche e terminação não
 * comem igual, então somar plantel de fases diferentes num número só daria
 * demanda torta. O que o vendedor já digitou nunca é jogado fora: ao abrir a
 * segunda fase, o plantel que estava lá vira a linha da fase que já existia.
 *
 * Fase que ENTRA vem com consumo de catálogo, então o estudo volta a pedir
 * confirmação — é a mesma regra da troca de fase simples.
 */
export function aplicarFases(s: EstudoInput, selecao: string[]): EstudoInput {
  const especie = s.produto.especie
  const ordem = (CATEGORIAS[especie] ?? []).map(c => c.chave)
  const chaves = ordem.filter(c => selecao.includes(c))
  // Sem nenhuma fase o estudo não existe — ignora a desmarcação da última.
  if (chaves.length === 0) return s

  const principal = chaves.includes(s.produto.categoria) ? s.produto.categoria : chaves[0]
  const anteriores = s.necessidade.fases ?? []
  const jaConhecidas = new Set(
    anteriores.length > 0 ? anteriores.map(x => x.categoria) : [s.produto.categoria],
  )
  const entrouFaseNova = chaves.some(c => !jaConhecidas.has(c))

  const fases: FasePlantel[] = chaves.map(chave => {
    const existente = anteriores.find(x => x.categoria === chave)
    if (existente) return existente
    if (chave === s.produto.categoria && anteriores.length === 0) {
      // primeira vez que abre multi-fase: o plantel digitado é o da fase de origem
      return {
        categoria: chave,
        numeroAnimais: s.necessidade.numeroAnimais,
        consumoPorAnimal: s.necessidade.consumoPorAnimal,
      }
    }
    // ⚠️ NA BASE DO ESTUDO, não em kg/mês cru. O catálogo é sempre mensal; se o
    // vendedor já escolheu "kg por dia", jogar o 2,7 aqui faria a fase nascer
    // significando 2,7 kg por ave POR DIA — o mesmo erro de 30x que a conversão
    // da unidade corrige do outro lado.
    return {
      categoria: chave,
      numeroAnimais: 0,
      consumoPorAnimal: consumoSugeridoNaBase(
        especie, chave, s.necessidade.baseConsumo, s.necessidade.dias,
      ),
    }
  })

  const produto = { ...s.produto, categoria: principal, categorias: chaves }

  if (chaves.length > 1) {
    // Cada fase come uma ração diferente, então cada uma ganha a SUA fórmula.
    // A fase de origem leva a que o vendedor já montou; as novas entram com a
    // referência do catálogo, que já fecha 100% — nada trava esperando ele
    // preencher seis fórmulas.
    const antigas = s.formula.porFase ?? {}
    const porFase: Record<string, IngredienteFormula[]> = {}
    for (const chave of chaves) {
      porFase[chave] = antigas[chave]
        ?? (chave === s.produto.categoria && s.formula.itens.length > 0
          ? s.formula.itens
          : formulaPadrao(s.produto.especie, chave))
    }
    return {
      ...s,
      produto,
      necessidade: {
        ...s.necessidade,
        fases,
        consumoConfirmado: entrouFaseNova ? false : s.necessidade.consumoConfirmado,
      },
      formula: { ...s.formula, porFase },
    }
  }

  // Sobrou uma fase: a fórmula DELA vira a fórmula do estudo e o `porFase` some.
  const itensDaSobrevivente = s.formula.porFase?.[principal] ?? s.formula.itens
  const { porFase: _saiu, ...formulaSemFases } = s.formula

  // O plantel dela vira o plantel do estudo. O consumo segue a
  // MESMA regra da troca de fase — confirmado com o cliente não se apaga.
  //
  // Vindo de UMA fase (sem linhas anteriores) o plantel não se mexe: trocar a
  // fase não muda o rebanho do cliente, e zerar os 200 animais que ele acabou de
  // digitar seria roubo silencioso.
  return {
    ...s,
    produto,
    necessidade: {
      ...s.necessidade,
      fases: [],
      numeroAnimais: anteriores.length > 0 ? fases[0].numeroAnimais : s.necessidade.numeroAnimais,
      consumoPorAnimal: s.necessidade.consumoConfirmado
        ? s.necessidade.consumoPorAnimal
        : (fases[0].consumoPorAnimal || s.necessidade.consumoPorAnimal),
      consumoConfirmado: entrouFaseNova ? false : s.necessidade.consumoConfirmado,
    },
    formula: { ...formulaSemFases, itens: itensDaSobrevivente },
  }
}

/**
 * Volta pro estudo de uma fase só: mantém a fase principal e o plantel dela, e
 * apaga a marca de seleção múltipla (`categorias`), que é o que faz a tela
 * mostrar o seletor simples.
 */
export function usarFaseUnica(s: EstudoInput): EstudoInput {
  const colapsado = aplicarFases(s, [s.produto.categoria])
  const { categorias: _fora, ...produto } = colapsado.produto
  return { ...colapsado, produto }
}

// ---------------------------------------------------------------------------
// Migração
// ---------------------------------------------------------------------------

function custoOpcional(bruto: unknown, padrao: CustoOpcional): CustoOpcional {
  if (typeof bruto === 'number') {
    return { ativo: Number.isFinite(bruto) && bruto > 0, valor: Number.isFinite(bruto) ? bruto : 0 }
  }
  if (bruto && typeof bruto === 'object') {
    const c = bruto as Partial<CustoOpcional>
    return { ativo: c.ativo === true, valor: Number(c.valor) || 0 }
  }
  return padrao
}

/**
 * Mescla um ajuste de cenário salvo. No módulo antigo o campo do preço da
 * matéria-prima chamava `materiaPrimaPct` — vira `ingredientesPct`. `fretePct`
 * e `margemPct` não têm equivalente (frete virou custo do cenário atual e
 * margem comercial saiu do escopo), então são descartados.
 */
function mesclarAjuste(padrao: AjusteCenario, bruto: unknown): AjusteCenario {
  if (!bruto || typeof bruto !== 'object') return padrao
  const b = bruto as Partial<AjusteCenario> & { materiaPrimaPct?: number }
  const num = (v: unknown, alt: number) => (Number.isFinite(Number(v)) ? Number(v) : alt)
  return {
    ingredientesPct: num(b.ingredientesPct ?? b.materiaPrimaPct, padrao.ingredientesPct),
    perdaPct: num(b.perdaPct, padrao.perdaPct),
    operacionaisPct: num(b.operacionaisPct, padrao.operacionaisPct),
    racaoCompradaPct: num(b.racaoCompradaPct, padrao.racaoCompradaPct),
    consumoPct: num(b.consumoPct, padrao.consumoPct),
    investimentoPct: num(b.investimentoPct, padrao.investimentoPct),
  }
}

/**
 * Converte um estudo salvo em "kg por dia"/"kg por ciclo" para kg/MÊS.
 *
 * O seletor de unidade saiu da tela em 27/08/2026: era a origem do erro de 30x
 * (o catálogo é mensal, e escolher "kg por dia" mantinha o mesmo número no
 * campo, virando 2,7 kg por ave POR DIA). Sem esta migração, todo estudo já
 * salvo em dia/ciclo abriria com o número na unidade errada e SEM o seletor
 * pra arrumar — ficaria preso no valor torto.
 *
 * Converte tanto o consumo principal quanto o de cada fase.
 */
export function migrarParaKgMes(n: Necessidade): Necessidade {
  if (n.baseConsumo === 'mes') return n
  const de = n.baseConsumo
  const dias = n.dias
  const conv = (v: number) => converterConsumo(v, de, 'mes', dias)
  return {
    ...n,
    baseConsumo: 'mes',
    consumoPorAnimal: conv(n.consumoPorAnimal),
    fases: n.fases?.map(f => ({ ...f, consumoPorAnimal: conv(f.consumoPorAnimal) })),
  }
}

/** Formato do módulo antigo de precificação (`/venda-racao` até 08/2026). */
interface InputLegado {
  quantidade?: {
    modo?: 'animais' | 'direto'
    numeroAnimais?: number
    consumoPorAnimal?: number
    baseConsumo?: 'dia' | 'mes' | 'ciclo'
    dias?: number
    sobraPct?: number
    quantidadeInformada?: number
    unidadeQuantidade?: 'kg' | 't' | 'sacos'
    pedidosPorMes?: number
    pesoSaco?: number
  }
  venda?: { precoAtualClientePorKg?: number; precoMercadoPorKg?: number }
}

/**
 * Fecha buracos de versões antigas do JSONB salvo — inclusive a virada de
 * "proposta de venda de ração" para "estudo de produção própria". Nenhuma
 * simulação antiga fica inacessível: o que existia vira ponto de partida.
 */
export function normalizarInput(
  bruto: unknown, cfgBruta?: Partial<ConfigEstudo> | null,
): EstudoInput {
  const base = novoEstudo(cfgBruta ?? CONFIG_PADRAO)
  if (!bruto || typeof bruto !== 'object') return base
  const s = bruto as Partial<EstudoInput> & InputLegado

  // --- necessidade: campo novo, ou convertido do antigo `quantidade`
  let necessidade = base.necessidade
  if (s.necessidade) {
    necessidade = migrarParaKgMes({ ...base.necessidade, ...s.necessidade })
  } else if (s.quantidade) {
    const q = s.quantidade
    const pedidos = Number(q.pedidosPorMes) || 1
    necessidade = {
      ...base.necessidade,
      modo: q.modo ?? base.necessidade.modo,
      numeroAnimais: Number(q.numeroAnimais) || 0,
      consumoPorAnimal: Number(q.consumoPorAnimal) || 0,
      baseConsumo: q.baseConsumo ?? 'mes',
      dias: Number(q.dias) || 30,
      margemSegurancaPct: Number(q.sobraPct) || 0,
      // no modelo antigo a quantidade direta era do PEDIDO e se repetia N vezes
      // no mês; aqui tudo é mensal.
      quantidadeInformada: (Number(q.quantidadeInformada) || 0) * (pedidos > 0 ? pedidos : 1),
      unidadeQuantidade: q.unidadeQuantidade ?? 'kg',
      periodoQuantidade: 'mes',
      pesoSaco: Number(q.pesoSaco) || base.necessidade.pesoSaco,
      consumoConfirmado: false,
    }
  }

  // --- cenário atual: campo novo, ou o "preço que o cliente paga hoje" antigo
  let atual = base.atual
  if (s.atual) {
    atual = {
      ...base.atual,
      ...s.atual,
      frete: custoOpcional(s.atual.frete, base.atual.frete),
      descarga: custoOpcional(s.atual.descarga, base.atual.descarga),
      outros: custoOpcional(s.atual.outros, base.atual.outros),
    }
  } else if (Number(s.venda?.precoAtualClientePorKg) > 0) {
    atual = {
      ...base.atual,
      preco: Number(s.venda?.precoAtualClientePorKg) || 0,
      unidadePreco: 'kg',
    }
  }

  const custosBrutos = (s.custos ?? {}) as Record<string, unknown>

  const normalizado: EstudoInput = {
    identificacao: { ...base.identificacao, ...(s.identificacao ?? {}) },
    produto: { ...base.produto, ...(s.produto ?? {}) },
    necessidade,
    atual,
    formula: {
      ...base.formula,
      ...(s.formula ?? {}),
      itens: Array.isArray(s.formula?.itens) ? s.formula!.itens : base.formula.itens,
    },
    custos: {
      ...base.custos,
      ...(s.custos ?? {}),
      // no módulo antigo era um número solto; agora tem liga/desliga
      custosFixosMensais: custoOpcional(custosBrutos.custosFixosMensais, base.custos.custosFixosMensais),
    },
    dimensionamento: { ...base.dimensionamento, ...(s.dimensionamento ?? {}) },
    investimento: { ...base.investimento, ...(s.investimento ?? {}) },
    cenarios: {
      conservador: mesclarAjuste(base.cenarios.conservador, s.cenarios?.conservador),
      provavel: mesclarAjuste(base.cenarios.provavel, s.cenarios?.provavel),
      otimista: mesclarAjuste(base.cenarios.otimista, s.cenarios?.otimista),
    },
    status: normalizarStatus(s.status),
  }

  // Estudo multi-fase salvo sem as linhas de plantel (ou com linha a menos)
  // reabriria mostrando 3 fases marcadas e calculando com uma só. Reconstrói.
  const marcadas = normalizado.produto.categorias ?? []
  if (marcadas.length > 1 && (normalizado.necessidade.fases?.length ?? 0) !== marcadas.length) {
    return aplicarFases(normalizado, marcadas)
  }
  return normalizado
}
