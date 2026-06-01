// Parecer IA pra Due Diligence — consolida dados SPC + Datajud + Detetive +
// contexto do orçamento + histórico Branorte em uma análise executiva que vai
// pro vendedor decidir crédito/prazo.
//
// Usa OpenAI gpt-4o-mini (mesma chave que orcamento-ai). Custo ~R$ 0,02 por
// parecer. Saída: markdown estruturado pronto pra renderizar no frontend.
//
// Hierarquia de decisão:
//   1. Detetive Branorte (determinístico) decide o SEMÁFORO — é a VERDADE FINAL.
//   2. IA aqui usa o semáforo como input, NUNCA sobrescreve.
//   3. IA dimensiona limite/condição/cenários com base no semáforo + contexto.

const OPENAI_KEY = process.env.OPENAI_API_KEY

// ─── PROMPTS POR NÍVEL DE ANÁLISE ─────────────────────────────────────────
// Três níveis escalonados por ticket. Quanto maior o ticket, mais profunda
// a análise (mais tokens, mais rigor). Veja escolherNivelAnalise() abaixo.

const SYSTEM_PROMPT_BASE = `Voce eh ANALISTA DE CREDITO SENIOR da Branorte (metalurgica B2B em SC, ticket R$ 30k-500k, prazo padrao 28/56/84 dias). 15 anos analisando agronegocio interior SC/PR/RS/MS/MT. Gera parecer EXECUTIVO honesto em markdown.

REGRAS HARD (NUNCA quebre):
1. SCORE 0 OU classificacao INADIMPLENTE OU inadimplencia ativa: Veredito=NAO RECOMENDADO. Limite=R$ 0. Condicao=Apenas a vista, antes da expedicao, e SO APOS regularizacao do SPC.
2. SCORE < 300: NAO RECOMENDADO ou ATENCAO MAXIMA. Limite max R$ 5.000.
3. SCORE 300-500: ATENCAO. Limite max R$ 20.000. A vista ou sinal 50% + 28/56.
4. SCORE 500-700: ATENCAO. Limite max R$ 80.000. 28/56/84 com aval pessoal.
5. SCORE 700+ e zero red flags: PODE VENDER. Limite ate R$ 200.000. 28/56/84 padrao.
6. SCORE 800+ e 5+ anos mercado: PODE VENDER. Limite ate R$ 350.000.

USE O LIMITE SUGERIDO PELO DETETIVE como teto, NUNCA acima. Se detetive disse R$ 0, MANTEM R$ 0.

OUTPUT (markdown valido, MAX 320 palavras, USE APENAS ## headers - NUNCA ###):

## Veredito
UMA linha: emoji + VEREDITO + 1 frase justificando COM SCORE REAL e situacao SPC. Se ha inadimplencia, MENCIONA O VALOR.

## Limite e condicao
- Limite sugerido: R$ X (numero concreto)
- Condicao: texto direto (ex: A vista antes da expedicao / 28-56-84 com aval / 28-56-84 padrao)
- Sinal: X% (apenas se aplicavel; se nao, NAO INCLUI a linha)
- Justificativa: 1 frase ligando score+inadimplencia ao limite

## Pontos a explorar na conversa
3 perguntas inteligentes, ESPECIFICAS pro contexto desta empresa (sem floreio).

## Pedir do cliente
Lista bullet de documentos REAIS (NAO use colchetes [X], escreva o documento literal). Adapta conforme red flags. Max 5 itens.

## Por que confiar
3-5 sinais positivos com NUMEROS REAIS extraidos do input. Se ha inadimplencia, NAO mente dizendo "score perfeito".

## Por que desconfiar
3-5 sinais negativos COM VALORES REAIS. Inadimplencia, processos, capital baixo, etc. Se inadimplencia=R$ X, ESCREVE o valor.

ABSOLUTAMENTE PROIBIDO:
- Placeholders nao substituidos: Z×0.8, [ATA atualizada], [X], [outros]
- ### subheaders
- Contradicao: dizer "score excelente" se score eh 0
- Sugerir esconder informacao do cliente ("evitar perguntas sobre inadimplencia" = PROIBIDO)
- Recomendar venda quando ha inadimplencia ativa
- Inventar dados que nao estao no input (ex: "10 anos de mercado" se idade nao foi passada)
- Tom hipocrita ou otimismo forcado contra os dados

FORMATO: direto, tecnico, sem floreio, portugues do Brasil.`

const SYSTEM_PROMPT_PROFUNDO_EXTRA = `

**ANÁLISE PROFUNDA (ticket ≥ R$ 150k):**
Compacta 03, Master, Mini Fábrica e tickets ≥ R$ 150k exigem rigor extra:
- Detalhar cada cenário (A/B/C) com justificativa numérica explícita (mostre a conta).
- Listar 2 PERGUNTAS-CHAVE que o vendedor deve fazer antes de fechar (ex: "Qual a integração atual? Tem contrato de fornecimento ativo?").
- Mencionar mitigações de risco específicas (seguro de crédito, FINAME, consórcio fechado).
- Validar capacidade de pagamento contra faturamento presumido (não estourar 10% do faturamento anual em uma única compra).
`

const SECAO_DADOS_FALTANTES = `

## Dados que aumentariam a confiança
Inclua esta seção SE houver consultas faltantes que mudariam a análise:
- Sintegra/IE (quando PJ e dado ausente)
- SPC dos sócios PF (quando empresa PJ mas sócios não consultados)
- Certidão Receita Federal (quando status cadastral pendente/suspenso)
- Referências bancárias (quando ticket > R$ 100k e dado ausente)
- Histórico Branorte (quando cliente potencialmente recorrente mas sem registro)

Use formato: \`- [Tipo de consulta]: por que importaria nesse caso\`
NÃO inclua a seção se todos os dados críticos já estão presentes.
`

// ─── INTERFACES ───────────────────────────────────────────────────────────

interface ResumoSpcInput {
  consumidor?: {
    tipo?: 'F' | 'J'
    documento?: string
    nome?: string | null
    razao_social?: string | null
    nome_fantasia?: string | null
    situacao?: string | null
    data_fundacao?: string | null
    data_nascimento?: string | null
    natureza_juridica?: string | null
    endereco?: string | null
    cnae_principal?: string | null
  }
  score?: { valor: number | null; classificacao: string | null; mensagem?: string | null }
  faturamento_presumido?: { valor: number; periodicidade?: string | null } | null
  inadimplencias?: {
    qtd: number
    valor_total: number
    detalhes?: Array<{ origem: string; valor: number; data: string | null }>
  }
  protestos?: { qtd: number; valor_total: number }
  socios?: Array<{ nome: string; participacao?: string | null }>
  participacoes_em_empresas?: Array<{ nome: string; tipo?: string | null }>
}

interface DatajudInput {
  totalEncontrado?: number
  processos?: Array<{
    numeroProcesso: string
    tribunal: string
    classe: string
    assunto: string
    dataAjuizamento: string | null
    valorCausa?: number | null
    status?: 'ativo' | 'extinto' | 'arquivado' | 'suspenso' | null
    cnpjConsultado?: string | null
  }>
}

/**
 * Dossiê do Detetive Branorte — versão expandida com sub_scores e cenários.
 * É a VERDADE FINAL sobre o semáforo. A IA NÃO sobrescreve.
 */
interface DossieDetetiveInput {
  semaforo: 'verde' | 'amarelo' | 'vermelho'
  score: number
  // sub_scores 0-100 por dimensão (vem do scoring novo)
  sub_scores?: {
    financeiro: number
    compliance: number
    reputacao: number
    juridico: number
    digital: number
  }
  // Backwards-compat com versão antiga
  recomendacao?: string
  red_flags?: Array<{ id: number | string; peso: number; nome: string; descricao: string }>
  // Novo formato (substitui red_flags quando presente)
  flags_criticas?: Array<{
    nome: string
    dimensao: string
    peso: number
    hard_fail: boolean
  }>
  modificador_setorial?: {
    aplicado: boolean
    motivo?: string
    pontos: number
  }
  modificador_historico_branorte?: {
    aplicado: boolean
    motivo?: string
    pontos: number
  }
  limite_calculado?: number
  cenarios?: Array<{
    condicao: string
    limite_max: number
    exigencias: string[]
  }>
  hard_fail?: boolean
  hard_fail_motivo?: string
  acoes_sugeridas?: string[]
}

/**
 * Contexto do orçamento em curso. Sem isso a IA opera no escuro.
 */
interface ContextoOrcamentoInput {
  equipamento_cotado?: string
  valor_total?: number
  prazo_proposto?: string
  regiao_cidade_uf?: string
  tipo_cliente?: 'PF' | 'PJ'
  integracao_frigorifico?: string
  forma_pagamento?: 'a_vista' | 'parcelado_sinal' | 'parcelado_sem_sinal' | 'finame' | 'consorcio'
}

/**
 * Histórico interno Branorte — trumps externo quando positivo.
 */
interface HistoricoBranorteInput {
  compras_pagas: number
  total_brl: number
  inadimplencia_brl: number
  ultima_compra_data?: string
}

/**
 * Metadata retornado junto com o parecer — habilita observabilidade e A/B test.
 */
interface ParecerIaMeta {
  prompt_version: number
  nivel_analise: 'rapido' | 'padrao' | 'profundo'
  tokens_in: number
  tokens_out: number
  modelo: string
}

interface ParecerIaResult {
  parecer: string | null
  erro: string | null
  meta: ParecerIaMeta
}

// ─── HELPER: NÍVEL DE ANÁLISE POR TICKET ──────────────────────────────────

function escolherNivelAnalise(valorTotal?: number): {
  nivel: 'rapido' | 'padrao' | 'profundo'
  max_tokens: number
} {
  const v = valorTotal ?? 0
  if (v < 50_000) return { nivel: 'rapido', max_tokens: 1000 }
  if (v < 150_000) return { nivel: 'padrao', max_tokens: 1400 }
  return { nivel: 'profundo', max_tokens: 1800 }
}

// ─── HELPER: PROMPT EXTERNO (FASE 2, LOW PRIORITY) ────────────────────────
//
// Stub pra externalizar prompts no Supabase futuramente. Por enquanto retorna
// o prompt hardcoded — tabela `ia_prompts` ainda não existe.

interface PromptAtivo {
  prompt_text: string
  version: number
}

export async function getActivePrompt(
  nome: 'dd-parecer-rapido' | 'dd-parecer-padrao' | 'dd-parecer-profundo',
): Promise<PromptAtivo> {
  // TODO fase 2: consultar tabela `ia_prompts` no Supabase com (nome, active=true)
  // e retornar { prompt_text, version }. Por ora fallback hardcoded.
  //
  // Versões hardcoded:
  //   v1 = prompt enxuto antigo (350 palavras, sem cenários)
  //   v2 = prompt atual (com cenários A/B/C, hierarquia detetive, regras setoriais)
  //
  // Quando a tabela existir, este bloco vira:
  //   const { data } = await supa.from('ia_prompts').select('prompt_text, version')
  //     .eq('nome', nome).eq('active', true).order('version', { ascending: false }).limit(1).maybeSingle()
  //   if (data?.prompt_text) return { prompt_text: data.prompt_text, version: data.version }

  if (nome === 'dd-parecer-profundo') {
    return { prompt_text: SYSTEM_PROMPT_BASE + SYSTEM_PROMPT_PROFUNDO_EXTRA + SECAO_DADOS_FALTANTES, version: 2 }
  }
  return { prompt_text: SYSTEM_PROMPT_BASE + SECAO_DADOS_FALTANTES, version: 2 }
}

// ─── VALIDADOR DE PARECER (anti-vazamento de placeholders) ────────────────

function validarParecer(texto: string): { valido: boolean; erros: string[] } {
  const erros: string[] = []
  if (/\[(ATA|X|Y|Z|outros)\b/i.test(texto)) erros.push("placeholder bracket vazou")
  if (/Z\s*[×x]\s*0\./i.test(texto)) erros.push("Z×0 nao substituido")
  if (/###\s/.test(texto)) erros.push("usou ### proibido")
  if (texto.split(/\s+/).length > 600) erros.push("muito longo")
  return { valido: erros.length === 0, erros }
}

// ─── FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────

/**
 * Gera o parecer markdown. Retorna { parecer, erro, meta }.
 *
 * @param opts.spcResumos        Resumos SPC consolidados (PJ + sócios PF)
 * @param opts.datajud           Processos judiciais (TJSC/TRF4/...). Opcional.
 * @param opts.dossieDetetive    Veredito determinístico do detetive (VERDADE FINAL). Recomendado.
 * @param opts.detetive          Alias novo para dossieDetetive (mesma coisa, nome novo na spec).
 * @param opts.contextoOrcamento Equipamento + valor + região + integração. Sem isso a IA opera no escuro.
 * @param opts.historicoBranorte Histórico interno do CNPJ na Branorte. Trumps externo quando positivo.
 * @param opts.ticketPedidoBrl   Atalho pra valor total quando contextoOrcamento não disponível.
 * @param opts.timeoutMs         Timeout da chamada OpenAI. Default 25s.
 */
export async function gerarParecerIA(opts: {
  spcResumos: ResumoSpcInput[]
  datajud: DatajudInput | null
  dossieDetetive?: DossieDetetiveInput | null
  // Aceita tanto `detetive` (nome novo da spec) quanto `dossieDetetive` (antigo) — retrocompat
  detetive?: DossieDetetiveInput | null
  contextoOrcamento?: ContextoOrcamentoInput | null
  historicoBranorte?: HistoricoBranorteInput | null
  portalTransparencia?: unknown
  ticketPedidoBrl?: number
  timeoutMs?: number
}): Promise<ParecerIaResult> {
  // Aceita ambos os nomes do parâmetro (detetive | dossieDetetive)
  const detetive = opts.detetive ?? opts.dossieDetetive ?? null

  // Decide nível por ticket (do contexto ou do atalho)
  const valorTotal =
    opts.contextoOrcamento?.valor_total ?? opts.ticketPedidoBrl ?? undefined
  const { nivel, max_tokens } = escolherNivelAnalise(valorTotal)

  const metaVazia: ParecerIaMeta = {
    prompt_version: 2,
    nivel_analise: nivel,
    tokens_in: 0,
    tokens_out: 0,
    modelo: 'gpt-4o-mini',
  }

  if (!OPENAI_KEY) {
    return {
      parecer: null,
      erro: 'OPENAI_API_KEY não configurada',
      meta: metaVazia,
    }
  }

  const semSPC = opts.spcResumos.length === 0
  const semDatajud = !opts.datajud || opts.datajud.totalEncontrado === 0
  const semDossie = !detetive
  const semContexto = !opts.contextoOrcamento
  if (semSPC && semDatajud && semDossie && semContexto) {
    return {
      parecer: null,
      erro: 'sem_dados_suficientes',
      meta: metaVazia,
    }
  }

  // Carrega prompt do nível certo (futuramente do Supabase, hoje hardcoded)
  const promptNome =
    nivel === 'profundo' ? 'dd-parecer-profundo' : nivel === 'padrao' ? 'dd-parecer-padrao' : 'dd-parecer-rapido'
  const promptAtivo = await getActivePrompt(promptNome)

  const userInput = montarInputJson(
    opts.spcResumos,
    opts.datajud,
    detetive,
    opts.contextoOrcamento,
    opts.historicoBranorte,
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000)

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens,
        messages: [
          { role: 'system', content: promptAtivo.prompt_text },
          { role: 'user', content: `Dados pra analisar:\n\n${userInput}` },
        ],
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      return {
        parecer: null,
        erro: `OpenAI HTTP ${resp.status}`,
        meta: { ...metaVazia, prompt_version: promptAtivo.version },
      }
    }
    const data = await resp.json()
    const parecer = data?.choices?.[0]?.message?.content ?? null
    const tokens_in = data?.usage?.prompt_tokens ?? 0
    const tokens_out = data?.usage?.completion_tokens ?? 0

    const meta: ParecerIaMeta = {
      prompt_version: promptAtivo.version,
      nivel_analise: nivel,
      tokens_in,
      tokens_out,
      modelo: 'gpt-4o-mini',
    }

    if (!parecer) {
      return { parecer: null, erro: 'resposta_vazia', meta }
    }
    if (parecer) {
      const val = validarParecer(parecer)
      if (!val.valido) console.warn("[parecer-ia] invalido:", val.erros)
    }
    return { parecer: parecer.trim(), erro: null, meta }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      parecer: null,
      erro: msg,
      meta: { ...metaVazia, prompt_version: promptAtivo.version },
    }
  } finally {
    clearTimeout(timer)
  }
}

// ─── MONTAGEM DO INPUT JSON/MD PRO MODELO ─────────────────────────────────

function montarInputJson(
  spcResumos: ResumoSpcInput[],
  datajud: DatajudInput | null,
  dossie?: DossieDetetiveInput | null,
  contexto?: ContextoOrcamentoInput | null,
  historico?: HistoricoBranorteInput | null,
): string {
  const partes: string[] = []

  // ─── BLOCO 1: CONTEXTO DA COTAÇÃO (CRÍTICO — vai no topo) ──────────────
  if (contexto) {
    partes.push(`### Contexto da Cotação`)
    if (contexto.equipamento_cotado) partes.push(`- Equipamento: ${contexto.equipamento_cotado}`)
    if (contexto.valor_total != null) {
      partes.push(`- Valor total: R$ ${contexto.valor_total.toLocaleString('pt-BR')}`)
      // Categoria de ticket pra IA calibrar rigor
      const cat =
        contexto.valor_total < 50_000
          ? 'baixo (<R$50k)'
          : contexto.valor_total < 150_000
            ? 'médio (R$50k-R$150k)'
            : contexto.valor_total < 500_000
              ? 'alto (R$150k-R$500k)'
              : 'premium (>R$500k)'
      partes.push(`- Categoria de ticket: ${cat}`)
    }
    if (contexto.prazo_proposto) partes.push(`- Prazo proposto pelo vendedor: ${contexto.prazo_proposto}`)
    if (contexto.forma_pagamento) partes.push(`- Forma de pagamento proposta: ${contexto.forma_pagamento}`)
    if (contexto.regiao_cidade_uf) partes.push(`- Região: ${contexto.regiao_cidade_uf}`)
    if (contexto.tipo_cliente) partes.push(`- Tipo de cliente: ${contexto.tipo_cliente}`)
    if (contexto.integracao_frigorifico) {
      partes.push(`- Integração com frigorífico: ${contexto.integracao_frigorifico} (BAIXO RISCO setorial)`)
    }
    partes.push('')
  }

  // ─── BLOCO 2: HISTÓRICO BRANORTE INTERNO (trumps externo) ──────────────
  if (historico) {
    partes.push(`### Histórico Branorte (cliente interno — pesa MUITO)`)
    partes.push(`- Compras pagas: ${historico.compras_pagas}`)
    partes.push(`- Total transacionado: R$ ${historico.total_brl.toLocaleString('pt-BR')}`)
    partes.push(`- Inadimplência ativa: R$ ${historico.inadimplencia_brl.toLocaleString('pt-BR')}`)
    if (historico.ultima_compra_data) partes.push(`- Última compra: ${historico.ultima_compra_data}`)
    if (historico.compras_pagas >= 3 && historico.inadimplencia_brl === 0) {
      partes.push(
        `- INTERPRETAÇÃO: cliente RECORRENTE com zero inadimplência — esse sinal sobrepõe restrições externas leves/médias.`,
      )
    } else if (historico.inadimplencia_brl > 0) {
      partes.push(
        `- INTERPRETAÇÃO: HARD FAIL — cliente com inadimplência ATIVA na Branorte. NÃO RECOMENDAR sob qualquer condição.`,
      )
    }
    partes.push('')
  }

  // ─── BLOCO 3: DETETIVE BRANORTE (VERDADE FINAL DO SEMÁFORO) ────────────
  if (dossie) {
    partes.push(`### Detetive Branorte (veredito determinístico — VERDADE FINAL)`)
    partes.push(`- **Semáforo: ${dossie.semaforo.toUpperCase()}** ← USE ISTO COMO BASE DO SEU VEREDITO`)
    partes.push(`- Score consolidado: ${dossie.score}/100`)

    if (dossie.sub_scores) {
      partes.push(`- Sub-scores por dimensão (0-100):`)
      partes.push(`  - Financeiro: ${dossie.sub_scores.financeiro}`)
      partes.push(`  - Compliance: ${dossie.sub_scores.compliance}`)
      partes.push(`  - Reputação: ${dossie.sub_scores.reputacao}`)
      partes.push(`  - Jurídico: ${dossie.sub_scores.juridico}`)
      partes.push(`  - Digital: ${dossie.sub_scores.digital}`)
    }

    if (dossie.hard_fail) {
      partes.push(`- **HARD FAIL ATIVO**: ${dossie.hard_fail_motivo ?? 'bloqueio automático'}`)
      partes.push(`  → NÃO recomende venda parcelada. Apenas vista com aval, ou recusar.`)
    }

    if (dossie.modificador_setorial?.aplicado) {
      partes.push(
        `- Modificador setorial aplicado: ${dossie.modificador_setorial.motivo ?? 'CNAE agro/pecuária'} (${dossie.modificador_setorial.pontos >= 0 ? '+' : ''}${dossie.modificador_setorial.pontos} pts)`,
      )
    }
    if (dossie.modificador_historico_branorte?.aplicado) {
      partes.push(
        `- Modificador histórico Branorte: ${dossie.modificador_historico_branorte.motivo ?? 'cliente interno'} (${dossie.modificador_historico_branorte.pontos >= 0 ? '+' : ''}${dossie.modificador_historico_branorte.pontos} pts)`,
      )
    }

    // Flags críticas (novo formato) OU red_flags (formato antigo, retrocompat)
    const flagsList: Array<{ nome: string; peso: number; dimensao?: string; descricao?: string; hard_fail?: boolean }> = []
    if (dossie.flags_criticas && dossie.flags_criticas.length > 0) {
      for (const f of dossie.flags_criticas) {
        flagsList.push({ nome: f.nome, peso: f.peso, dimensao: f.dimensao, hard_fail: f.hard_fail })
      }
    } else if (dossie.red_flags && dossie.red_flags.length > 0) {
      for (const f of dossie.red_flags) {
        flagsList.push({ nome: f.nome, peso: f.peso, descricao: f.descricao })
      }
    }
    if (flagsList.length > 0) {
      partes.push(`- Red flags detectadas (${flagsList.length}):`)
      for (const f of flagsList) {
        const dim = f.dimensao ? ` · ${f.dimensao}` : ''
        const hf = f.hard_fail ? ' · **HARD FAIL**' : ''
        const desc = f.descricao ? `: ${f.descricao}` : ''
        partes.push(`  - [peso ${f.peso}${dim}${hf}] ${f.nome}${desc}`)
      }
    } else {
      partes.push(`- Nenhuma red flag identificada pelas regras do detetive.`)
    }

    if (dossie.limite_calculado != null) {
      partes.push(`- Limite sugerido pelo detetive: R$ ${dossie.limite_calculado.toLocaleString('pt-BR')}`)
    }

    if (dossie.cenarios && dossie.cenarios.length > 0) {
      partes.push(`- Cenários pré-calculados pelo detetive:`)
      for (const c of dossie.cenarios) {
        partes.push(
          `  - ${c.condicao} → até R$ ${c.limite_max.toLocaleString('pt-BR')} | exigências: ${c.exigencias.join('; ') || 'nenhuma'}`,
        )
      }
    }

    if (dossie.recomendacao) {
      partes.push(`- Recomendação textual do detetive: ${dossie.recomendacao}`)
    }
    if (dossie.acoes_sugeridas && dossie.acoes_sugeridas.length > 0) {
      partes.push(`- Ações sugeridas pelo detetive:`)
      for (const a of dossie.acoes_sugeridas) {
        partes.push(`  - ${a}`)
      }
    }
    partes.push(
      `- LEMBRE: o semáforo do detetive é a VERDADE FINAL. Você dimensiona limite/condição/cenários, NÃO sobrescreve o semáforo.`,
    )
    partes.push('')
  }

  // ─── BLOCO 4: SPC POR CONSUMIDOR (PJ + sócios PF) ──────────────────────
  for (const r of spcResumos) {
    const c = r.consumidor ?? {}
    partes.push(`### Dados SPC (${c.tipo === 'J' ? 'Empresa' : 'Pessoa Física'})`)
    if (c.nome) partes.push(`- Nome: ${c.nome}`)
    if (c.razao_social && c.razao_social !== c.nome) partes.push(`- Razão Social: ${c.razao_social}`)
    if (c.documento) partes.push(`- Documento: ${c.documento}`)
    if (c.situacao) partes.push(`- Situação cadastral: ${c.situacao}`)
    if (c.data_fundacao) partes.push(`- Fundação: ${c.data_fundacao}`)
    if (c.data_nascimento) partes.push(`- Nascimento: ${c.data_nascimento}`)
    if (c.natureza_juridica) partes.push(`- Natureza jurídica: ${c.natureza_juridica}`)
    if (c.cnae_principal) partes.push(`- CNAE principal: ${c.cnae_principal}`)
    if (c.endereco) partes.push(`- Endereço: ${c.endereco}`)

    if (r.score) {
      const valorStr = r.score.valor != null ? `${r.score.valor}/1000` : 'não disponível'
      const classStr = r.score.classificacao ? ` (classe: ${r.score.classificacao})` : ''
      partes.push(`- Score SPC: ${valorStr}${classStr}`)
      if (r.score.mensagem) {
        partes.push(`  → Interpretação SPC: "${r.score.mensagem}"`)
      }
    }
    if (r.inadimplencias) {
      partes.push(
        `- Inadimplências SPC: ${r.inadimplencias.qtd} ocorrência(s), total R$ ${r.inadimplencias.valor_total.toFixed(2)}`,
      )
      for (const d of r.inadimplencias.detalhes ?? []) {
        partes.push(`  - ${d.origem}: R$ ${d.valor.toFixed(2)}${d.data ? ` (${d.data})` : ''}`)
      }
    }
    if (r.protestos) {
      partes.push(
        `- Protestos: ${r.protestos.qtd} ocorrência(s), total R$ ${r.protestos.valor_total.toFixed(2)}`,
      )
    }
    if (r.faturamento_presumido && r.faturamento_presumido.valor > 0) {
      partes.push(
        `- Faturamento Presumido SPC: R$ ${r.faturamento_presumido.valor.toLocaleString('pt-BR')}/${r.faturamento_presumido.periodicidade ?? 'período'} (estimativa estatística, considere ±35% margem)`,
      )
    }
    if (r.socios && r.socios.length) {
      partes.push(`- Sócios: ${r.socios.map(s => `${s.nome}${s.participacao ? ` (${s.participacao})` : ''}`).join('; ')}`)
    }
    if (r.participacoes_em_empresas && r.participacoes_em_empresas.length) {
      partes.push(`- Participações em outras empresas: ${r.participacoes_em_empresas.length}`)
    }
    partes.push('')
  }

  // ─── BLOCO 5: DATAJUD ENRIQUECIDO ──────────────────────────────────────
  if (datajud) {
    partes.push(`### Datajud (CNJ — processos judiciais)`)
    partes.push(`- Total encontrado: ${datajud.totalEncontrado ?? 0}`)
    if (datajud.processos && datajud.processos.length > 0) {
      partes.push(`- Processos (até 10 mais recentes, com polo presumido e status):`)
      for (const p of datajud.processos.slice(0, 10)) {
        // Heurística de polo: classes "Execução*" / "Cumprimento*" → empresa geralmente é POLO PASSIVO
        // Classes "Ação de Cobrança" + autor conhecido → depende. Sem dados precisos, marcamos "presumido".
        const classeLower = (p.classe || '').toLowerCase()
        let poloPresumido = 'indeterminado'
        if (classeLower.startsWith('execução') || classeLower.startsWith('execucao') || classeLower.startsWith('cumprimento')) {
          poloPresumido = 'passivo (provável réu/devedor)'
        } else if (classeLower.startsWith('ação de cobrança') || classeLower.startsWith('acao de cobranca')) {
          poloPresumido = 'indefinido (cobrança)'
        }

        // Tempo desde ajuizamento em meses
        let tempoMeses: number | null = null
        if (p.dataAjuizamento) {
          const dt = new Date(p.dataAjuizamento)
          if (!isNaN(dt.getTime())) {
            const diffMs = Date.now() - dt.getTime()
            tempoMeses = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30))
          }
        }

        const valorStr = p.valorCausa != null ? ` · valor R$ ${p.valorCausa.toLocaleString('pt-BR')}` : ''
        const statusStr = p.status ? ` · status ${p.status}` : ''
        const tempoStr = tempoMeses != null ? ` · há ${tempoMeses} meses` : ''
        const poloStr = ` · polo: ${poloPresumido}`

        partes.push(
          `  - ${p.numeroProcesso} · ${p.tribunal} · ${p.classe}${p.assunto && p.assunto !== '—' ? ` · ${p.assunto}` : ''}${p.dataAjuizamento ? ` · ajuiz. ${p.dataAjuizamento}` : ''}${tempoStr}${valorStr}${statusStr}${poloStr}`,
        )
      }
      partes.push(
        `- REGRA: Execução fiscal EXTINTA ou empresa no polo ATIVO (autor) = ignore/positivo. Empresa em polo PASSIVO com causa ATIVA > R$ 50k = pesa forte. Trabalhista isolada NÃO é deal-breaker pra industrial.`,
      )
    } else {
      partes.push(`- Nenhum processo encontrado em TJSC/TRF4/TJSP/TJPR/TJRS/TST/STJ`)
    }
    partes.push('')
  }

  return partes.join('\n')
}

// ─── EXPORTS (tipos públicos pra outros módulos) ──────────────────────────

export type {
  ResumoSpcInput,
  DatajudInput,
  DossieDetetiveInput,
  ContextoOrcamentoInput,
  HistoricoBranorteInput,
  ParecerIaMeta,
  ParecerIaResult,
}
