// Taxonomia compartilhada do funil de etiquetas WhatsApp (Wascript).
// Fonte única para ordem oficial, aliases de typo, cores e ocultas —
// usada pelo Kanban /funil e alinhada com EtiquetasZap/PainelEtiquetas.

// Ordem oficial do funil de vendas Branorte. Etiquetas fora da lista vão pro final.
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
}

// Etiquetas internas/de organização que não são funil de cliente
export const ETIQUETAS_OCULTAS = new Set([
  'NAO LIDAS', 'FAVORITOS', 'GRUPOS', 'BRANORTE',
  'TRANSPORTADORAS', 'FUNCIONARIO', 'FUNCIONARIOS', 'PESSOAL',
])

export const ETIQUETA_COR: Record<string, string> = {
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

export const canonico = (nomeNormalizado: string): string =>
  ALIASES[nomeNormalizado.trim()] ?? nomeNormalizado.trim()

export const ordemDe = (nomeCanonico: string): number => {
  const idx = ORDEM_FUNIL.indexOf(nomeCanonico)
  return idx === -1 ? 900 : idx
}

export const corDaEtiqueta = (nomeCanonico: string): string =>
  ETIQUETA_COR[nomeCanonico] ?? '#9ca3af'

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
