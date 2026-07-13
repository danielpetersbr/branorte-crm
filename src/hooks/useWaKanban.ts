import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { canonico, ordemDe, corDaEtiqueta, ETIQUETAS_OCULTAS } from '@/lib/wa-funil'

// Kanban de etiquetas WhatsApp — espelho do que o vendedor vê no Wascript.
// Fontes (sincronizadas pela extensão Branorte WA Sync a cada 30s):
//   wascript_etiquetas → catálogo de etiquetas do vendedor (id por-vendedor!)
//   wa_chat_labels     → chats com label_ids[], nome, última mensagem

export interface WaChat {
  phone: string
  chat_id: string | null
  contact_name: string | null
  label_ids: string[] | null
  last_message_at: string | null
  last_message_from_me: boolean | null
  last_message_preview: string | null
  foto_url: string | null // foto de perfil do WhatsApp (via extensão → wa-sync-avatars)
  vendedor?: string // preenchido no modo "Todos"
}

export const TODOS = '__TODOS__'

export interface WaColuna {
  /** nome canônico (pós-alias) — chave da coluna */
  nome: string
  cor: string
  oculta: boolean
  chats: WaChat[]
}

export interface WaKanban {
  colunas: WaColuna[]
  semEtiqueta: WaChat[]
  totalChats: number
  ultimaSync: string | null
}

export function useWaVendedores() {
  return useQuery({
    queryKey: ['wa-vendedores'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wascript_etiquetas')
        .select('vendedor_nome')
      if (error) throw error
      // DANIEL é o dono — o WhatsApp dele não é quadro de vendas
      return [...new Set((data ?? []).map(r => r.vendedor_nome as string))]
        .filter(v => v !== 'DANIEL')
        .sort()
    },
  })
}

export function useWaKanban(vendedor: string | null) {
  const todos = vendedor === TODOS
  return useQuery<WaKanban>({
    queryKey: ['wa-kanban', vendedor],
    enabled: !!vendedor,
    refetchInterval: 30_000, // mesma cadência da extensão
    queryFn: async () => {
      let etiqQuery = supabase
        .from('wascript_etiquetas')
        .select('vendedor_nome, etiqueta_id_wascript, etiqueta_nome, etiqueta_nome_normalizado, synced_at')
      let chatsQuery = supabase
        .from('wa_chat_labels')
        .select('vendedor_nome, phone, chat_id, contact_name, label_ids, last_message_at, last_message_from_me, last_message_preview, foto_url, updated_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(todos ? 12000 : 4000)
      if (todos) {
        // consolidado da equipe — exclui o dono
        etiqQuery = etiqQuery.neq('vendedor_nome', 'DANIEL')
        chatsQuery = chatsQuery.neq('vendedor_nome', 'DANIEL')
      } else {
        etiqQuery = etiqQuery.eq('vendedor_nome', vendedor!)
        chatsQuery = chatsQuery.eq('vendedor_nome', vendedor!)
      }
      const [etiquetasRes, chatsRes] = await Promise.all([etiqQuery, chatsQuery])
      if (etiquetasRes.error) throw etiquetasRes.error
      if (chatsRes.error) throw chatsRes.error

      const etiquetas = etiquetasRes.data ?? []
      const chats = (chatsRes.data ?? []) as (WaChat & { updated_at?: string; vendedor_nome?: string })[]
      // expõe o vendedor de cada chat (badge no modo Todos)
      for (const c of chats) c.vendedor = c.vendedor_nome

      // id Wascript é POR vendedor → chave composta vendedor::id
      const idParaNome = new Map<string, string>()
      for (const e of etiquetas) {
        idParaNome.set(`${e.vendedor_nome}::${e.etiqueta_id_wascript}`, canonico(e.etiqueta_nome_normalizado))
      }

      // colunas na ordem oficial do funil (typos colapsam na mesma coluna)
      const porNome = new Map<string, WaColuna>()
      for (const e of etiquetas) {
        const nome = canonico(e.etiqueta_nome_normalizado)
        if (!porNome.has(nome)) {
          porNome.set(nome, { nome, cor: corDaEtiqueta(nome), oculta: ETIQUETAS_OCULTAS.has(nome), chats: [] })
        }
      }

      const semEtiqueta: WaChat[] = []
      for (const c of chats) {
        const ids = c.label_ids ?? []
        if (ids.length === 0) {
          semEtiqueta.push(c)
          continue
        }
        const nomesDoChat = new Set<string>()
        for (const id of ids) {
          const nome = idParaNome.get(`${c.vendedor_nome}::${id}`)
          if (nome) nomesDoChat.add(nome)
        }
        if (nomesDoChat.size === 0) {
          semEtiqueta.push(c) // etiqueta órfã (id sem catálogo)
          continue
        }
        for (const nome of nomesDoChat) {
          porNome.get(nome)?.chats.push(c)
        }
      }

      const colunas = [...porNome.values()].sort((a, b) => ordemDe(a.nome) - ordemDe(b.nome) || a.nome.localeCompare(b.nome))

      const ultimaSync = etiquetas.reduce<string | null>(
        (max, e) => (e.synced_at && (!max || e.synced_at > max) ? e.synced_at : max), null
      )

      return { colunas, semEtiqueta, totalChats: chats.length, ultimaSync }
    },
  })
}

export interface WaMensagem {
  msg_id: string
  from_me: boolean | null
  tipo: string
  body: string | null
  duracao_seg: number | null
  media_url: string | null
  data_msg: string | null
}

/**
 * Últimas ~10 mensagens do chat (sincronizadas pela extensão v1.6.71+ só pra
 * chats em FOLLOW UP / LEAD QUENTE). Ordem cronológica (antiga → recente).
 */
export function useWaMensagens(vendedor: string | null, chatId: string | null, habilitado = true) {
  return useQuery<WaMensagem[]>({
    queryKey: ['wa-mensagens', vendedor, chatId],
    enabled: habilitado && !!vendedor && !!chatId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_chat_messages')
        .select('msg_id, from_me, tipo, body, duracao_seg, media_url, data_msg')
        .eq('vendedor_nome', vendedor!)
        .eq('chat_id', chatId!)
        .order('data_msg', { ascending: false, nullsFirst: false })
        .limit(10)
      if (error) throw error
      return (data ?? []).reverse()
    },
  })
}

export interface WaAgendada {
  id: string
  vendedor_nome: string
  chat_id: string | null
  contato_numero: string | null
  body: string | null
  scheduled_at: string
  media_type: string | null
}

/**
 * Mensagens agendadas PENDENTES (construtor da extensão) — pra badge ⏰ nos
 * cards e seção no drawer. Indexadas por vendedor::chat_id e por dígitos do
 * telefone (fallback quando o agendamento não gravou o chat_id igual).
 */
export function useWaAgendadas(vendedor: string | null) {
  const todos = vendedor === TODOS
  return useQuery({
    queryKey: ['wa-agendadas', vendedor],
    enabled: !!vendedor,
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('wa_scheduled_messages')
        .select('id, vendedor_nome, chat_id, contato_numero, body, scheduled_at, media_type')
        .eq('status', 'pending')
        .eq('to_self', false)
        .order('scheduled_at', { ascending: true })
        .limit(500)
      if (!todos) q = q.eq('vendedor_nome', vendedor!)
      const { data, error } = await q
      if (error) throw error
      const porChat = new Map<string, WaAgendada>()
      const porFone = new Map<string, WaAgendada>()
      for (const a of (data ?? []) as WaAgendada[]) {
        // primeira do map = mais próxima de disparar (query já vem ordenada)
        if (a.chat_id && !porChat.has(`${a.vendedor_nome}::${a.chat_id}`)) {
          porChat.set(`${a.vendedor_nome}::${a.chat_id}`, a)
        }
        const fone = String(a.contato_numero ?? '').replace(/\D/g, '')
        if (fone.length >= 10 && !porFone.has(`${a.vendedor_nome}::${fone}`)) {
          porFone.set(`${a.vendedor_nome}::${fone}`, a)
        }
      }
      return { porChat, porFone }
    },
  })
}

/** Agendada pendente de um chat específico (chat_id primeiro, telefone como fallback) */
export function lookupAgendada(
  mapas: { porChat: Map<string, WaAgendada>; porFone: Map<string, WaAgendada> } | undefined,
  vendedor: string | null | undefined,
  chatId: string | null,
  phone: string | null,
): WaAgendada | null {
  if (!mapas || !vendedor) return null
  if (chatId) {
    const hit = mapas.porChat.get(`${vendedor}::${chatId}`)
    if (hit) return hit
  }
  const fone = String(phone ?? '').replace(/\D/g, '')
  if (fone.length >= 10) return mapas.porFone.get(`${vendedor}::${fone}`) ?? null
  return null
}

export interface WaMovimento {
  etiqueta_de: string | null
  etiqueta_para: string | null
  detectado_em: string
}

/** Histórico de movimentação de etiquetas de um chat (timeline do drawer) */
export function useWaMovimentos(vendedor: string | null, phone: string | null) {
  return useQuery<WaMovimento[]>({
    queryKey: ['wa-movimentos', vendedor, phone],
    enabled: !!vendedor && !!phone,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_etiqueta_movimentos')
        .select('etiqueta_de, etiqueta_para, detectado_em')
        .eq('vendedor_nome', vendedor!)
        .eq('phone', phone!)
        .order('detectado_em', { ascending: false })
        .limit(15)
      if (error) throw error
      return data ?? []
    },
  })
}
