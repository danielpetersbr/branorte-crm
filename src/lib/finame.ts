// ─────────────────────────────────────────────────────────────────────────────
// MODO FINAME — configuração centralizada (financiamento BNDES/FINAME)
// ─────────────────────────────────────────────────────────────────────────────
//
// REGRA DE NEGÓCIO (decidida com o Daniel, 2026-06-25):
//   - Cada equipamento que TEM código FINAME próprio sai como sua PRÓPRIA linha,
//     com o nome e o código FINAME oficiais.
//   - MOTORES e ACESSÓRIOS (sem código próprio) são EMBUTIDOS (diluídos) no valor
//     dos equipamentos principais — NÃO aparecem como linha separada.
//   - Componentes extras (painel elétrico, balança, etc.) também são embutidos.
//   - Item sem código FINAME e que não é acessório → BLOQUEIA a geração + sugere
//     substituição.
//
// ⚠️  Os códigos abaixo são FIXOS e OFICIAIS. NUNCA inventar novos códigos.
//     Para cadastrar um tipo novo no futuro, adicione uma entrada em FINAME_MAP.
// ─────────────────────────────────────────────────────────────────────────────

export interface FinameTipo {
  key: string
  /** Termos que identificam o tipo no nome do item (já normalizados: lowercase, sem acento). */
  aliases: string[]
  /** Nome que aparece no orçamento FINAME (pode diferir do nome comercial do catálogo). */
  nomeFiname: string
  /** Código FINAME oficial (8 dígitos). */
  codigoFiname: string
  /** Descrição técnica padrão da linha. */
  descricaoPadrao: string
}

// Ordem IMPORTA: o primeiro alias que casar vence.
// "Silo Misturador" precisa cair em MISTURADOR (não em CAIXA_ARMAZENAGEM), por isso
// MISTURADOR vem antes e CAIXA_ARMAZENAGEM (silo) vem por último.
export const FINAME_MAP: FinameTipo[] = [
  {
    key: 'MISTURADOR',
    aliases: ['misturador', 'silo misturador', 'master'],
    nomeFiname: 'Silo Misturador',
    codigoFiname: '03590150',
    descricaoPadrao: 'Equipamento destinado à mistura de ração.',
  },
  {
    key: 'ELEVADOR_CANECAS',
    aliases: ['elevador de canecas', 'elevador canecas', 'elevador'],
    nomeFiname: 'Elevador de Canecas',
    codigoFiname: '03637657',
    descricaoPadrao: 'Equipamento destinado ao transporte vertical de materiais.',
  },
  {
    key: 'PENEIRA_VIBRATORIA',
    aliases: ['peneira vibratoria', 'peneira'],
    nomeFiname: 'Peneira Vibratória',
    codigoFiname: '03629482',
    descricaoPadrao: 'Equipamento destinado à classificação/peneiramento de materiais.',
  },
  {
    key: 'MOINHO_MARTELO',
    aliases: ['moinho martelo', 'moinho de martelo', 'moinho'],
    nomeFiname: 'Moinho Martelo',
    codigoFiname: '03625516',
    descricaoPadrao: 'Equipamento destinado à moagem de materiais.',
  },
  {
    key: 'TRANSPORTADOR_HELICOIDAL',
    // ensacadeira e rosca (de carga/transporte) saem como Transportador Helicoidal.
    aliases: [
      'transportador helicoidal', 'transportador', 'rosca transportadora', 'rosca',
      'chupim', 'ensacadeira', 'calha th', 'calha', 'helicoidal',
    ],
    nomeFiname: 'Transportador Helicoidal',
    codigoFiname: '03648162',
    descricaoPadrao: 'Equipamento destinado ao transporte de materiais.',
  },
  {
    key: 'CACAMBA_PESAGEM',
    aliases: ['cacamba de pesagem', 'cacamba'],
    nomeFiname: 'Caçamba de Pesagem',
    codigoFiname: '04328489',
    descricaoPadrao: 'Equipamento destinado à pesagem.',
  },
  {
    key: 'CAIXA_ARMAZENAGEM',
    aliases: ['caixa de armazenagem', 'caixa armazenagem', 'silo de armazenagem', 'armazenagem', 'silos', 'silo'],
    nomeFiname: 'Silo de Armazenagem',
    codigoFiname: '03617124',
    descricaoPadrao: 'Equipamento destinado à armazenagem.',
  },
]

// Itens que são SÓ motor/componente motriz → embutidos (não geram linha).
const FINAME_MOTOR_KEYWORDS = [
  'motor', 'motoredutor', 'motorredutor', 'moto redutor', 'redutor',
  'acionamento', 'conjunto motriz',
]

// Marcadores FORTES de acessório/peça (vencem o match de principal) → embutidos.
const FINAME_ACESSORIO_FORTE = ['jogo', 'kit ', 'kit-', 'par de']

// Keywords FRACAS de acessório (só valem se não casou nenhum principal) → embutidos.
const FINAME_ACESSORIO_KEYWORDS = [
  'acessorio', 'base', 'suporte', 'correia', 'protecao', 'acoplamento',
  'rosca auxiliar', 'componente auxiliar', 'componentes auxiliares',
  'item complementar', 'itens complementares', 'flange', 'mangote', 'duto',
]

export const FINAME_NAO_RESOLVIDO_MSG =
  'Este item não possui código FINAME cadastrado e não pode ser incluído no orçamento FINAME.'

export const FINAME_SUGESTAO_GENERICA =
  'Verifique se este item pode ser substituído por um item com código FINAME cadastrado, como ' +
  'Transportador Helicoidal, Silo de Armazenagem, Elevador de Canecas, Peneira Vibratória, ' +
  'Moinho Martelo, Caçamba de Pesagem ou Silo Misturador.'

export const FINAME_INCLUSOS_TXT = 'Motor e acessórios necessários inclusos no conjunto.'

export type FinameClasse =
  | { tipo: 'principal'; fin: FinameTipo }
  | { tipo: 'acessorio' } // valor embutido no equipamento
  | { tipo: 'motor' } // valor embutido no equipamento
  | { tipo: 'naoResolvido'; sugestao: string }

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

// Peneira PASSIVA não é a "Peneira Vibratória" acionada — é peça/acessório (embute).
// Espelha peneiraSemMotor() do OrcamentoMontar: SÓ a peneira vibratória é o equipamento;
// qualquer outra peneira (rotativa, jogo, par, de moinho) é passiva.
function ehPeneiraPassiva(n: string): boolean {
  return /peneira/.test(n) && !/vibrat[oó]ria/.test(n)
}

/**
 * Classifica um item do carrinho para o Modo FINAME.
 * Precedência: categoria ACESSORIO → peças passivas → marcadores fortes de acessório →
 * motor puro → alias de equipamento principal → keyword fraca de acessório → não resolvido.
 */
export function classificarItemFiname(nome: string, categoria?: string | null): FinameClasse {
  const n = norm(nome)
  const cat = norm(categoria)

  // 1) Categoria ACESSORIO explícita do catálogo → embute.
  if (cat === 'acessorio') return { tipo: 'acessorio' }

  // 2) Peneira passiva (jogo/par/moinho) → embute.
  if (ehPeneiraPassiva(n)) return { tipo: 'acessorio' }

  // 3) Marcador FORTE de acessório/peça (jogo, kit, par de) → embute.
  if (FINAME_ACESSORIO_FORTE.some(k => n.includes(k))) return { tipo: 'acessorio' }

  const casaPrincipal = FINAME_MAP.some(t => t.aliases.some(a => n.includes(a)))

  // 4) Item que é SÓ motor (sem casar nenhum equipamento principal) → embute.
  if (!casaPrincipal && FINAME_MOTOR_KEYWORDS.some(k => n.includes(k))) {
    return { tipo: 'motor' }
  }

  // 5) Equipamento principal (com código FINAME próprio).
  for (const t of FINAME_MAP) {
    if (t.aliases.some(a => n.includes(a))) return { tipo: 'principal', fin: t }
  }

  // 6) Keyword fraca de acessório → embute.
  if (FINAME_ACESSORIO_KEYWORDS.some(k => n.includes(k))) return { tipo: 'acessorio' }

  // 7) Sem código e não é acessório → bloqueia + sugere.
  return { tipo: 'naoResolvido', sugestao: FINAME_SUGESTAO_GENERICA }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORMAÇÃO DO CARRINHO → ITENS FINAME
// ─────────────────────────────────────────────────────────────────────────────

export interface FinameInputItem {
  uid: string
  nome: string // nome_custom || nome
  categoria?: string | null
  qtd: number
  /** Valor já a cobrar (subtotal = valor unitário × qtd; 0 se brinde/por conta). */
  subtotal: number
  /** Total de motor desse item (somado de motoresAgrupados por item_uid). */
  motorValor: number
}

export interface FinameResultItem {
  uid: string
  nomeFiname: string
  codigoFiname: string
  categoria: string
  specs: string[]
  qtd: number
  /** Valor UNITÁRIO final (motor + acessórios diluídos). */
  valor: number
}

export interface FinameBloqueio {
  uid: string
  nome: string
  mensagem: string
  sugestao: string
}

export interface FinameTransformResult {
  itens: FinameResultItem[]
  /** Soma das linhas (valor unitário × qtd) — total da proposta FINAME. */
  totalGeral: number
  bloqueios: FinameBloqueio[]
}

/**
 * Transforma os itens do carrinho no conjunto FINAME:
 *  - mantém só os equipamentos principais (cada um com seu código),
 *  - dilui motores + acessórios + poolExtra (acessórios% + componentes extras) no valor,
 *  - retorna bloqueios para itens sem código FINAME que não são acessório.
 *
 * Garantia: total = soma das linhas (o documento sempre fecha internamente).
 */
export function montarItensFiname(itens: FinameInputItem[], poolExtra: number): FinameTransformResult {
  const principais: Array<{ in: FinameInputItem; fin: FinameTipo; base: number }> = []
  const bloqueios: FinameBloqueio[] = []
  let pool = Math.max(0, Math.round(poolExtra || 0))

  for (const it of itens) {
    const cls = classificarItemFiname(it.nome, it.categoria)
    const base = Math.max(0, Math.round((it.subtotal || 0) + (it.motorValor || 0)))
    if (cls.tipo === 'principal') {
      principais.push({ in: it, fin: cls.fin, base })
    } else if (cls.tipo === 'acessorio' || cls.tipo === 'motor') {
      pool += base // valor embutido
    } else {
      bloqueios.push({
        uid: it.uid,
        nome: it.nome,
        mensagem: FINAME_NAO_RESOLVIDO_MSG,
        sugestao: cls.sugestao,
      })
    }
  }

  // Precisa de ao menos um equipamento principal pra receber o código + o pool.
  if (principais.length === 0) {
    bloqueios.push({
      uid: '__sem_principal__',
      nome: '(nenhum equipamento principal)',
      mensagem: 'Nenhum equipamento com código FINAME no orçamento. Adicione ao menos um equipamento principal (ex: Misturador, Silo, Transportador).',
      sugestao: FINAME_SUGESTAO_GENERICA,
    })
    return { itens: [], totalGeral: 0, bloqueios }
  }

  const totalBase = principais.reduce((s, p) => s + p.base, 0)
  // índice do maior (absorve a sobra de arredondamento)
  let idxMaior = 0
  principais.forEach((p, i) => { if (p.base > principais[idxMaior].base) idxMaior = i })

  const shares = new Array(principais.length).fill(0)
  if (pool > 0) {
    if (totalBase > 0) {
      let distribuido = 0
      principais.forEach((p, i) => {
        const s = Math.floor((pool * p.base) / totalBase)
        shares[i] = s
        distribuido += s
      })
      shares[idxMaior] += pool - distribuido
    } else {
      // todas as bases zero (itens sem preço) → divide igual
      const each = Math.floor(pool / principais.length)
      principais.forEach((_, i) => { shares[i] = each })
      shares[idxMaior] += pool - each * principais.length
    }
  }

  let totalGeral = 0
  const itensOut: FinameResultItem[] = principais.map((p, i) => {
    const lineTotal = p.base + shares[i]
    const qtd = Math.max(1, p.in.qtd)
    const unit = Math.round(lineTotal / qtd)
    totalGeral += unit * qtd
    const temEmbutido = (p.in.motorValor || 0) > 0 || shares[i] > 0
    const specs = [
      p.fin.descricaoPadrao,
      ...(temEmbutido ? [FINAME_INCLUSOS_TXT] : []),
      `Código FINAME: ${p.fin.codigoFiname}.`,
    ]
    return {
      uid: p.in.uid,
      nomeFiname: p.fin.nomeFiname,
      codigoFiname: p.fin.codigoFiname,
      categoria: p.in.categoria ?? '',
      specs,
      qtd,
      valor: unit,
    }
  })

  return { itens: itensOut, totalGeral, bloqueios }
}
