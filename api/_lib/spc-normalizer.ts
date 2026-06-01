// Normalizador do payload SPC — extrai os campos importantes pro
// frontend conseguir renderizar de forma legivel.
//
// Funciona em 2 modos:
//   1) Payload real do SPC (estrutura aninhada: result.return_object.resultado)
//   2) Payload mock (gerado pelo proprio backend pra testes)
//
// Retorna sempre o mesmo shape "resumo" que o frontend conhece.

export interface ResumoConsumidor {
  tipo: 'F' | 'J'
  documento: string
  nome: string | null
  razao_social?: string | null
  nome_fantasia?: string | null
  situacao?: string | null
  data_fundacao?: string | null
  data_nascimento?: string | null
  natureza_juridica?: string | null
  endereco?: string | null
  telefones?: string[]
  email?: string | null
}

export interface ResumoSpc {
  consumidor: ResumoConsumidor
  score: { valor: number | null; classificacao: string | null; mensagem?: string | null }
  inadimplencias: {
    qtd: number
    valor_total: number
    detalhes: Array<{ origem: string; valor: number; data: string | null }>
  }
  protestos: { qtd: number; valor_total: number }
  socios?: Array<{ nome: string; participacao?: string | null; documento?: string | null }>
  administradores?: Array<{ nome: string; cargo?: string | null }>
  participacoes_em_empresas?: Array<{ nome: string; cnpj?: string | null; tipo?: string | null }>
  /** PEP — Pessoa Exposta Politicamente (insumo 5255). */
  pep?: { tem: boolean; qtd: number; detalhes: Array<{ nome?: string | null; cargo?: string | null }> }
  /** Faturamento presumido em R$ (insumo 5178). */
  faturamento_presumido?: { valor: number; periodicidade?: 'mensal' | 'anual' | null } | null
  alertas?: string[]
}

// ============================================================================
// MOCK realista (~ payload SPC) — gerado server-side quando SPC_MOCK=1
// ============================================================================
export function gerarMockResumo(tipo: 'F' | 'J', documento: string): ResumoSpc {
  if (tipo === 'J') {
    return {
      consumidor: {
        tipo: 'J',
        documento,
        nome: 'EMPRESA EXEMPLO COMERCIO E SERVIÇOS LTDA',
        razao_social: 'EMPRESA EXEMPLO COMERCIO E SERVIÇOS LTDA',
        nome_fantasia: 'EXEMPLO',
        situacao: 'ATIVA',
        data_fundacao: '14/05/2010',
        natureza_juridica: 'Sociedade Empresária Limitada',
        endereco: 'R. EXEMPLO, 123 — CENTRO — SAO PAULO/SP — CEP 01234-567',
        telefones: ['(11) 3456-7890', '(11) 98765-4321'],
        email: 'contato@exemplo.com.br',
      },
      score: { valor: 750, classificacao: 'BOM' },
      inadimplencias: {
        qtd: 0,
        valor_total: 0,
        detalhes: [],
      },
      protestos: { qtd: 0, valor_total: 0 },
      socios: [
        { nome: 'JOAO DA SILVA', participacao: '50%', documento: '123.***.***-01' },
        { nome: 'MARIA DA SILVA', participacao: '50%', documento: '987.***.***-00' },
      ],
      administradores: [
        { nome: 'JOAO DA SILVA', cargo: 'Administrador' },
      ],
      participacoes_em_empresas: [
        { nome: 'OUTRA EMPRESA LTDA', cnpj: '99.888.777/0001-66', tipo: 'Sócio (30%)' },
      ],
      alertas: [],
    }
  }
  // PF
  return {
    consumidor: {
      tipo: 'F',
      documento,
      nome: 'JOAO DA SILVA EXEMPLO',
      data_nascimento: '14/05/1980',
      situacao: 'REGULAR',
      endereco: 'R. EXEMPLO, 456 — CENTRO — SAO PAULO/SP — CEP 01234-567',
      telefones: ['(11) 99876-5432'],
      email: 'joao@exemplo.com.br',
    },
    score: { valor: 680, classificacao: 'REGULAR' },
    inadimplencias: {
      qtd: 0,
      valor_total: 0,
      detalhes: [],
    },
    protestos: { qtd: 0, valor_total: 0 },
    participacoes_em_empresas: [
      { nome: 'EMPRESA EXEMPLO LTDA', cnpj: documento.length === 14 ? documento : '11.222.333/0001-44', tipo: 'Sócio (50%)' },
    ],
    alertas: [],
  }
}

// ============================================================================
// Normalizador do payload REAL do SPC
// ============================================================================
//
// O payload real vem assim (resumido):
// {
//   result: { return_object: { resultado: {
//     consumidor: {
//       consumidorPessoaFisica: { ... } OR consumidorPessoaJuridica: { ... }
//     },
//     spc: { resumo: { quantidadeTotal, valorTotal }, detalheSpc: [...] },
//     score: { pontuacao, ... },
//     protestoNacional: { resumo: {...}, detalheProtestoNacional: [...] },
//     socio: { detalheSocio: [...] },
//     administrador: { detalheAdministrador: [...] },
//     participacaoEmpresa: { detalheParticipacaoEmpresa: [...] }
//   }}}
// }
//
// Como cada produto SPC retorna campos diferentes, o normalizador eh
// defensivo: extrai o que existir e ignora o resto.
type AnyObj = Record<string, unknown>

function get<T = unknown>(obj: AnyObj | null | undefined, ...path: string[]): T | undefined {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as AnyObj)[k]
  }
  return cur as T | undefined
}

function fmtCidade(end: AnyObj | undefined): string | null {
  if (!end) return null
  const rua = get<string>(end, 'logradouro') ?? ''
  const num = get<string>(end, 'numero') ?? ''
  const comp = get<string>(end, 'complemento') ?? ''
  const bairro = get<string>(end, 'bairro') ?? ''
  const cidade = get<string>(end, 'cidade', 'nome') ?? ''
  const uf = get<string>(end, 'cidade', 'estado', 'siglaUf') ?? ''
  const cep = get<string | number>(end, 'cep')
  const partes = [
    [rua, num].filter(Boolean).join(', '),
    comp,
    bairro,
    [cidade, uf].filter(Boolean).join('/'),
    cep ? `CEP ${String(cep)}` : '',
  ].filter(Boolean)
  return partes.length ? partes.join(' — ') : null
}

function fmtFone(t: AnyObj | undefined): string | null {
  if (!t) return null
  const ddd = get<number | string>(t, 'numeroDdd')
  const num = get<number | string>(t, 'numero')
  if (!ddd && !num) return null
  return `(${ddd}) ${num}`
}

export function normalizarPayloadSpc(
  payload: AnyObj | null | undefined,
  fallbackDoc = '',
): ResumoSpc | null {
  if (!payload) return null
  // SPC retorna result.return_object.resultado — mas as vezes vem direto.
  const raiz =
    get<AnyObj>(payload, 'result', 'return_object', 'resultado') ??
    get<AnyObj>(payload, 'resultado') ??
    payload
  const consumidor = get<AnyObj>(raiz, 'consumidor')
  const pf = get<AnyObj>(consumidor, 'consumidorPessoaFisica')
  const pj = get<AnyObj>(consumidor, 'consumidorPessoaJuridica')
  const isPj = !!pj
  const c = pj ?? pf

  if (!c) return null  // sem consumidor identificado, payload invalido

  const documento = isPj
    ? String(get(c, 'cnpj', 'numero') ?? fallbackDoc)
    : String(get(c, 'cpf', 'numero') ?? fallbackDoc)

  const consumidorNorm: ResumoConsumidor = isPj
    ? {
        tipo: 'J',
        documento,
        nome: (get<string>(c, 'nomeComercial') ?? get<string>(c, 'razaoSocial')) || null,
        razao_social: get<string>(c, 'razaoSocial') ?? null,
        nome_fantasia: get<string>(c, 'nomeComercial') ?? null,
        situacao: get<string>(c, 'situacaoCnpj', 'descricaoSituacao') ?? null,
        data_fundacao: (() => {
          const v = get<number>(c, 'dataFundacao')
          return v ? new Date(v).toLocaleDateString('pt-BR') : null
        })(),
        natureza_juridica: get<string>(c, 'naturezaJuridica', 'descricao') ?? null,
        endereco: fmtCidade(get<AnyObj>(c, 'endereco')),
        telefones: [fmtFone(get<AnyObj>(c, 'telefone')), fmtFone(get<AnyObj>(c, 'fax'))].filter(
          (x): x is string => !!x,
        ),
        email: get<string>(c, 'email') ?? null,
      }
    : {
        tipo: 'F',
        documento,
        nome: get<string>(c, 'nome') ?? null,
        data_nascimento: (() => {
          const v = get<number>(c, 'dataNascimento')
          return v ? new Date(v).toLocaleDateString('pt-BR') : null
        })(),
        situacao: get<string>(c, 'situacaoCpf', 'descricaoSituacao') ?? null,
        endereco: fmtCidade(get<AnyObj>(c, 'endereco')),
        telefones: [
          fmtFone(get<AnyObj>(c, 'telefoneCelular')),
          fmtFone(get<AnyObj>(c, 'telefoneResidencial')),
          fmtFone(get<AnyObj>(c, 'telefoneComercial')),
        ].filter((x): x is string => !!x),
        email: get<string>(c, 'email') ?? null,
      }

  const spc = get<AnyObj>(raiz, 'spc')
  const detalheSpc = (get<AnyObj[]>(spc, 'detalheSpc') ?? []) as AnyObj[]
  const inadimplencias = {
    qtd: Number(get(spc, 'resumo', 'quantidadeTotal') ?? detalheSpc.length ?? 0),
    valor_total: Number(get(spc, 'resumo', 'valorTotal') ?? 0),
    detalhes: detalheSpc.slice(0, 5).map(d => ({
      origem: String(get(d, 'nomeAssociado') ?? get(d, 'origem') ?? '—'),
      valor: Number(get(d, 'valor') ?? 0),
      data: (() => {
        const v = get<number>(d, 'dataInclusao')
        return v ? new Date(v).toLocaleDateString('pt-BR') : null
      })(),
    })),
  }

  // Protesto: o SPC retorna `protesto` (não `protestoNacional`)
  const protesto = get<AnyObj>(raiz, 'protesto') ?? get<AnyObj>(raiz, 'protestoNacional')
  const protestos = {
    qtd: Number(get(protesto, 'resumo', 'quantidadeTotal') ?? 0),
    valor_total: Number(get(protesto, 'resumo', 'valorTotal') ?? 0),
  }

  // Score: insumo 78 retorna em spcScore12Meses.detalheSpcScore12Meses[0]
  // Estrutura: { score: number, classe: 'A'|'B'|'C'|'D'|'E'|'F', horizonte: 12, mesagemInterpretativaScore: string }
  // classe='F' = inadimplente. score=0 com classe=F NÃO é ausência de score, é alto risco.
  const score12 = get<AnyObj[]>(raiz, 'spcScore12Meses', 'detalheSpcScore12Meses')?.[0]
  const score3 = get<AnyObj[]>(raiz, 'spcScore3Meses', 'detalheSpcScore3Meses')?.[0]
  const scoreLegacy = get<AnyObj>(raiz, 'score') // fallback legado
  const scoreFonte = score12 ?? score3 ?? scoreLegacy
  let scoreValor: number | null = null
  let scoreClassificacao: string | null = null
  let scoreMensagem: string | null = null
  if (scoreFonte) {
    const v = get<number>(scoreFonte, 'score') ?? get<number>(scoreFonte, 'pontuacao') ?? get<number>(scoreFonte, 'valor')
    scoreValor = typeof v === 'number' ? v : null
    const classe = get<string>(scoreFonte, 'classe') ?? get<string>(scoreFonte, 'classificacao')
    scoreClassificacao = classe ? mapearClasseScore(classe) : null
    scoreMensagem = get<string>(scoreFonte, 'mesagemInterpretativaScore') ?? get<string>(scoreFonte, 'mensagemInterpretativaScore') ?? null
  }
  const score = { valor: scoreValor, classificacao: scoreClassificacao, mensagem: scoreMensagem }

  const socios = (get<AnyObj[]>(raiz, 'socio', 'detalheSocio') ?? []).map(s => ({
    nome: String(get(s, 'nome') ?? '—'),
    participacao: (get<string | number>(s, 'percentualParticipacao') ?? null)?.toString() ?? null,
    documento: (get<string>(s, 'cpf', 'numero') ?? get<string>(s, 'cnpj', 'numero')) ?? null,
  }))

  const administradores = (get<AnyObj[]>(raiz, 'administrador', 'detalheAdministrador') ?? []).map(a => ({
    nome: String(get(a, 'nome') ?? '—'),
    cargo: get<string>(a, 'cargo') ?? null,
  }))

  const participacoes = (
    get<AnyObj[]>(raiz, 'participacaoEmpresa', 'detalheParticipacaoEmpresa') ?? []
  ).map(p => ({
    nome: String(get(p, 'nome') ?? get(p, 'razaoSocial') ?? '—'),
    cnpj: get<string>(p, 'cnpj', 'numero') ?? null,
    tipo: get<string>(p, 'tipo') ?? null,
  }))

  // PEP: insumo 5255 retorna em resultadoInsumoPep
  const pepObj = get<AnyObj>(raiz, 'resultadoInsumoPep') ?? get<AnyObj>(raiz, 'pep')
  const pepDetalhes = (get<AnyObj[]>(pepObj, 'detalhePep') ?? []).map(p => ({
    nome: get<string>(p, 'nome') ?? null,
    cargo: get<string>(p, 'cargoFuncao') ?? get<string>(p, 'cargo') ?? null,
  }))
  const pepQtd = Number(get(pepObj, 'resumo', 'quantidadeTotal') ?? pepDetalhes.length ?? 0)
  const pep = pepObj ? { tem: pepQtd > 0, qtd: pepQtd, detalhes: pepDetalhes } : undefined

  // Faturamento presumido: insumo 5178
  const fatObj = get<AnyObj>(raiz, 'faturamentoPresumido')
  const fatValor = Number(
    get(fatObj, 'detalheFaturamentoPresumido', '0', 'valorFaturamento') ??
    (get<AnyObj[]>(fatObj, 'detalheFaturamentoPresumido')?.[0] as AnyObj | undefined)?.valorFaturamento ??
    get(fatObj, 'resumo', 'valorTotal') ?? 0,
  )
  const faturamento_presumido = fatObj && fatValor > 0 ? { valor: fatValor, periodicidade: 'anual' as const } : null

  return {
    consumidor: consumidorNorm,
    score,
    inadimplencias,
    protestos,
    socios: socios.length ? socios : undefined,
    administradores: administradores.length ? administradores : undefined,
    participacoes_em_empresas: participacoes.length ? participacoes : undefined,
    pep,
    faturamento_presumido,
    alertas: [],
  }
}

// Mapeia classe A-F do SPC pra descrição humana
function mapearClasseScore(classe: string): string {
  const m: Record<string, string> = {
    A: 'EXCELENTE', B: 'BOM', C: 'MÉDIO',
    D: 'BAIXO', E: 'MUITO BAIXO', F: 'INADIMPLENTE',
  }
  return m[classe.toUpperCase()] ?? classe
}
