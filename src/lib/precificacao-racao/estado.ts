/**
 * Construção e migração do estado do formulário.
 *
 * `novaSimulacao` monta um input completo a partir dos defaults da empresa —
 * é o que a página usa ao abrir e ao trocar de espécie. `normalizarInput`
 * garante que uma simulação salva há meses (com campos que ainda não existiam)
 * volte a abrir sem quebrar.
 */
import {
  CATEGORIAS, CONFIG_PADRAO, ESPECIES, formulaPadrao, mesclarConfig,
} from './catalogo'
import { emDiasISO, hojeISO } from './formato'
import type {
  ConfigVendaRacao, Especie, SimulacaoInput,
} from './tipos'

export function categoriaPadrao(especie: Especie): string {
  return CATEGORIAS[especie]?.[0]?.chave ?? 'outro'
}

export function consumoSugerido(especie: Especie, categoria: string): number {
  return CATEGORIAS[especie]?.find(c => c.chave === categoria)?.consumoMes ?? 0
}

export function novaSimulacao(
  configBruta: Partial<ConfigVendaRacao> | null | undefined,
  especie: Especie = 'bovinos',
  vendedorNome = '',
): SimulacaoInput {
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
    quantidade: {
      modo: semAnimais ? 'direto' : 'animais',
      numeroAnimais: 0,
      consumoPorAnimal: consumoSugerido(especie, categoria),
      baseConsumo: 'mes',
      dias: 30,
      sobraPct: 0,
      quantidadeInformada: 0,
      unidadeQuantidade: 'kg',
      pedidosPorMes: 1,
      pesoSaco: cfg.pesoSacoPadrao,
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
      frete: { ativo: false, valor: 0 },
      freteModo: 'total',
      outrosFixosPedido: { ativo: false, valor: 0 },
      custosFixosMensais: 0,
    },
    venda: {
      modoPreco: 'margem',
      impostosPct: cfg.impostosPct,
      comissaoPct: cfg.comissaoPct,
      taxaFinanceiraPct: cfg.taxaFinanceiraPct,
      taxaCartaoPct: cfg.taxaCartaoPct,
      margemDesejadaPct: cfg.margemPorEspecie[especie] ?? 15,
      margemMinimaPct: cfg.margemMinimaPorEspecie[especie] ?? 10,
      precoAtualClientePorKg: 0,
      precoMercadoPorKg: 0,
      prazoPagamento: cfg.prazoPadrao,
      formaPagamento: cfg.formaPagamentoPadrao,
      condicaoEntrega: cfg.condicaoEntregaPadrao,
      precoNegociadoPorKg: null,
    },
    cenarios: cfg.cenarios,
    status: 'rascunho',
  }
}

/**
 * Aplica a troca de espécie preservando o que o vendedor já digitou de
 * cliente/quantidade — só o que é específico da espécie é resetado.
 */
export function trocarEspecie(
  atual: SimulacaoInput, especie: Especie, cfgBruta: Partial<ConfigVendaRacao> | null | undefined,
): SimulacaoInput {
  // Clicar no card da espécie JÁ selecionada não é troca — e esse clique-à-toa
  // resetava a fórmula pra `formulaPadrao()`, apagando ingredientes digitados.
  // Trocar de verdade continua zerando, que é o certo.
  if (atual.produto.especie === especie) return atual

  const cfg = mesclarConfig(cfgBruta ?? CONFIG_PADRAO)
  const categoria = categoriaPadrao(especie)
  const semAnimais = ESPECIES.find(e => e.chave === especie)?.semAnimais === true

  return {
    ...atual,
    produto: { especie, categoria, categoriaLivre: '' },
    quantidade: {
      ...atual.quantidade,
      modo: semAnimais ? 'direto' : atual.quantidade.modo,
      consumoPorAnimal: consumoSugerido(especie, categoria),
    },
    formula: { ...atual.formula, formulaId: null, nome: '', itens: formulaPadrao(especie, categoria) },
    venda: {
      ...atual.venda,
      margemDesejadaPct: cfg.margemPorEspecie[especie] ?? atual.venda.margemDesejadaPct,
      margemMinimaPct: cfg.margemMinimaPorEspecie[especie] ?? atual.venda.margemMinimaPct,
      // preço negociado volta a acompanhar o sugerido: a base de custo mudou
      precoNegociadoPorKg: null,
    },
  }
}

/** Fecha buracos de versões antigas do JSONB salvo. */
export function normalizarInput(
  bruto: unknown, cfgBruta?: Partial<ConfigVendaRacao> | null,
): SimulacaoInput {
  const base = novaSimulacao(cfgBruta ?? CONFIG_PADRAO)
  if (!bruto || typeof bruto !== 'object') return base
  const s = bruto as Partial<SimulacaoInput>

  return {
    identificacao: { ...base.identificacao, ...(s.identificacao ?? {}) },
    produto: { ...base.produto, ...(s.produto ?? {}) },
    quantidade: { ...base.quantidade, ...(s.quantidade ?? {}) },
    formula: {
      ...base.formula,
      ...(s.formula ?? {}),
      itens: Array.isArray(s.formula?.itens) ? s.formula!.itens : base.formula.itens,
    },
    custos: { ...base.custos, ...(s.custos ?? {}) },
    venda: { ...base.venda, ...(s.venda ?? {}) },
    cenarios: {
      conservador: { ...base.cenarios.conservador, ...(s.cenarios?.conservador ?? {}) },
      provavel: { ...base.cenarios.provavel, ...(s.cenarios?.provavel ?? {}) },
      otimista: { ...base.cenarios.otimista, ...(s.cenarios?.otimista ?? {}) },
    },
    status: s.status ?? base.status,
  }
}
