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
import type { AjusteCenario, ConfigEstudo, CustoOpcional, Especie, EstudoInput } from './tipos'

export function categoriaPadrao(especie: Especie): string {
  return CATEGORIAS[especie]?.[0]?.chave ?? 'outro'
}

/** kg/animal/mês de REFERÊNCIA da fase. Nunca é verdade sobre o cliente. */
export function consumoSugerido(especie: Especie, categoria: string): number {
  return CATEGORIAS[especie]?.find(c => c.chave === categoria)?.consumoMes ?? 0
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
      itens: formulaPadrao(especie),
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
    },
    formula: { ...atual.formula, formulaId: null, nome: '', itens: formulaPadrao(especie) },
  }
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
    necessidade = { ...base.necessidade, ...s.necessidade }
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

  return {
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
}
