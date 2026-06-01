/**
 * Detetive Scoring Engine
 *
 * Motor de regras para due diligence de leads Branorte.
 * Recebe dados ja coletados (OpenCNPJ, CGU, DataJud, noticias, BrasilAPI, socios reverso)
 * e devolve um dossie consolidado com score 0-100, semaforo e acoes sugeridas.
 *
 * Pesos das red flags (1-5) refletem severidade.
 *
 * MAX_SCORE recalculado dinamicamente como soma dos pesos das flags APLICAVEIS
 * (nao mais hardcoded 43 ou 51) — evita bug quando flag nao se aplica por falta
 * de dado.
 *
 * Score normalizado: score = round(100 - (soma_pesos_detectadas / max_pesos_aplicaveis) × 100)
 * Escala 0-100 onde MAIOR=MELHOR (100 = limpo, 0 = saturado de problemas).
 *
 * NOTA DE COMPATIBILIDADE: o cálculo histórico (score = soma/MAX × 100, onde
 * MAIOR=PIOR) é mantido em `score` para retrocompatibilidade com consumidores
 * antigos. O novo campo `score_normalizado` (MAIOR=MELHOR) é a métrica canônica
 * usada por sub_scores, semáforo dinâmico e limite sugerido.
 */

// ============================================================================
// TIPOS DE INPUT
// ============================================================================

export interface DetetiveInput {
  cnpj: string
  ticket_pedido?: number // R$ do orcamento (se conhecido)
  opencnpj: {
    razao_social: string | null
    situacao: string | null
    data_abertura: string | null
    capital_social: number | null
    cnae_principal: { codigo: string; descricao: string } | null
    socios: Array<{
      nome: string
      cpf_cnpj_mascara: string | null
      data_nascimento?: string | null // ISO date — habilita Flag 16 (idade extrema)
    }>
    endereco: { cep: string | null; municipio: string | null; uf: string | null } | null
  } | null
  cgu_sancoes?: {
    ceis: number
    cnep: number
    acordos_leniencia: number
    cepim: number
  } | null
  datajud?: {
    total_processos: number
    processos_por_ano?: Record<string, number>
  } | null
  noticias?: {
    tem_alerta: boolean
    keywords_que_bateram: string[]
    total: number
  } | null
  brasilapi?: {
    endereco_compartilhado_count?: number
    zona_inferida?: string
  } | null
  socios_reverso?: Array<{
    cpf_mascara: string
    qtd_empresas: number
    cnaes_distintos: number
  }>
  instagram?: {
    perfil_encontrado: boolean
    privado?: boolean
    seguidores?: number
    total_posts?: number
    data_ultimo_post?: string | null // ISO date
    red_flags?: Array<{ id: string; descricao: string; severidade: 'baixa' | 'media' | 'alta' }>
  } | null
  /**
   * Faturamento presumido anual (R$). Quando disponível, alimenta o sub_score
   * financeiro e a fórmula de limite (faturamento × 0.10 × 12).
   */
  faturamento_presumido_anual?: number | null
  /**
   * Pegada digital agregada (além do Instagram).
   * Alimenta o sub_score `digital`.
   */
  pegada_digital?: {
    site_ativo?: boolean
    linkedin_ativo?: boolean
    reclame_aqui_rating?: number | null // 0-10
  } | null
  /**
   * Sinais de PEP (Pessoa Exposta Politicamente) detectados nos sócios.
   */
  pep?: {
    algum_socio_pep: boolean
    detalhes?: string[]
  } | null
  /**
   * Contexto do orçamento atual — destrava cenários A/B/C com cobertura real
   * e ativa Flag 15 (forma de pagamento suspeita).
   */
  contexto_orcamento?: {
    equipamento?: string
    valor_total?: number
    ticket_categoria?: 'baixo' | 'medio' | 'alto' | 'premium'
    forma_pagamento?:
      | 'a_vista'
      | 'parcelado_sinal'
      | 'parcelado_sem_sinal'
      | 'finame'
      | 'consorcio'
  } | null
  /**
   * Histórico INTERNO Branorte (pode sobrepor sinais externos).
   * Quando há inadimplência ativa, dispara Flag 14 (hard_fail).
   */
  historico_branorte?: {
    compras_pagas: number
    total_brl: number
    inadimplencia_brl: number
    ultima_compra_data?: string | null // ISO date
  } | null
  /**
   * Porte declarado/inferido — usado no multiplicador do limite sugerido.
   */
  porte_empresa?: 'micro' | 'pequena' | 'media' | 'grande' | null
  /**
   * Resultado da consulta SPC/Serasa (apontamentos externos).
   * Quando classificacao === 'INADIMPLENTE' OU score.valor === 0 OU há
   * inadimplencia ativa, dispara Flag 17 (hard_fail) — bloqueio total da venda.
   */
  spc?: {
    score?: {
      valor?: number | null
      classificacao?: string | null // ex: 'INADIMPLENTE', 'BAIXO', 'MEDIO', 'ALTO'
    } | null
    inadimplencias?: {
      qtd?: number | null
      valor_total_brl?: number | null
      detalhes?: Array<{
        credor?: string | null
        valor_brl?: number | null
        data_inclusao?: string | null
      }> | null
    } | null
  } | null
}

// ============================================================================
// TIPOS DE OUTPUT
// ============================================================================

/**
 * Dimensões usadas pra agrupar flags em sub_scores.
 * Cada flag pertence a uma única dimensão.
 */
export type DimensaoFlag =
  | 'financeiro'
  | 'compliance'
  | 'reputacao'
  | 'juridico'
  | 'estrutural'
  | 'digital'

export interface RedFlag {
  id: number
  peso: 1 | 2 | 3 | 4 | 5
  nome: string
  descricao: string
  evidencia?: Record<string, unknown>
  hard_fail?: boolean // override automatico pra vermelho
  /**
   * Dimensão da flag — usada pra calcular sub_scores agrupados.
   * Mapeamento canônico:
   *   F01_CAPITAL_BAIXO              → financeiro
   *   F02_ENDERECO_COMPARTILHADO     → estrutural
   *   F03_SOCIO_HETEROGENEO          → estrutural
   *   F04_TURNOVER_SOCIETARIO        → estrutural
   *   F05_CNAE_INCOMPATIVEL          → estrutural
   *   F06_SITUACAO_IRREGULAR         → compliance
   *   F07_SANCAO_CGU                 → compliance
   *   F08_DATAJUD_PROCESSOS          → juridico
   *   F09_NOTICIA_NEGATIVA           → reputacao
   *   F10_EMPRESA_JOVEM_TICKET_ALTO  → estrutural
   *   F11_IG_AUSENTE                 → digital
   *   F12_IG_MISMATCH_PORTE          → digital
   *   F13_IG_ABANDONADO              → digital
   *   F14_HIST_INADIMPLENCIA_INTERNO → financeiro (hard_fail)
   *   F15_FORMA_PAGAMENTO_SUSPEITA   → financeiro
   *   F16_SOCIO_IDADE_EXTREMA        → estrutural
   *   F17_SCORE_INADIMPLENTE_SPC     → financeiro (hard_fail)
   */
  dimensao?: DimensaoFlag
}

/**
 * Sub-scores por dimensão, cada um 0-100 onde MAIOR=MELHOR.
 * Fórmula: round((max_pesos_dimensao - soma_pesos_detectadas_dimensao) / max_pesos_dimensao × 100).
 * Quando nenhuma flag de uma dimensão é aplicável (max=0), retorna 100 (limpo por default).
 */
export interface SubScores {
  financeiro: number
  compliance: number
  reputacao: number
  juridico: number
  estrutural: number
  digital: number
}

/**
 * Cenário comercial A/B/C. Sempre retorna 3 cenários, mesmo que algum seja
 * marcado como inviável (semáforo='vermelho' + limite_max_brl=0).
 */
export interface Cenario {
  tipo: 'a_vista' | 'prazo_curto' | 'prazo_longo' | 'finame'
  condicao: string // descrição humana (ex: "À vista (antes da expedição)")
  semaforo: 'verde' | 'amarelo' | 'vermelho'
  limite_max_brl: number
  entrada_minima_pct: number // 0-100
  parcelas_maximas: number // 1 = à vista, 3 = 28/56/84, 60 = FINAME
  exigencias: string[]
  prazo_aprovacao_interna_dias: number // 0 = imediato
}

export interface ModificadorAplicado {
  aplicado: boolean
  motivo?: string
  pontos: number // delta aplicado ao score (positivo melhora)
}

export interface DossieResultado {
  cnpj: string
  /**
   * Score legado 0-100 onde MAIOR=PIOR (mantido pra retrocompat).
   * Use `score_normalizado` pra nova lógica.
   */
  score: number
  /**
   * Score normalizado 0-100 onde MAIOR=MELHOR.
   * Calculado como: round(100 - (soma_pesos / max_pesos_aplicaveis) × 100)
   * + modificadores (setorial, histórico Branorte) clampado em [0, 100].
   */
  score_normalizado: number
  /**
   * MAX_SCORE aplicável (soma dos pesos das flags que tinham dado suficiente
   * pra serem avaliadas). Substitui o hardcoded 51.
   */
  max_score: number
  semaforo: 'verde' | 'amarelo' | 'vermelho'
  recomendacao: string
  red_flags: RedFlag[]
  acoes_sugeridas: string[]
  /**
   * Sub-scores por dimensão (0-100, MAIOR=MELHOR).
   */
  sub_scores: SubScores
  /**
   * Modificador setorial (CNAE agro/agroindustrial reduz peso digital).
   */
  modificador_setorial: ModificadorAplicado
  /**
   * Modificador histórico Branorte (cliente recorrente sem inadimplência sobe semáforo).
   */
  modificador_historico_branorte: ModificadorAplicado & {
    pode_sobrepor_externo?: boolean
  }
  /**
   * Limite sugerido em R$, calculado por fórmula auditável.
   */
  limite_sugerido_brl: number
  /**
   * Condição comercial recomendada default.
   */
  condicao_default: string
  /**
   * Cenários A/B/C de venda (sempre 3, mesmo quando algum é inviável).
   */
  cenarios: Cenario[]
  /**
   * Algum hard_fail ativo?
   */
  hard_fail: boolean
  hard_fail_motivo?: string
}

// ============================================================================
// CONSTANTES DE DOMINIO
// ============================================================================

/**
 * CNAEs esperados pra clientes Branorte (metalurgia e agroalimentar).
 * Se o CNAE principal nao bate com nenhum prefixo, flag 5 ativa.
 *
 * Codigos sao prefixos (4 digitos) - CNAE completo tem 7.
 * - 1062: Moagem de trigo
 * - 1063: Fabricacao de farinha de mandioca
 * - 0151: Criacao de bovinos
 * - 0155: Criacao de aves
 * - 1011: Frigorifico - abate de bovinos
 * - 2833: Maquinas/equipamentos agropecuaria
 * - 2866: Maquinas para industria alimentar
 * - 2869: Outras maquinas industriais
 */
const CNAES_COMPATIVEIS = ['1062', '1063', '0151', '0155', '1011', '2833', '2866', '2869']

/**
 * Keywords criticas em noticias que disparam flag 9.
 * Mesmo que `tem_alerta` ja venha true, validamos se as keywords matched
 * incluem termos efetivamente graves.
 */
const KEYWORDS_NOTICIA_CRITICAS = [
  'fraude',
  'fraudes',
  'operacao',
  'operação',
  'golpe',
  'golpes',
  'estelionato',
  'lavagem',
  'corrupcao',
  'corrupção',
  'preso',
  'presos',
]

/**
 * Situacoes cadastrais que sao hard fail imediato.
 */
const SITUACOES_HARD_FAIL = ['SUSPENSA', 'INAPTA', 'BAIXADA', 'NULA']

/**
 * Limite minimo de capital social vs ticket pra considerar desproporcional.
 * Capital < 10% do ticket = flag 1 ativa.
 */
const CAPITAL_TICKET_RATIO_MIN = 0.1

/**
 * Empresa jovem = aberta ha menos de 365 dias.
 */
const EMPRESA_JOVEM_DIAS = 365

/**
 * Ticket alto = >= R$ 100k.
 */
const TICKET_ALTO_BRL = 100_000

/**
 * Endereco compartilhado: 5 ou mais empresas no mesmo endereco = flag 2.
 */
const ENDERECO_COMPARTILHADO_LIMITE = 5

/**
 * Socio em N empresas heterogeneas: >= 5 empresas E >= 3 CNAEs distintos.
 */
const SOCIO_EMPRESAS_LIMITE = 5
const SOCIO_CNAES_DISTINTOS_LIMITE = 3

/**
 * Flag 11 (IG ausente em empresa de ticket alto):
 * - Ticket > R$ 50k
 * - Empresa com mais de 2 anos (730 dias)
 * - Sem perfil IG encontrado
 */
const TICKET_ALTO_IG_AUSENTE_BRL = 50_000
const EMPRESA_MADURA_DIAS = 730 // 2 anos

/**
 * Flag 12 (IG mismatch porte):
 * - Seguidores < 50
 * - E (faturamento/presumido alto OU empresa antiga >5 anos)
 */
const IG_SEGUIDORES_BAIXO = 50
const EMPRESA_ANTIGA_DIAS = 1825 // 5 anos

/**
 * Flag 13 (IG abandonado):
 * - Ultimo post ha mais de 12 meses (365 dias)
 */
const IG_ULTIMO_POST_DIAS_LIMITE = 365

/**
 * Flag 15 (forma de pagamento suspeita):
 * - Cotação 100% parcelada SEM entrada
 * - E ticket > R$ 100k
 */
const TICKET_PAGAMENTO_SUSPEITO_BRL = 100_000

/**
 * Flag 16 (sócio idade extrema):
 * - < 25 anos ou > 80 anos (proxy de laranja).
 */
const SOCIO_IDADE_MINIMA = 25
const SOCIO_IDADE_MAXIMA = 80

/**
 * Prefixos CNAE (4 dígitos) do setor agro/agroindustrial.
 * Quando o CNAE principal casa, reduz peso das flags digitais F11/F12/F13 em 70%
 * (ausência de IG/site/LinkedIn é normal nesse setor).
 *
 *   01.xx  - Agropecuária
 *   1062   - Moagem de trigo
 *   1063   - Fabricação farinha de mandioca
 *   1066   - Fabricação de alimentos para animais (ração)
 *   1091   - Fabricação de produtos de panificação industrial
 *   4623   - Atacado de matéria-prima agrícola e animais vivos
 *   4632   - Atacado de cereais e leguminosas beneficiados
 *   4634   - Atacado de carnes e produtos animais
 *   4681   - Atacado de combustíveis sólidos/líquidos para agro
 */
const CNAES_AGRO_INDUSTRIAL_PREFIXOS = [
  '01', // qualquer 01.xx
  '1062',
  '1063',
  '1066',
  '1091',
  '4623',
  '4632',
  '4634',
  '4681',
]

/**
 * Mapeamento canônico de flag.id → dimensão.
 */
const DIMENSAO_POR_FLAG: Record<number, DimensaoFlag> = {
  1: 'financeiro', // capital desproporcional
  2: 'estrutural', // endereço compartilhado
  3: 'estrutural', // sócio heterogêneo
  4: 'estrutural', // turnover societário
  5: 'estrutural', // CNAE incompatível
  6: 'compliance', // situação cadastral irregular
  7: 'compliance', // sanções CGU
  8: 'juridico', // processos crescentes
  9: 'reputacao', // notícias negativas
  10: 'estrutural', // empresa jovem com ticket alto
  11: 'digital', // IG ausente
  12: 'digital', // IG mismatch porte
  13: 'digital', // IG abandonado
  14: 'financeiro', // histórico interno inadimplência (hard_fail)
  15: 'financeiro', // forma de pagamento suspeita
  16: 'estrutural', // sócio idade extrema
  17: 'financeiro', // SPC INADIMPLENTE (hard_fail)
}

/**
 * Penalidade de score em pontos percentuais (0-100) aplicada ao cálculo de
 * limite_sugerido. Cada dimensão pesa diferente:
 *   financeiro: 5% por flag ativa
 *   compliance: 10% por flag ativa
 *   juridico:   8% por flag ativa
 *   reputacao:  4% por flag ativa
 *   estrutural: 3% por flag ativa
 *   digital:    2% por flag ativa
 */
const PENALIDADE_LIMITE_POR_DIMENSAO: Record<DimensaoFlag, number> = {
  financeiro: 0.05,
  compliance: 0.1,
  juridico: 0.08,
  reputacao: 0.04,
  estrutural: 0.03,
  digital: 0.02,
}

// ============================================================================
// HELPERS
// ============================================================================

function diasDesde(dataIso: string | null): number | null {
  if (!dataIso) return null
  const d = new Date(dataIso)
  if (isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function processosCrescentes(porAno: Record<string, number> | undefined): boolean {
  if (!porAno) return false
  const anos = Object.keys(porAno)
    .map((a) => parseInt(a, 10))
    .filter((a) => !isNaN(a))
    .sort((a, b) => a - b)
  if (anos.length < 2) return false
  // Pega os ultimos 3 anos (ou todos se menos)
  const ultimos = anos.slice(-3)
  if (ultimos.length < 2) return false
  // Crescente = ano N+1 > ano N em todos os pares
  for (let i = 1; i < ultimos.length; i++) {
    const anoAtual = ultimos[i]
    const anoAnt = ultimos[i - 1]
    if ((porAno[String(anoAtual)] ?? 0) <= (porAno[String(anoAnt)] ?? 0)) {
      return false
    }
  }
  return true
}

function cnaeCompativel(codigo: string | null | undefined): boolean {
  if (!codigo) return true // sem cnae = nao podemos afirmar incompatibilidade
  const codigoLimpo = codigo.replace(/\D/g, '')
  // Compara pelos primeiros 4 digitos
  const prefixo = codigoLimpo.substring(0, 4)
  return CNAES_COMPATIVEIS.includes(prefixo)
}

/**
 * CNAE pertence ao setor agro/agroindustrial?
 * Aceita prefixos de 2 ou 4 dígitos.
 */
function cnaeEhAgro(codigo: string | null | undefined): boolean {
  if (!codigo) return false
  const limpo = codigo.replace(/\D/g, '')
  return CNAES_AGRO_INDUSTRIAL_PREFIXOS.some((prefixo) => limpo.startsWith(prefixo))
}

/**
 * Idade em anos a partir de uma data ISO. Retorna null se data inválida.
 */
function idadeAnos(dataNascimentoIso: string | null | undefined): number | null {
  if (!dataNascimentoIso) return null
  const d = new Date(dataNascimentoIso)
  if (isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  const anos = diffMs / (1000 * 60 * 60 * 24 * 365.25)
  return Math.floor(anos)
}

/**
 * Helper: infere porte da empresa a partir de capital social quando não declarado.
 * micro <= 360k, pequena <= 4.8M, media <= 300M, resto = grande
 * (proxy do critério SEBRAE adaptado).
 */
function inferePorte(
  porteExplicito: 'micro' | 'pequena' | 'media' | 'grande' | null | undefined,
  capitalSocial: number | null | undefined,
): 'micro' | 'pequena' | 'media' | 'grande' {
  if (porteExplicito) return porteExplicito
  const cs = capitalSocial ?? 0
  if (cs <= 360_000) return 'micro'
  if (cs <= 4_800_000) return 'pequena'
  if (cs <= 300_000_000) return 'media'
  return 'grande'
}

// ============================================================================
// AVALIACAO DE RED FLAGS
// ============================================================================

function avaliarFlag1_CapitalDesproporcional(input: DetetiveInput): RedFlag | null {
  const capital = input.opencnpj?.capital_social
  const ticket = input.ticket_pedido
  if (capital == null || ticket == null || ticket <= 0) return null
  const ratio = capital / ticket
  if (ratio >= CAPITAL_TICKET_RATIO_MIN) return null
  return {
    id: 1,
    peso: 5,
    nome: 'Capital social desproporcional ao ticket',
    descricao: `Capital social (R$ ${capital.toLocaleString('pt-BR')}) representa apenas ${(ratio * 100).toFixed(1)}% do ticket do pedido (R$ ${ticket.toLocaleString('pt-BR')}).`,
    evidencia: {
      capital_social: capital,
      ticket_pedido: ticket,
      ratio: Number(ratio.toFixed(4)),
      limite_minimo: CAPITAL_TICKET_RATIO_MIN,
    },
  }
}

function avaliarFlag2_EnderecoCompartilhado(input: DetetiveInput): RedFlag | null {
  const count = input.brasilapi?.endereco_compartilhado_count
  const zona = input.brasilapi?.zona_inferida
  const ehVirtual = zona === 'virtual' || zona === 'compartilhado'
  if (!ehVirtual && (count == null || count < ENDERECO_COMPARTILHADO_LIMITE)) return null
  return {
    id: 2,
    peso: 4,
    nome: 'Endereco compartilhado ou virtual',
    descricao: ehVirtual
      ? `Endereco classificado como "${zona}" - possivel coworking, escritorio virtual ou endereco de fachada.`
      : `${count} empresas distintas registradas no mesmo endereco - indica endereco compartilhado.`,
    evidencia: {
      endereco_compartilhado_count: count ?? null,
      zona_inferida: zona ?? null,
    },
  }
}

function avaliarFlag3_SocioHeterogeneo(input: DetetiveInput): RedFlag | null {
  const reverso = input.socios_reverso ?? []
  const suspeitos = reverso.filter(
    (s) =>
      s.qtd_empresas >= SOCIO_EMPRESAS_LIMITE &&
      s.cnaes_distintos >= SOCIO_CNAES_DISTINTOS_LIMITE,
  )
  if (suspeitos.length === 0) return null
  return {
    id: 3,
    peso: 5,
    nome: 'Socio com participacao em multiplas empresas heterogeneas',
    descricao: `${suspeitos.length} socio(s) participam de >= ${SOCIO_EMPRESAS_LIMITE} empresas com >= ${SOCIO_CNAES_DISTINTOS_LIMITE} CNAEs distintos - perfil compativel com laranja ou empresarios em multiplas areas nao relacionadas.`,
    evidencia: {
      socios_suspeitos: suspeitos,
      total_socios_analisados: reverso.length,
    },
  }
}

function avaliarFlag4_TurnoverSocietario(input: DetetiveInput): RedFlag | null {
  // Sem historico de socios disponivel no input atual.
  // Heuristica disponivel: empresa muito jovem (< 90 dias) com socios novos.
  // Se tivermos mais dados no futuro, melhorar.
  const dias = diasDesde(input.opencnpj?.data_abertura ?? null)
  const numSocios = input.opencnpj?.socios.length ?? 0
  if (dias == null || dias > 90 || numSocios === 0) return null
  // So flagueia se for empresa muito nova com socios (turnover proxy fraco)
  return {
    id: 4,
    peso: 4,
    nome: 'Possivel turnover societario recente',
    descricao: `Empresa aberta ha ${dias} dias com ${numSocios} socio(s) - sem historico consolidado de quadro societario.`,
    evidencia: {
      dias_desde_abertura: dias,
      num_socios_atuais: numSocios,
    },
  }
}

function avaliarFlag5_CNAEIncompativel(input: DetetiveInput): RedFlag | null {
  const cnae = input.opencnpj?.cnae_principal
  if (!cnae) return null
  if (cnaeCompativel(cnae.codigo)) return null
  return {
    id: 5,
    peso: 3,
    nome: 'CNAE incompativel com perfil de cliente Branorte',
    descricao: `CNAE principal (${cnae.codigo} - ${cnae.descricao}) nao bate com os setores tipicos atendidos pela Branorte (metalurgia e agroalimentar).`,
    evidencia: {
      cnae_codigo: cnae.codigo,
      cnae_descricao: cnae.descricao,
      cnaes_esperados: CNAES_COMPATIVEIS,
    },
  }
}

function avaliarFlag6_SituacaoCadastral(input: DetetiveInput): RedFlag | null {
  const situacao = input.opencnpj?.situacao?.toUpperCase().trim() ?? null
  if (!situacao) return null
  if (!SITUACOES_HARD_FAIL.includes(situacao)) return null
  return {
    id: 6,
    peso: 5,
    nome: 'Empresa com situacao cadastral irregular',
    descricao: `Situacao cadastral atual: ${situacao}. Empresa nao apta operacionalmente perante a Receita Federal.`,
    evidencia: {
      situacao_cadastral: situacao,
    },
    hard_fail: true,
  }
}

function avaliarFlag7_SancoesCGU(input: DetetiveInput): RedFlag | null {
  const cgu = input.cgu_sancoes
  if (!cgu) return null
  const total = cgu.ceis + cgu.cnep + cgu.acordos_leniencia + cgu.cepim
  if (total === 0) return null
  const detalhes: string[] = []
  if (cgu.ceis > 0) detalhes.push(`CEIS: ${cgu.ceis}`)
  if (cgu.cnep > 0) detalhes.push(`CNEP: ${cgu.cnep}`)
  if (cgu.acordos_leniencia > 0) detalhes.push(`Acordos Leniencia: ${cgu.acordos_leniencia}`)
  if (cgu.cepim > 0) detalhes.push(`CEPIM: ${cgu.cepim}`)
  return {
    id: 7,
    peso: 5,
    nome: 'Empresa com sancoes registradas na CGU',
    descricao: `Inscricao em listas de sancoes do Portal da Transparencia: ${detalhes.join(', ')}.`,
    evidencia: {
      ceis: cgu.ceis,
      cnep: cgu.cnep,
      acordos_leniencia: cgu.acordos_leniencia,
      cepim: cgu.cepim,
      total: total,
    },
    hard_fail: true,
  }
}

function avaliarFlag8_ProcessosCrescentes(input: DetetiveInput): RedFlag | null {
  const dj = input.datajud
  if (!dj) return null
  // So flagueia se houver crescimento ano-a-ano nos ultimos anos
  if (!processosCrescentes(dj.processos_por_ano)) return null
  return {
    id: 8,
    peso: 4,
    nome: 'Volume de processos judiciais em crescimento',
    descricao: `Total de ${dj.total_processos} processos identificados no DataJud com tendencia de crescimento ano-a-ano.`,
    evidencia: {
      total_processos: dj.total_processos,
      processos_por_ano: dj.processos_por_ano ?? {},
    },
  }
}

function avaliarFlag9_NoticiasNegativas(input: DetetiveInput): RedFlag | null {
  const not = input.noticias
  if (!not || !not.tem_alerta) return null
  const keywords = not.keywords_que_bateram ?? []
  const keywordsCriticas = keywords.filter((k) =>
    KEYWORDS_NOTICIA_CRITICAS.some((critica) => k.toLowerCase().includes(critica)),
  )
  if (keywordsCriticas.length === 0) return null
  return {
    id: 9,
    peso: 5,
    nome: 'Noticias negativas com termos criticos',
    descricao: `Encontradas ${not.total} mencao(oes) na imprensa com termos criticos: ${keywordsCriticas.join(', ')}.`,
    evidencia: {
      total_noticias: not.total,
      keywords_criticas: keywordsCriticas,
      todas_keywords: keywords,
    },
  }
}

function avaliarFlag10_EmpresaJovemTicketAlto(input: DetetiveInput): RedFlag | null {
  const dias = diasDesde(input.opencnpj?.data_abertura ?? null)
  const ticket = input.ticket_pedido
  if (dias == null || ticket == null) return null
  if (dias > EMPRESA_JOVEM_DIAS) return null
  if (ticket < TICKET_ALTO_BRL) return null
  return {
    id: 10,
    peso: 3,
    nome: 'Empresa jovem com ticket de pedido elevado',
    descricao: `Empresa aberta ha apenas ${dias} dias solicitando pedido de R$ ${ticket.toLocaleString('pt-BR')} (>= R$ ${TICKET_ALTO_BRL.toLocaleString('pt-BR')}).`,
    evidencia: {
      dias_desde_abertura: dias,
      ticket_pedido: ticket,
      limite_dias_jovem: EMPRESA_JOVEM_DIAS,
      limite_ticket_alto: TICKET_ALTO_BRL,
    },
  }
}

function avaliarFlag11_IGAusenteTicketAlto(input: DetetiveInput): RedFlag | null {
  const ticket = input.ticket_pedido
  const dias = diasDesde(input.opencnpj?.data_abertura ?? null)
  const ig = input.instagram
  if (ticket == null || ticket <= TICKET_ALTO_IG_AUSENTE_BRL) return null
  if (dias == null || dias <= EMPRESA_MADURA_DIAS) return null
  // Se IG vier null/undefined, considera "nao buscado" -> nao flagueia
  // So flagueia se ig foi consultado E perfil_encontrado=false
  if (!ig) return null
  if (ig.perfil_encontrado) return null
  return {
    id: 11,
    peso: 2,
    nome: 'Empresa madura de ticket alto sem presenca digital (Instagram)',
    descricao: `Empresa aberta ha ${dias} dias com pedido de R$ ${ticket.toLocaleString('pt-BR')} (> R$ ${TICKET_ALTO_IG_AUSENTE_BRL.toLocaleString('pt-BR')}) nao possui perfil no Instagram. Sinal de baixa presenca digital.`,
    evidencia: {
      ticket_pedido: ticket,
      dias_desde_abertura: dias,
      perfil_encontrado: false,
      limite_ticket: TICKET_ALTO_IG_AUSENTE_BRL,
      limite_dias_empresa_madura: EMPRESA_MADURA_DIAS,
    },
  }
}

function avaliarFlag12_IGMismatchPorte(input: DetetiveInput): RedFlag | null {
  const ig = input.instagram
  if (!ig || !ig.perfil_encontrado) return null
  const seguidores = ig.seguidores
  if (seguidores == null || seguidores >= IG_SEGUIDORES_BAIXO) return null
  const dias = diasDesde(input.opencnpj?.data_abertura ?? null)
  const empresaAntiga = dias != null && dias > EMPRESA_ANTIGA_DIAS
  // Heuristica de "faturamento alto" sem dados diretos: usa ticket alto como proxy
  const ticket = input.ticket_pedido
  const faturamentoPresumidoAlto = ticket != null && ticket >= TICKET_ALTO_BRL
  if (!empresaAntiga && !faturamentoPresumidoAlto) return null
  const motivos: string[] = []
  if (empresaAntiga) motivos.push(`empresa antiga (${dias} dias)`)
  if (faturamentoPresumidoAlto)
    motivos.push(`ticket elevado (R$ ${ticket!.toLocaleString('pt-BR')})`)
  return {
    id: 12,
    peso: 3,
    nome: 'Instagram com seguidores incompativeis com porte da empresa',
    descricao: `Perfil com apenas ${seguidores} seguidores (< ${IG_SEGUIDORES_BAIXO}) destoa do perfil esperado: ${motivos.join(' e ')}.`,
    evidencia: {
      seguidores,
      limite_seguidores_baixo: IG_SEGUIDORES_BAIXO,
      dias_desde_abertura: dias ?? null,
      empresa_antiga: empresaAntiga,
      ticket_pedido: ticket ?? null,
      faturamento_presumido_alto: faturamentoPresumidoAlto,
    },
  }
}

function avaliarFlag13_IGAbandonado(input: DetetiveInput): RedFlag | null {
  const ig = input.instagram
  if (!ig || !ig.perfil_encontrado) return null
  const ultimoPost = ig.data_ultimo_post
  if (!ultimoPost) return null
  const diasSemPostar = diasDesde(ultimoPost)
  if (diasSemPostar == null) return null
  if (diasSemPostar <= IG_ULTIMO_POST_DIAS_LIMITE) return null
  return {
    id: 13,
    peso: 3,
    nome: 'Instagram abandonado (sem posts ha mais de 12 meses)',
    descricao: `Ultimo post no Instagram ha ${diasSemPostar} dias (> ${IG_ULTIMO_POST_DIAS_LIMITE}). Empresa pode estar inativa ou paralisada.`,
    evidencia: {
      data_ultimo_post: ultimoPost,
      dias_sem_postar: diasSemPostar,
      limite_dias: IG_ULTIMO_POST_DIAS_LIMITE,
    },
  }
}

// ============================================================================
// RED FLAGS NOVAS (F14, F15, F16)
// ============================================================================

/**
 * F14 — Histórico interno Branorte com inadimplência ATIVA.
 * Hard fail: cliente já tem inadimplência aberta na casa.
 */
function avaliarFlag14_HistInadimplenciaInterno(input: DetetiveInput): RedFlag | null {
  const hist = input.historico_branorte
  if (!hist) return null
  if (hist.inadimplencia_brl <= 0) return null
  return {
    id: 14,
    peso: 5,
    nome: 'Histórico interno Branorte com inadimplência ativa',
    descricao: `Cliente já possui R$ ${hist.inadimplencia_brl.toLocaleString('pt-BR')} em inadimplência aberta na Branorte. Bloqueio até regularização.`,
    evidencia: {
      compras_pagas: hist.compras_pagas,
      total_brl: hist.total_brl,
      inadimplencia_brl: hist.inadimplencia_brl,
      ultima_compra_data: hist.ultima_compra_data ?? null,
    },
    hard_fail: true,
  }
}

/**
 * F15 — Forma de pagamento suspeita (100% parcelado sem entrada em ticket alto).
 */
function avaliarFlag15_FormaPagamentoSuspeita(input: DetetiveInput): RedFlag | null {
  const ctx = input.contexto_orcamento
  if (!ctx) return null
  const valor = ctx.valor_total ?? 0
  if (valor < TICKET_PAGAMENTO_SUSPEITO_BRL) return null
  if (ctx.forma_pagamento !== 'parcelado_sem_sinal') return null
  return {
    id: 15,
    peso: 3,
    nome: 'Forma de pagamento suspeita',
    descricao: `Cotação de R$ ${valor.toLocaleString('pt-BR')} (> R$ ${TICKET_PAGAMENTO_SUSPEITO_BRL.toLocaleString('pt-BR')}) sendo proposta 100% parcelada SEM entrada. Padrão atípico — pedir entrada ou aval.`,
    evidencia: {
      valor_total: valor,
      forma_pagamento: ctx.forma_pagamento,
      ticket_categoria: ctx.ticket_categoria ?? null,
    },
  }
}

/**
 * F16 — Sócio com idade extrema (< 25 ou > 80 anos).
 * Proxy fraco de laranja — só ativa quando data_nascimento disponível.
 */
function avaliarFlag16_SocioIdadeExtrema(input: DetetiveInput): RedFlag | null {
  const socios = input.opencnpj?.socios ?? []
  if (socios.length === 0) return null
  const extremos: Array<{ nome: string; idade: number }> = []
  for (const s of socios) {
    const idade = idadeAnos(s.data_nascimento)
    if (idade == null) continue
    if (idade < SOCIO_IDADE_MINIMA || idade > SOCIO_IDADE_MAXIMA) {
      extremos.push({ nome: s.nome, idade })
    }
  }
  if (extremos.length === 0) return null
  return {
    id: 16,
    peso: 3,
    nome: 'Sócio com idade extrema',
    descricao: `${extremos.length} sócio(s) fora da faixa típica (${SOCIO_IDADE_MINIMA}-${SOCIO_IDADE_MAXIMA} anos): ${extremos.map((e) => `${e.nome} (${e.idade} anos)`).join('; ')}. Proxy fraco de testa-de-ferro — confirmar atividade real.`,
    evidencia: {
      socios_extremos: extremos,
      faixa_normal: { min: SOCIO_IDADE_MINIMA, max: SOCIO_IDADE_MAXIMA },
    },
  }
}

/**
 * F17 — SPC INADIMPLENTE / Score zerado / Classe F / Inadimplência ativa.
 * Hard fail: apontamento ativo no SPC requer regularização antes de qualquer venda.
 *
 * Triggers (qualquer um basta):
 *   - input.spc.score.classificacao === 'INADIMPLENTE'
 *   - input.spc.score.classificacao === 'F' (classe F)
 *   - input.spc.score.valor === 0
 *   - input.spc.inadimplencias.qtd > 0
 */
function avaliarFlag17_ScoreInadimplenteSPC(input: DetetiveInput): RedFlag | null {
  const spc = input.spc
  if (!spc) return null

  const classificacao = (spc.score?.classificacao ?? '').toString().trim().toUpperCase()
  const valor = spc.score?.valor
  const qtdInadimplencias = spc.inadimplencias?.qtd ?? 0
  const valorTotalInadimplencias = spc.inadimplencias?.valor_total_brl ?? 0

  const triggerClassificacao = classificacao === 'INADIMPLENTE'
  const triggerClasseF =
    classificacao === 'F' ||
    classificacao === 'CLASSE F' ||
    classificacao === 'CLASSE_F'
  const triggerScoreZero = typeof valor === 'number' && valor === 0
  const triggerInadimplencia = typeof qtdInadimplencias === 'number' && qtdInadimplencias > 0

  if (
    !triggerClassificacao &&
    !triggerClasseF &&
    !triggerScoreZero &&
    !triggerInadimplencia
  ) {
    return null
  }

  const motivos: string[] = []
  if (triggerClassificacao) motivos.push(`classificação SPC: ${classificacao}`)
  if (triggerClasseF && !triggerClassificacao) motivos.push(`classe SPC: ${classificacao}`)
  if (triggerScoreZero) motivos.push('score SPC = 0')
  if (triggerInadimplencia) {
    motivos.push(
      `${qtdInadimplencias} inadimplência(s) ativa(s)` +
        (valorTotalInadimplencias > 0
          ? ` (R$ ${valorTotalInadimplencias.toLocaleString('pt-BR')})`
          : ''),
    )
  }

  return {
    id: 17,
    peso: 5,
    nome: 'SPC com classificação INADIMPLENTE / score zerado / inadimplência ativa',
    descricao: `SPC retornou classificação INADIMPLENTE/score 0 ou há inadimplência ativa: ${motivos.join('; ')}. Bloqueio total até regularização.`,
    evidencia: {
      classificacao: spc.score?.classificacao ?? null,
      score_valor: valor ?? null,
      qtd_inadimplencias: qtdInadimplencias,
      valor_total_inadimplencias_brl: valorTotalInadimplencias,
      detalhes: spc.inadimplencias?.detalhes ?? null,
    },
    hard_fail: true,
  }
}

// ============================================================================
// MOTOR PRINCIPAL
// ============================================================================

/**
 * MAX_SCORE histórico (legado): 51 = soma fixa dos pesos das 13 flags originais.
 * Mantido pra compatibilidade com `score` (campo legado) — não inclui F14-F17
 * para preservar a escala antiga consumida por integrações legadas.
 * O novo cálculo usa max_score_aplicavel dinâmico — soma só dos pesos que foram
 * considerados (i.e. tinham dado suficiente).
 */
const MAX_SCORE = 51 // soma dos pesos: 5+4+5+4+3+5+5+4+5+3+2+3+3

function gerarRecomendacao(
  semaforo: 'verde' | 'amarelo' | 'vermelho',
  hardFail: boolean,
  comboFraude: boolean,
): string {
  if (hardFail) {
    return 'BLOQUEAR. Empresa apresenta restricao critica (situacao cadastral irregular ou sancao oficial). Nao prosseguir com a venda sem regularizacao formal e revisao juridica.'
  }
  if (comboFraude) {
    return 'BLOQUEAR. Combinacao de flags caracteriza padrao tipico de fraude (capital desproporcional + socio em multiplas empresas + empresa jovem com ticket alto). Recusar negociacao ou exigir garantias reais robustas.'
  }
  if (semaforo === 'vermelho') {
    return 'ALTO RISCO. Indicios significativos de problemas. Exigir garantias reforcadas, aval pessoal e analise juridica antes de fechar.'
  }
  if (semaforo === 'amarelo') {
    return 'RISCO MODERADO. Prosseguir com cautela: sinal maior, condicoes mais conservadoras e acompanhamento proximo do pos-venda.'
  }
  return 'BAIXO RISCO. Empresa apresenta perfil aderente ao ICP Branorte. Prosseguir conforme politica comercial padrao.'
}

function gerarAcoesSugeridas(
  semaforo: 'verde' | 'amarelo' | 'vermelho',
  flagsAtivas: RedFlag[],
  hardFail: boolean,
): string[] {
  const acoes: string[] = []

  if (hardFail) {
    acoes.push('Recusar formalmente a negociacao ate regularizacao documental.')
    acoes.push('Encaminhar caso para revisao juridica antes de qualquer contato comercial.')
    return acoes
  }

  if (semaforo === 'vermelho') {
    acoes.push('Exigir sinal de no minimo 50% antes do inicio da fabricacao.')
    acoes.push('Solicitar aval pessoal de socios com bens pessoais comprovados.')
    acoes.push('Pedir garantia real (imovel, veiculo ou carta fianca bancaria).')
    acoes.push('Validar referencias comerciais com 3 fornecedores ativos.')
  } else if (semaforo === 'amarelo') {
    acoes.push('Exigir sinal de 30-40% (acima da politica padrao de 20%).')
    acoes.push('Solicitar aval pessoal dos socios majoritarios.')
    acoes.push('Validar pelo menos 2 referencias comerciais antes de fechar.')
  } else {
    acoes.push('Seguir politica comercial padrao (sinal usual + parcelamento padrao).')
  }

  // Acoes especificas por flag ativa
  for (const flag of flagsAtivas) {
    if (flag.id === 5) {
      acoes.push('Confirmar com o cliente o uso real do equipamento (CNAE diverge do esperado).')
    }
    if (flag.id === 2) {
      acoes.push('Visitar fisicamente o endereco antes da entrega ou exigir comprovante de operacao no local.')
    }
    if (flag.id === 8) {
      acoes.push('Detalhar com o juridico os processos em aberto (consultar DataJud diretamente).')
    }
    if (flag.id === 11) {
      acoes.push('Pedir referencias comerciais ja que a empresa nao tem presenca digital relevante.')
    }
    if (flag.id === 12) {
      acoes.push('Verificar se o faturamento declarado e coerente com presenca online.')
    }
    if (flag.id === 13) {
      acoes.push('Empresa pode estar parada - confirmar atividade comercial recente.')
    }
  }

  return acoes
}

// ============================================================================
// FUNÇÕES AUXILIARES NOVAS (sub-scores, modificadores, semáforo, limite, cenários)
// ============================================================================

/**
 * Anexa o campo `dimensao` a uma flag conforme o mapeamento canônico.
 */
function anexarDimensao(flag: RedFlag): RedFlag {
  if (flag.dimensao) return flag
  return { ...flag, dimensao: DIMENSAO_POR_FLAG[flag.id] }
}

/**
 * Soma de pesos máximos por dimensão considerando o catálogo COMPLETO de flags
 * mapeadas em DIMENSAO_POR_FLAG. Pesos canônicos (espelham os retornados pelos
 * avaliadores):
 *   F01:5 F02:4 F03:5 F04:4 F05:3 F06:5 F07:5 F08:4 F09:5 F10:3
 *   F11:2 F12:3 F13:3 F14:5 F15:3 F16:3 F17:5
 */
const PESOS_CANONICOS: Record<number, number> = {
  1: 5, 2: 4, 3: 5, 4: 4, 5: 3, 6: 5, 7: 5, 8: 4, 9: 5, 10: 3,
  11: 2, 12: 3, 13: 3, 14: 5, 15: 3, 16: 3, 17: 5,
}

function pesosMaxPorDimensao(): Record<DimensaoFlag, number> {
  const res: Record<DimensaoFlag, number> = {
    financeiro: 0,
    compliance: 0,
    reputacao: 0,
    juridico: 0,
    estrutural: 0,
    digital: 0,
  }
  for (const [idStr, peso] of Object.entries(PESOS_CANONICOS)) {
    const id = parseInt(idStr, 10)
    const dim = DIMENSAO_POR_FLAG[id]
    if (dim) res[dim] += peso
  }
  return res
}

/**
 * Calcula sub-scores 0-100 por dimensão (MAIOR=MELHOR).
 * Quando max=0 (dimensão sem flags catalogadas), retorna 100 (limpo).
 */
export function calcularSubScores(
  flags: RedFlag[],
  pesos_max_por_dimensao: Record<DimensaoFlag, number> = pesosMaxPorDimensao(),
): SubScores {
  const somaPorDim: Record<DimensaoFlag, number> = {
    financeiro: 0,
    compliance: 0,
    reputacao: 0,
    juridico: 0,
    estrutural: 0,
    digital: 0,
  }
  for (const f of flags) {
    const dim = f.dimensao ?? DIMENSAO_POR_FLAG[f.id]
    if (!dim) continue
    somaPorDim[dim] += f.peso
  }
  const calc = (dim: DimensaoFlag): number => {
    const max = pesos_max_por_dimensao[dim]
    if (max <= 0) return 100
    const detectada = Math.min(somaPorDim[dim], max)
    return Math.max(0, Math.min(100, Math.round(((max - detectada) / max) * 100)))
  }
  return {
    financeiro: calc('financeiro'),
    compliance: calc('compliance'),
    reputacao: calc('reputacao'),
    juridico: calc('juridico'),
    estrutural: calc('estrutural'),
    digital: calc('digital'),
  }
}

/**
 * Modificador setorial: se CNAE é agro/agroindustrial, reduz peso efetivo das
 * flags digitais F11/F12/F13 em 70% (ausência de pegada digital é normal).
 * Retorna delta positivo (melhora score) e flags ajustadas para uso downstream.
 */
export function aplicaModificadorSetorial(
  cnae: string | null | undefined,
  flags: RedFlag[],
): {
  delta: number
  nota: string
  aplicado: boolean
  flags_ajustadas: RedFlag[]
} {
  if (!cnaeEhAgro(cnae)) {
    return { delta: 0, nota: '', aplicado: false, flags_ajustadas: flags }
  }
  // Flags digitais: F11, F12, F13
  const idsDigitais = new Set([11, 12, 13])
  let pesoAntes = 0
  let pesoDepois = 0
  const ajustadas = flags.map((f) => {
    if (!idsDigitais.has(f.id)) return f
    pesoAntes += f.peso
    const novoPeso = Math.max(1, Math.round(f.peso * 0.3)) as 1 | 2 | 3 | 4 | 5
    pesoDepois += novoPeso
    return { ...f, peso: novoPeso }
  })
  const deltaPesos = pesoAntes - pesoDepois
  // delta em pontos de score: aproximadamente deltaPesos / MAX_SCORE * 100
  const delta = Math.round((deltaPesos / Math.max(MAX_SCORE, 1)) * 100)
  return {
    delta,
    nota:
      delta > 0
        ? `score ajustado +${delta} pts pelo segmento agro (pegada digital reduzida — normal pro setor)`
        : 'CNAE agro detectado mas sem flags digitais ativas',
    aplicado: true,
    flags_ajustadas: ajustadas,
  }
}

/**
 * Modificador histórico Branorte:
 * - Se inadimplencia > 0 → Flag 14 já fez hard_fail (NÃO sobrepõe).
 * - Se compras_pagas ≥ 3 E inadimplencia = 0 E última compra < 12 meses → bônus
 *   +10 pts no score E permite SUBIR semáforo 1 nível (vermelho→amarelo,
 *   amarelo→verde) em cenários à-vista e prazo curto. NÃO sobrepõe FINAME.
 */
export function aplicaModificadorHistoricoBranorte(
  historico:
    | {
        compras_pagas: number
        total_brl: number
        inadimplencia_brl: number
        ultima_compra_data?: string | null
      }
    | null
    | undefined,
): {
  delta: number
  motivo: string
  aplicado: boolean
  pode_sobrepor_externo: boolean
} {
  if (!historico) return { delta: 0, motivo: '', aplicado: false, pode_sobrepor_externo: false }
  if (historico.inadimplencia_brl > 0) {
    return {
      delta: 0,
      motivo:
        'Inadimplência interna ativa — Flag 14 (hard_fail) bloqueia qualquer sobreposição.',
      aplicado: false,
      pode_sobrepor_externo: false,
    }
  }
  const dias = diasDesde(historico.ultima_compra_data ?? null)
  const ultimaRecente = dias != null && dias < 365
  if (historico.compras_pagas < 3 || !ultimaRecente) {
    return { delta: 0, motivo: '', aplicado: false, pode_sobrepor_externo: false }
  }
  return {
    delta: 10,
    motivo: `Cliente recorrente: ${historico.compras_pagas} compras pagas (R$ ${historico.total_brl.toLocaleString('pt-BR')}), última há ${dias} dias, zero inadimplência. Histórico INTERNO sobrepõe sinais externos em cenários à-vista e 28/56/84.`,
    aplicado: true,
    pode_sobrepor_externo: true,
  }
}

/**
 * Escalonamento dinâmico do semáforo por ticket.
 * Resolve o problema de thresholds globais hardcoded — ticket maior exige
 * score mais alto pra ficar verde.
 */
export function decideSemaforo(
  score_normalizado: number,
  ticket_brl: number,
  hard_fail: boolean,
): 'verde' | 'amarelo' | 'vermelho' {
  if (hard_fail) return 'vermelho'
  const ticket = ticket_brl > 0 ? ticket_brl : 100_000 // default presumido
  let verdeMin: number
  let amareloMin: number
  if (ticket < 50_000) {
    verdeMin = 30
    amareloMin = 15
  } else if (ticket < 150_000) {
    verdeMin = 50
    amareloMin = 30
  } else if (ticket < 500_000) {
    verdeMin = 65
    amareloMin = 45
  } else {
    verdeMin = 75
    amareloMin = 55
  }
  if (score_normalizado >= verdeMin) return 'verde'
  if (score_normalizado >= amareloMin) return 'amarelo'
  return 'vermelho'
}

/**
 * Sobe o semáforo em 1 nível (utilitário usado pelos cenários à-vista/FINAME e
 * pelo bônus do histórico Branorte).
 */
function subirSemaforo(s: 'verde' | 'amarelo' | 'vermelho'): 'verde' | 'amarelo' | 'vermelho' {
  if (s === 'vermelho') return 'amarelo'
  if (s === 'amarelo') return 'verde'
  return 'verde'
}

/**
 * Fórmula auditável de limite sugerido em R$.
 *
 *   base = MIN(
 *     faturamento_anual × 0.10 × 12 (capacidade real de pagamento),
 *     capital_social × multiplicador_porte,
 *     valor_cotacao (nunca passa do ticket)
 *   )
 *   limite = base × score_modifier × (1 - penalidades_red_flags_pct)
 *
 * multiplicador_porte: micro=3, pequena=2, media=1.5, grande=1.2
 * score_modifier:    ≥80 → 1.0, 60-79 → 0.7, 40-59 → 0.4, <40 → 0.0
 *
 * penalidades_red_flags_pct: soma das penalidades de flags ativas
 * (financeiro: 5%, compliance: 10%, juridico: 8%, reputacao: 4%,
 *  estrutural: 3%, digital: 2%). Clampado em [0, 0.95].
 */
export function calcularLimiteSugerido(input: {
  capital_social: number
  faturamento_presumido?: number | null
  idade_empresa_anos?: number
  valor_cotacao: number
  score_normalizado: number
  hard_fail: boolean
  cnae_porte: 'micro' | 'pequena' | 'media' | 'grande'
  flags?: RedFlag[]
}): number {
  if (input.hard_fail) return 0
  const cap = Math.max(0, input.capital_social || 0)
  const fat = input.faturamento_presumido && input.faturamento_presumido > 0 ? input.faturamento_presumido : null
  const cot = Math.max(0, input.valor_cotacao || 0)

  const multiplicadorPorte: Record<'micro' | 'pequena' | 'media' | 'grande', number> = {
    micro: 3,
    pequena: 2,
    media: 1.5,
    grande: 1.2,
  }
  const fatPorMes = fat != null ? fat * 0.1 * 12 : Number.POSITIVE_INFINITY
  const capPorMult = cap * multiplicadorPorte[input.cnae_porte]
  const cotMax = cot > 0 ? cot : Number.POSITIVE_INFINITY
  const base = Math.min(fatPorMes, capPorMult, cotMax)
  if (!isFinite(base) || base <= 0) return 0

  let scoreModifier: number
  if (input.score_normalizado >= 80) scoreModifier = 1.0
  else if (input.score_normalizado >= 60) scoreModifier = 0.7
  else if (input.score_normalizado >= 40) scoreModifier = 0.4
  else scoreModifier = 0.0

  // Penalidade por flags ativas
  let penalidade = 0
  for (const f of input.flags ?? []) {
    const dim = f.dimensao ?? DIMENSAO_POR_FLAG[f.id]
    if (!dim) continue
    penalidade += PENALIDADE_LIMITE_POR_DIMENSAO[dim] ?? 0
  }
  penalidade = Math.min(0.95, penalidade)

  const limite = base * scoreModifier * (1 - penalidade)
  return Math.max(0, Math.round(limite))
}

/**
 * Calcula os 3 cenários A/B/C sempre. Cenário pode ficar com limite_max=0 e
 * semaforo=vermelho se for inviável — a UI decide se mostra ou esconde.
 */
export function calcularCenarios(
  input: DetetiveInput,
  limite_global: number,
  semaforo_global: 'verde' | 'amarelo' | 'vermelho',
): Cenario[] {
  // (A) À VISTA — risco menor → semáforo melhora 1 nível, limite × 1.5
  const semaforoAvista = subirSemaforo(semaforo_global)
  const cenarioAvista: Cenario = {
    tipo: 'a_vista',
    condicao: 'À vista (antes da expedição) — desconto comercial 3% sobre o valor cheio',
    semaforo: input.historico_branorte?.inadimplencia_brl ? 'vermelho' : semaforoAvista,
    limite_max_brl: Math.round(limite_global * 1.5),
    entrada_minima_pct: 100,
    parcelas_maximas: 1,
    exigencias: ['NF eletrônica padrão', 'Pagamento confirmado antes da expedição'],
    prazo_aprovacao_interna_dias: 0,
  }

  // (B) PRAZO CURTO 28/56/84 com sinal 30% — semáforo = global
  const exigenciasB: string[] = (() => {
    if (semaforo_global === 'verde') return ['ATA constitutiva atualizada']
    if (semaforo_global === 'amarelo')
      return [
        'ATA constitutiva atualizada',
        'Comprovante de endereço < 90 dias',
        '2 referências comerciais ativas',
      ]
    return [
      'Aval pessoal cobrindo 100% do valor',
      'Comprovante de endereço < 90 dias',
      'Carta-fiança bancária OU garantia real',
    ]
  })()
  const cenarioCurto: Cenario = {
    tipo: 'prazo_curto',
    condicao: '28/56/84 com sinal de 30%',
    semaforo: semaforo_global,
    limite_max_brl: limite_global,
    entrada_minima_pct: 30,
    parcelas_maximas: 3,
    exigencias: exigenciasB,
    prazo_aprovacao_interna_dias: 1,
  }

  // (C) FINAME / CONSÓRCIO — banco assume risco → semáforo melhora 1 nível, limite × 2
  // Mas histórico Branorte NÃO sobrepõe FINAME (regra explícita).
  const semaforoFiname = subirSemaforo(semaforo_global)
  const cenarioFiname: Cenario = {
    tipo: 'finame',
    condicao: 'FINAME ou Consórcio (banco assume risco) — entrada 20% + 60 parcelas',
    semaforo: input.contexto_orcamento?.forma_pagamento === 'finame' || semaforoFiname !== 'vermelho'
      ? semaforoFiname
      : 'vermelho',
    limite_max_brl: Math.round(limite_global * 2),
    entrada_minima_pct: 20,
    parcelas_maximas: 60,
    exigencias: [
      'FINAME aprovado pelo banco OU carta-fiança bancária',
      'Cópia da carta de aprovação antes da emissão da NF',
    ],
    prazo_aprovacao_interna_dias: 15,
  }

  return [cenarioAvista, cenarioCurto, cenarioFiname]
}

/**
 * Gera string descritiva do cenário recomendado default.
 */
function gerarCondicaoDefault(
  semaforo: 'verde' | 'amarelo' | 'vermelho',
  hard_fail: boolean,
): string {
  if (hard_fail) return 'nao_vender'
  if (semaforo === 'verde') return 'prazo_curto'
  if (semaforo === 'amarelo') return 'prazo_curto_com_garantia'
  return 'a_vista_ou_finame'
}

/**
 * Função principal. Ordem de execução:
 *   1. detectar TODAS flags ativas (13 originais + 4 novas: F14-F17)
 *   2. anexar dimensão canônica
 *   3. checar hard_fails — se algum, montar resultado vermelho imediato
 *      (SPC INADIMPLENTE/Classe F/F17 OU histórico interno F14 zeram TODOS os
 *       cenários — nem à vista é permitido)
 *   4. calcular sub_scores brutos
 *   5. aplicar modificador setorial (reduz peso digital em CNAE agro)
 *   6. aplicar modificador histórico Branorte (pode sobrepor)
 *   7. calcular score legado (MAIOR=PIOR) e score normalizado (MAIOR=MELHOR)
 *   8. decidir semáforo por ticket
 *   9. calcular limite sugerido
 *  10. calcular cenários A/B/C
 *  11. retornar resultado completo
 *
 * Mantém retrocompatibilidade: campos `score`, `semaforo`, `recomendacao`,
 * `red_flags`, `acoes_sugeridas` permanecem com a mesma semântica.
 */
export function calcularDossie(input: DetetiveInput): DossieResultado {
  // 1. Avalia TODAS flags (13 originais + 4 novas)
  const avaliacoes: Array<RedFlag | null> = [
    avaliarFlag1_CapitalDesproporcional(input),
    avaliarFlag2_EnderecoCompartilhado(input),
    avaliarFlag3_SocioHeterogeneo(input),
    avaliarFlag4_TurnoverSocietario(input),
    avaliarFlag5_CNAEIncompativel(input),
    avaliarFlag6_SituacaoCadastral(input),
    avaliarFlag7_SancoesCGU(input),
    avaliarFlag8_ProcessosCrescentes(input),
    avaliarFlag9_NoticiasNegativas(input),
    avaliarFlag10_EmpresaJovemTicketAlto(input),
    avaliarFlag11_IGAusenteTicketAlto(input),
    avaliarFlag12_IGMismatchPorte(input),
    avaliarFlag13_IGAbandonado(input),
    avaliarFlag14_HistInadimplenciaInterno(input),
    avaliarFlag15_FormaPagamentoSuspeita(input),
    avaliarFlag16_SocioIdadeExtrema(input),
    avaliarFlag17_ScoreInadimplenteSPC(input),
  ]

  // 2. Anexa dimensão canônica
  const redFlagsBrutas = avaliacoes
    .filter((f): f is RedFlag => f !== null)
    .map(anexarDimensao)

  // Detecta overrides clássicos
  const hardFail = redFlagsBrutas.some((f) => f.hard_fail === true)
  const idsAtivos = new Set(redFlagsBrutas.map((f) => f.id))
  const comboFraude = idsAtivos.has(1) && idsAtivos.has(3) && idsAtivos.has(10)
  const hardFailMotivo = (() => {
    const hf = redFlagsBrutas.find((f) => f.hard_fail)
    if (hf) return hf.nome
    if (comboFraude)
      return 'Combinação F01+F03+F10 — perfil típico de fraude (capital desproporcional + sócio em múltiplas empresas + empresa jovem com ticket alto)'
    return undefined
  })()

  // 5. Modificador setorial (reduz peso digital se CNAE agro)
  const cnaePrincipal = input.opencnpj?.cnae_principal?.codigo ?? null
  const modSetorial = aplicaModificadorSetorial(cnaePrincipal, redFlagsBrutas)
  const redFlags = modSetorial.flags_ajustadas

  // 6. Modificador histórico Branorte
  const modHist = aplicaModificadorHistoricoBranorte(input.historico_branorte)

  // 4. Sub-scores (a partir das flags ajustadas)
  const sub_scores = calcularSubScores(redFlags)

  // 7. Score legado (MAIOR=PIOR, mantém compatibilidade)
  const somaAtual = redFlags.reduce((acc, f) => acc + f.peso, 0)
  let score = Math.round((somaAtual / MAX_SCORE) * 100)
  if (score > 100) score = 100
  if (score < 0) score = 0

  // Score normalizado (MAIOR=MELHOR) — usa max APLICÁVEL dinâmico (soma dos
  // pesos canônicos de todas as flags que poderiam ter sido avaliadas nesta
  // execução). Hoje todas estão sempre no catálogo, mas mantemos esse mapeamento
  // pra suportar inclusão futura de flags opt-in.
  const somaPesosAplicaveis = avaliacoes.reduce<number>((acc, _f, i) => {
    const id = i + 1
    return acc + (PESOS_CANONICOS[id] ?? 0)
  }, 0)
  const max_score = somaPesosAplicaveis || MAX_SCORE
  let score_normalizado = Math.round(100 - (somaAtual / max_score) * 100)
  // Aplica deltas dos modificadores
  score_normalizado += modSetorial.delta + modHist.delta
  score_normalizado = Math.max(0, Math.min(100, score_normalizado))

  // 3. Hard-fail short-circuit: monta resultado vermelho e retorna direto
  //    (mas mantém sub_scores e cenários pra UI renderizar contexto).
  if (hardFail) {
    const ticketHF = input.contexto_orcamento?.valor_total ?? input.ticket_pedido ?? 0
    const semaforoHF: 'verde' | 'amarelo' | 'vermelho' = 'vermelho'

    // Detecta hard-fail de inadimplência ATIVA SPC (F17 ou classe F).
    // Quando há apontamento ativo no SPC, TODOS os cenários ficam com limite=0 e
    // semáforo=vermelho — não há venda possível, nem à vista.
    // Inadimplência interna (F14) também zera tudo (cliente já deve pra casa).
    const spcClassificacao = (input.spc?.score?.classificacao ?? '')
      .toString()
      .trim()
      .toUpperCase()
    const spcClasseF =
      spcClassificacao === 'F' ||
      spcClassificacao === 'CLASSE F' ||
      spcClassificacao === 'CLASSE_F'
    const inadimplenciaSpcAtiva =
      idsAtivos.has(17) ||
      spcClasseF ||
      (typeof input.spc?.inadimplencias?.qtd === 'number' &&
        (input.spc?.inadimplencias?.qtd ?? 0) > 0)
    const inadimplenciaInternaAtiva =
      idsAtivos.has(14) ||
      (typeof input.historico_branorte?.inadimplencia_brl === 'number' &&
        (input.historico_branorte?.inadimplencia_brl ?? 0) > 0)
    const inadimplenciaAtiva = inadimplenciaSpcAtiva || inadimplenciaInternaAtiva

    const cenariosHF = calcularCenarios(input, 0, semaforoHF).map((c) => {
      if (inadimplenciaAtiva) {
        // Apontamento ativo (SPC ou interno): NENHUM cenário viável,
        // todos limite=0/vermelho.
        return { ...c, semaforo: 'vermelho' as const, limite_max_brl: 0 }
      }
      // Hard fail "tradicional" (situação cadastral, CGU): à-vista ainda
      // possível com 50% do ticket, demais bloqueados.
      return c.tipo === 'a_vista'
        ? {
            ...c,
            semaforo: 'amarelo' as const,
            limite_max_brl: Math.max(0, Math.round(ticketHF * 0.5)),
          }
        : { ...c, semaforo: 'vermelho' as const, limite_max_brl: 0 }
    })

    // Recomendação especializada conforme tipo de inadimplência ativa.
    let recomendacaoHF: string
    if (inadimplenciaSpcAtiva) {
      recomendacaoHF =
        'NAO VENDER. Apontamento ativo no SPC requer regularizacao antes de qualquer venda.'
    } else if (inadimplenciaInternaAtiva) {
      recomendacaoHF =
        'NAO VENDER. Cliente possui inadimplencia interna ativa na Branorte — bloqueio ate regularizacao do debito existente.'
    } else {
      recomendacaoHF = gerarRecomendacao(semaforoHF, true, comboFraude)
    }

    return {
      cnpj: input.cnpj,
      score,
      score_normalizado,
      max_score,
      semaforo: semaforoHF,
      recomendacao: recomendacaoHF,
      red_flags: redFlags,
      acoes_sugeridas: gerarAcoesSugeridas(semaforoHF, redFlags, true),
      sub_scores,
      modificador_setorial: {
        aplicado: modSetorial.aplicado,
        motivo: modSetorial.nota || undefined,
        pontos: modSetorial.delta,
      },
      modificador_historico_branorte: {
        aplicado: modHist.aplicado,
        motivo: modHist.motivo || undefined,
        pontos: modHist.delta,
        pode_sobrepor_externo: modHist.pode_sobrepor_externo,
      },
      limite_sugerido_brl: 0,
      condicao_default: 'nao_vender',
      cenarios: cenariosHF,
      hard_fail: true,
      hard_fail_motivo: hardFailMotivo,
    }
  }

  // 8. Semáforo dinâmico por ticket
  const ticket = input.contexto_orcamento?.valor_total ?? input.ticket_pedido ?? 0
  let semaforo = decideSemaforo(score_normalizado, ticket, false)
  if (comboFraude) semaforo = 'vermelho'
  // Histórico Branorte pode SOBREPOR semáforo (sobe 1 nível em cenários
  // à-vista / 28-56-84; NÃO em FINAME — isso é tratado dentro de calcularCenarios).
  if (modHist.pode_sobrepor_externo) {
    semaforo = subirSemaforo(semaforo)
  }

  // 9. Limite sugerido
  const porte = inferePorte(input.porte_empresa, input.opencnpj?.capital_social)
  const idadeDias = diasDesde(input.opencnpj?.data_abertura ?? null)
  const limite_sugerido_brl = calcularLimiteSugerido({
    capital_social: input.opencnpj?.capital_social ?? 0,
    faturamento_presumido: input.faturamento_presumido_anual ?? null,
    idade_empresa_anos: idadeDias != null ? Math.floor(idadeDias / 365) : 0,
    valor_cotacao: ticket,
    score_normalizado,
    hard_fail: false,
    cnae_porte: porte,
    flags: redFlags,
  })

  // 10. Cenários A/B/C
  const cenarios = calcularCenarios(input, limite_sugerido_brl, semaforo)

  // 11. Resultado final
  const recomendacao = gerarRecomendacao(semaforo, false, comboFraude)
  const acoes_sugeridas = gerarAcoesSugeridas(semaforo, redFlags, false)
  const condicao_default = gerarCondicaoDefault(semaforo, false)

  return {
    cnpj: input.cnpj,
    score,
    score_normalizado,
    max_score,
    semaforo,
    recomendacao,
    red_flags: redFlags,
    acoes_sugeridas,
    sub_scores,
    modificador_setorial: {
      aplicado: modSetorial.aplicado,
      motivo: modSetorial.nota || undefined,
      pontos: modSetorial.delta,
    },
    modificador_historico_branorte: {
      aplicado: modHist.aplicado,
      motivo: modHist.motivo || undefined,
      pontos: modHist.delta,
      pode_sobrepor_externo: modHist.pode_sobrepor_externo,
    },
    limite_sugerido_brl,
    condicao_default,
    cenarios,
    hard_fail: false,
    hard_fail_motivo: hardFailMotivo,
  }
}
