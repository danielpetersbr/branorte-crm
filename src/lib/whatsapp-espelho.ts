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
import type { WaChat, WaKanban } from '../hooks/useWaKanban'
import { digitosDaBusca, ordemDe, precisaResposta } from './wa-funil'

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
