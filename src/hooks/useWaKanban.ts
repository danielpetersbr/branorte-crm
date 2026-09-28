import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { canonico, ordemDe, corDaEtiqueta, ETIQUETAS_OCULTAS, montarConversa } from '@/lib/wa-funil'
import { foraDoRanking, NOMES_FORA_DO_RANKING } from '@/lib/vendedores-fora-do-ranking'
import { todasAsLinhas } from '@/lib/rpc-paginado'
import { useAuth } from './useAuth'

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
  const userId = useAuth().session?.user.id
  return useQuery({
    queryKey: ['wa-vendedores', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wascript_etiquetas')
        .select('vendedor_nome')
      if (error) throw error
      // O dono não é vendedor: o WhatsApp dele não é quadro de vendas.
      return [...new Set((data ?? []).map(r => r.vendedor_nome as string))]
        .filter(v => !foraDoRanking(v))
        .sort()
    },
  })
}

export function useWaKanban(vendedor: string | null) {
  const userId = useAuth().session?.user.id
  const todos = vendedor === TODOS
  return useQuery<WaKanban>({
    queryKey: ['wa-kanban', vendedor, userId],
    enabled: !!vendedor && !!userId,
    refetchInterval: 30_000, // mesma cadência da extensão
    queryFn: async ({ signal }) => {
      const fora = `(${NOMES_FORA_DO_RANKING.join(',')})`
      const [etiquetas, linhasChats] = await Promise.all([
        todasAsLinhas(async (de, ate) => {
          let q = supabase
            .from('wascript_etiquetas')
            .select('vendedor_nome, etiqueta_id_wascript, etiqueta_nome, etiqueta_nome_normalizado, synced_at', { count: 'exact' })
            .order('id')
            .range(de, ate)
            .abortSignal(signal)
          q = todos ? q.not('vendedor_nome', 'in', fora) : q.eq('vendedor_nome', vendedor!)
          const { data, error, count } = await q
          if (error) throw error
          return { linhas: data ?? [], total: count }
        }),
        todasAsLinhas(async (de, ate) => {
          // Paginar pela chave única evita que uma mensagem nova mude a posição
          // do chat entre páginas. O teto do PostgREST independe do .limit().
          let q = supabase
            .from('wa_chat_labels')
            .select('vendedor_nome, phone, chat_id, contact_name, label_ids, last_message_at, last_message_from_me, last_message_preview, foto_url, updated_at', { count: 'exact' })
            .order('vendedor_nome')
            .order('phone')
            .range(de, ate)
            .abortSignal(signal)
          q = todos ? q.not('vendedor_nome', 'in', fora) : q.eq('vendedor_nome', vendedor!)
          const { data, error, count } = await q
          if (error) throw error
          return { linhas: data ?? [], total: count }
        }),
      ])

      const chats = linhasChats as (WaChat & { updated_at?: string; vendedor_nome?: string })[]
      // A ordem de leitura é estável; a de exibição continua da mensagem mais recente.
      chats.sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
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

      const syncEtiquetas = etiquetas.reduce<string | null>(
        (max, e) => (e.synced_at && (!max || e.synced_at > max) ? e.synced_at : max), null
      )
      const ultimaSync = chats.reduce<string | null>(
        (max, c) => (c.updated_at && (!max || c.updated_at > max) ? c.updated_at : max), syncEtiquetas
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
  transcricao?: string | null
  transcricao_em?: string | null
  duracao_seg: number | null
  media_url: string | null
  data_msg: string | null
}

/** Quantas mensagens o drawer carrega de cara (cobre ~87% dos chats por inteiro). */
export const MSGS_PAGINA_INICIAL = 30
/** Quanto cada clique em "carregar anteriores" acrescenta. */
export const MSGS_PAGINA_INCREMENTO = 50

export interface WaConversa {
  mensagens: WaMensagem[]
  /** Há mensagens mais antigas no banco além das carregadas. */
  temMais: boolean
}

/**
 * Mensagens já persistidas do chat, em ordem cronológica (antiga → recente).
 *
 * Lê de wa_chat_messages, que é o HISTÓRICO GRAVADO — não depende do WhatsApp Web
 * do vendedor estar aberto agora. A leitura é agnóstica ao estágio do funil:
 * filtra só por vendedor+chat_id (o par que identifica a conversa; todo chat_id é
 * um jid @lid único por contato).
 *
 * Pagina para trás: busca `limite + 1` linhas pra saber se ainda há histórico mais
 * antigo sem precisar de um count. Antes isso era um `.limit(10)` fixo, que escondia
 * ~4,7 mil mensagens já gravadas (metade dos chats tem mais de 10).
 */
export function useWaMensagens(
  vendedor: string | null,
  chatId: string | null,
  habilitado = true,
  limite = MSGS_PAGINA_INICIAL,
) {
  const userId = useAuth().session?.user.id
  return useQuery<WaConversa>({
    queryKey: ['wa-mensagens', vendedor, chatId, limite, userId],
    enabled: habilitado && !!vendedor && !!chatId && !!userId,
    refetchInterval: 30_000,
    // mantém a página anterior visível durante o refetch/expansão (não pisca vazio)
    placeholderData: (prev, query) => query?.queryKey[1] === vendedor && query?.queryKey[2] === chatId && query?.queryKey[4] === userId ? prev : undefined,
    queryFn: async ({ signal }) => {
      // Busca só a janela pedida e mais uma sonda, mesmo quando ela ultrapassa
      // max_rows. Uma resposta truncada não significa fim do histórico.
      const data = await todasAsLinhas<WaMensagem>(async (de, ate) => {
        const { data, error, count } = await supabase
          .from('wa_chat_messages')
          .select('msg_id, from_me, tipo, body, duracao_seg, media_url, data_msg, transcricao, transcricao_em', { count: 'exact' })
          .eq('vendedor_nome', vendedor!)
          .eq('chat_id', chatId!)
          .order('data_msg', { ascending: false, nullsFirst: false })
          // desempate determinístico para mensagens do mesmo segundo
          .order('msg_id', { ascending: false })
          .range(de, Math.min(ate, limite))
          .abortSignal(signal)
        if (error) throw error
        return { linhas: data ?? [], total: count == null ? null : Math.min(count, limite + 1) }
      }, Math.min(5000, limite + 1))
      // dedup + janela + ordem cronológica ficam numa função pura (testável em wa-funil.ts)
      return montarConversa<WaMensagem>(data, limite)
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
  const userId = useAuth().session?.user.id
  const todos = vendedor === TODOS
  return useQuery({
    queryKey: ['wa-agendadas', vendedor, userId],
    enabled: !!vendedor && !!userId,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const data = await todasAsLinhas<WaAgendada>(async (de, ate) => {
        let q = supabase
          .from('wa_scheduled_messages')
          .select('id, vendedor_nome, chat_id, contato_numero, body, scheduled_at, media_type', { count: 'exact' })
          .eq('status', 'pending')
          .eq('to_self', false)
          .order('id')
          .range(de, ate)
          .abortSignal(signal)
        if (!todos) q = q.eq('vendedor_nome', vendedor!)
        const { data, error, count } = await q
        if (error) throw error
        return { linhas: data ?? [], total: count }
      })
      data.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))
      const porChat = new Map<string, WaAgendada>()
      const porFone = new Map<string, WaAgendada>()
      for (const a of data) {
        // primeira do map = mais próxima de disparar (lista já vem ordenada)
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
  const userId = useAuth().session?.user.id
  return useQuery<WaMovimento[]>({
    queryKey: ['wa-movimentos', vendedor, phone, userId],
    enabled: !!vendedor && !!phone && !!userId,
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
