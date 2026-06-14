import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseAuditoria, supabase } from '@/lib/supabase'
import { ATENDIMENTO_PAGE_SIZE, type Atendimento, type StatusReal, type StatusVendedor } from '@/types/atendimento'
import { DDD_TO_UF } from '@/lib/ddd-uf'

/**
 * Pega primeiro nome do vendedor logado. NULL se admin (sem filtro)
 * ou se não-vendor. Usado pra filtrar atendimentos por
 * responsavel ILIKE 'Vendor%' já que RLS em auditoria schema é complexa.
 */
async function getCurrentVendorFirstName(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, vendor_id')
    .eq('id', sess.session.user.id)
    .maybeSingle()
  if (!profile || profile.role !== 'vendor' || !profile.vendor_id) return null
  const { data: vendor } = await supabase
    .from('vendors')
    .select('name')
    .eq('id', profile.vendor_id)
    .maybeSingle()
  if (!vendor?.name) return null
  return vendor.name.split(/\s+/)[0]  // só primeiro nome (ex: "GUSTAVO" → match "Gustavo Vicente")
}

export type DataPreset = '' | 'hoje' | 'ontem' | '7d' | '30d' | 'mes'

export interface AtendimentoFilters {
  search: string
  responsavel: string
  status_real: string
  uf: string
  data: DataPreset
  origem: string
  // #17: filtro por código de criativo (ex: M0023, F1234). Match exato em
  // contacts.criativo_codigo. Vazio = sem filtro.
  criativo: string
  // Filtro por etiqueta do WhatsApp (nome normalizado, ex: 'FOLLOW UP', 'VENDIDO').
  // Resolvido server-side via RPC atendimentos_telefones_por_etiqueta. Vazio = sem filtro.
  etiqueta: string
  page: number
}

function dateRangeFromPreset(preset: DataPreset): { from?: string; to?: string } {
  if (!preset) return {}
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  if (preset === 'hoje') {
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === 'ontem') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() }
  }
  if (preset === '7d') {
    const f = new Date(now); f.setDate(f.getDate() - 6)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === '30d') {
    const f = new Date(now); f.setDate(f.getDate() - 29)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === 'mes') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  return {}
}

// Normaliza telefone pra formato e164 sem +. Estratégia tolerante:
//   "+55 (33) 9946-6579" → "5533999466579"
//   "(33) 9946-6579"     → "33999466579"  (sem 55)
//   "5533999466579"      → "5533999466579"
// Retorna ARRAY de variações pra dar match mesmo se número estiver salvo
// sem o "55" no CRM mas com no WA (ou vice-versa).
function phoneVariants(p: string | null | undefined): string[] {
  if (!p) return []
  const d = String(p).replace(/[^\d]/g, '')
  if (!d) return []
  const variants = new Set<string>()
  variants.add(d)
  if (!d.startsWith('55') && d.length >= 10) variants.add('55' + d)
  if (d.startsWith('55') && d.length >= 12) variants.add(d.slice(2))
  // Variante com/sem 9º dígito de celular (BR mobile pode aparecer dos dois jeitos)
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') variants.add(d.slice(0, 4) + d.slice(5))
  if (d.startsWith('55') && d.length === 12) variants.add(d.slice(0, 4) + '9' + d.slice(4))
  if (!d.startsWith('55') && d.length === 11 && d[2] === '9') variants.add(d.slice(0, 2) + d.slice(3))
  if (!d.startsWith('55') && d.length === 10) variants.add(d.slice(0, 2) + '9' + d.slice(2))
  return [...variants]
}

export type WaLabelMap = Record<string, { id: string; name: string; color?: string | null; vendedor: string }[]>

export function useWaLabelsByPhones(phones: (string | null | undefined)[], enabled = true) {
  // Coleta variações de todos os phones únicos
  const allPhones = [...new Set(phones.flatMap(phoneVariants))].filter(p => p && p.length >= 10)
  return useQuery({
    queryKey: ['wa-labels-by-phones', allPhones.sort().join(',')],
    enabled: enabled && allPhones.length > 0,
    queryFn: async (): Promise<WaLabelMap> => {
      if (allPhones.length === 0) return {}
      // Fetch chats que casam com algum phone
      const { data: chatRows, error } = await supabase
        .from('wa_chat_labels')
        .select('phone, label_ids, vendedor_nome')
        .in('phone', allPhones)
      if (error) throw error
      if (!chatRows || chatRows.length === 0) return {}
      // Coleta todos label_ids únicos pra resolver nomes via wascript_etiquetas
      const allLabelIds = new Set<string>()
      const allVendors = new Set<string>()
      for (const row of chatRows) {
        for (const id of (row.label_ids || [])) allLabelIds.add(String(id))
        if (row.vendedor_nome) allVendors.add(String(row.vendedor_nome))
      }
      const labelInfo: Record<string, { name: string; color?: string | null }> = {}
      if (allLabelIds.size > 0 && allVendors.size > 0) {
        // Schema real: etiqueta_id_wascript (integer), sem coluna de cor
        const idsAsNumbers = [...allLabelIds].map(id => parseInt(id, 10)).filter(n => Number.isFinite(n))
        const { data: labelRows } = await supabase
          .from('wascript_etiquetas')
          .select('etiqueta_id_wascript, etiqueta_nome, vendedor_nome')
          .in('etiqueta_id_wascript', idsAsNumbers)
          .in('vendedor_nome', [...allVendors])
        for (const lr of (labelRows ?? [])) {
          labelInfo[`${lr.vendedor_nome}::${lr.etiqueta_id_wascript}`] = {
            name: String(lr.etiqueta_nome || ''),
            color: null,  // tabela real não tem cor
          }
        }
      }
      // Constrói o map { phone → labels[] }
      // ATENÇÃO: pode existir MAIS DE UMA row pro mesmo phone (1 por vendedor),
      // porque cada vendedor tem o cliente salvo no Zap dele com etiquetas
      // próprias. Antes a gente fazia `map[phone] = labels` que SOBRESCREVIA —
      // perdia as labels dos vendedores processados primeiro. Agora acumula.
      const map: WaLabelMap = {}
      for (const row of chatRows) {
        const phone = String(row.phone)
        const labels = (row.label_ids || []).map((id: string) => {
          const info = labelInfo[`${row.vendedor_nome}::${id}`]
          return {
            id: String(id),
            name: info?.name || `#${id}`,
            color: info?.color ?? null,
            vendedor: String(row.vendedor_nome || ''),
          }
        })
        if (!map[phone]) map[phone] = []
        map[phone].push(...labels)
      }
      return map
    },
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  })
}

// Helper pra usar no componente: dado um phone do CRM, busca as labels do map
export function lookupWaLabels(map: WaLabelMap | undefined, phone: string | null | undefined) {
  if (!map || !phone) return []
  for (const v of phoneVariants(phone)) {
    if (map[v]) return map[v]
  }
  return []
}

export function useAtendimentos(filters: AtendimentoFilters) {
  return useQuery({
    queryKey: ['atendimentos', filters],
    queryFn: async () => {
      const vendorFirst = await getCurrentVendorFirstName()
      let query = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('*', { count: 'exact' })
        .eq('is_internal', false)
        .order('ultima_msg', { ascending: false, nullsFirst: false })

      // Vendor vê seus atendimentos + sem responsavel (não-atribuídos, "a definir", etc.)
      if (vendorFirst) {
        query = query.or(
          `responsavel.ilike.${vendorFirst}%,` +
          `responsavel.is.null,` +
          `responsavel.eq.,` +
          `responsavel.eq.a definir`
        )
      }

      if (filters.search) {
        const escaped = filters.search.replace(/[%_]/g, c => `\\${c}`)
        query = query.or(`nome.ilike.%${escaped}%,telefone.ilike.%${escaped}%`)
      }
      if (filters.responsavel) query = query.eq('responsavel', filters.responsavel)
      if (filters.status_real) query = query.eq('status_real', filters.status_real)
      // Filtro por etiqueta do WhatsApp: a RPC devolve os telefones com a etiqueta
      // (em toda a base), e filtramos os atendimentos por eles.
      if (filters.etiqueta) {
        const { data: tels, error: telErr } = await supabase.rpc('atendimentos_telefones_por_etiqueta', { p_etiqueta: filters.etiqueta })
        if (telErr) throw telErr
        const list = (tels ?? []) as string[]
        if (list.length === 0) return { rows: [], total: 0 }
        query = query.in('telefone_norm', list)
      }
      const range = dateRangeFromPreset(filters.data)
      // Filtra por data de CHEGADA do lead (created_at)
      if (range.from) query = query.gte('created_at', range.from)
      if (range.to)   query = query.lte('created_at', range.to)
      if (filters.uf) {
        const ddds = Object.entries(DDD_TO_UF)
          .filter(([, uf]) => uf === filters.uf)
          .map(([ddd]) => ddd)
        if (ddds.length > 0) {
          const orExpr = ddds.map(ddd => `telefone.like.+55${ddd}%`).join(',')
          query = query.or(orExpr)
        }
      }
      if (filters.origem) {
        // Mapeia label normalizado de volta pra padrões SQL no campo origem
        const origemMap: Record<string, string[]> = {
          'WhatsApp (48) 8878-1144': ['WhatsApp 1144', '%1144%', '%8878%'],
          'WhatsApp (48) 3658-4502': ['WhatsApp 4502', '%4502%', '%3658%'],
          'Meta ADS': ['Meta ADS', 'Meta'],
          'Facebook': ['Facebook'],
          'Facebook Form': ['Facebook Formulario', 'Facebook Formulário'],
          'Instagram': ['Instagram', 'Instagram Formulario', 'Instagram Formulário', 'Bio Instagram'],
          'Google': ['Google'],
          'Não identificado': ['Não identificou', 'Nao identificou', 'Não Identificado'],
        }
        const patterns = origemMap[filters.origem]
        if (patterns) {
          const orExpr = patterns.map(p =>
            p.includes('%') ? `origem.ilike.${p}` : `origem.eq.${p}`
          ).join(',')
          query = query.or(orExpr)
        } else {
          query = query.eq('origem', filters.origem)
        }
      }
      // #17: filtro por criativo. Match exato em criativo_codigo (M0023, F1234).
      if (filters.criativo) {
        query = query.eq('criativo_codigo', filters.criativo.trim().toUpperCase())
      }

      const from = filters.page * ATENDIMENTO_PAGE_SIZE
      query = query.range(from, from + ATENDIMENTO_PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw error
      return { rows: (data ?? []) as Atendimento[], total: count ?? 0 }
    },
    placeholderData: prev => prev,
    refetchInterval: 30_000,                  // polling a cada 30s
    refetchIntervalInBackground: false,       // pausa quando aba nao tem foco
    refetchOnWindowFocus: true,               // atualiza ao voltar pra aba
  })
}

export interface AtendimentoKpis {
  total: number
  hoje: number
  quentes: number
  contatados: number  // leads com vendedor responsável atribuído (não null, vazio ou "a definir")
  naoEngajaram: number
  qualificados: number
  emAndamento: number
  paraPegar: number  // leads sem responsavel (null, vazio, "a definir") — disponíveis pra puxar
  byStatus: Record<StatusReal, number>
}

function startOfTodayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// Aplica os filtros base (search/responsavel/status/uf/data) na query head-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBaseFilters(query: any, filters?: Partial<AtendimentoFilters>, vendorFirst?: string | null): any {
  let q = query
  // Vendor scope: vê seus + não-atribuídos
  if (vendorFirst) {
    q = q.or(
      `responsavel.ilike.${vendorFirst}%,` +
      `responsavel.is.null,` +
      `responsavel.eq.,` +
      `responsavel.eq.a definir`
    )
  }
  if (filters?.search) {
    const escaped = filters.search.replace(/[%_]/g, c => `\\${c}`)
    q = q.or(`nome.ilike.%${escaped}%,telefone.ilike.%${escaped}%`)
  }
  if (filters?.responsavel) q = q.eq('responsavel', filters.responsavel)
  if (filters?.status_real) q = q.eq('status_real', filters.status_real)
  if (filters?.uf) {
    const ddds = Object.entries(DDD_TO_UF).filter(([, uf]) => uf === filters.uf).map(([d]) => d)
    if (ddds.length > 0) q = q.or(ddds.map(d => `telefone.like.+55${d}%`).join(','))
  }
  if (filters?.data) {
    const range = dateRangeFromPreset(filters.data)
    if (range.from) q = q.gte('created_at', range.from)
    if (range.to)   q = q.lte('created_at', range.to)
  }
  if (filters?.origem) {
    const origemMap: Record<string, string[]> = {
      'WhatsApp (48) 8878-1144': ['WhatsApp 1144', '%1144%', '%8878%'],
      'WhatsApp (48) 3658-4502': ['WhatsApp 4502', '%4502%', '%3658%'],
      'Meta ADS': ['Meta ADS', 'Meta'],
      'Facebook': ['Facebook'],
      'Facebook Form': ['Facebook Formulario', 'Facebook Formulário'],
      'Instagram': ['Instagram', 'Instagram Formulario', 'Instagram Formulário', 'Bio Instagram'],
      'Google': ['Google'],
      'Não identificado': ['Não identificou', 'Nao identificou', 'Não Identificado'],
    }
    const patterns = origemMap[filters.origem]
    if (patterns) {
      const orExpr = patterns.map(p =>
        p.includes('%') ? `origem.ilike.${p}` : `origem.eq.${p}`
      ).join(',')
      q = q.or(orExpr)
    } else {
      q = q.eq('origem', filters.origem)
    }
  }
  // #17: filtro por criativo aplicado também no KPI/total
  if (filters?.criativo) {
    q = q.eq('criativo_codigo', filters.criativo.trim().toUpperCase())
  }
  return q
}

export function useAtendimentoKpis(filters?: Partial<AtendimentoFilters>) {
  // Cache key estavel ignorando page (KPIs nao paginam)
  const filterKey = JSON.stringify({
    search: filters?.search ?? '',
    responsavel: filters?.responsavel ?? '',
    status_real: filters?.status_real ?? '',
    uf: filters?.uf ?? '',
    data: filters?.data ?? '',
  })
  return useQuery({
    queryKey: ['atendimentos-kpis', filterKey],
    queryFn: async (): Promise<AtendimentoKpis> => {
      const vendorFirst = await getCurrentVendorFirstName()
      const baseQ = () => {
        const q = supabaseAuditoria
          .from('atendimentos_por_cliente')
          .select('*', { count: 'exact', head: true })
          .eq('is_internal', false)
        return applyBaseFilters(q, filters, vendorFirst)
      }

      const todayIso = startOfTodayISO()

      // Allowlist do catálogo Branorte (fonte: SELECT DISTINCT categoria FROM precos_branorte).
      // Quem pede "Extrusora", "Peletizadora", etc. NÃO bate em nenhuma keyword e NÃO qualifica.
      const BRANORTE_EQUIP_KEYWORDS = [
        'aliment', 'balanc', 'balanç', 'brete', 'casquead',
        'cacamb', 'caçamb', 'caixa', 'compact', 'fabric', 'fábric',
        'descarga', 'elevador', 'caneca', 'sacaria', 'ensacad',
        'helico', 'rosca', 'mistur', 'moega', 'moinho', 'martelo',
        'passarela', 'peneira', 'limpeza', 'silo', 'big bag', 'bigbag',
        'transporta', 'esteira',
      ]
      const equipOrFilter = BRANORTE_EQUIP_KEYWORDS
        .map(kw => `o_que_precisa.ilike.%${kw}%`)
        .join(',')

      const [
        totalRes,
        hojeRes,
        quentesRes,
        contatadosRes,
        naoEngajaramRes,
        qualFabricaRes,
        qualEquipRes,
        emAndamentoRes,
        paraPegarRes,
        vendidoRes, abandonadoRes, semRespostaRes, aguardandoRes, perdidoRes,
      ] = await Promise.all([
        baseQ(),
        baseQ().gte('last_message_at', todayIso),
        baseQ().eq('quando_investir', 'Agora'),
        // Contatados: lead tem vendedor responsável atribuído (não "a definir")
        baseQ().not('responsavel', 'is', null).neq('responsavel', '').neq('responsavel', 'a definir'),
        // Nao engajaram: chegou no anuncio mas nem clicou no primeiro botao (motivo_contato)
        baseQ().is('motivo_contato', null).is('tocou_botao_em', null),
        // Qualificados FÁBRICA: motivo fábrica + finalidade + animal preenchidos
        baseQ()
          .or('motivo_contato.ilike.%fab%,motivo_contato.ilike.%fáb%')
          .not('finalidade_fabrica', 'is', null)
          .not('qual_animal', 'is', null),
        // Qualificados EQUIPAMENTO: motivo equipamento + o_que_precisa bate no catálogo Branorte
        baseQ()
          .ilike('motivo_contato', '%equip%')
          .or(equipOrFilter),
        // Em andamento: clicou no MOTIVO mas nao clicou no botao final
        baseQ().not('motivo_contato', 'is', null).is('tocou_botao_em', null),
        // Pra pegar: sem responsavel — null, vazio, ou "a definir"
        baseQ().or('responsavel.is.null,responsavel.eq.,responsavel.eq.a definir'),
        baseQ().eq('status_real', 'Vendido'),
        baseQ().eq('status_real', 'Abandonado'),
        baseQ().eq('status_real', 'Sem-Resposta'),
        baseQ().eq('status_real', 'Aguardando-Vendedor'),
        baseQ().eq('status_real', 'Perdido'),
      ])
      if (totalRes.error) throw totalRes.error

      const byStatus = {
        'Vendido':              vendidoRes.count ?? 0,
        'Em-andamento':         emAndamentoRes.count ?? 0,
        'Aguardando-Vendedor':  aguardandoRes.count ?? 0,
        'Abandonado':           abandonadoRes.count ?? 0,
        'Sem-Resposta':         semRespostaRes.count ?? 0,
        'Perdido':              perdidoRes.count ?? 0,
      } as Record<StatusReal, number>

      return {
        total:           totalRes.count ?? 0,
        hoje:            hojeRes.count ?? 0,
        quentes:         quentesRes.count ?? 0,
        contatados:      contatadosRes.count ?? 0,
        naoEngajaram:    naoEngajaramRes.count ?? 0,
        qualificados:    (qualFabricaRes.count ?? 0) + (qualEquipRes.count ?? 0),
        emAndamento:     emAndamentoRes.count ?? 0,
        paraPegar:       paraPegarRes.count ?? 0,
        byStatus,
      }
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export function useAtendimentoResponsaveis() {
  return useQuery({
    queryKey: ['atendimentos-responsaveis'],
    queryFn: async () => {
      const vendorFirst = await getCurrentVendorFirstName()
      // Distinct via: pegar responsaveis únicos da view (limit grande).
      let query = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('responsavel')
        .eq('is_internal', false)
        .not('responsavel', 'is', null)
      // Vendor: só seu nome no dropdown
      if (vendorFirst) query = query.ilike('responsavel', `${vendorFirst}%`)
      const { data, error } = await query
        .limit(2000)
      if (error) throw error
      const set = new Set<string>()
      for (const r of (data ?? []) as { responsavel: string | null }[]) {
        if (r.responsavel) set.add(r.responsavel)
      }
      return Array.from(set).sort()
    },
    staleTime: 5 * 60_000,
  })
}

// Exclui um atendimento (ou todas as rows do mesmo cliente, via auditoria_ids).
// Usa RPC SECURITY DEFINER pq anon nao tem DELETE direto na tabela.
export function useDeleteAtendimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) throw new Error('Nenhum id pra excluir')
      const { data, error } = await supabaseAuditoria.rpc('delete_atendimentos', { p_ids: ids })
      if (error) throw error
      return data as { success: boolean; deleted?: number; error?: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atendimentos'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-kpis'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-responsaveis'] })
    },
  })
}

// Atribui atendimento ao usuario logado ('Pegar pra mim').
// Atualiza TODOS auditoria_ids do cliente.
export function useAtribuirAtendimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { auditoria_ids: string[]; user_id: string; user_name: string }) => {
      if (!args.auditoria_ids.length) throw new Error('Nenhum id')
      const { data, error } = await supabase.rpc('atendimento_atribuir', {
        p_auditoria_ids: args.auditoria_ids,
        p_user_id: args.user_id,
        p_user_name: args.user_name,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atendimentos'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-responsaveis'] })
    },
  })
}

// Carrega todos os atendimentos pro Kanban (sem paginar). Limita 1000 por seguranca.
// Filtros: search, responsavel, uf, data — mesmo schema do /atendimentos.
export function useAtendimentosFunil(filters: Omit<AtendimentoFilters, 'status_real' | 'page'>) {
  return useQuery({
    queryKey: ['atendimentos-funil', filters],
    queryFn: async () => {
      const vendorFirst = await getCurrentVendorFirstName()
      let query = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('*')
        .eq('is_internal', false)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1000)

      if (vendorFirst) {
        query = query.or(
          `responsavel.ilike.${vendorFirst}%,` +
          `responsavel.is.null,` +
          `responsavel.eq.,` +
          `responsavel.eq.a definir`
        )
      }

      if (filters.search) {
        const escaped = filters.search.replace(/[%_]/g, c => `\\${c}`)
        query = query.or(`nome.ilike.%${escaped}%,telefone.ilike.%${escaped}%`)
      }
      if (filters.responsavel) query = query.eq('responsavel', filters.responsavel)
      if (filters.uf) {
        const ddds = Object.entries(DDD_TO_UF).filter(([, uf]) => uf === filters.uf).map(([ddd]) => ddd)
        if (ddds.length > 0) {
          query = query.or(ddds.map(ddd => `telefone.like.+55${ddd}%`).join(','))
        }
      }
      const range = dateRangeFromPreset(filters.data)
      if (range.from) query = query.gte('created_at', range.from)
      if (range.to)   query = query.lte('created_at', range.to)

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as Atendimento[]
    },
    placeholderData: prev => prev,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

// Atribui lead a um vendedor especifico pelo nome (sem precisar do user_id auth).
// Usado pelo admin pra atribuir pra qualquer vendedor da equipe.
export function useAtribuirVendedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { auditoria_ids: string[]; vendor_name: string; vendor_user_id?: string | null }) => {
      if (!args.auditoria_ids.length) throw new Error('Nenhum id')
      if (!args.vendor_name?.trim()) throw new Error('Nome do vendedor obrigatorio')
      const { error, data } = await supabaseAuditoria
        .from('auditoria_atendimentos')
        .update({
          responsavel: args.vendor_name,
          responsavel_user_id: args.vendor_user_id ?? null,
        })
        .in('id', args.auditoria_ids)
        .select('id')
      if (error) throw error
      return (data ?? []).length
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atendimentos'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-kpis'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-responsaveis'] })
    },
  })
}

// Atualiza o status_vendedor (Novo, Em atendimento, Proposta enviada, Negociando,
// Fechou, Nao fechou, Sem retorno) em todas as rows do cliente.
export function useUpdateStatusVendedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { auditoria_ids: string[]; status: StatusVendedor | null }) => {
      if (!args.auditoria_ids.length) throw new Error('Nenhum id')
      const { error, data } = await supabaseAuditoria
        .from('auditoria_atendimentos')
        .update({ status_vendedor: args.status })
        .in('id', args.auditoria_ids)
        .select('id')
      if (error) throw error
      return (data ?? []).length
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atendimentos'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-kpis'] })
    },
  })
}

// Fecha (resolve) ou reabre atendimento.
// fechar=true seta finished_at=now(); fechar=false seta NULL.
export function useResolverAtendimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { auditoria_ids: string[]; user_id: string; fechar: boolean }) => {
      if (!args.auditoria_ids.length) throw new Error('Nenhum id')
      const { data, error } = await supabase.rpc('atendimento_resolver', {
        p_auditoria_ids: args.auditoria_ids,
        p_user_id: args.user_id,
        p_fechar: args.fechar,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atendimentos'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-kpis'] })
    },
  })
}

// --- Origens breakdown ---

export interface OrigemEntry {
  label: string
  count: number
  color: string
}

function normalizeOrigem(raw: string | null | undefined): string {
  if (!raw) return 'Não identificado'
  const s = raw.toLowerCase().trim()
  if (s.includes('1144') || s.includes('8878')) return 'WhatsApp (48) 8878-1144'
  if (s.includes('4502') || s.includes('3658')) return 'WhatsApp (48) 3658-4502'
  if (s.includes('whatsapp')) return 'WhatsApp'
  if (s === 'meta ads' || s === 'meta') return 'Meta ADS'
  if (s.includes('instagram') && s.includes('formul')) return 'Instagram'
  if (s.includes('instagram')) return 'Instagram'
  if (s.includes('facebook') && s.includes('formul')) return 'Facebook Form'
  if (s === 'facebook') return 'Facebook'
  if (s.includes('google')) return 'Google'
  if (s.includes('não identif') || s === 'nao identificou' || s === 'não identificou') return 'Não identificado'
  return raw
}

const ORIGEM_COLORS: Record<string, string> = {
  'WhatsApp (48) 8878-1144': '#25D366',
  'WhatsApp (48) 3658-4502': '#128C7E',
  'WhatsApp': '#25D366',
  'Meta ADS': '#1877F2',
  'Facebook': '#1877F2',
  'Facebook Form': '#4267B2',
  'Instagram': '#E1306C',
  'Google': '#4285F4',
  'Não identificado': '#6B7280',
}

export function useAtendimentoOrigens(filters?: Partial<AtendimentoFilters>) {
  const filterKey = JSON.stringify({
    search: filters?.search ?? '',
    responsavel: filters?.responsavel ?? '',
    status_real: filters?.status_real ?? '',
    uf: filters?.uf ?? '',
    data: filters?.data ?? '',
  })
  return useQuery({
    queryKey: ['atendimentos-origens', filterKey],
    queryFn: async (): Promise<OrigemEntry[]> => {
      const vendorFirst = await getCurrentVendorFirstName()
      let query = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('origem')
        .eq('is_internal', false)
        .limit(5000)
      query = applyBaseFilters(query, filters, vendorFirst)
      const { data, error } = await query
      if (error) throw error

      const counts: Record<string, number> = {}
      for (const row of (data ?? []) as { origem: string | null }[]) {
        const label = normalizeOrigem(row.origem)
        counts[label] = (counts[label] ?? 0) + 1
      }

      return Object.entries(counts)
        .map(([label, count]) => ({
          label,
          count,
          color: ORIGEM_COLORS[label] ?? '#6B7280',
        }))
        .sort((a, b) => b.count - a.count)
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}
