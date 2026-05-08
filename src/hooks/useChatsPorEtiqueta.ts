import { useQuery } from '@tanstack/react-query'
import { supabase, supabaseAuditoria } from '@/lib/supabase'

export interface ChatRow {
  phone: string
  vendedor_nome: string
  label_ids: string[]
  last_message_at?: string | null
  last_message_from_me?: boolean | null
  last_message_preview?: string | null
}

export interface EtiquetaInfo {
  id: string         // etiqueta_id_wascript como string
  nome: string       // etiqueta_nome (original)
  nomeCanonico: string  // mapeado pra nome oficial via ALIASES
  vendedor: string
}

const ALIASES: Record<string, string> = {
  'FALLOW UP': 'FOLLOW UP',
  'FALLOWUP': 'FOLLOW UP',
  'FOLLOWUP': 'FOLLOW UP',
  'FOLLOW-UP': 'FOLLOW UP',
  'COMPROU DO COMCORRENTE': 'COMPROU DO CONCORRENTE',
  'PROSPECCOES': 'PROSPECCAO',
  'NOVOS LEADS': 'NOVO LEAD',
  'LEAD NOVO': 'NOVO LEAD',
  'VENDIDOS': 'VENDIDO',
  'RESOLVIDOS': 'RESOLVIDO',
}

// Etiquetas que NÃO fazem parte do funil — não devem aparecer no painel
const ETIQUETAS_HIDDEN = new Set([
  'BRANORTE',
  'TRANSPORTADORAS',
  'TRANSPORTADORA',
  'FAVORITOS',
  'GRUPOS',
  'NAO LIDAS',
  'NAO LIDA',
  'FUNCIONARIO',
  'FUNCIONARIOS',
  'PESSOAL',
])

function canonicalize(nomeNormalizado: string): string {
  return ALIASES[nomeNormalizado] ?? nomeNormalizado
}

export function isEtiquetaFunil(nomeCanonico: string): boolean {
  return !ETIQUETAS_HIDDEN.has(nomeCanonico)
}

// Variantes de phone pra match em atendimentos (com/sem 55)
function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return []
  const out = new Set<string>([digits])
  if (digits.startsWith('55') && digits.length >= 12) out.add(digits.slice(2))
  if (!digits.startsWith('55')) out.add('55' + digits)
  return [...out]
}

export type StatusTemporal = 'fresco' | 'recente' | 'parado' | 'sem-dado'

export function classificarStatusTemporal(lastMessageAt: string | null | undefined): StatusTemporal {
  if (!lastMessageAt) return 'sem-dado'
  const last = new Date(lastMessageAt).getTime()
  if (!Number.isFinite(last)) return 'sem-dado'
  const diffMs = Date.now() - last
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  if (diffDays < 1) return 'fresco'
  if (diffDays < 3) return 'recente'
  return 'parado'
}

export interface ChatComEtiqueta {
  phone: string
  vendedor: string
  etiquetas: EtiquetaInfo[]
  lastMessageAt: string | null
  lastMessageFromMe: boolean | null  // true = vendedor, false = cliente, null = sem dado
  status: StatusTemporal
}

export interface AggregacaoEtiqueta {
  nomeCanonico: string
  total: number
  fresco: number
  recente: number
  parado: number
  semDado: number
  aguardando: number  // cliente esperando resposta do vendedor
  porVendedor: Record<string, number>
}

export interface PainelEtiquetasData {
  chats: ChatComEtiqueta[]
  porEtiqueta: AggregacaoEtiqueta[]
  vendedores: string[]
  totaisGerais: {
    chats: number
    fresco: number
    recente: number
    parado: number
    semDado: number
    aguardando: number
  }
}

/**
 * Painel completo: chats reais (de wa_chat_labels), etiquetas resolvidas,
 * e status temporal via JOIN com atendimentos.last_message_at.
 */
export function usePainelEtiquetas() {
  return useQuery<PainelEtiquetasData>({
    queryKey: ['painel-etiquetas-temporal'],
    queryFn: async () => {
      // 1) Fetch wa_chat_labels (chats reais)
      const { data: chatRows, error: errChat } = await supabase
        .from('wa_chat_labels')
        .select('phone, vendedor_nome, label_ids, last_message_at, last_message_from_me, last_message_preview')
        .order('vendedor_nome')
      if (errChat) throw errChat
      const chats: ChatRow[] = (chatRows ?? []).map((r: any) => ({
        phone: String(r.phone),
        vendedor_nome: String(r.vendedor_nome || ''),
        label_ids: (r.label_ids || []).map((x: any) => String(x)),
        last_message_at: r.last_message_at || null,
        last_message_from_me: typeof r.last_message_from_me === 'boolean' ? r.last_message_from_me : null,
        last_message_preview: r.last_message_preview || null,
      }))

      // 2) Coleta IDs/vendedores únicos pra resolver via wascript_etiquetas
      const allIds = new Set<number>()
      const allVendors = new Set<string>()
      for (const c of chats) {
        for (const id of c.label_ids) {
          const n = parseInt(id, 10)
          if (Number.isFinite(n)) allIds.add(n)
        }
        if (c.vendedor_nome) allVendors.add(c.vendedor_nome)
      }

      const labelMap: Record<string, EtiquetaInfo> = {}
      if (allIds.size > 0 && allVendors.size > 0) {
        const { data: etRows } = await supabase
          .from('wascript_etiquetas')
          .select('etiqueta_id_wascript, etiqueta_nome, etiqueta_nome_normalizado, vendedor_nome')
          .in('etiqueta_id_wascript', [...allIds])
          .in('vendedor_nome', [...allVendors])
        for (const er of (etRows ?? [])) {
          const key = `${er.vendedor_nome}::${er.etiqueta_id_wascript}`
          labelMap[key] = {
            id: String(er.etiqueta_id_wascript),
            nome: String(er.etiqueta_nome || ''),
            nomeCanonico: canonicalize(String(er.etiqueta_nome_normalizado || '').toUpperCase().trim()),
            vendedor: String(er.vendedor_nome || ''),
          }
        }
      }

      // 3) Coleta phones pra fetch de last_message_at via atendimentos
      const allPhoneVariants = new Set<string>()
      for (const c of chats) {
        for (const v of phoneVariants(c.phone)) allPhoneVariants.add(v)
      }

      // Map phone canônico → last_message_at (mais recente entre variantes)
      const lastMsgMap = new Map<string, string>()
      if (allPhoneVariants.size > 0) {
        // Lê em chunks pra evitar URL gigante
        const phoneArr = [...allPhoneVariants]
        const CHUNK = 200
        for (let i = 0; i < phoneArr.length; i += CHUNK) {
          const slice = phoneArr.slice(i, i + CHUNK)
          const { data: atRows } = await supabaseAuditoria
            .from('atendimentos_por_cliente')
            .select('telefone_norm, last_message_at')
            .in('telefone_norm', slice)
          for (const a of (atRows ?? [])) {
            const ph = String(a.telefone_norm || '').replace(/\D/g, '')
            const last = a.last_message_at as string | null
            if (!ph || !last) continue
            const prev = lastMsgMap.get(ph)
            if (!prev || new Date(last).getTime() > new Date(prev).getTime()) {
              lastMsgMap.set(ph, last)
            }
          }
        }
      }

      // 4) Constrói lista enriquecida de chats
      const chatsEnriquecidos: ChatComEtiqueta[] = chats.map(c => {
        // Resolve etiquetas
        const ets: EtiquetaInfo[] = []
        for (const id of c.label_ids) {
          const key = `${c.vendedor_nome}::${id}`
          const info = labelMap[key]
          if (info) ets.push(info)
        }
        // Last message: prefere o que veio direto da extensão (mais fresco e tem fromMe)
        // Fallback pra atendimentos.last_message_at
        let last: string | null = c.last_message_at ?? null
        let fromMe: boolean | null = typeof c.last_message_from_me === 'boolean' ? c.last_message_from_me : null
        if (!last) {
          for (const v of phoneVariants(c.phone)) {
            const m = lastMsgMap.get(v)
            if (m && (!last || new Date(m).getTime() > new Date(last).getTime())) last = m
          }
        }
        return {
          phone: c.phone,
          vendedor: c.vendedor_nome,
          etiquetas: ets,
          lastMessageAt: last,
          lastMessageFromMe: fromMe,
          status: classificarStatusTemporal(last),
        }
      })

      // 5) Agregação por etiqueta canônica (filtrando lixo)
      const aggMap = new Map<string, AggregacaoEtiqueta>()
      const vendSet = new Set<string>()
      for (const chat of chatsEnriquecidos) {
        if (chat.vendedor) vendSet.add(chat.vendedor)
        const aguardando = chat.lastMessageFromMe === false  // cliente foi o último a falar
        // Cada chat conta uma vez por etiqueta canônica única (apenas etiquetas de funil)
        const canonsDoChat = new Set(
          chat.etiquetas
            .map(e => e.nomeCanonico)
            .filter(isEtiquetaFunil)
        )
        for (const canon of canonsDoChat) {
          if (!aggMap.has(canon)) {
            aggMap.set(canon, {
              nomeCanonico: canon,
              total: 0,
              fresco: 0,
              recente: 0,
              parado: 0,
              semDado: 0,
              aguardando: 0,
              porVendedor: {},
            })
          }
          const a = aggMap.get(canon)!
          a.total += 1
          if (chat.status === 'fresco') a.fresco += 1
          else if (chat.status === 'recente') a.recente += 1
          else if (chat.status === 'parado') a.parado += 1
          else a.semDado += 1
          if (aguardando) a.aguardando += 1
          a.porVendedor[chat.vendedor] = (a.porVendedor[chat.vendedor] || 0) + 1
        }
      }

      // 6) Totais gerais (chats únicos, não soma por etiqueta)
      const totaisGerais = chatsEnriquecidos.reduce((acc, c) => {
        acc.chats += 1
        if (c.status === 'fresco') acc.fresco += 1
        else if (c.status === 'recente') acc.recente += 1
        else if (c.status === 'parado') acc.parado += 1
        else acc.semDado += 1
        if (c.lastMessageFromMe === false) acc.aguardando += 1
        return acc
      }, { chats: 0, fresco: 0, recente: 0, parado: 0, semDado: 0, aguardando: 0 })

      return {
        chats: chatsEnriquecidos,
        porEtiqueta: [...aggMap.values()].sort((a, b) => b.total - a.total),
        vendedores: [...vendSet].sort(),
        totaisGerais,
      }
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
