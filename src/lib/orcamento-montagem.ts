// MONTAGEM DA FÁBRICA — custo de mandar a equipe da Branorte montar no cliente.
//
// Valores-padrão acordados com o Daniel em 22/09/2026:
//   mão de obra .... 10% sobre o total geral da proposta (equipamentos +
//                    acessórios + motores + componentes adicionais), medido
//                    ANTES da montagem entrar (senão o 10% comeria a si mesmo).
//   estadia ........ R$ 500,00 por pessoa POR DIA
//   alimentação .... R$ 100,00 por pessoa POR DIA
//   passagem ....... R$ 5.000,00 por pessoa (média, valor único da viagem)
//   deslocamento ... R$ 300,00 por dia, por carro alugado
//
// "Dias" é o total da viagem que o vendedor digita — ida, montagem e volta.
// Todo valor unitário é editável na tela: a passagem é média e muda por destino.
//
// Quem paga cada linha (roadmap #69, 29/09/2026): o vendedor marca linha a linha
// se a Branorte cobre ou se fica POR CONTA DO CLIENTE (ex.: alimentação, estadia
// e deslocamento). Linha do cliente sai do total e vai pro 2º quadro da proposta,
// sem valor. Sem marcação = Branorte cobre: orçamento salvo antes disso abre e
// soma exatamente igual.

import { OBS_POR_CONTA_DEFAULT } from './orcamento-defaults'

export type MontagemResponsavel = 'branorte' | 'cliente'

export interface MontagemCfg {
  /** Bloco ligado no orçamento. Falso = não mostra nem soma. */
  ativo: boolean
  pessoas: number
  /** Total de dias da viagem (ida + montagem + volta). */
  dias: number
  carros: number
  /** % de mão de obra sobre a base (padrão 10). */
  percentualMaoObra: number
  /** R$ por pessoa por dia. */
  estadiaDia: number
  /** R$ por pessoa por dia. */
  alimentacaoDia: number
  /** R$ por pessoa (viagem toda). */
  passagemPessoa: number
  /** R$ por carro por dia. */
  deslocamentoDia: number
  /**
   * Quem paga cada linha. Chave ausente (ou o campo inteiro, em orçamento salvo
   * antes de 29/09/2026) = 'branorte'. Só 'cliente' precisa ser gravado.
   */
  responsavel?: Partial<Record<MontagemChave, MontagemResponsavel>>
  /**
   * Total calculado no momento em que o orçamento foi SALVO. Não é entrada:
   * a tela sempre recalcula. Existe porque quem lê o orçamento pronto (o
   * gerador de contrato, relatório) não tem como refazer a base do %.
   */
  total?: number
}

export const MONTAGEM_PADRAO: MontagemCfg = {
  ativo: true,
  pessoas: 1,
  dias: 1,
  carros: 1,
  percentualMaoObra: 10,
  estadiaDia: 500,
  alimentacaoDia: 100,
  passagemPessoa: 5000,
  deslocamentoDia: 300,
}

export type MontagemChave = 'mao_obra' | 'estadia' | 'alimentacao' | 'passagem' | 'deslocamento'

/** Ordem em que as linhas aparecem (tela, PDF e DOCX). */
export const MONTAGEM_CHAVES: readonly MontagemChave[] = ['mao_obra', 'estadia', 'alimentacao', 'passagem', 'deslocamento']

export interface MontagemLinha {
  chave: MontagemChave
  rotulo: string
  /** Como a conta foi feita, pro vendedor conferir. Ex.: "R$ 500,00 × 2 pessoas × 5 dias". */
  detalhe: string
  /** Na linha do cliente é só referência interna: não entra no total nem vai pro PDF. */
  valor: number
  responsavel: MontagemResponsavel
}

export interface MontagemCalculo {
  /** Linhas que a BRANORTE cobra (só as com valor > 0). Somam no total. */
  linhas: MontagemLinha[]
  /** Linhas POR CONTA DO CLIENTE: fora do total, listadas sem valor no 2º quadro. */
  linhasCliente: MontagemLinha[]
  /**
   * As 5 linhas, na ordem da tela, INCLUSIVE as da Branorte zeradas. Só pro editor
   * (29/09/2026): linha zerada sumia da tela junto com o campo do unitário — não
   * dava pra marcar "por conta do cliente" nem voltar o valor depois de zerar.
   * PDF/DOCX e total seguem `linhas`/`linhasCliente`.
   */
  todas: MontagemLinha[]
  total: number
  /** Base sobre a qual o % de mão de obra incidiu. */
  base: number
}

/** Quem paga a linha. Qualquer coisa que não seja 'cliente' (inclusive ausente) = Branorte. */
export function responsavelDaLinha(cfg: MontagemCfg | null | undefined, chave: MontagemChave): MontagemResponsavel {
  return cfg?.responsavel?.[chave] === 'cliente' ? 'cliente' : 'branorte'
}

/** Número seguro e não-negativo — campo vazio na tela vira NaN. */
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function plural(n: number, sing: string, plu: string): string {
  return `${n} ${n === 1 ? sing : plu}`
}

/**
 * Calcula as linhas da montagem.
 *
 * @param cfg        configuração da tela
 * @param baseMaoObra total geral da proposta SEM a montagem (equipamentos +
 *                    acessórios + motores + componentes adicionais)
 */
export function calcularMontagem(cfg: MontagemCfg | null | undefined, baseMaoObra: number): MontagemCalculo {
  if (!cfg || !cfg.ativo) return { linhas: [], linhasCliente: [], todas: [], total: 0, base: 0 }

  const pessoas = Math.floor(num(cfg.pessoas))
  const dias = Math.floor(num(cfg.dias))
  const carros = Math.floor(num(cfg.carros))
  const pct = num(cfg.percentualMaoObra)
  const base = num(baseMaoObra)

  const linhas: MontagemLinha[] = []
  const linhasCliente: MontagemLinha[] = []
  const todas: MontagemLinha[] = []

  // Linha da Branorte só entra com valor (> 0), como sempre foi. Linha marcada
  // POR CONTA DO CLIENTE entra mesmo zerada: o vendedor escolheu avisar o cliente
  // de que aquilo é com ele, e no PDF ela sai sem valor de qualquer jeito.
  function add(chave: MontagemChave, rotulo: string, detalhe: string, valor: number) {
    const responsavel = responsavelDaLinha(cfg, chave)
    const linha: MontagemLinha = { chave, rotulo, detalhe, valor, responsavel }
    todas.push(linha)
    if (responsavel === 'cliente') linhasCliente.push(linha)
    else if (valor > 0) linhas.push(linha)
  }

  add('mao_obra', 'Mão de obra', `${pct}% sobre ${brl(base)}`, Math.round((base * pct) / 100))

  add(
    'estadia', 'Estadia',
    `${brl(num(cfg.estadiaDia))} × ${plural(pessoas, 'pessoa', 'pessoas')} × ${plural(dias, 'dia', 'dias')}`,
    Math.round(num(cfg.estadiaDia) * pessoas * dias),
  )

  add(
    'alimentacao', 'Alimentação',
    `${brl(num(cfg.alimentacaoDia))} × ${plural(pessoas, 'pessoa', 'pessoas')} × ${plural(dias, 'dia', 'dias')}`,
    Math.round(num(cfg.alimentacaoDia) * pessoas * dias),
  )

  add(
    'passagem', 'Passagem',
    `${brl(num(cfg.passagemPessoa))} × ${plural(pessoas, 'pessoa', 'pessoas')}`,
    Math.round(num(cfg.passagemPessoa) * pessoas),
  )

  add(
    'deslocamento', 'Deslocamento',
    `${brl(num(cfg.deslocamentoDia))} × ${plural(carros, 'carro', 'carros')} × ${plural(dias, 'dia', 'dias')}`,
    Math.round(num(cfg.deslocamentoDia) * carros * dias),
  )

  return { linhas, linhasCliente, todas, total: linhas.reduce((s, l) => s + l.valor, 0), base }
}

/**
 * Frase do que a montagem INCLUI, pro cliente ler no PDF: os itens que entraram,
 * sem o valor de cada um. Ele precisa saber que passagem e hotel estão na conta
 * (valoriza a proposta) sem conseguir fatiar item a item na negociação.
 * Pedido do Daniel, 22/09/2026.
 */
const ROTULO_CLIENTE: Record<MontagemChave, string> = {
  mao_obra: 'mão de obra',
  estadia: 'estadia',
  alimentacao: 'alimentação',
  passagem: 'passagem aérea',
  deslocamento: 'deslocamento',
}

function listaComE(nomes: string[]): string {
  if (nomes.length === 0) return ''
  if (nomes.length === 1) return nomes[0]
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

/** Só as linhas que a Branorte cobra — as do cliente não estão "inclusas". */
export function inclusosMontagem(cfg: MontagemCfg | null | undefined, baseMaoObra: number): string {
  return listaComE(calcularMontagem(cfg, baseMaoObra).linhas.map(l => ROTULO_CLIENTE[l.chave]))
}

/**
 * Os 2 quadros da montagem na proposta (roadmap #69, print do vendedor):
 *   MONTAGEM DOS ITENS ORÇADOS ACIMA: (Valores para os montadores do fabricante)
 *     - Mão de obra / - Passagens aéreas idas/voltas / Valor total R$ ...
 *   MONTAGEM DOS ITENS ORÇADOS ACIMA: (POR CONTA DO CLIENTE)
 *     - Alimentação / - Estadia / - Deslocamento            (sem valor)
 * O print trazia "Valores para 2 montadores": o número de pessoas NÃO vai pro PDF
 * — pessoas, dias e o valor de cada linha são conta interna desde 22/09/2026
 * (exposta vira negociação item a item). O cliente vê os itens e UM total.
 */
export const MONTAGEM_QUADRO_TITULO = 'Montagem dos itens orçados acima:'
export const MONTAGEM_QUADRO_FABRICANTE = '(Valores para os montadores do fabricante)'
export const MONTAGEM_QUADRO_CLIENTE = '(POR CONTA DO CLIENTE)'

const ROTULO_QUADRO: Record<MontagemChave, string> = {
  mao_obra: 'Mão de obra',
  estadia: 'Estadia',
  alimentacao: 'Alimentação',
  passagem: 'Passagens aéreas idas/voltas',
  deslocamento: 'Deslocamento',
}

// Ordem dos itens NOS QUADROS = a do print do vendedor: primeiro o que é da equipe
// (mão de obra, passagem), depois o custo de ficar lá (alimentação, estadia,
// deslocamento). A tela segue MONTAGEM_CHAVES, que é a ordem da conta.
const ORDEM_QUADRO: readonly MontagemChave[] = ['mao_obra', 'passagem', 'alimentacao', 'estadia', 'deslocamento']

function naOrdemDoQuadro(linhas: MontagemLinha[]): string[] {
  return linhas
    .slice()
    .sort((a, b) => ORDEM_QUADRO.indexOf(a.chave) - ORDEM_QUADRO.indexOf(b.chave))
    .map(l => ROTULO_QUADRO[l.chave])
}

export interface MontagemQuadros {
  /** 1º quadro: o que a Branorte cobra — itens sem valor + UM total. null = nada cobrado. */
  fabricante: { itens: string[]; total: number } | null
  /** 2º quadro: o que fica por conta do cliente — só os itens. null = nenhum. */
  cliente: { itens: string[] } | null
}

/** Uma fonte só pros 2 quadros da prévia/PDF e do DOCX nativo (Word que vai pro Z:\). */
export function quadrosMontagem(cfg: MontagemCfg | null | undefined, baseMaoObra: number): MontagemQuadros {
  const c = calcularMontagem(cfg, baseMaoObra)
  return {
    fabricante: c.total > 0 ? { itens: naOrdemDoQuadro(c.linhas), total: c.total } : null,
    cliente: c.linhasCliente.length > 0 ? { itens: naOrdemDoQuadro(c.linhasCliente) } : null,
  }
}

/**
 * Troca quem paga uma linha. Voltar pra Branorte APAGA a chave (e o campo, se
 * ficou vazio): o JSON gravado fica igual ao de antes da feature.
 */
export function comResponsavel(cfg: MontagemCfg, chave: MontagemChave, resp: MontagemResponsavel): MontagemCfg {
  const mapa: Partial<Record<MontagemChave, MontagemResponsavel>> = { ...(cfg.responsavel ?? {}) }
  if (resp === 'cliente') mapa[chave] = 'cliente'
  else delete mapa[chave]
  const { responsavel: _antigo, ...resto } = cfg
  return Object.keys(mapa).length > 0 ? { ...resto, responsavel: mapa } : resto
}

/**
 * Lista "Observação — por conta do cliente" coerente com a montagem. Uma regra só
 * pra preview/PDF e DOCX (antes só a preview tirava a linha — o DOCX se contradizia).
 *  - Montagem COBRADA: sai a linha histórica "Montagem dos equipamentos orçados
 *    acima (se necessário)" — o cliente lia no mesmo documento o valor cobrado e
 *    "é por sua conta".
 * As linhas da montagem POR CONTA DO CLIENTE NÃO entram aqui: elas têm o 2º quadro
 * (prévia, PDF e DOCX — 29/09/2026); repetir aqui listava a mesma coisa duas vezes.
 * `null` = as 5 linhas históricas (mesma regra da preview).
 */
export function obsPorContaComMontagem(
  obsPorConta: string[] | null | undefined,
  cfg: MontagemCfg | null | undefined,
  baseMaoObra: number,
): string[] {
  const linhasBase = obsPorConta ?? OBS_POR_CONTA_DEFAULT
  const cobrando = calcularMontagem(cfg, baseMaoObra).total > 0
  return cobrando
    ? linhasBase.filter(l => !/montagem\s+dos\s+equipamentos/i.test(l))
    : linhasBase.slice()
}

/** Só o total — atalho pros cálculos de total geral. */
export function totalMontagem(cfg: MontagemCfg | null | undefined, baseMaoObra: number): number {
  return calcularMontagem(cfg, baseMaoObra).total
}

/** Versão pra gravar no banco: carimba o total calculado junto da configuração. */
export function montagemParaSalvar(
  cfg: MontagemCfg | null | undefined,
  baseMaoObra: number,
): MontagemCfg | null {
  if (!cfg || !cfg.ativo) return null
  return { ...cfg, total: calcularMontagem(cfg, baseMaoObra).total }
}

/**
 * Total de um orçamento JÁ SALVO, para quem não consegue refazer a base do %
 * (contrato, relatórios). Usa o carimbo; 0 se o orçamento é anterior à feature.
 */
export function totalMontagemSalva(cfg: MontagemCfg | null | undefined): number {
  const n = Number(cfg?.total)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Normaliza o que veio do banco (JSONB) pro shape completo, sem campo faltando.
 *
 * A coluna `montagem` já existia com OUTRO formato ({ titulo, itens[], valor,
 * tituloCliente, itensCliente[] }) — esqueleto do roadmap #69 que nenhuma tela
 * chegou a preencher (0 de 1.930 orçamentos em 22/09/2026). Se um desses
 * aparecer, devolve null em vez de inventar uma montagem que ninguém pediu.
 */
export function normalizarMontagem(raw: unknown): MontagemCfg | null {
  if (!raw || typeof raw !== 'object') return null
  if ('titulo' in raw && !('pessoas' in raw)) return null // formato antigo (#69)
  const o = raw as Partial<MontagemCfg>
  // Só guarda o que é 'cliente' e com chave conhecida. Orçamento de antes de
  // 29/09/2026 (sem o campo) volta SEM `responsavel` — o mesmo objeto de sempre.
  const responsavel: Partial<Record<MontagemChave, MontagemResponsavel>> = {}
  const rawResp = (o as { responsavel?: unknown }).responsavel
  if (rawResp && typeof rawResp === 'object') {
    for (const k of MONTAGEM_CHAVES) {
      if ((rawResp as Record<string, unknown>)[k] === 'cliente') responsavel[k] = 'cliente'
    }
  }
  return {
    ativo: o.ativo !== false,
    pessoas: num(o.pessoas) || MONTAGEM_PADRAO.pessoas,
    dias: num(o.dias) || MONTAGEM_PADRAO.dias,
    carros: num(o.carros) || MONTAGEM_PADRAO.carros,
    percentualMaoObra: o.percentualMaoObra == null ? MONTAGEM_PADRAO.percentualMaoObra : num(o.percentualMaoObra),
    estadiaDia: o.estadiaDia == null ? MONTAGEM_PADRAO.estadiaDia : num(o.estadiaDia),
    alimentacaoDia: o.alimentacaoDia == null ? MONTAGEM_PADRAO.alimentacaoDia : num(o.alimentacaoDia),
    passagemPessoa: o.passagemPessoa == null ? MONTAGEM_PADRAO.passagemPessoa : num(o.passagemPessoa),
    deslocamentoDia: o.deslocamentoDia == null ? MONTAGEM_PADRAO.deslocamentoDia : num(o.deslocamentoDia),
    ...(Object.keys(responsavel).length > 0 ? { responsavel } : {}),
  }
}
