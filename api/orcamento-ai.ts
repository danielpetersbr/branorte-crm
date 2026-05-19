// Vercel serverless function — copiloto IA do orçamento.
// Usa OpenAI gpt-4o-mini com function calling pra consultar preços, motores,
// modelos de pacote, etc. NÃO modifica o banco — apenas leitura (Sprint 1).
//
// Fluxo:
//   1. Front manda histórico de mensagens
//   2. Server valida JWT do Supabase
//   3. Chama OpenAI com tools de leitura registradas
//   4. Loop: GPT pede tool → server executa query no Supabase via service role → devolve resultado
//   5. GPT formula resposta final (texto + sugestões opcionais)
//   6. Server retorna { reply, sugestoes? }
//
// REGRA DE OURO: tools só executam SELECT. Nenhuma escrita no banco aqui.
// Quando virar Sprint 2 (escrita), as tools de mutação retornam "sugestões"
// que o frontend renderiza como cards de aprovação manual.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_KEY = process.env.OPENAI_API_KEY!
const OPENAI_MODEL = 'gpt-4o-mini'
const MAX_TOOL_ITERATIONS = 14  // aumentado pra IA conseguir compor orçamento do zero (varias tool calls sequenciais)

const SYSTEM_PROMPT = `Você é o copiloto do CRM Branorte — uma metalúrgica que fabrica equipamentos pra fábricas de ração (transportadores helicoidais, misturadores, silos, caçambas de pesagem, moinhos, ensacadeiras, balanças e fábricas compactas).

SEU PAPEL
Ajudar o vendedor durante a montagem de orçamentos. Você consulta preços, sugere modelos, encontra motores compatíveis, **compõe orçamentos do zero juntando itens individuais** e explica diferenças entre variantes.

REGRAS INQUEBRÁVEIS
1. NUNCA invente preços, capacidades, modelos ou códigos. Toda informação factual SEMPRE vem das tools.
2. Responda sempre em português brasileiro, tom direto e profissional.
3. Use tabelas markdown quando listar 3+ itens. Senão, frases curtas.
4. Valores monetários: sempre formate como R$ X.XXX,XX (com separador de milhar e vírgula decimal).
5. Quando o vendedor mencionar "caçamba de pesagem 2000 kg" — IMPORTANTE: a caçamba e a balança são itens SEPARADOS. A maior caçamba é 1900 L (1000 kg de produto). Os "2000 kg" geralmente é a BALANÇA ELETRÔNICA 2000 KG que acompanha. Esclareça isso ativamente.
6. Valores monetários: sempre formate como R$ X.XXX,XX (com separador de milhar e vírgula decimal).
7. NUNCA chame propor_* sem antes confirmar o item via consultar_precos/listar_modelos_compacta. Os IDs precisam ser REAIS.

⛔ REGRA CRÍTICA — NUNCA RESPONDA "NÃO ENCONTREI" SEM TENTAR COMPOR DO ZERO
Caso real ruim: vendedor pediu "mini fábrica monofásica com misturador 150 kg" → você respondeu "não encontrei modelo" e parou.
COMPORTAMENTO CORRETO: se não tem PACOTE pronto que combine, MONTE do zero juntando items individuais:
  1. Busca o misturador 150 kg via consultar_precos(categoria='MISTURADOR', capacidade_min=130, capacidade_max=170)
  2. Busca componentes necessários: moinho, transportadores, silo, caçamba, balança — chamando consultar_precos pra cada categoria
  3. Pra cada item, escolhe a opção monofásica (campo valor_com_motor_mono não-nulo) se cliente pediu monofásico
  4. Propõe ADICIONAR cada item via propor_adicionar_item (em sequência — pode chamar várias seguidas)
  5. No fim, faz um resumo do orçamento composto pro vendedor revisar e aprovar item por item

WORKFLOW DE ORÇAMENTO COMPLETO DO ZERO
Quando o vendedor pedir "monta orçamento de mini fábrica X kg/h com Y" (e não houver modelo pronto que case):
  - Defina mentalmente os "blocos" que toda fábrica de ração precisa:
    1. RECEPÇÃO: moega + transportador de chegada (TH 160 ou 210 mm)
    2. ARMAZENAMENTO grão bruto: silo (capacidade = ~5x produção horária × dias de autonomia)
    3. MOAGEM: moinho de martelo (CV proporcional à capacidade — 5 CV pra 100-200 kg/h, 10 CV pra 200-500 kg/h, 15 CV pra 500-1000 kg/h)
    4. PESAGEM/DOSAGEM: caçamba de pesagem + balança eletrônica
    5. MISTURA: misturador horizontal (capacidade do batch = ~30 min de produção)
    6. ENSACAMENTO (opcional): ensacadeira + transportador de sacaria
    7. INTERCONEXÕES: transportadores entre etapas
  - Pra cada bloco: consulta_precos → escolhe item adequado → propor_adicionar_item
  - SEMPRE filtre por voltagem se cliente pediu (mono ou trifásico) — verifica valor_com_motor_mono/trif
  - Se algum bloco não tiver opção no catálogo na capacidade exata, escolhe o ITEM MAIS PRÓXIMO disponível (não pula) e justifica
  - Use propor_carregar_pacote SÓ se achar pacote exato; caso contrário, COMPONHA item-a-item

REGRAS DE COMPATIBILIDADE
- Monofásico: motores até 5 CV. Acima disso, só trifásico. Se cliente quer mono mas item precisa motor 7.5+ CV, AVISE.
- Capacidade do misturador deve ser >= 30% da produção horária (batch de ~30 min)
- Capacidade do silo deve ser >= 5× produção horária (autonomia mínima)
- Quando há moinho, sempre incluir transportador de alimentação (TH 160 mm × 2-3 m)

CATEGORIAS DA TABELA precos_branorte
TRANSPORTADOR (helicoidais 160/210mm, chupins), MISTURADOR (vertical/horizontal, 500-2000 kg),
MOINHO (martelos 5-20 CV), CAIXA (dosagem, ração pronta), SILO (1-100 ton),
ELEVADOR, CACAMBA (pesagem 600-3000 L), PRE-LIMPEZA, PENEIRA, HELICOIDE, BALANCA,
ENSACADEIRA, COMPACTA (pacotes Linhas 01/02 Master), ALIMENTADOR, DESCARGA, MOEGA,
PASSARELA, SUPORTE_BAG, ELEVADOR_SACARIA, OUTROS.

REGRAS DE AÇÕES PROPOSTAS
- Use propor_adicionar_item pra cada item individual quando compor do zero
- Use propor_carregar_pacote SÓ quando achar pacote exato em listar_modelos_compacta
- Use propor_preencher_cliente quando vendedor disser dados do cliente
- Cada ação aparece como card no chat — vendedor clica pra confirmar uma a uma
- Pode chamar várias propor_* na mesma resposta (componha o orçamento todo de uma vez)`

// ============================================================================
// TOOL DEFINITIONS (JSON schema enviado pro OpenAI)
// ============================================================================

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'consultar_precos',
      description:
        'Busca itens na tabela oficial de preços (precos_branorte). Use pra consultar preço, motor padrão, capacidade etc. de qualquer equipamento. Retorna até 20 resultados ordenados por relevância.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description:
              'Categoria exata. Ex: CACAMBA, TRANSPORTADOR, MISTURADOR, SILO, BALANCA, COMPACTA, MOINHO, ENSACADEIRA, etc. Opcional — se omitir, busca em todas.',
          },
          busca: {
            type: 'string',
            description:
              'Termo livre que filtra por descrição (ILIKE %busca%). Ex: "pesagem 1900", "moinho 10 cv", "silo 30 ton". Opcional.',
          },
          capacidade_min: {
            type: 'number',
            description: 'Filtro mínimo em capacidade_kg_pratica ou capacidade_litros. Opcional.',
          },
          capacidade_max: {
            type: 'number',
            description: 'Filtro máximo. Opcional.',
          },
          max_resultados: {
            type: 'integer',
            description: 'Limite. Default 15, max 30.',
            default: 15,
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'consultar_motor',
      description:
        'Busca motores elétricos no catalogo_motores. Use pra responder "qual o preço do motor 5 CV trifásico 4 polos" etc.',
      parameters: {
        type: 'object',
        properties: {
          cv: { type: 'number', description: 'Potência em CV. Ex: 1.5, 2, 5, 7.5, 15.' },
          polos: { type: 'integer', description: '2, 4 ou 6.', enum: [2, 4, 6] },
          voltagem: {
            type: 'string',
            description: 'TRIFASICO_220, MONOFASICO_220, etc. Opcional.',
          },
        },
        required: ['cv'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'listar_modelos_compacta',
      description:
        'Lista modelos de pacote fechado (orcamento_modelos) — fábricas compactas e mini-fábricas. Use pra "monta orçamento de mini fábrica que produz 200 kg/h e armazena 1000 kg".',
      parameters: {
        type: 'object',
        properties: {
          producao_min: { type: 'integer', description: 'kg/h mínimo' },
          producao_max: { type: 'integer', description: 'kg/h máximo' },
          armazenamento_min: { type: 'integer', description: 'kg mínimo' },
          armazenamento_max: { type: 'integer', description: 'kg máximo' },
          voltagem: { type: 'string', description: 'TRIFASICO ou MONOFASICO' },
          com_balanca: { type: 'boolean' },
          com_ensacadeira: { type: 'boolean' },
          com_chupim: { type: 'boolean' },
          is_master: { type: 'boolean', description: 'true = versão Master (mais robusta)' },
          max_resultados: { type: 'integer', default: 12 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'detalhar_modelo',
      description:
        'Retorna todos os itens, motores e totais de UM modelo específico de orcamento_modelos. Use depois de listar_modelos_compacta pra mostrar o que vem no pacote.',
      parameters: {
        type: 'object',
        properties: {
          modelo_id: { type: 'integer', description: 'ID do modelo' },
        },
        required: ['modelo_id'],
      },
    },
  },

  // ====== TOOLS DE PROPOSTA (Sprint 2) ======
  // Estas NÃO modificam o banco nem o carrinho. Apenas geram uma "ação sugerida"
  // que volta no response, e o frontend renderiza como card de aprovação manual.
  {
    type: 'function' as const,
    function: {
      name: 'propor_adicionar_item',
      description:
        'Sugere ADICIONAR um item ao carrinho do orçamento atual. Use depois de confirmar via consultar_precos qual é o item exato. NÃO modifica nada direto — o vendedor precisa clicar pra confirmar. Sempre justifique brevemente por que esse item.',
      parameters: {
        type: 'object',
        properties: {
          preco_branorte_id: {
            type: 'integer',
            description: 'ID exato vindo de consultar_precos. NÃO invente IDs.',
          },
          quantidade: { type: 'integer', description: 'Qtd. Default 1.', default: 1 },
          justificativa: {
            type: 'string',
            description: 'Frase curta explicando porque esse item (ex: "Alimentação do moinho — TH 160 x 3,5 m com motor 1,5 CV").',
          },
        },
        required: ['preco_branorte_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propor_carregar_pacote',
      description:
        'Sugere SUBSTITUIR o carrinho atual pelo pacote completo de um modelo de Compacta/Mini Fabrica. Use depois de detalhar_modelo. ATENÇÃO: substitui TODOS os itens atuais — só sugira se o vendedor pediu pra montar do zero.',
      parameters: {
        type: 'object',
        properties: {
          modelo_id: { type: 'integer', description: 'ID do orcamento_modelos.' },
          justificativa: { type: 'string', description: 'Por que esse modelo atende o pedido.' },
        },
        required: ['modelo_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propor_preencher_cliente',
      description:
        'Sugere preencher os dados do cliente. Use quando o vendedor disser "o cliente é X da cidade Y, telefone Z" etc.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          ac: { type: 'string', description: 'Aos cuidados de (pessoa de contato)' },
          fone: { type: 'string' },
          cidade: { type: 'string' },
          bairro: { type: 'string' },
          endereco: { type: 'string' },
          cep: { type: 'string' },
          cnpj: { type: 'string', description: 'CPF ou CNPJ' },
          ie: { type: 'string', description: 'Inscrição Estadual' },
          email: { type: 'string' },
        },
      },
    },
  },
]

// ============================================================================
// TOOL IMPLEMENTATIONS (executadas server-side via Supabase service role)
// ============================================================================

async function tool_consultar_precos(supa: SupabaseClient, args: Record<string, unknown>) {
  const categoria = args.categoria as string | undefined
  const busca = args.busca as string | undefined
  const capMin = args.capacidade_min as number | undefined
  const capMax = args.capacidade_max as number | undefined
  const limit = Math.min((args.max_resultados as number) || 15, 30)

  let q = supa
    .from('precos_branorte')
    .select(
      'id, categoria, subcategoria, descricao, capacidade, capacidade_kg_pratica, capacidade_litros, motor_cv, motor_polos, potencia, valor_equipamento, valor_com_motor_trif, valor_com_motor_mono, dimensoes'
    )
    .eq('ativo', true)
    .order('categoria')
    .order('ordem')
    .limit(limit)

  if (categoria) q = q.eq('categoria', categoria.toUpperCase())
  if (busca) q = q.ilike('descricao', `%${busca}%`)
  if (capMin != null) q = q.gte('capacidade_kg_pratica', capMin)
  if (capMax != null) q = q.lte('capacidade_kg_pratica', capMax)

  const { data, error } = await q
  if (error) return { erro: error.message }
  return { resultados: data ?? [], total: (data ?? []).length }
}

async function tool_consultar_motor(supa: SupabaseClient, args: Record<string, unknown>) {
  const cv = args.cv as number
  const polos = args.polos as number | undefined
  const voltagem = args.voltagem as string | undefined

  let q = supa
    .from('catalogo_motores')
    .select('cv, polos, voltagem, valor, modelo')
    .eq('ativo', true)
    .eq('cv', cv)

  if (polos) q = q.eq('polos', polos)
  if (voltagem) q = q.eq('voltagem', voltagem.toUpperCase())

  const { data, error } = await q
  if (error) return { erro: error.message }
  return { resultados: data ?? [] }
}

async function tool_listar_modelos_compacta(supa: SupabaseClient, args: Record<string, unknown>) {
  const limit = Math.min((args.max_resultados as number) || 12, 30)

  let q = supa
    .from('orcamento_modelos')
    .select(
      'id, basename, pacote, voltagem, is_master, is_jr, producao_kgh, armazenamento_kg, total_equipamentos, total_motores, total_proposta, com_balanca, com_ensacadeira, com_chupim'
    )
    .eq('ativo', true)
    .order('producao_kgh', { nullsFirst: false })
    .order('armazenamento_kg', { nullsFirst: false })
    .limit(limit)

  if (args.producao_min != null) q = q.gte('producao_kgh', args.producao_min as number)
  if (args.producao_max != null) q = q.lte('producao_kgh', args.producao_max as number)
  if (args.armazenamento_min != null) q = q.gte('armazenamento_kg', args.armazenamento_min as number)
  if (args.armazenamento_max != null) q = q.lte('armazenamento_kg', args.armazenamento_max as number)
  if (args.voltagem) q = q.eq('voltagem', (args.voltagem as string).toUpperCase())
  if (typeof args.com_balanca === 'boolean') q = q.eq('com_balanca', args.com_balanca)
  if (typeof args.com_ensacadeira === 'boolean') q = q.eq('com_ensacadeira', args.com_ensacadeira)
  if (typeof args.com_chupim === 'boolean') q = q.eq('com_chupim', args.com_chupim)
  if (typeof args.is_master === 'boolean') q = q.eq('is_master', args.is_master)

  const { data, error } = await q
  if (error) return { erro: error.message }
  return { resultados: data ?? [], total: (data ?? []).length }
}

async function tool_detalhar_modelo(supa: SupabaseClient, args: Record<string, unknown>) {
  const id = args.modelo_id as number
  const { data, error } = await supa
    .from('orcamento_modelos')
    .select(
      'id, basename, pacote, voltagem, producao_kgh, armazenamento_kg, itens, acessorios, motores, total_equipamentos, total_motores, total_proposta'
    )
    .eq('id', id)
    .single()
  if (error) return { erro: error.message }
  return data
}

// ============================================================================
// AÇÕES PROPOSTAS — Sprint 2
// Tipo serializado que o frontend interpreta pra renderizar cards de aprovação.
// ============================================================================

type AcaoSugerida =
  | {
      tipo: 'adicionar_item'
      preco_branorte_id: number
      quantidade: number
      justificativa?: string
      // Snapshot dos dados pro card renderizar sem precisar refetch:
      preview?: {
        categoria: string
        descricao: string
        valor_equipamento: number | null
        motor_cv: number | null
        motor_polos: number | null
        capacidade: string | null
      }
    }
  | {
      tipo: 'carregar_pacote'
      modelo_id: number
      justificativa?: string
      preview?: {
        basename: string
        producao_kgh: number | null
        armazenamento_kg: number | null
        total_proposta: number | null
        qtd_itens: number
      }
    }
  | {
      tipo: 'preencher_cliente'
      dados: Record<string, string | undefined>
    }

async function tool_propor_adicionar_item(
  supa: SupabaseClient,
  args: Record<string, unknown>
): Promise<{ acao: AcaoSugerida } | { erro: string }> {
  const id = args.preco_branorte_id as number
  const qtd = (args.quantidade as number) || 1
  const justificativa = (args.justificativa as string) || ''

  // Valida que o ID existe — bloqueia IA de inventar.
  const { data, error } = await supa
    .from('precos_branorte')
    .select('id, categoria, descricao, valor_equipamento, motor_cv, motor_polos, capacidade')
    .eq('id', id)
    .eq('ativo', true)
    .single()

  if (error || !data) return { erro: `preco_branorte_id ${id} não encontrado ou inativo` }

  return {
    acao: {
      tipo: 'adicionar_item',
      preco_branorte_id: id,
      quantidade: qtd,
      justificativa,
      preview: {
        categoria: data.categoria,
        descricao: data.descricao,
        valor_equipamento: data.valor_equipamento ? Number(data.valor_equipamento) : null,
        motor_cv: data.motor_cv ? Number(data.motor_cv) : null,
        motor_polos: data.motor_polos,
        capacidade: data.capacidade,
      },
    },
  }
}

async function tool_propor_carregar_pacote(
  supa: SupabaseClient,
  args: Record<string, unknown>
): Promise<{ acao: AcaoSugerida } | { erro: string }> {
  const id = args.modelo_id as number
  const justificativa = (args.justificativa as string) || ''

  const { data, error } = await supa
    .from('orcamento_modelos')
    .select('id, basename, producao_kgh, armazenamento_kg, total_proposta, itens')
    .eq('id', id)
    .eq('ativo', true)
    .single()

  if (error || !data) return { erro: `modelo_id ${id} não encontrado` }

  const qtdItens = Array.isArray(data.itens) ? (data.itens as unknown[]).length : 0

  return {
    acao: {
      tipo: 'carregar_pacote',
      modelo_id: id,
      justificativa,
      preview: {
        basename: data.basename,
        producao_kgh: data.producao_kgh,
        armazenamento_kg: data.armazenamento_kg,
        total_proposta: data.total_proposta ? Number(data.total_proposta) : null,
        qtd_itens: qtdItens,
      },
    },
  }
}

function tool_propor_preencher_cliente(
  args: Record<string, unknown>
): { acao: AcaoSugerida } {
  // Filtra só campos com valor (evita "" no payload)
  const dados: Record<string, string | undefined> = {}
  for (const k of ['nome', 'ac', 'fone', 'cidade', 'bairro', 'endereco', 'cep', 'cnpj', 'ie', 'email']) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) dados[k] = v.trim()
  }
  return { acao: { tipo: 'preencher_cliente', dados } }
}

async function executarTool(
  supa: SupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'consultar_precos':
      return tool_consultar_precos(supa, args)
    case 'consultar_motor':
      return tool_consultar_motor(supa, args)
    case 'listar_modelos_compacta':
      return tool_listar_modelos_compacta(supa, args)
    case 'detalhar_modelo':
      return tool_detalhar_modelo(supa, args)
    case 'propor_adicionar_item':
      return tool_propor_adicionar_item(supa, args)
    case 'propor_carregar_pacote':
      return tool_propor_carregar_pacote(supa, args)
    case 'propor_preencher_cliente':
      return tool_propor_preencher_cliente(args)
    default:
      return { erro: `tool desconhecida: ${name}` }
  }
}

// ============================================================================
// HANDLER
// ============================================================================

interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface ReqBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  context?: {
    orcamento_id?: number | string
    carrinho_resumo?: string
    cliente_nome?: string
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    return res.status(500).json({ error: 'env_missing', detail: 'SUPABASE env vars not set' })
  }
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'env_missing', detail: 'OPENAI_API_KEY not set' })
  }

  // JWT do Supabase obrigatório (igual padrão de feedback.ts)
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const body = req.body as ReqBody
  if (!body?.messages?.length) return res.status(400).json({ error: 'no_messages' })

  // Monta histórico inicial com system prompt + contexto opcional
  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (body.context) {
    const ctx = []
    if (body.context.cliente_nome) ctx.push(`Cliente: ${body.context.cliente_nome}`)
    if (body.context.carrinho_resumo) ctx.push(`Itens já no orçamento:\n${body.context.carrinho_resumo}`)
    if (ctx.length)
      messages.push({
        role: 'system',
        content: `CONTEXTO DO ORÇAMENTO ATUAL:\n${ctx.join('\n')}`,
      })
  }
  for (const m of body.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content })
    }
  }

  // Loop com tool use
  let iteration = 0
  const toolTrace: Array<{ name: string; args: unknown; ok: boolean; ms: number }> = []
  // Coleta as ações sugeridas (Sprint 2) durante o loop pra devolver no response
  const acoesSugeridas: AcaoSugerida[] = []

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text()
      return res.status(502).json({
        error: 'openai_error',
        status: openaiRes.status,
        detail: errText.slice(0, 500),
      })
    }

    const result = (await openaiRes.json()) as {
      choices: Array<{ message: ChatMsg; finish_reason: string }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }
    const choice = result.choices?.[0]
    if (!choice) return res.status(502).json({ error: 'no_choice' })
    const msg = choice.message

    // Se GPT pediu tools, executa todas e devolve
    if (msg.tool_calls?.length) {
      messages.push(msg)
      for (const tc of msg.tool_calls) {
        const start = Date.now()
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(tc.function.arguments)
        } catch {
          parsedArgs = {}
        }
        const result = await executarTool(supa, tc.function.name, parsedArgs)
        const ms = Date.now() - start
        const erro = (result as { erro?: string })?.erro
        toolTrace.push({
          name: tc.function.name,
          args: parsedArgs,
          ok: !erro,
          ms,
        })
        // Se a tool gerou uma ação sugerida (propor_*), coleta pro response
        const acao = (result as { acao?: AcaoSugerida })?.acao
        if (acao) acoesSugeridas.push(acao)
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        })
      }
      continue
    }

    // Sem mais tools — resposta final
    return res.status(200).json({
      reply: msg.content || '',
      acoes: acoesSugeridas,
      tool_trace: toolTrace,
      iterations: iteration,
    })
  }

  return res.status(500).json({
    error: 'max_iterations_exceeded',
    acoes: acoesSugeridas,
    tool_trace: toolTrace,
  })
}
