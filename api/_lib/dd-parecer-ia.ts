// Parecer IA pra Due Diligence — consolida dados SPC + Datajud em
// uma análise executiva que vai pro vendedor decidir crédito/prazo.
//
// Usa OpenAI gpt-4o-mini (mesma chave que orcamento-ai). Custo ~R$ 0,02 por
// parecer. Saída: markdown estruturado pronto pra renderizar no frontend.

const OPENAI_KEY = process.env.OPENAI_API_KEY

const SYSTEM_PROMPT = `Você é um analista de crédito experiente da Branorte (fabricante metalúrgico B2B em SC). Sua tarefa é gerar um parecer EXECUTIVO de due diligence em markdown, baseado nos dados que vou enviar (SPC + processos Datajud).

**Estilo:**
- Direto, técnico, sem floreio.
- Português do Brasil.
- Markdown simples (apenas ## headers, listas com -, e **negrito**).
- Máximo 350 palavras no total.

**Estrutura obrigatória:**

## Veredito
Uma única linha começando com:
- ✅ **PODE VENDER** (sem restrições, score bom, sem processos relevantes)
- ⚠️ **ATENÇÃO** (alguma pendência, score médio, processo recente)
- ❌ **NÃO RECOMENDADO** (restrições ativas, score baixo, múltiplos processos com valor alto)

Em seguida, 1-2 frases explicando o porquê.

## Sinais positivos
- Lista de até 4 sinais positivos concretos (com dados/números).

## Sinais de alerta
- Lista de até 4 sinais de risco concretos (com dados/números).
- Se não houver alertas, escreva "- Nenhum sinal de alerta identificado."

## Recomendação operacional
- **Limite sugerido:** R$ X (baseado em score e situação)
- **Condição de pagamento:** [texto curto, ex: "Boleto 28/56/84 dias" ou "À vista antes da expedição"]
- **Observação:** [1 frase com contexto/ressalva relevante]

**Regras:**
- Para empresa com score >700 e zero restrições/processos = sempre verde, limite R$ 200k.
- Para score 400-700 ou restrições baixas (<R$ 5k) = amarelo, limite R$ 50k com aval.
- Para score <400 OU restrições >R$ 10k OU 3+ processos com execução = vermelho, à vista.
- Processos como "Execução de Título Extrajudicial" ou "Execução Fiscal" são SINAL FORTE de risco.
- "Cumprimento de Sentença" também é sinal forte.
- "Ação Trabalhista" isolada NÃO é deal-breaker pra empresa industrial — mencionar mas não pesar muito.
- Capital social baixo (<R$ 100k) em empresa pequena é normal, não alertar.
- Empresa com 10+ anos de mercado = sinal positivo forte.

Não invente dados que não estão na entrada. Se faltar info, escreva "informação não disponível".`

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
  }
  score?: { valor: number | null; classificacao: string | null }
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
  }>
}

/**
 * Gera o parecer markdown. Retorna null se falhar (frontend mostra só os dados raw).
 */
export async function gerarParecerIA(opts: {
  spcResumos: ResumoSpcInput[]
  datajud: DatajudInput | null
  timeoutMs?: number
}): Promise<{ parecer: string | null; erro: string | null }> {
  if (!OPENAI_KEY) return { parecer: null, erro: 'OPENAI_API_KEY não configurada' }
  if (opts.spcResumos.length === 0 && (!opts.datajud || opts.datajud.totalEncontrado === 0)) {
    return { parecer: null, erro: 'sem_dados_suficientes' }
  }

  const userInput = montarInputJson(opts.spcResumos, opts.datajud)

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
        max_tokens: 800,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Dados pra analisar:\n\n${userInput}` },
        ],
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      return { parecer: null, erro: `OpenAI HTTP ${resp.status}` }
    }
    const data = await resp.json()
    const parecer = data?.choices?.[0]?.message?.content ?? null
    if (!parecer) return { parecer: null, erro: 'resposta_vazia' }
    return { parecer: parecer.trim(), erro: null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { parecer: null, erro: msg }
  } finally {
    clearTimeout(timer)
  }
}

function montarInputJson(spcResumos: ResumoSpcInput[], datajud: DatajudInput | null): string {
  const partes: string[] = []

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
    if (c.endereco) partes.push(`- Endereço: ${c.endereco}`)

    if (r.score) {
      partes.push(
        `- Score: ${r.score.valor ?? 'não disponível'}${r.score.classificacao ? ` (${r.score.classificacao})` : ''}`,
      )
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
    if (r.socios && r.socios.length) {
      partes.push(`- Sócios: ${r.socios.map(s => `${s.nome}${s.participacao ? ` (${s.participacao})` : ''}`).join('; ')}`)
    }
    if (r.participacoes_em_empresas && r.participacoes_em_empresas.length) {
      partes.push(`- Participações em outras empresas: ${r.participacoes_em_empresas.length}`)
    }
    partes.push('')
  }

  if (datajud) {
    partes.push(`### Datajud (CNJ — processos judiciais)`)
    partes.push(`- Total encontrado: ${datajud.totalEncontrado ?? 0}`)
    if (datajud.processos && datajud.processos.length > 0) {
      partes.push(`- Processos (até 10 mais recentes):`)
      for (const p of datajud.processos.slice(0, 10)) {
        partes.push(`  - ${p.numeroProcesso} · ${p.tribunal} · ${p.classe}${p.assunto && p.assunto !== '—' ? ` · ${p.assunto}` : ''}${p.dataAjuizamento ? ` · ajuiz. ${p.dataAjuizamento}` : ''}`)
      }
    } else {
      partes.push(`- Nenhum processo encontrado em TJSC/TRF4/TJSP/TJPR/TJRS/TST/STJ`)
    }
  }

  return partes.join('\n')
}
