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

export interface MontagemLinha {
  chave: MontagemChave
  rotulo: string
  /** Como a conta foi feita, pro vendedor conferir. Ex.: "R$ 500,00 × 2 pessoas × 5 dias". */
  detalhe: string
  valor: number
}

export interface MontagemCalculo {
  linhas: MontagemLinha[]
  total: number
  /** Base sobre a qual o % de mão de obra incidiu. */
  base: number
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
  if (!cfg || !cfg.ativo) return { linhas: [], total: 0, base: 0 }

  const pessoas = Math.floor(num(cfg.pessoas))
  const dias = Math.floor(num(cfg.dias))
  const carros = Math.floor(num(cfg.carros))
  const pct = num(cfg.percentualMaoObra)
  const base = num(baseMaoObra)

  const linhas: MontagemLinha[] = []

  const maoObra = Math.round((base * pct) / 100)
  if (maoObra > 0) {
    linhas.push({
      chave: 'mao_obra',
      rotulo: 'Mão de obra',
      detalhe: `${pct}% sobre ${brl(base)}`,
      valor: maoObra,
    })
  }

  const estadia = Math.round(num(cfg.estadiaDia) * pessoas * dias)
  if (estadia > 0) {
    linhas.push({
      chave: 'estadia',
      rotulo: 'Estadia',
      detalhe: `${brl(num(cfg.estadiaDia))} × ${plural(pessoas, 'pessoa', 'pessoas')} × ${plural(dias, 'dia', 'dias')}`,
      valor: estadia,
    })
  }

  const alimentacao = Math.round(num(cfg.alimentacaoDia) * pessoas * dias)
  if (alimentacao > 0) {
    linhas.push({
      chave: 'alimentacao',
      rotulo: 'Alimentação',
      detalhe: `${brl(num(cfg.alimentacaoDia))} × ${plural(pessoas, 'pessoa', 'pessoas')} × ${plural(dias, 'dia', 'dias')}`,
      valor: alimentacao,
    })
  }

  const passagem = Math.round(num(cfg.passagemPessoa) * pessoas)
  if (passagem > 0) {
    linhas.push({
      chave: 'passagem',
      rotulo: 'Passagem',
      detalhe: `${brl(num(cfg.passagemPessoa))} × ${plural(pessoas, 'pessoa', 'pessoas')}`,
      valor: passagem,
    })
  }

  const deslocamento = Math.round(num(cfg.deslocamentoDia) * carros * dias)
  if (deslocamento > 0) {
    linhas.push({
      chave: 'deslocamento',
      rotulo: 'Deslocamento',
      detalhe: `${brl(num(cfg.deslocamentoDia))} × ${plural(carros, 'carro', 'carros')} × ${plural(dias, 'dia', 'dias')}`,
      valor: deslocamento,
    })
  }

  return { linhas, total: linhas.reduce((s, l) => s + l.valor, 0), base }
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

export function inclusosMontagem(cfg: MontagemCfg | null | undefined, baseMaoObra: number): string {
  const nomes = calcularMontagem(cfg, baseMaoObra).linhas.map(l => ROTULO_CLIENTE[l.chave])
  if (nomes.length === 0) return ''
  if (nomes.length === 1) return nomes[0]
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
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
  }
}
