/**
 * Espelho dos WhatsApps dos vendedores na tela /whatsapp (só o admin vê).
 *
 * A conta da Ana tem atendimento completo (crm_chat_*: responder, assumir,
 * finalizar). As dos vendedores são SÓ LEITURA: a lista vem de
 * `wa_chat_labels` e o histórico de `wa_chat_messages`, os dois gravados pela
 * extensão que roda no WhatsApp de cada um. Nada sai do WhatsApp do vendedor
 * por esta tela — regra do Daniel: depois do primeiro contato, quem fala com o
 * cliente ali é o próprio vendedor.
 */
import type { WaChat, WaColuna, WaKanban } from '../hooks/useWaKanban'
import { canonico, corDaEtiqueta, digitosDaBusca, ETIQUETAS_OCULTAS, ordemDe, precisaResposta } from './wa-funil'

export const CONTA_ANA = 'ANA'

/** Dono da empresa: o WhatsApp dele entra no fim da lista, depois da equipe. */
const CONTA_DONO = 'DANIEL'

export interface ContaWhatsApp {
  /** vendedor_nome nas tabelas do espelho (GUSTAVO, EDILSON JR…) */
  nome: string
  /** Últimos 4 dígitos do número conectado, quando conhecido. */
  final: string | null
}

/** "EDILSON JR" → "Edilson Jr" */
export function rotuloConta(nome: string): string {
  return nome.toLowerCase().replace(/(^|\s)\p{L}/gu, letra => letra.toUpperCase())
}

/** Últimos 4 dígitos de um número/wid ("554884357022@c.us" → "7022"). */
export function finalDoNumero(valor: string | null | undefined): string | null {
  const digitos = (valor ?? '').split('@')[0].replace(/\D/g, '')
  return digitos.length >= 8 ? digitos.slice(-4) : null
}

/**
 * Contas com espelho, na ordem do seletor: a equipe em ordem alfabética e o
 * WhatsApp do dono por último. A Ana fica de fora (ela é a conta padrão da tela).
 */
export function contasDoEspelho(nomes: string[], finais: Record<string, string | null> = {}): ContaWhatsApp[] {
  const unicos = [...new Set(nomes.map(n => n.trim()).filter(Boolean))].filter(n => n !== CONTA_ANA)
  unicos.sort((a, b) => Number(a === CONTA_DONO) - Number(b === CONTA_DONO) || a.localeCompare(b, 'pt-BR'))
  return unicos.map(nome => ({ nome, final: finais[nome] ?? null }))
}

export interface ConversaEspelho extends WaChat {
  /** Etiquetas do WhatsApp do vendedor, na ordem do funil. */
  etiquetas: string[]
  /** Cliente falou por último e não foi só "ok/obrigado". */
  aguardando: boolean
}

const ehGrupoOuStatus = (chatId: string | null) =>
  !!chatId && (chatId.endsWith('@g.us') || chatId === 'status@broadcast' || chatId.endsWith('@newsletter'))

/**
 * O quadro do funil repete o mesmo chat em cada coluna de etiqueta. Aqui ele
 * vira uma lista de conversas (uma linha por chat), mais recente primeiro,
 * sem grupos — igual à lista da Ana.
 */
export function achatarConversas(kanban: WaKanban | undefined): ConversaEspelho[] {
  if (!kanban) return []
  const etiquetasPorChat = new Map<WaChat, string[]>()
  for (const coluna of kanban.colunas) {
    for (const chat of coluna.chats) {
      const lista = etiquetasPorChat.get(chat)
      if (lista) { if (!lista.includes(coluna.nome)) lista.push(coluna.nome) }
      else etiquetasPorChat.set(chat, [coluna.nome])
    }
  }
  for (const chat of kanban.semEtiqueta) if (!etiquetasPorChat.has(chat)) etiquetasPorChat.set(chat, [])
  const vistos = new Set<string>()
  const conversas: ConversaEspelho[] = []
  for (const [chat, etiquetas] of etiquetasPorChat) {
    if (ehGrupoOuStatus(chat.chat_id)) continue
    const chave = chaveConversa(chat)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    conversas.push({ ...chat, etiquetas, aguardando: precisaResposta(chat) })
  }
  return conversas.sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
}

/** Identidade estável da conversa na lista (chat_id; telefone quando falta). */
export function chaveConversa(chat: Pick<WaChat, 'chat_id' | 'phone'>): string {
  return chat.chat_id || `fone:${chat.phone}`
}

export type FiltroEspelho = 'todas' | 'aguardando'

/** Busca por nome ou telefone (só dígitos casam com o número) + etiqueta + fila. */
export function filtrarConversas(
  conversas: ConversaEspelho[],
  { busca = '', etiqueta = '', filtro = 'todas' }: { busca?: string; etiqueta?: string; filtro?: FiltroEspelho },
): ConversaEspelho[] {
  const texto = busca.trim().toLocaleLowerCase('pt-BR')
  const digitos = digitosDaBusca(busca)
  return conversas.filter(c => {
    if (filtro === 'aguardando' && !c.aguardando) return false
    if (etiqueta === '__sem__' ? c.etiquetas.length > 0 : etiqueta && !c.etiquetas.includes(etiqueta)) return false
    if (!texto) return true
    if (digitos) return c.phone.replace(/\D/g, '').includes(digitos)
    return (c.contact_name ?? '').toLocaleLowerCase('pt-BR').includes(texto)
  })
}

const ACENTOS: Record<string, string> = {
  PROSPECCAO: 'PROSPECÇÃO',
  'ORCAMENTO ENVIADO': 'ORÇAMENTO ENVIADO',
  'NAO RESPONDEU MAIS': 'NÃO RESPONDEU MAIS',
  'NAO TEM INTERESSE': 'NÃO TEM INTERESSE',
  'NAO FABRICAMOS': 'NÃO FABRICAMOS',
  'SO BASE DE PRECO': 'SÓ BASE DE PREÇO',
  'FORA DO ORCAMENTO': 'FORA DO ORÇAMENTO',
  'SUPORTE TECNICO': 'SUPORTE TÉCNICO',
  PENDENCIA: 'PENDÊNCIA',
}

/** Nome canônico do funil (sem acento) → como o vendedor escreve no WhatsApp. */
export function nomeEtiqueta(canonico: string): string {
  const tentativa = canonico.match(/^([0-9])A TENTATIVA$/)
  return tentativa ? `${tentativa[1]}ª TENTATIVA` : ACENTOS[canonico] ?? canonico
}

/** Etiquetas presentes na lista, com contagem, pra montar o filtro. */
export function etiquetasDaLista(conversas: ConversaEspelho[]): { nome: string; total: number }[] {
  const contagem = new Map<string, number>()
  for (const c of conversas) for (const e of c.etiquetas) contagem.set(e, (contagem.get(e) ?? 0) + 1)
  return [...contagem]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => ordemDe(a.nome) - ordemDe(b.nome) || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * A lista (wa_chat_labels) sabe da última mensagem antes do histórico (wa_chat_messages):
 * as duas chegam por caminhos separados da extensão. Atrasado = a lista tem mensagem
 * mais nova que a última gravada, com folga de 1 ciclo de sincronização.
 */
export function historicoAtrasado(ultimaNaLista: string | null, ultimaNoHistorico: string | null, folgaMs = 90_000): boolean {
  if (!ultimaNaLista) return false
  const lista = Date.parse(ultimaNaLista)
  if (!Number.isFinite(lista)) return false
  const historico = ultimaNoHistorico ? Date.parse(ultimaNoHistorico) : NaN
  return !Number.isFinite(historico) || lista - historico > folgaMs
}

export interface LinhaEspelho extends WaChat {
  vendedor_nome: string
  updated_at?: string | null
}

/** id de etiqueta → nome canônico, por vendedor (o id do WhatsApp é POR conta). Igual ao useWaKanban. */
export function mapaEtiquetas(catalogo: { vendedor_nome: string; etiqueta_id_wascript: string | number; etiqueta_nome_normalizado: string }[]): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const e of catalogo) {
    const nome = canonico(e.etiqueta_nome_normalizado)
    if (nome !== 'SEM ETIQUETA') mapa.set(`${e.vendedor_nome}::${e.etiqueta_id_wascript}`, nome)
  }
  return mapa
}

/**
 * Encaixa no quadro já carregado só as conversas que mudaram (mensagem nova ou etiqueta
 * trocada), sem baixar a lista inteira de novo (~450 KB por vendedor). A conversa sai de
 * todas as colunas e volta nas etiquetas atuais — como o MESMO objeto em cada coluna,
 * que é o que `achatarConversas` usa pra juntar as etiquetas numa linha só.
 * Chave = telefone (único por vendedor em wa_chat_labels).
 */
export function aplicarDeltaKanban(kanban: WaKanban, linhas: LinhaEspelho[], idParaNome: Map<string, string>): WaKanban {
  if (!linhas.length) return kanban
  const conhecidos = new Set<string>()
  for (const c of kanban.semEtiqueta) conhecidos.add(c.phone)
  for (const col of kanban.colunas) for (const c of col.chats) conhecidos.add(c.phone)
  const mudou = new Set(linhas.map(l => l.phone))
  const fica = (c: WaChat) => !mudou.has(c.phone)
  const colunas: WaColuna[] = kanban.colunas.map(col => ({ ...col, chats: col.chats.filter(fica) }))
  const semEtiqueta = kanban.semEtiqueta.filter(fica)
  for (const linha of linhas) {
    const chat = { ...linha, vendedor: linha.vendedor_nome } as WaChat
    const nomes = new Set<string>()
    for (const id of linha.label_ids ?? []) {
      const nome = idParaNome.get(`${linha.vendedor_nome}::${id}`)
      if (nome) nomes.add(nome)
    }
    if (!nomes.size) { semEtiqueta.push(chat); continue }
    for (const nome of nomes) {
      let coluna = colunas.find(c => c.nome === nome)
      if (!coluna) {
        coluna = { nome, cor: corDaEtiqueta(nome), oculta: ETIQUETAS_OCULTAS.has(nome), chats: [] }
        colunas.push(coluna)
      }
      coluna.chats.push(chat)
    }
  }
  const recente = (a: WaChat, b: WaChat) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')
  for (const col of colunas) col.chats.sort(recente)
  semEtiqueta.sort(recente)
  colunas.sort((a, b) => ordemDe(a.nome) - ordemDe(b.nome) || a.nome.localeCompare(b.nome))
  const novos = linhas.filter(l => !conhecidos.has(l.phone)).length
  const ultimaSync = linhas.reduce<string | null>((max, l) => (l.updated_at && (!max || l.updated_at > max) ? l.updated_at : max), kanban.ultimaSync)
  return { colunas, semEtiqueta, totalChats: kanban.totalChats + novos, ultimaSync }
}

/**
 * Documento (PDF de orçamento etc.) das conversas do funil dos vendedores: bucket PRIVADO wa-documentos
 * (edge wa-sync-messages v20). Só o admin abre, por link assinado. Caminho = VENDEDOR/<id seguro>.<ext>.
 */
export const DOC_PRIVADO_PREFIXO = 'https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/authenticated/wa-documentos/'
export function caminhoDocPrivado(url: string | null | undefined): string | null {
  if (!url?.startsWith(DOC_PRIVADO_PREFIXO)) return null
  const caminho = url.slice(DOC_PRIVADO_PREFIXO.length)
  return /^[A-Z][A-Z ]{0,40}\/[A-Za-z0-9_-]{1,180}\.[a-z0-9]{2,5}$/.test(caminho) ? caminho : null
}
