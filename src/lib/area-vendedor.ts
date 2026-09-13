import type { WaChat, WaKanban } from '../hooks/useWaKanban'
import type { SupervisaoAchado } from '../hooks/useSupervisaoVendedor'

export const ETAPAS_AREA = ['PROSPECCAO', '2A TENTATIVA', '3A TENTATIVA', 'NOVO LEAD', 'FOLLOW UP', 'LEAD QUENTE'] as const
export const REGRAS_ETAPA: Record<string, string> = {
  PROSPECCAO: 'Ainda não confirmou interesse em um produto que fabricamos.',
  '2A TENTATIVA': 'Não respondeu à primeira abordagem.',
  '3A TENTATIVA': 'Não respondeu à segunda tentativa.',
  'NOVO LEAD': 'Confirmou interesse em algo que a Branorte fabrica.',
  'FOLLOW UP': 'Negociação com orçamento realmente enviado ao cliente.',
  'LEAD QUENTE': 'Previsão de fechamento dentro de um mês.',
}

export interface AreaCliente {
  id: string
  chat: WaChat
  etapas: string[]
  achados: SupervisaoAchado[]
  ultimaAnalise: string | null
  analiseDesatualizada: boolean
  temIA: boolean
}

function instante(value: string | null | undefined): number {
  const n = value ? Date.parse(value) : NaN
  return Number.isFinite(n) ? n : 0
}

/** Leitura recente do servidor não comprova captura recente do WhatsApp. */
export function syncDesatualizada(sync: string | null, agora = Date.now()): boolean {
  const timestamp = instante(sync)
  return !timestamp || timestamp > agora + 60_000 || agora - timestamp > 5 * 60_000
}

export function montarAreaClientes(carteira: WaKanban | undefined, achados: SupervisaoAchado[] = []): AreaCliente[] {
  if (!carteira) return []
  const clientes = new Map<string, AreaCliente>()
  const incluir = (chat: WaChat, etapa: string) => {
    // Sem chat_id não associamos achados por nome ou telefone: evita falso match.
    const id = chat.chat_id || `telefone:${chat.phone}`
    let cliente = clientes.get(id)
    if (!cliente) {
      cliente = { id, chat, etapas: [], achados: [], ultimaAnalise: null, analiseDesatualizada: false, temIA: false }
      clientes.set(id, cliente)
    }
    if (!cliente.etapas.includes(etapa)) cliente.etapas.push(etapa)
    if (instante(chat.last_message_at) > instante(cliente.chat.last_message_at)) cliente.chat = chat
  }
  for (const coluna of carteira.colunas) {
    if (!coluna.oculta) for (const chat of coluna.chats) incluir(chat, coluna.nome)
  }
  for (const chat of carteira.semEtiqueta) incluir(chat, 'SEM ETIQUETA')
  const vistos = new Set<string>()
  for (const achado of achados) {
    if (vistos.has(achado.id)) continue
    vistos.add(achado.id)
    const cliente = clientes.get(achado.chat_id)
    if (!cliente) continue
    cliente.achados.push(achado)
    const data = achado.atualizado_em || achado.detectado_em
    if (instante(data) > instante(cliente.ultimaAnalise)) cliente.ultimaAnalise = data
    if (achado.camada === 'ia') cliente.temIA = true
  }
  for (const cliente of clientes.values()) {
    cliente.achados.sort((a, b) => b.score - a.score)
    // Análise sem data confiável ou anterior à última mensagem exige revisão.
    cliente.analiseDesatualizada = cliente.achados.length > 0 && (!instante(cliente.ultimaAnalise) || instante(cliente.chat.last_message_at) > instante(cliente.ultimaAnalise))
  }
  return [...clientes.values()].sort((a, b) => (b.achados[0]?.score ?? 0) - (a.achados[0]?.score ?? 0) || instante(b.chat.last_message_at) - instante(a.chat.last_message_at))
}
