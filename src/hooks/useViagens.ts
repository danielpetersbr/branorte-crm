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
  hidratarParadas, indexarProgramacao, validarCfg, linhaDaCfg, linhaDaParada,
  paradaDaLinha, cfgDaLinha, praHora,
} from '@/lib/viagem-db'
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

async function usuarioId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) throw new Error('Sessão expirada — entre de novo pra salvar.')
  return data.user.id
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
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
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
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['viagens'] })
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
    },
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
      // O quadro mostra a precisão de cada parada: sem isto ele segue dizendo
      // "no centro da cidade" depois de o vendedor ter corrigido.
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORGANIZAÇÃO DE VIAGEM — o quadro que fica ABAIXO do mapa
//
// Entre "montei a viagem" e "posso fechar o roteiro" existe um trabalho que não
// é de planejamento: falar com o vendedor, ele falar com o cliente, e voltar com
// (a) pode visitar nessa data? e (b) qual é a localização REAL da propriedade.
// Isso leva dias e não morava em lugar nenhum — quem salvava a viagem perdia de
// vista o que faltava. Estes hooks alimentam esse quadro sem precisar reabrir o
// planejador.
// ═══════════════════════════════════════════════════════════════════════════════

/** Uma parada como o quadro precisa dela: quem é, onde está, e o que falta. */
export interface ParadaConfirmacao {
  id: string
  viagemId: string
  cliKeys: string[]
  nome: string
  cidade: string | null
  uf: string | null
  vendedor: string | null
  telefone: string | null
  lat: number
  lng: number
  precisao: Precisao
  confirmacao: Confirmacao
  dia: number
  ordem: number
  chegadaPrevista: string | null
  notas: string | null
}

export interface ViagemQuadro extends ViagemResumo {
  paradasDetalhe: ParadaConfirmacao[]
  /** paradas com visita confirmada pelo cliente */
  confirmadas: number
  /** ainda no centro da cidade — a rota sai errada enquanto for assim */
  aproximadas: number
  /** cliente disse que não dá — fica visível em vez de sumir */
  indisponiveis: number
}

/**
 * Viagens + paradas em DUAS consultas, não N+1.
 *
 * Traz todas menos concluída/cancelada: viagem que já rodou não tem o que
 * confirmar, e deixar acumular transforma o quadro em lixo que ninguém lê.
 */
export function useQuadroViagens() {
  return useQuery<ViagemQuadro[]>({
    queryKey: ['viagens-quadro'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('viagens')
        .select('id, nome, status, data_inicio, dias, criado_por, created_at')
        .not('status', 'in', '("concluida","cancelada")')
        .order('created_at', { ascending: false })
      if (error) throw error

      const viagens = (data ?? []) as Omit<ViagemResumo, 'paradas'>[]
      if (!viagens.length) return []

      const { data: ps, error: erroParadas } = await supabase
        .from('viagem_paradas')
        .select('id, viagem_id, cli_key, cli_keys, rotulo, cliente_nome, vendedor, telefone, cidade, uf, lat, lng, precisao, confirmacao, dia, ordem, chegada_prevista, notas')
        .in('viagem_id', viagens.map(v => v.id))
        .order('dia', { ascending: true })
        .order('ordem', { ascending: true })
      if (erroParadas) throw erroParadas

      const porViagem = new Map<string, ParadaConfirmacao[]>()
      for (const r of (ps ?? []) as Record<string, unknown>[]) {
        const vid = String(r.viagem_id)
        const arr = Array.isArray(r.cli_keys) ? (r.cli_keys as string[]).filter(Boolean) : []
        const keys = arr.length ? arr : (r.cli_key ? [String(r.cli_key)] : [])
        const lista = porViagem.get(vid) ?? []
        lista.push({
          id: String(r.id),
          viagemId: vid,
          cliKeys: keys,
          nome: (r.rotulo as string) || (r.cliente_nome as string) || (r.cidade as string) || 'Parada',
          cidade: (r.cidade as string | null) ?? null,
          uf: (r.uf as string | null) ?? null,
          vendedor: (r.vendedor as string | null) ?? null,
          telefone: (r.telefone as string | null) ?? null,
          lat: Number(r.lat) || 0,
          lng: Number(r.lng) || 0,
          precisao: ((r.precisao as Precisao) ?? 'cidade'),
          confirmacao: ((r.confirmacao as Confirmacao) ?? 'nao_solicitado'),
          dia: Number(r.dia) || 1,
          ordem: Number(r.ordem) || 0,
          chegadaPrevista: (r.chegada_prevista as string | null) ?? null,
          notas: (r.notas as string | null) ?? null,
        })
        porViagem.set(vid, lista)
      }

      return viagens.map(v => {
        const det = porViagem.get(v.id) ?? []
        return {
          ...v,
          paradas: det.length,
          paradasDetalhe: det,
          confirmadas: det.filter(p => p.confirmacao === 'visita_confirmada').length,
          aproximadas: det.filter(p => p.precisao === 'cidade' || p.precisao === 'estado').length,
          indisponiveis: det.filter(p => p.confirmacao === 'indisponivel').length,
        }
      })
    },
  })
}

/** Muda o estado de UMA parada. */
export function useConfirmarParada() {
  const qc = useQueryClient()
  return useMutation<void, Error, { paradaId: string; confirmacao: Confirmacao; notas?: string | null }>({
    mutationFn: async ({ paradaId, confirmacao, notas }) => {
      // Via RPC, não UPDATE direto: a policy da tabela só deixa quem CRIOU a
      // viagem escrever. O vendedor confirma viagem montada pelo escritório, e
      // pela tabela ele levaria "0 linhas afetadas" — sem erro, sem efeito.
      const { error } = await supabase.rpc('viagem_confirmar_parada', {
        p_parada: paradaId, p_confirmacao: confirmacao, p_notas: notas ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
      qc.invalidateQueries({ queryKey: ['viagem'] })
    },
  })
}

/** Muda o status da viagem inteira (aguardando → pronta → em andamento). */
export function useStatusViagem() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; status: ViagemStatus }>({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from('viagens').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
      qc.invalidateQueries({ queryKey: ['viagens'] })
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
      qc.invalidateQueries({ queryKey: ['viagem'] })
    },
  })
}

/**
 * Grava a localização real E deixa a parada da viagem coerente com ela.
 *
 * Os dois passos juntos de propósito: `cliente_localizacao` é do CLIENTE (vale
 * pra toda viagem futura), mas a parada JÁ SALVA guarda a coordenada antiga em
 * colunas próprias. Gravar só o primeiro deixava o quadro mostrando "aproximada"
 * depois de o vendedor ter corrigido — parecia que não tinha salvado.
 */
export function useCorrigirLocalDaParada() {
  const qc = useQueryClient()
  return useMutation<void, Error, {
    paradaId: string
    /** Não vai pra RPC — ela lê os cli_keys da própria parada, pra ninguém pedir
     *  a correção de um cliente passando a chave de outro. Fica no tipo porque
     *  a UI usa a lista pra dizer "N clientes nessa parada". */
    cliKeys?: string[]
    lat: number
    lng: number
    endereco?: string | null
    fonte?: string | null
  }>({
    mutationFn: async ({ paradaId, lat, lng, endereco, fonte }) => {
      // Uma RPC só, pelo mesmo motivo do confirmar — e porque os dois destinos
      // (cliente_localizacao + a parada) têm que cair juntos: gravar só o
      // primeiro deixava o quadro mostrando "aproximada" depois de corrigido.
      // A função lê os cli_keys da própria parada, então não dá pra pedir a
      // correção de um cliente passando a chave de outro.
      const { error } = await supabase.rpc('viagem_localizacao_parada', {
        p_parada: paradaId, p_lat: lat, p_lng: lng,
        p_endereco: endereco ?? null, p_fonte: fonte ?? 'link_do_cliente',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['viagens-quadro'] })
      qc.invalidateQueries({ queryKey: ['orcamentos-mapa-v2'] })
      qc.invalidateQueries({ queryKey: ['viagem'] })
    },
  })
}
