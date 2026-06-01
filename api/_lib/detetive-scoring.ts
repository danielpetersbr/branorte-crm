/**
 * Detetive Scoring Engine
 *
 * Motor de regras para due diligence de leads Branorte.
 * Recebe dados ja coletados (OpenCNPJ, CGU, DataJud, noticias, BrasilAPI, socios reverso)
 * e devolve um dossie consolidado com score 0-100, semaforo e acoes sugeridas.
 *
 * Pesos das red flags (1-5) refletem severidade. Score final eh normalizado
 * pelo maxScore (soma de todos os pesos = 43) e mapeado para semaforo.
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
    socios: Array<{ nome: string; cpf_cnpj_mascara: string | null }>
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
}

// ============================================================================
// TIPOS DE OUTPUT
// ============================================================================

export interface RedFlag {
  id: number
  peso: 1 | 2 | 3 | 4 | 5
  nome: string
  descricao: string
  evidencia?: Record<string, unknown>
  hard_fail?: boolean // override automatico pra vermelho
}

export interface DossieResultado {
  cnpj: string
  score: number // 0-100, normalizado
  semaforo: 'verde' | 'amarelo' | 'vermelho'
  recomendacao: string
  red_flags: RedFlag[]
  acoes_sugeridas: string[]
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
// MOTOR PRINCIPAL
// ============================================================================

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

export function calcularDossie(input: DetetiveInput): DossieResultado {
  // Avalia todas as 13 flags
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
  ]

  const redFlags = avaliacoes.filter((f): f is RedFlag => f !== null)

  // Soma de pesos
  const soma = redFlags.reduce((acc, f) => acc + f.peso, 0)
  let score = Math.round((soma / MAX_SCORE) * 100)
  if (score > 100) score = 100
  if (score < 0) score = 0

  // Detecta overrides
  const hardFail = redFlags.some((f) => f.hard_fail === true)
  const idsAtivos = new Set(redFlags.map((f) => f.id))
  const comboFraude = idsAtivos.has(1) && idsAtivos.has(3) && idsAtivos.has(10)

  // Determina semaforo
  let semaforo: 'verde' | 'amarelo' | 'vermelho'
  if (hardFail || comboFraude) {
    semaforo = 'vermelho'
  } else if (score <= 30) {
    semaforo = 'verde'
  } else if (score <= 60) {
    semaforo = 'amarelo'
  } else {
    semaforo = 'vermelho'
  }

  const recomendacao = gerarRecomendacao(semaforo, hardFail, comboFraude)
  const acoes_sugeridas = gerarAcoesSugeridas(semaforo, redFlags, hardFail)

  return {
    cnpj: input.cnpj,
    score,
    semaforo,
    recomendacao,
    red_flags: redFlags,
    acoes_sugeridas,
  }
}
