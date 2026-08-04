// Persistência do Modo Planejamento de Viagem (/mapa-visitas).
// A lógica pura (otimizador, programação, formatação) vive em @/lib/viagem.
// Aqui só entra a ida-e-volta com o banco: viagens, viagem_paradas e cliente_localizacao.
//
// Duas decisões que valem a leitura antes de mexer:
//
// 1) cli_key vs cli_keys — existe UNIQUE (viagem_id, cli_key) WHERE cli_key IS NOT NULL
//    e CHECK (tipo <> 'cliente' OR cli_key IS NOT NULL). Então:
//      tipo='cliente' → cli_key = a chave do único cliente (satisfaz o CHECK)
//      qualquer outro → cli_key = NULL (foge do UNIQUE, que barraria a 2ª parada-cidade)
//    cli_keys[] é preenchido SEMPRE que houver cliente, inclusive na parada de cliente
//    único, pra leitura ficar uniforme (lê cli_keys, cai pra cli_key só em registro velho).
//
// 2) ordem é GLOBAL (índice no array), não "ordem dentro do dia". Como programar() consome
//    o array em sequência, a ordem global é monotônica dentro de cada dia — ou seja, ordenar
//    por (dia, ordem) dá o mesmo resultado. E ordenar só por `ordem` devolve o array
//    exatamente como estava, incluindo as paradas que ficaram fora do plano.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  CONFIG_PADRAO,
  refDoPonto,
  type ClienteRef,
  type Confirmacao,
  type ConfigViagem,
  type Parada,
  type PontoMapa,
  type Precisao,
  type Programacao,
  type TipoParada,
} from '@/lib/viagem'

// ── tipos ────────────────────────────────────────────────────────────────────

export type ViagemStatus =
  | 'rascunho' | 'aguardando_localizacoes' | 'aguardando_confirmacoes'
  | 'pronta' | 'em_andamento' | 'concluida' | 'cancelada'

export interface ViagemResumo {
  id: string
  nome: string
  status: ViagemStatus
  data_inicio: string | null
  dias: number
  criado_por: string
  created_at: string
  /** quantas paradas a viagem tem hoje */
  paradas: number
}

export interface ViagemCarregada {
  id: string
  status: ViagemStatus
  criadoPor: string
  observacoes: string | null
  cfg: ConfigViagem
  paradas: Parada[]
}

export interface SalvarViagemInput {
  /** ausente = cria; presente = regrava por cima */
  id?: string
  cfg: ConfigViagem
  paradas: Parada[]
  /** se vier, grava dia/horário previsto/km de cada parada e os totais da viagem */
  programacao?: Programacao
  status?: ViagemStatus
  observacoes?: string | null
}

/** O CHECK da tabela só aceita estes três — 'cidade'/'estado' são derivados, não confirmáveis. */
export type PrecisaoConfirmavel = Extract<Precisao, 'endereco' | 'confirmada' | 'manual'>

export interface SalvarLocalizacaoInput {
  cliKey: string
  lat: number
  lng: number
  precisao?: PrecisaoConfirmavel
  /** de onde veio: 'vendedor', 'link_maps', 'cadastro'… */
  fonte?: string | null
  endereco?: string | null
  observacao?: string | null
}

// ── helpers de conversão ─────────────────────────────────────────────────────

/** time do banco ('HH:MM:SS') → 'HH:MM' do front. Aceita hora sem zero à esquerda. */
const soHora = (t: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t == null ? '' : String(t))
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** 'HH:MM' do front → time do banco. Lixo vira null em vez de estourar o INSERT.
 *  A faixa é checada de verdade: '99:99' casa com \d{1,2}:\d{2} mas não é hora,
 *  e o Postgres recusaria o literal em vez de gravar null. */
const praHora = (h: string | null | undefined): string | null => {
  const min = hhmm(h)
  return min == null ? null : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

/** data 'YYYY-MM-DD' + minutos desde 00:00 → timestamptz. Hora é LOCAL (é o horário da viagem). */
function carimbo(data: string | null | undefined, minutos: number | null | undefined): string | null {
  if (!data || minutos == null) return null
  const d = new Date(`${data}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setMinutes(d.getMinutes() + minutos)
  return d.toISOString()
}

async function usuarioId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) throw new Error('Sessão expirada — entre de novo pra salvar.')
  return data.user.id
}

interface Encaixe {
  dia: number
  data: string | null
  chegada: number
  saida: number
  metros: number | null
  segundos: number | null
}

/** parada.id → onde ela caiu na programação. Quem não caiu (fora do plano) não entra no mapa. */
function indexarProgramacao(prog?: Programacao): Map<string, Encaixe> {
  const m = new Map<string, Encaixe>()
  for (const d of prog?.dias ?? []) {
    for (const x of d.paradas) {
      m.set(x.parada.id, {
        dia: d.dia,
        data: d.data,
        chegada: x.chegada,
        saida: x.saida,
        metros: x.trechoAnterior?.metros ?? null,
        segundos: x.trechoAnterior?.segundos ?? null,
      })
    }
  }
  return m
}

/**
 * Traduz os CHECK da tabela `viagens` pra mensagem legível ANTES do INSERT.
 * O painel deixa passar: os dois <input type="time"> não se conversam (dá pra
 * fechar às 07:00 e abrir às 08:00) e visitaMinutosPadrao só é travado por
 * baixo (Math.max(5, …), sem teto). Sem isto, o usuário levaria um
 * `23514 viagens_jornada_valida` cru na tela.
 */
function validarCfg(cfg: ConfigViagem): void {
  const ini = hhmm(cfg.horaInicio), fim = hhmm(cfg.horaFim)
  if (ini == null || fim == null) {
    throw new Error('Horário de início ou de fim inválido. Use o formato HH:MM.')
  }
  if (fim <= ini) {
    throw new Error(`O fim da jornada (${cfg.horaFim}) precisa ser depois do início (${cfg.horaInicio}).`)
  }
  if (!Number.isFinite(cfg.dias) || cfg.dias < 1 || cfg.dias > 60) {
    throw new Error('A viagem precisa ter entre 1 e 60 dias.')
  }
  if (cfg.almocoMinutos < 0 || cfg.almocoMinutos > 240) {
    throw new Error('O almoço precisa ter entre 0 e 240 minutos.')
  }
  if (cfg.visitaMinutosPadrao < 5 || cfg.visitaMinutosPadrao > 600) {
    throw new Error('O tempo padrão de visita precisa ficar entre 5 e 600 minutos.')
  }
}

/** 'HH:MM' → minutos. null quando não é hora. (Local: não vale importar de viagem.ts,
 *  cujo hhmmParaMin aceita lixo e devolve 0 — aqui 0 e inválido são coisas diferentes.) */
function hhmm(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h > 23 || min > 59 ? null : h * 60 + min
}

function linhaDaParada(viagemId: string, p: Parada, ordem: number, e: Encaixe | undefined) {
  const c0 = p.clientes[0] ?? null
  const keys = p.clientes.map(c => c.cliKey).filter((k): k is string => !!k)
  if (p.tipo === 'cliente' && !keys.length) {
    throw new Error(`Parada "${p.rotulo || p.cidade || p.id}" está marcada como cliente mas não tem cli_key.`)
  }
  const quem = p.rotulo || p.clientes[0]?.nome || p.cidade || p.id
  // CHECK visita_minutos between 0 and 1440 — o painel só trava o piso (Math.max(0, …))
  if (p.visitaMinutos != null && (p.visitaMinutos > 1440 || p.visitaMinutos < 0)) {
    throw new Error(`Tempo de visita de "${quem}" precisa ficar entre 0 e 1440 minutos.`)
  }
  // CHECK viagem_paradas_janela_valida (janela_fim > janela_inicio). Os dois
  // <input type="time"> do painel são independentes, então dá pra pedir visita
  // "das 14:00 às 09:00" e só descobrir no INSERT.
  const jIni = praHora(p.janelaInicio), jFim = praHora(p.janelaFim)
  if (jIni && jFim && jFim <= jIni) {
    throw new Error(`Em "${quem}", o fim da janela (${p.janelaFim}) precisa ser depois do início (${p.janelaInicio}).`)
  }
  return {
    viagem_id: viagemId,
    tipo: p.tipo,
    cli_key: p.tipo === 'cliente' ? keys[0] : null,
    cli_keys: keys.length ? keys : null,
    rotulo: p.rotulo,
    cliente_nome: c0?.nome ?? null,
    vendedor: c0?.vendedor ?? null,
    telefone: c0?.telefone ?? null,
    equipamento: c0?.equipamento ?? null,
    valor: c0?.valor ?? null,
    cidade: p.cidade,
    uf: p.uf,
    endereco: p.endereco,
    lat: p.lat,
    lng: p.lng,
    precisao: p.precisao,
    dia: e?.dia ?? 1,
    ordem,
    ordem_travada: p.ordemTravada,
    visita_minutos: p.visitaMinutos,
    janela_inicio: praHora(p.janelaInicio),
    janela_fim: praHora(p.janelaFim),
    chegada_prevista: carimbo(e?.data, e?.chegada),
    saida_prevista: carimbo(e?.data, e?.saida),
    metros_anterior: e?.metros ?? null,
    deslocamento_anterior_seg: e?.segundos ?? null,
    confirmacao: p.confirmacao,
    notas: p.notas,
  }
}

/**
 * Volta pra Parada. O banco guarda nome/telefone/vendedor só do PRIMEIRO cliente da
 * parada-cidade — os demais voltam como esqueleto (só cliKey). Use hidratarParadas()
 * com os pontos do mapa pra recompor tudo.
 */
function paradaDaLinha(r: Record<string, unknown>): Parada {
  const arr = Array.isArray(r.cli_keys) ? (r.cli_keys as string[]).filter(Boolean) : []
  const keys = arr.length ? arr : (r.cli_key ? [String(r.cli_key)] : [])
  const clientes: ClienteRef[] = keys.map((k, i) => ({
    cliKey: k,
    nome: i === 0 ? ((r.cliente_nome as string | null) ?? null) : null,
    telefone: i === 0 ? ((r.telefone as string | null) ?? null) : null,
    vendedor: i === 0 ? ((r.vendedor as string | null) ?? null) : null,
    equipamento: i === 0 ? ((r.equipamento as string | null) ?? null) : null,
    valor: i === 0 ? num(r.valor) : null,
    vendido: false,
    numeros: null,
  }))
  return {
    id: String(r.id),
    tipo: (r.tipo as TipoParada) ?? 'parada',
    clientes,
    rotulo: (r.rotulo as string | null) ?? null,
    cidade: (r.cidade as string | null) ?? null,
    uf: (r.uf as string | null) ?? null,
    endereco: (r.endereco as string | null) ?? null,
    lat: num(r.lat) ?? 0,
    lng: num(r.lng) ?? 0,
    precisao: ((r.precisao as Precisao) ?? 'cidade'),
    visitaMinutos: num(r.visita_minutos),
    janelaInicio: soHora(r.janela_inicio),
    janelaFim: soHora(r.janela_fim),
    ordemTravada: r.ordem_travada === true,
    notas: (r.notas as string | null) ?? null,
    confirmacao: ((r.confirmacao as Confirmacao) ?? 'nao_solicitado'),
  }
}

function cfgDaLinha(v: Record<string, unknown>): ConfigViagem {
  const oLat = num(v.origem_lat), oLng = num(v.origem_lng)
  const dLat = num(v.destino_lat), dLng = num(v.destino_lng)
  return {
    nome: (v.nome as string | null) ?? '',
    dataInicio: (v.data_inicio as string | null) ?? null,
    dias: num(v.dias) ?? CONFIG_PADRAO.dias,
    horaInicio: soHora(v.hora_inicio) ?? CONFIG_PADRAO.horaInicio,
    horaFim: soHora(v.hora_fim) ?? CONFIG_PADRAO.horaFim,
    almocoInicio: soHora(v.almoco_inicio),
    almocoMinutos: num(v.almoco_minutos) ?? CONFIG_PADRAO.almocoMinutos,
    visitaMinutosPadrao: num(v.visita_minutos_padrao) ?? CONFIG_PADRAO.visitaMinutosPadrao,
    origem: oLat != null && oLng != null
      ? { nome: (v.origem_nome as string | null) ?? 'Origem', lat: oLat, lng: oLng } : null,
    destino: dLat != null && dLng != null
      ? { nome: (v.destino_nome as string | null) ?? 'Destino', lat: dLat, lng: dLng } : null,
    retornarOrigem: v.retornar_origem !== false,
    modo: v.modo_otimizacao === 'manual' ? 'manual' : 'otimizar',
  }
}

function linhaDaCfg(cfg: ConfigViagem, prog?: Programacao) {
  return {
    nome: cfg.nome.trim() || 'Viagem sem nome', // coluna é NOT NULL e lista com nome vazio é inútil
    data_inicio: cfg.dataInicio || null,
    dias: cfg.dias,
    origem_nome: cfg.origem?.nome ?? null,
    origem_lat: cfg.origem?.lat ?? null,
    origem_lng: cfg.origem?.lng ?? null,
    destino_nome: cfg.destino?.nome ?? null,
    destino_lat: cfg.destino?.lat ?? null,
    destino_lng: cfg.destino?.lng ?? null,
    retornar_origem: cfg.retornarOrigem,
    hora_inicio: praHora(cfg.horaInicio) ?? praHora(CONFIG_PADRAO.horaInicio),
    hora_fim: praHora(cfg.horaFim) ?? praHora(CONFIG_PADRAO.horaFim),
    almoco_inicio: praHora(cfg.almocoInicio),
    almoco_minutos: cfg.almocoMinutos,
    visita_minutos_padrao: cfg.visitaMinutosPadrao,
    modo_otimizacao: cfg.modo,
    total_metros: prog?.totalMetros ?? null,
    total_deslocamento_seg: prog?.totalDeslocamentoSeg ?? null,
    total_visita_seg: prog?.totalVisitaSeg ?? null,
    // 'estimado' = haversine × fator de estrada; a UI usa isso pra avisar que não é rota real
    provedor_rota: prog ? (prog.estimado ? 'estimado' : 'osrm') : null,
    calculado_em: prog ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Recompõe nome/telefone/vendedor/valor dos clientes de uma viagem salva a partir dos
 * pontos do mapa (mapa_orcamentos_v2). Sem isso, a parada-cidade volta do banco com só
 * o primeiro cliente nomeado. Pura — chame no render, não precisa de mutation.
 */
export function hidratarParadas(paradas: Parada[], pontos: PontoMapa[]): Parada[] {
  if (!pontos.length || !paradas.length) return paradas
  const porKey = new Map(pontos.map(p => [p.cli_key, p]))
  return paradas.map(p => {
    if (!p.clientes.length) return p
    let achou = false
    const clientes = p.clientes.map(c => {
      const ponto = porKey.get(c.cliKey)
      if (!ponto) return c
      achou = true
      // equipamento não vem da RPC — é campo da parada, preserva o que estava salvo
      return { ...refDoPonto(ponto), equipamento: c.equipamento }
    })
    return achou ? { ...p, clientes } : p
  })
}

// ── camada de pontos do mapa (com cli_key + precisão) ────────────────────────

/**
 * Igual a mapa_orcamentos(), mais cli_key (chave estável do cliente) e precisao
 * (endereco/confirmada/manual/cidade/estado). A RPC faz LEFT JOIN em cliente_localizacao,
 * então confirmar um endereço muda o ponto aqui.
 */
export function useOrcamentosMapaV2() {
  return useQuery<PontoMapa[]>({
    queryKey: ['orcamentos-mapa-v2'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mapa_orcamentos_v2')
      if (error) throw error
      return (data ?? []) as PontoMapa[]
    },
  })
}

// ── viagens ──────────────────────────────────────────────────────────────────

/**
 * Lista as viagens visíveis pro usuário. Quem filtra é a RLS (viagens_sel):
 * dono vê as suas; perfil com viagens_ve_todas() vê todas.
 */
export function useViagens() {
  return useQuery<ViagemResumo[]>({
    queryKey: ['viagens'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('viagens')
        .select('id, nome, status, data_inicio, dias, criado_por, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error

      const linhas = (data ?? []) as Omit<ViagemResumo, 'paradas'>[]
      if (!linhas.length) return []

      const { data: ps, error: erroParadas } = await supabase
        .from('viagem_paradas')
        .select('viagem_id')
        .in('viagem_id', linhas.map(v => v.id))
      if (erroParadas) throw erroParadas

      const conta = new Map<string, number>()
      for (const p of (ps ?? []) as { viagem_id: string }[]) {
        conta.set(p.viagem_id, (conta.get(p.viagem_id) ?? 0) + 1)
      }
      return linhas.map(v => ({ ...v, paradas: conta.get(v.id) ?? 0 }))
    },
  })
}

/** Uma viagem + paradas, já no formato que @/lib/viagem consome. */
export function useViagem(id: string | null | undefined) {
  return useQuery<ViagemCarregada | null>({
    queryKey: ['viagem', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: v, error } = await supabase
        .from('viagens').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      if (!v) return null

      const { data: rows, error: erroParadas } = await supabase
        .from('viagem_paradas').select('*').eq('viagem_id', id!)
        .order('ordem', { ascending: true })
      if (erroParadas) throw erroParadas

      return {
        id: String(v.id),
        status: (v.status as ViagemStatus) ?? 'rascunho',
        criadoPor: String(v.criado_por),
        observacoes: (v.observacoes as string | null) ?? null,
        cfg: cfgDaLinha(v),
        paradas: ((rows ?? []) as Record<string, unknown>[]).map(paradaDaLinha),
      }
    },
  })
}

/**
 * Grava a viagem inteira. As paradas são apagadas e reinseridas — diff parada-a-parada
 * seria mais código pra manter e erraria toda vez que o otimizador reordenasse tudo.
 * Retorna o id da viagem (novo ou o mesmo).
 */
export function useSalvarViagem() {
  const qc = useQueryClient()
  return useMutation<string, Error, SalvarViagemInput>({
    mutationFn: async ({ id, cfg, paradas, programacao, status, observacoes }) => {
      validarCfg(cfg)
      const base = linhaDaCfg(cfg, programacao)
      const patch: Record<string, unknown> = { ...base }
      if (status) patch.status = status
      if (observacoes !== undefined) patch.observacoes = observacoes

      let viagemId = id
      if (viagemId) {
        // criado_por fica de fora de propósito: admin editando viagem alheia não vira dono
        const { error } = await supabase.from('viagens').update(patch).eq('id', viagemId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('viagens')
          .insert({ ...patch, criado_por: await usuarioId() })
          .select('id').single()
        if (error) throw error
        viagemId = String(data.id)
      }

      const encaixes = indexarProgramacao(programacao)
      const linhas = paradas.map((p, i) => linhaDaParada(viagemId!, p, i, encaixes.get(p.id)))

      // UNIQUE (viagem_id, cli_key): erro legível em vez de 23505 cru
      const vistos = new Set<string>()
      for (const l of linhas) {
        if (!l.cli_key) continue
        if (vistos.has(l.cli_key)) {
          throw new Error('O mesmo cliente está em duas paradas desta viagem. Remova a repetida antes de salvar.')
        }
        vistos.add(l.cli_key)
      }

      // Sem transação no PostgREST: a validação acima roda ANTES do delete de propósito,
      // pra não apagar as paradas e descobrir o problema no insert.
      const { error: erroLimpeza } = await supabase
        .from('viagem_paradas').delete().eq('viagem_id', viagemId)
      if (erroLimpeza) throw erroLimpeza

      if (linhas.length) {
        const { error: erroInsert } = await supabase.from('viagem_paradas').insert(linhas)
        if (erroInsert) throw erroInsert
      }
      return viagemId
    },
    onSuccess: (viagemId) => {
      qc.invalidateQueries({ queryKey: ['viagens'] })
      qc.invalidateQueries({ queryKey: ['viagem', viagemId] })
    },
  })
}

/** Apaga a viagem. As paradas vão junto por ON DELETE CASCADE. */
export function useExcluirViagem() {
  const qc = useQueryClient()
  return useMutation<string, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('viagens').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['viagens'] })
      qc.removeQueries({ queryKey: ['viagem', id] })
    },
  })
}

/** Clona viagem + paradas. A cópia nasce 'rascunho' e sem as confirmações da original. */
export function useDuplicarViagem() {
  const qc = useQueryClient()
  return useMutation<string, Error, string>({
    mutationFn: async (id) => {
      const uid = await usuarioId()

      const { data: v, error } = await supabase.from('viagens').select('*').eq('id', id).single()
      if (error) throw error

      const {
        id: _id, criado_por: _dono, created_at: _criada, updated_at: _atualizada,
        nome, ...resto
      } = v as Record<string, unknown> & { nome: string }

      const { data: nova, error: erroInsert } = await supabase
        .from('viagens')
        .insert({ ...resto, nome: `${nome} (cópia)`, status: 'rascunho', criado_por: uid })
        .select('id').single()
      if (erroInsert) throw erroInsert
      const novoId = String(nova.id)

      const { data: rows, error: erroParadas } = await supabase
        .from('viagem_paradas').select('*').eq('viagem_id', id)
        .order('ordem', { ascending: true })
      if (erroParadas) throw erroParadas

      const copias = ((rows ?? []) as Record<string, unknown>[]).map(r => {
        const {
          id: _pid, viagem_id: _vid, created_at: _c, updated_at: _u,
          confirmacao: _cf, confirmacao_em: _ce, ...campos
        } = r
        return { ...campos, viagem_id: novoId, confirmacao: 'nao_solicitado', confirmacao_em: null }
      })
      if (copias.length) {
        const { error: erroCopias } = await supabase.from('viagem_paradas').insert(copias)
        if (erroCopias) throw erroCopias
      }
      return novoId
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['viagens'] }),
  })
}

// ── localização confirmada do cliente ────────────────────────────────────────

/**
 * Grava/atualiza a coordenada real de um cliente.
 * Invalida ['orcamentos-mapa-v2'] porque mapa_orcamentos_v2() faz LEFT JOIN nesta tabela:
 * confirmar o endereço tem que mover o pino na hora, sem F5.
 */
export function useSalvarLocalizacaoCliente() {
  const qc = useQueryClient()
  return useMutation<string, Error, SalvarLocalizacaoInput>({
    mutationFn: async (loc) => {
      const payload = {
        cli_key: loc.cliKey,
        lat: loc.lat,
        lng: loc.lng,
        precisao: loc.precisao ?? 'confirmada',
        fonte: loc.fonte ?? null,
        endereco: loc.endereco ?? null,
        observacao: loc.observacao ?? null,
        confirmado_por: await usuarioId(),
        confirmado_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('cliente_localizacao').upsert(payload, { onConflict: 'cli_key' })
      if (error) throw error
      return loc.cliKey
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-mapa-v2'] })
      qc.invalidateQueries({ queryKey: ['viagem'] })
    },
  })
}
