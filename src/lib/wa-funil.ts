// Taxonomia compartilhada do funil de etiquetas WhatsApp (Wascript).
// Fonte única para ordem oficial, aliases de typo, cores e ocultas —
// usada pelo Kanban /funil. (As telas EtiquetasZap/EtiquetasZapGraficos/
// PainelEtiquetas que também consumiam isto foram removidas em 2026-08-17.)

// Ordem oficial do funil de vendas Branorte. Etiquetas fora da lista vão pro final.
/**
 * As 5 etapas do FUNIL propriamente dito, na ordem em que o Daniel trabalha:
 * prospeccao -> 2a tentativa -> novo lead -> follow up -> lead quente.
 *
 * Existe separado de ORDEM_FUNIL (que lista TUDO, inclusive motivo de
 * fechamento) porque a barra de chips fixa estas cinco na frente: sao as que o
 * vendedor usa pra decidir o que fazer HOJE. As demais ordenam por volume.
 */
export const FUNIL_PRINCIPAL: string[] = [
  'PROSPECCAO',
  '2A TENTATIVA',
  'NOVO LEAD',
  'FOLLOW UP',
  'LEAD QUENTE',
]

export const ORDEM_FUNIL: string[] = [
  // FUNIL DE VENDAS
  'PROSPECCAO',
  '2A TENTATIVA',
  'NOVO LEAD',
  'FOLLOW UP',
  'LEAD QUENTE',
  'ORCAMENTO ENVIADO',
  'INTERESSE FUTURO',
  'VENDIDO',
  // MOTIVO DE FECHAMENTO
  'NAO RESPONDEU MAIS',
  'NUNCA RESPONDEU',
  'NAO TEM INTERESSE',
  'COMPROU DO CONCORRENTE',
  'SO BASE DE PRECO',
  'FORA DO ORCAMENTO',
  'NAO FABRICAMOS',
  'OUTROS ASSUNTOS',
  'RESOLVIDO',
]

// Typos/variantes → nome canônico (corrige exibição sem alterar o dado)
export const ALIASES: Record<string, string> = {
  'FALLOW UP': 'FOLLOW UP',
  'FALLOWUP': 'FOLLOW UP',
  'FOLLOWUP': 'FOLLOW UP',
  'COMPROU DO COMCORRENTE': 'COMPROU DO CONCORRENTE',
  'PROSPECCOES': 'PROSPECCAO',
  'NOVOS LEADS': 'NOVO LEAD',
  'LEAD NOVO': 'NOVO LEAD',
  'VENDIDOS': 'VENDIDO',
  'RESOLVIDOS': 'RESOLVIDO',
  'QUENTE': 'LEAD QUENTE',
  // Estes dois existiam só na função SQL `wa_etiqueta_canonica` — o front não
  // os conhecia, então a mesma etiqueta virava duas coisas diferentes conforme
  // quem estivesse lendo. Achado em 06/08/2026 ao espelhar a regra de status.
  'COMPROU NA CONCORRENCIA': 'COMPROU DO CONCORRENTE',
  '2O TENTATIVA': '2A TENTATIVA',
}

// Etiquetas internas/de organização que não são funil de cliente
export const ETIQUETAS_OCULTAS = new Set([
  'NAO LIDAS', 'FAVORITOS', 'GRUPOS', 'BRANORTE',
  'TRANSPORTADORAS', 'FUNCIONARIO', 'FUNCIONARIOS', 'PESSOAL',
])

/**
 * HUE DE IDENTIDADE de cada etiqueta.
 *
 * Um hex só faz DOIS trabalhos incompatíveis neste app: é preenchimento sólido
 * (dot do /funil, faixa do topo da coluna, barra do Recharts em
 * /painel-etiquetas) E é COR DE TEXTO (badge da /contatos via `estiloEtiqueta`,
 * chip do drawer do /funil, cabeçalho da matriz do /painel-etiquetas). A paleta
 * antiga era calibrada só pro primeiro caso: 18 de 18 falhavam AA como texto no
 * tema claro, e 12 falhavam até o AA-large de 3:1 — 'INTERESSE FUTURO' (#facc15)
 * ficava em 1,45:1 e 'RESOLVIDO' (#84cc16) em 1,82:1, ilegíveis.
 *
 * Valores de 2026-08: mesmo matiz, um passo mais escuro. 24/24 passam AA
 * (>= 4,5:1) sobre branco e >= 3:1 como dot sobre o fundo pastel da família.
 * Efeito colateral declarado: os dots e a faixa do /funil e as barras do
 * /painel-etiquetas ficam ~1 passo mais escuros — ganham definição sobre branco.
 */
export const ETIQUETA_COR: Record<string, string> = {
  // FUNIL DE VENDAS
  'PROSPECCAO': '#1d4ed8',
  '2A TENTATIVA': '#0d6982',
  'NOVO LEAD': '#6d28d9',
  'FOLLOW UP': '#9e4908',
  'LEAD QUENTE': '#b9175b',
  'ORCAMENTO ENVIADO': '#03669c',
  'INTERESSE FUTURO': '#8b5506',
  'AGENDAMENTO': '#4338ca',
  'VENDIDO': '#046e50',
  // MOTIVO DE FECHAMENTO
  'RESOLVIDO': '#436c0d',
  'NAO RESPONDEU MAIS': '#67615c',
  'NUNCA RESPONDEU': '#57534e',
  'NAO TEM INTERESSE': '#9f1239',
  'COMPROU DO CONCORRENTE': '#b91c1c',
  'SO BASE DE PRECO': '#ac3a0b',
  'FORA DO ORCAMENTO': '#bc123b',
  'NAO FABRICAMOS': '#a21caf',
  // AVULSAS (existem no banco e não tinham cor — caíam no cinza de fallback)
  'OUTROS ASSUNTOS': '#52525b',
  'SUPORTE TECNICO': '#3f6212',
  'FEIRA': '#742eec',
  'PENDENTE': '#8b5506',
  'PENDENCIA': '#b91c1c',
  'IMPORTANTE': '#ac3a0b',
  'IMPORTANTES': '#ac3a0b',
  // Coluna sintetica do /funil (nao existe no WhatsApp). Estava com '#f59e0b'
  // cravado no FunilWhatsApp e virou a unica cor fora da paleta calibrada:
  // 1,78:1 contra o fundo da coluna, enquanto as vizinhas ficaram em ~5,1.
  'SEM ETIQUETA': '#8b5506',
}

/**
 * Paleta dos GRÁFICOS (Recharts) — proposital e necessariamente diferente da de
 * cima.
 *
 * Estas eram as cores de `ETIQUETA_COR` até 2026-08, quando ela foi escurecida
 * pra passar AA como TEXTO sobre fundo claro. Os gráficos não podem usar a nova:
 * o canvas do Recharts é ESCURO por construção e independente do tema do app
 * (`background: '#11151c'`, ticks `#e7e9ee` — era assim em PainelEtiquetas.tsx,
 * removida em 2026-08-17), e
 * as 18 cores calibradas pro claro caem abaixo de 3:1 ali. Barra escura sobre
 * fundo escuro não é gráfico.
 *
 * Está AQUI, e não copiada dentro de cada página, porque até 2026-08 as três
 * cópias (esta, PainelEtiquetas e EtiquetasZapGraficos) eram byte-idênticas e
 * ninguém sabia que eram três. Duas paletas com PAPEL declarado é design; três
 * cópias mudas é armadilha.
 *
 * ⚠️ Desde 2026-08-17 esta paleta NÃO tem consumidor: as duas telas de gráfico
 * de etiqueta foram removidas. Mantida de propósito — é a calibragem AA pro
 * canvas escuro do Recharts, cara de refazer. Próximo gráfico de etiqueta usa
 * ela em vez de inventar a quarta cópia.
 *
 * REGRA: `fill`/`stroke` de gráfico usa esta. Texto, selo, dot e borda de UI
 * usam `ETIQUETA_COR` via `estiloEtiqueta()` + `.etq-soft`/`.etq-dot`.
 */
export const ETIQUETA_COR_GRAFICO: Record<string, string> = {
  'PROSPECCAO': '#3b82f6',
  '2A TENTATIVA': '#06b6d4',
  'NOVO LEAD': '#8b5cf6',
  'FOLLOW UP': '#f59e0b',
  'INTERESSE FUTURO': '#facc15',
  'VENDIDO': '#10b981',
  'LEAD QUENTE': '#ec4899',
  'ORCAMENTO ENVIADO': '#22d3ee',
  'RESOLVIDO': '#84cc16',
  'NAO RESPONDEU MAIS': '#94a3b8',
  'NUNCA RESPONDEU': '#64748b',
  'NAO TEM INTERESSE': '#a78bfa',
  'COMPROU DO CONCORRENTE': '#ef4444',
  'SO BASE DE PRECO': '#f97316',
  'FORA DO ORCAMENTO': '#fb7185',
  'NAO FABRICAMOS': '#0ea5e9',
  'OUTROS ASSUNTOS': '#71717a',
  'PENDENCIA': '#dc2626',
}

export const corDeGrafico = (nomeCanonico: string): string =>
  ETIQUETA_COR_GRAFICO[nomeCanonico] ?? '#9ca3af'

export const canonico = (nomeNormalizado: string): string =>
  ALIASES[nomeNormalizado.trim()] ?? nomeNormalizado.trim()

export const ordemDe = (nomeCanonico: string): number => {
  const idx = ORDEM_FUNIL.indexOf(nomeCanonico)
  return idx === -1 ? 900 : idx
}

// Fallback antigo era #9ca3af (2,31:1 sobre branco — ilegível como texto).
export const corDaEtiqueta = (nomeCanonico: string): string =>
  ETIQUETA_COR[nomeCanonico] ?? '#52525b'

// ---------------------------------------------------------------------------
// FAMÍLIAS DE ETIQUETA — a calma da barra de chips da /contatos
// ---------------------------------------------------------------------------

/**
 * ~27 etiquetas reais, cada uma com um hex saturado próprio, viravam um
 * arco-íris de 25 chips no topo da lista. A família agrupa por SIGNIFICADO e dá
 * ao chip um fundo pastel; a identidade individual continua existindo, mas no
 * dot (ETIQUETA_COR), que é 6px em vez de um bloco inteiro.
 *
 * O pastel é CALMA, não identidade: entre os fundos o ΔE fica em 6,7–9,3
 * (indistinguível sozinho). Quem carrega a família é o TEXTO + a BORDA
 * (ΔE 23–88). Por isso o texto é escuro e saturado, não cinza.
 */
export type FamiliaEtiqueta = 'positivo' | 'andamento' | 'sem-retorno' | 'perdido' | 'neutro'

export const ETIQUETA_FAMILIA: Record<string, FamiliaEtiqueta> = {
  'VENDIDO': 'positivo',
  'RESOLVIDO': 'positivo',

  'PROSPECCAO': 'andamento',
  '2A TENTATIVA': 'andamento',
  'NOVO LEAD': 'andamento',
  'FOLLOW UP': 'andamento',
  'LEAD QUENTE': 'andamento',
  'ORCAMENTO ENVIADO': 'andamento',
  'INTERESSE FUTURO': 'andamento',
  'AGENDAMENTO': 'andamento',

  'NAO RESPONDEU MAIS': 'sem-retorno',
  'NUNCA RESPONDEU': 'sem-retorno',

  'NAO TEM INTERESSE': 'perdido',
  'COMPROU DO CONCORRENTE': 'perdido',
  'SO BASE DE PRECO': 'perdido',
  'FORA DO ORCAMENTO': 'perdido',
  'NAO FABRICAMOS': 'perdido',

  'OUTROS ASSUNTOS': 'neutro',
  'SUPORTE TECNICO': 'neutro',
  'FEIRA': 'neutro',
  'PENDENTE': 'neutro',
  'PENDENCIA': 'neutro',
  'IMPORTANTE': 'neutro',
  'IMPORTANTES': 'neutro',
}

/** Etiqueta desconhecida (ad-hoc de vendedor, etiqueta do CRM) cai em neutro. */
export const familiaDe = (nomeCanonico: string): FamiliaEtiqueta =>
  ETIQUETA_FAMILIA[nomeCanonico] ?? 'neutro'

/**
 * Classes do chip por família. Contraste medido no claro (texto/fundo):
 * positivo 5,82 · andamento 6,93 · sem-retorno 5,91 · perdido 6,94 · neutro 8,37.
 * No hover nenhuma cai abaixo de 5,34. No estado SELECIONADO o fundo vira o
 * próprio tom escuro do texto com letra branca: 6,56–9,53 — e o selecionado
 * deixa de ser sempre o verde da marca (que colidia com a família 'positivo' e
 * apagava qual família você tinha filtrado).
 */
export const FAMILIA_CHIP: Record<FamiliaEtiqueta, { normal: string; solido: string }> = {
  positivo: {
    normal: 'bg-[#e6f5ec] text-[#0b6b45] border-[#9dd5b9] hover:bg-[#d5eede] hover:border-[#0b6b45]/35 dark:bg-[#102c20] dark:text-[#84dcaf] dark:border-[#1f5038] dark:hover:bg-[#173d2c]',
    solido: 'bg-[#0b6b45] text-white border-[#0b6b45] dark:bg-[#84dcaf] dark:text-[#0d0d0f] dark:border-[#84dcaf]',
  },
  andamento: {
    normal: 'bg-[#e8f0fd] text-[#1a4f9c] border-[#a6c6f2] hover:bg-[#d6e5fb] hover:border-[#1a4f9c]/35 dark:bg-[#132135] dark:text-[#93bdf5] dark:border-[#254063] dark:hover:bg-[#1a2e49]',
    solido: 'bg-[#1a4f9c] text-white border-[#1a4f9c] dark:bg-[#93bdf5] dark:text-[#0d0d0f] dark:border-[#93bdf5]',
  },
  'sem-retorno': {
    normal: 'bg-[#f8eee0] text-[#7a5327] border-[#e3cba6] hover:bg-[#f2e3cd] hover:border-[#7a5327]/35 dark:bg-[#272016] dark:text-[#dcc19a] dark:border-[#453824] dark:hover:bg-[#342c1f]',
    solido: 'bg-[#7a5327] text-white border-[#7a5327] dark:bg-[#dcc19a] dark:text-[#0d0d0f] dark:border-[#dcc19a]',
  },
  perdido: {
    normal: 'bg-[#fdeaee] text-[#9b1c39] border-[#f1b2c0] hover:bg-[#fbdae1] hover:border-[#9b1c39]/35 dark:bg-[#2e1621] dark:text-[#f2a3b7] dark:border-[#52273a] dark:hover:bg-[#3e1e2d]',
    solido: 'bg-[#9b1c39] text-white border-[#9b1c39] dark:bg-[#f2a3b7] dark:text-[#0d0d0f] dark:border-[#f2a3b7]',
  },
  neutro: {
    normal: 'bg-[#f0f0f1] text-[#45454a] border-[#cbcbcf] hover:bg-[#e5e5e7] hover:border-[#45454a]/35 dark:bg-[#212124] dark:text-[#b4b4bb] dark:border-[#3a3a40] dark:hover:bg-[#2b2b2f]',
    solido: 'bg-[#45454a] text-white border-[#45454a] dark:bg-[#b4b4bb] dark:text-[#0d0d0f] dark:border-[#b4b4bb]',
  },
}

// Temperatura do chat pela última mensagem (igual ao painel do WhatsApp/Wascript)
export type Temperatura = 'fresco' | 'recente' | 'morno' | 'parado' | 'sem-dado'

export function temperaturaDe(iso: string | null): Temperatura {
  if (!iso) return 'sem-dado'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'sem-dado'
  const dias = (Date.now() - t) / 86_400_000
  if (dias < 1) return 'fresco'
  if (dias < 3) return 'recente'
  if (dias < 7) return 'morno'
  return 'parado'
}

export const TEMP_META: Record<Temperatura, { cor: string; label: string }> = {
  fresco: { cor: '#22c55e', label: 'Hoje' },
  recente: { cor: '#3b82f6', label: 'Recente (1-3 dias)' },
  morno: { cor: '#eab308', label: 'Morno (3-7 dias)' },
  parado: { cor: '#ef4444', label: 'Parado (+7 dias)' },
  'sem-dado': { cor: '#6b7280', label: 'Sem data' },
}

// Detecta se a última mensagem do cliente é um ENCERRAMENTO/cordialidade
// (ok, obrigado, tchau, "vou analisar"...) — nesses casos a bola está com
// o cliente e não há resposta pendente, então sai da fila de resposta.
const ENCERRAMENTO_EXATO = new Set([
  'ok', 'okay', 'okk', 'okkk', 'blz', 'beleza', 'certo', 'perfeito', 'otimo', 'otima',
  'show', 'joia', 'bacana', 'isso', 'isso mesmo', 'sim', 'combinado', 'fechado', 'entendi',
  'ata', 'ah ta', 'ahta', 'uhum', 'aham', 'massa', 'top', 'show de bola', 'bom demais',
  'obrigado', 'obrigada', 'obg', 'obgd', 'ob', 'vlw', 'valeu', 'valew', 'grato', 'grata', 'gratidao',
  'de nada', 'denada', 'gracias', 'no gracias', 'muchas gracias',
  'entendi ok', 'ok entendi', 'entendi obrigado', 'entendido', 'show obrigado',
  'tchau', 'falou', 'flw', 'abraco', 'abracos', 'forte abraco', 'abs',
  'ate mais', 'ate logo', 'ate breve', 'ate', 'de boa', 'tranquilo', 'suave',
])

export function ehEncerramento(preview: string | null): boolean {
  if (!preview) return false
  const t = preview
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ') // remove emoji/pontuação
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return true // era só emoji/pontuação (👍🙏) → encerramento
  if (ENCERRAMENTO_EXATO.has(t)) return true
  // despedida/agradecimento em qualquer posição (prefixo — pega obrigado/obrigada/abraço…)
  if (/\b(tchau|obrigad|agradec|valeu|vlw|abrac|falou|flw|ate mais|ate logo|ate breve|grat[oa])/.test(t)) return true
  if (/\bob(g|rigad)?\s+(pela|pelo)\s+aten/.test(t)) return true // "ob/obg pela atencao"
  // bola com o cliente — não precisa cobrar resposta
  if (/\b(vou (analisar|pensar|ver|verificar|avaliar|conversar|retornar)|estou analisando|qualquer coisa (eu |te )?(chamo|falo|aviso|retorno)|depois (eu )?(falo|vejo|retorno|aviso)|nao (precisa|seria necessario)|sem necessidade)\b/.test(t)) return true
  return false
}

export interface ChatLite {
  last_message_at: string | null
  last_message_from_me: boolean | null
  last_message_preview?: string | null
}

/** Cliente mandou por último E não foi um encerramento → precisa de resposta */
export function precisaResposta(chat: ChatLite): boolean {
  return chat.last_message_from_me === false && !ehEncerramento(chat.last_message_preview ?? null)
}

export interface ResumoColuna {
  fresco: number
  recente: number
  morno: number
  parado: number
  semDado: number
  aguardando: number // precisa de resposta (exclui encerramentos)
}

export function resumoColuna(chats: ChatLite[]): ResumoColuna {
  const r: ResumoColuna = { fresco: 0, recente: 0, morno: 0, parado: 0, semDado: 0, aguardando: 0 }
  for (const c of chats) {
    const temp = temperaturaDe(c.last_message_at)
    if (temp === 'fresco') r.fresco++
    else if (temp === 'recente') r.recente++
    else if (temp === 'morno') r.morno++
    else if (temp === 'parado') r.parado++
    else r.semDado++
    if (precisaResposta(c)) r.aguardando++
  }
  return r
}

/** +5566998144699 → +55 (66) 99814-4699 (degrada com elegância) */
export function formatarTelefone(phone: string): string {
  const d = (phone || '').replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 13 || d.length === 12)) {
    const ddd = d.slice(2, 4)
    const num = d.slice(4)
    const meio = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`
    return `+55 (${ddd}) ${meio}`
  }
  return phone
}

const SEM_NOME = /^(\(sem nome\)|desconhecido|sem nome|null|undefined)$/i

/** Nome do contato tratado; se vazio/placeholder, devolve o telefone formatado */
export function nomeContato(contactName: string | null, phone: string): string {
  const n = (contactName || '').trim()
  if (!n || SEM_NOME.test(n)) return formatarTelefone(phone)
  return n
}

export type Ordenacao = 'aguardando' | 'recente' | 'parado'

export const ORDENACAO_LABEL: Record<Ordenacao, string> = {
  aguardando: 'Aguardando primeiro',
  recente: 'Mais recente',
  parado: 'Mais parado',
}

/** Ordena chats conforme o modo escolhido (não muta o array original) */
export function ordenarChats<T extends ChatLite>(chats: T[], modo: Ordenacao): T[] {
  const ts = (c: ChatLite) => (c.last_message_at ? new Date(c.last_message_at).getTime() : 0)
  const arr = [...chats]
  if (modo === 'recente') {
    arr.sort((a, b) => ts(b) - ts(a))
  } else if (modo === 'parado') {
    arr.sort((a, b) => (ts(a) || Infinity) - (ts(b) || Infinity)) // mais antigo primeiro
  } else {
    // aguardando: quem precisa de resposta primeiro (mais antigo no topo)
    arr.sort((a, b) => {
      const aw = precisaResposta(a) ? 0 : 1
      const bw = precisaResposta(b) ? 0 : 1
      if (aw !== bw) return aw - bw
      if (aw === 0) return ts(a) - ts(b) // ambos pendentes → mais antigo primeiro (mais urgente)
      return ts(b) - ts(a) // resto → mais recente primeiro
    })
  }
  return arr
}

// ---------------------------------------------------------------------------
// Conversa do drawer (histórico persistido em wa_chat_messages)
// ---------------------------------------------------------------------------

/** Só o que a montagem da conversa precisa — evita acoplar este módulo ao hook. */
export interface MensagemLite {
  msg_id: string
  data_msg: string | null
  media_url?: string | null
}

/**
 * Identidade canônica de uma mensagem do WhatsApp.
 *
 * A extensão grava o mesmo id em duas formas, dependendo de por onde leu a
 * mensagem: o hash curto (`3EB0201F4BF2...`) e o serializado
 * (`true_5547999@lid_3EB0201F4BF2...`). São a MESMA mensagem, mas strings
 * diferentes — e como o UNIQUE do banco é sobre msg_id cru, viram duas linhas
 * e a bolha aparece duplicada no drawer. O hash final é o que as duas formas
 * têm em comum, então é ele que identifica a mensagem.
 */
export const idCanonicoMsg = (msgId: string): string => {
  const s = String(msgId || '')
  const i = s.lastIndexOf('_')
  return i === -1 ? s : s.slice(i + 1)
}

// Miniatura base64 que o WhatsApp Web põe em `body` de mídia sem legenda.
// Sem legenda, esse blob virava um paredão de texto dentro da bolha.
const SO_BASE64 = /^[A-Za-z0-9+/]{120,}={0,2}$/

/**
 * Texto realmente exibível de uma mensagem. Devolve null quando o corpo é só
 * o thumbnail base64 (mídia sem legenda) — aí a bolha mostra o rótulo do tipo
 * / o player / a foto, em vez do blob.
 */
export function corpoVisivel(body: string | null | undefined): string | null {
  const t = (body || '').trim()
  if (!t) return null
  if (SO_BASE64.test(t)) return null
  return t
}

export interface ConversaMontada<T extends MensagemLite> {
  mensagens: T[]
  /** Existe histórico mais antigo além da janela carregada. */
  temMais: boolean
}

/**
 * Monta a janela de conversa a partir das linhas cruas do banco.
 *
 * Recebe as linhas em ordem DECRESCENTE por data_msg (mais recente primeiro),
 * como devolve a query, e no máximo `limite + 1` linhas — a linha extra é só a
 * sonda que indica se ainda há histórico anterior.
 *
 * Garante: dedup por msg_id, janela = as `limite` MAIS RECENTES, e saída em
 * ordem cronológica ASC com mensagens sem data no fim (senão flutuariam pro topo).
 */
export function montarConversa<T extends MensagemLite>(linhas: T[], limite: number): ConversaMontada<T> {
  // Dedup pela identidade CANÔNICA (hash), não pela string crua: a mesma
  // mensagem existe no banco nas duas formas de msg_id e renderizaria em dobro.
  // Entre duplicatas, fica a que tem mídia — perder o áudio/foto seria pior.
  const porId = new Map<string, T>()
  for (const l of linhas) {
    if (!l) continue
    const id = idCanonicoMsg(l.msg_id)
    const atual = porId.get(id)
    if (!atual) { porId.set(id, l); continue }
    const temMidia = (m: T) => !!m.media_url && m.media_url !== 'unavailable'
    if (!temMidia(atual) && temMidia(l)) porId.set(id, l)
  }
  // temMais vem da contagem CRUA (o banco devolveu mais linhas que a janela).
  // Usar a contagem já deduplicada esconderia histórico real quando o excedente
  // fosse duplicata; assim, no pior caso oferecemos um "carregar" a mais — nunca
  // deixamos de oferecer quando existe mensagem antiga pra mostrar.
  const temMais = linhas.length > limite
  const unicas = [...porId.values()]
  // vieram DESC → cortar o excedente pelo FIM descarta as mais antigas
  const janela = unicas.slice(0, limite)
  // ordem cronológica ASC, com desempate estável pelo id canônico: sem isso,
  // mensagens do MESMO segundo trocam de lugar a cada refetch de 30s.
  const mensagens = janela.slice().sort((a, b) => {
    if (!a.data_msg && !b.data_msg) return idCanonicoMsg(a.msg_id).localeCompare(idCanonicoMsg(b.msg_id))
    if (!a.data_msg) return 1
    if (!b.data_msg) return -1
    const d = new Date(a.data_msg).getTime() - new Date(b.data_msg).getTime()
    return d !== 0 ? d : idCanonicoMsg(a.msg_id).localeCompare(idCanonicoMsg(b.msg_id))
  })
  return { mensagens, temMais }
}

/** "há 5 min", "há 3 h", "ontem", "10/06" */
export function tempoRelativo(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMin = Math.floor((Date.now() - t) / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'ontem'
  if (diffD < 7) return `há ${diffD} dias`
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Status do contato (ABERTO/FECHADO) derivado da etiqueta do WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Etiqueta → status do contato, na regra que o Daniel ditou em 06/08/2026:
 * prospecção e negociação = ABERTO; motivo de encerramento = FECHADO.
 *
 * É a mesma divisão que ORDEM_FUNIL já anotava em comentário ("FUNIL DE VENDAS"
 * vs "MOTIVO DE FECHAMENTO") — aqui ela vira valor.
 *
 * Ausente do mapa = **não decide**. São as avulsas e internas (IMPORTANTES,
 * PENDENTE, FEIRA, SUPORTE TECNICO, AGENDAMENTO, BRANORTE, TRANSPORTADORAS):
 * não dizem nada sobre o negócio estar aberto, então o vendedor marca na mão.
 *
 * ⚠️ ESPELHO da função SQL `wa_status_da_etiqueta(text)`. Quem manda de verdade
 * é o banco (job `recompute-contact-status-5min`); isto aqui existe só pra tela
 * saber EXPLICAR o valor. Mudou um, muda o outro — senão a tela diz uma coisa e
 * o job grava outra.
 */
export const STATUS_POR_ETIQUETA: Record<string, 'ABERTO' | 'FECHADO'> = {
  // prospecção e negociação: ainda dá pra vender
  'PROSPECCAO': 'ABERTO',
  '2A TENTATIVA': 'ABERTO',
  '3A TENTATIVA': 'ABERTO',
  '4A TENTATIVA': 'ABERTO',
  'NOVO LEAD': 'ABERTO',
  'FOLLOW UP': 'ABERTO',
  'LEAD QUENTE': 'ABERTO',
  'ORCAMENTO ENVIADO': 'ABERTO',
  // motivo de encerramento: a conversa acabou (com ou sem venda)
  'INTERESSE FUTURO': 'FECHADO',
  'SO BASE DE PRECO': 'FECHADO',
  'NAO TEM INTERESSE': 'FECHADO',
  'NAO FABRICAMOS': 'FECHADO',
  'OUTROS ASSUNTOS': 'FECHADO',
  'FORA DO ORCAMENTO': 'FECHADO',
  'VENDIDO': 'FECHADO',
  'NAO RESPONDEU MAIS': 'FECHADO',
  'NUNCA RESPONDEU': 'FECHADO',
  'RESOLVIDO': 'FECHADO',
  'COMPROU DO CONCORRENTE': 'FECHADO',
}

/**
 * `null` = essa etiqueta não decide nada sobre aberto/fechado.
 *
 * ⚠️ Normaliza com `upper` + `trim` ANTES de olhar os aliases, porque é isso que
 * o `wa_etiqueta_canonica` do banco faz (`case upper(btrim(p))`). O `canonico()`
 * daqui só apara espaço — quem chama ele já recebe o texto em caixa alta da RPC.
 * Não dá pra confiar nisso aqui: a própria tela lista "3a tentativa" e "4a
 * tentativa" em minúsculas. Sem o `upper`, o banco marcaria ABERTO e a tela
 * diria "não decide" — a divergência exata que este espelho existe pra evitar.
 */
export function statusDaEtiqueta(nome: string | null | undefined): 'ABERTO' | 'FECHADO' | null {
  return STATUS_POR_ETIQUETA[nomeParaStatus(nome)] ?? null
}

const semAcento = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Nome da etiqueta como o mapa de status enxerga: sem acento, caixa alta, sem
 * espaco nas pontas, aliases aplicados. ESPELHO de
 * `wa_etiqueta_canonica(sem_acento(...))` no banco.
 *
 * O acento entrou em 01/09/2026 junto com as etiquetas do CRM: as do WhatsApp
 * ja chegam sem acento, mas a do CRM e digitada pelo vendedor ("Não tem
 * interesse") e sem isto nao decidia nada.
 */
function nomeParaStatus(nome: string | null | undefined): string {
  const bruto = semAcento(nome ?? '').trim().toUpperCase()
  return ALIASES[bruto] ?? bruto
}

export interface EtiquetaBruta {
  etiqueta?: string | null
  vendedor?: string | null
  em?: string | null
  /** De onde veio. Ausente = WhatsApp (o caso de sempre). */
  origem?: 'wa' | 'crm'
}

/**
 * Junta as etiquetas do WhatsApp com as que o vendedor aplicou AQUI no CRM,
 * no formato que `statusDerivadoDaEtiqueta` entende.
 *
 * A do CRM entra como se fosse do DONO do contato (e o que o job
 * `recompute_contact_status` faz: `vendedor = vendors.name` do contato), com
 * `em` = quando foi aplicada. Assim ela disputa em pe de igualdade com a
 * etiqueta que o dono pos no WhatsApp: a mais recente das duas manda.
 */
export function comEtiquetasDoCrm(
  wa: EtiquetaBruta[] | null | undefined,
  crm: { nome: string; aplicada_em?: string | null }[] | null | undefined,
  vendedorDono: string | null,
): EtiquetaBruta[] {
  return [
    ...(wa ?? []),
    ...(crm ?? []).map(e => ({ etiqueta: e.nome, vendedor: vendedorDono, em: e.aplicada_em ?? '', origem: 'crm' as const })),
  ]
}

/**
 * Qual etiqueta decide o status deste contato.
 *
 * ⚠️ ESPELHO de `wa_status_do_contato(jsonb, text)` no banco — mesma ordem de
 * desempate, senão a tela explica com uma etiqueta e o job grava por outra.
 *
 * O mesmo telefone costuma estar etiquetado em até 10 WhatsApps, então: entre as
 * que DECIDEM, a do vendedor DONO do contato manda; empatando, a mais recente.
 * Sem nenhuma do dono, cai na mais recente de qualquer um.
 *
 * ⚠️ 3o desempate (01/09/2026): as etiquetas de UMA conversa chegam da extensao
 * todas com o MESMO `em` (label_changed_at e por chat, nao por etiqueta). Entao
 * "ORCAMENTO ENVIADO" + "NAO RESPONDEU MAIS" empatavam em tudo e o vencedor era
 * a ordem em que o JSON veio — a tela dizia uma coisa e o job gravava outra, e
 * o proprio job alternava a cada 5 min (215 telefones, medido). Em empate, o
 * motivo de ENCERRAMENTO vence: e a mesma regra do `is_closed`.
 */
export function statusDerivadoDaEtiqueta(
  etiquetas: EtiquetaBruta[] | null | undefined,
  vendedorDono: string | null,
): { status: 'ABERTO' | 'FECHADO'; etiqueta: string; vendedor: string | null; origem: 'wa' | 'crm' } | null {
  const dono = (vendedorDono ?? '').trim().toUpperCase()
  const decidem = (etiquetas ?? [])
    .map(e => ({
      // mesma normalização de statusDaEtiqueta, pra o rótulo mostrado bater
      // com a etiqueta que de fato decidiu
      nome: nomeParaStatus(e.etiqueta),
      vendedor: e.vendedor ?? null,
      em: e.em ?? '',
      origem: e.origem ?? 'wa',
      status: statusDaEtiqueta(e.etiqueta),
    }))
    .filter((e): e is typeof e & { status: 'ABERTO' | 'FECHADO' } => e.status !== null)
  if (decidem.length === 0) return null

  decidem.sort((a, b) => {
    const da = dono && (a.vendedor ?? '').trim().toUpperCase() === dono ? 1 : 0
    const db = dono && (b.vendedor ?? '').trim().toUpperCase() === dono ? 1 : 0
    if (da !== db) return db - da
    const porData = b.em.localeCompare(a.em)
    if (porData !== 0) return porData
    return Number(b.status === 'FECHADO') - Number(a.status === 'FECHADO')
  })
  const v = decidem[0]
  return { status: v.status, etiqueta: v.nome, vendedor: v.vendedor, origem: v.origem }
}
