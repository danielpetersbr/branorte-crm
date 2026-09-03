import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todasAsLinhas, type PaginaRpc } from '@/lib/rpc-paginado'
import type { Precisao } from '@/lib/viagem'
import type { MapaEtiquetas } from '@/lib/mapa-etiquetas'

export interface Visita {
  id: string
  telefone: string | null
  nome: string | null
  cidade: string | null
  estado: string | null
  interesse: string | null
  vendedor_nome: string | null
  etiquetas: string[] | null
  valor_negociando: number | null
  lat: number | null
  lng: number | null
  created_at: string
}

export function useVisitas() {
  return useQuery<Visita[]>({
    queryKey: ['visitas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cliente_dados_visita')
        .select('id, telefone, nome, cidade, estado, interesse, vendedor_nome, etiquetas, valor_negociando, lat, lng, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Visita[]
    },
  })
}

// Dispara o geocoding dos registros sem coordenada (server-side via Nominatim)
export function useGeocodarVisitas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/geocode-visitas', { method: 'POST' })
      if (!r.ok) throw new Error('Falha no geocoding')
      return r.json() as Promise<{ atualizados: number; pendentes: number; falhas?: string[] }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitas'] }),
  })
}

// ── Camada de ORÇAMENTOS no mapa ──────────────────────────────────────────
// 1 ponto por cliente (telefone): orçamento mais recente define a idade/cor.
// total = valor do orçamento MAIS RECENTE do cliente (não a soma dos orçamentos dele);
// se o cliente já comprou, é a soma das vendas. lat/lng vem do cache de cidade.
export interface OrcamentoPonto {
  cliente: string | null
  telefone: string | null
  fone: string | null
  numeros: string | null
  cidade: string | null
  uf: string | null
  total: number | null
  n_orcamentos: number
  data_recente: string | null
  vendedor: string | null
  // 02/09/2026 — de onde veio o vendedor do pino. 'orcamento' = assinatura/gerador
  // do orçamento; 'whatsapp' = o orçamento não tinha vendedor e o pino herdou o do
  // WhatsApp que etiquetou a conversa (ou falou por último). null = sem vendedor.
  vendedor_fonte?: 'orcamento' | 'whatsapp' | null
  vendido: boolean
  n_vendas: number
  lat: number
  lng: number
  // ── vindos da v2 ──
  // cli_key: identidade estável do cliente (a RPC já calculava internamente; a v2 expõe).
  //   É a chave que a viagem persiste — telefone bruto não serve, 119 clientes têm mais de um.
  // precisao: de onde veio a coordenada. Hoje NENHUM cliente tem 'endereco' — cidade_geocache
  //   e vendas_mapa são ambos por município. 'estado' = a coordenada serve a várias cidades,
  //   então o cliente aparece numa cidade que não é a dele.
  cli_key: string
  precisao: Precisao
}

// contagem real de vendas (pontos) com coordenada — pra reconciliar com o mapa-vendas do controle
export function useVendasMapaCount() {
  return useQuery<number>({
    queryKey: ['vendas-mapa-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('vendas_mapa').select('id', { count: 'exact', head: true }).not('lat', 'is', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

// v2 = mesmas 14 colunas da v1 (verificado: 0 divergências) + cli_key + precisao.
// A v2 faz left join em cliente_localizacao, então confirmar um endereço move o pino
// na hora — basta invalidar esta query.
/**
 * `enabled` existe pro mapa da ORGANIZAÇÃO: lá a base inteira (2.349 clientes) só
 * é buscada quando o usuário abre a caixa de "puxar cliente". Sem parâmetro o
 * comportamento é o de sempre — o /mapa-visitas precisa dela na hora.
 */
/**
 * Os estados que ESTE usuário enxerga. Vazio = sem restrição, vê tudo.
 *
 * Só pra TELA — a restrição de verdade está nas RPCs mapa_orcamentos_v2 e
 * lista_orcamentos_mapa, que filtram por ufs_visiveis() no banco. Isto aqui existe
 * pra o representante saber POR QUE só aparecem dois estados, em vez de achar que
 * o sistema perdeu a carteira dele. A policy de SELECT já só devolve as linhas dele.
 */
export function useUfsVisiveis() {
  return useQuery<string[]>({
    queryKey: ['ufs-visiveis'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // ⚠️ Filtrar pelo usuario e OBRIGATORIO: a policy de SELECT e
      // `user_id = auth.uid() OR is_admin()`, entao o admin le as UFs de TODO
      // MUNDO e o selo "seu acesso e limitado a MA · PI" aparecia pro Daniel com
      // as UFs de um representante (02/09/2026). O banco nao restringe o admin
      // (ufs_visiveis() olha so as linhas dele); era so o selo mentindo.
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return []
      const { data, error } = await supabase.from('usuario_ufs').select('uf').eq('user_id', u.user.id)
      if (error) throw error
      return (data ?? []).map(r => String(r.uf).toUpperCase()).sort()
    },
  })
}


// ── RPCs grandes vêm PAGINADAS até o fim ─────────────────────────────────────
// O PostgREST corta em max_rows (10.000) sem avisar. mapa_etiquetas_wa tem 17 mil
// linhas e lista_orcamentos_mapa 11,8 mil: o mapa mostrava "Sem WhatsApp
// sincronizado" pra cliente com conversa (02/09/2026). Ver lib/rpc-paginado.
type RpcDoMapa = 'mapa_orcamentos_v2' | 'lista_orcamentos_mapa' | 'mapa_etiquetas_wa'
async function paginaRpc<T>(fn: RpcDoMapa, de: number, ate: number): Promise<PaginaRpc<T>> {
  const { data, error, count } = await supabase.rpc(fn, {}, { count: 'exact' }).range(de, ate)
  if (error) throw error
  return { linhas: (data ?? []) as T[], total: count ?? null }
}
export function rpcInteira<T>(fn: RpcDoMapa): Promise<T[]> {
  return todasAsLinhas<T>((de, ate) => paginaRpc<T>(fn, de, ate))
}

export function useOrcamentosMapa(opts?: { enabled?: boolean }) {
  return useQuery<OrcamentoPonto[]>({
    enabled: opts?.enabled ?? true,
    queryKey: ['orcamentos-mapa'],
    queryFn: async () => {
      return rpcInteira<OrcamentoPonto>('mapa_orcamentos_v2')
    },
  })
}

// Lista per-orçamento (tabela + filtro de raio): nº, data, cliente, equipamento, cidade, vendido, coords
export interface OrcamentoLinha {
  numero: string | null
  data_emissao: string | null
  cliente: string | null
  equipamento: string | null
  cidade: string | null
  uf: string | null
  total: number | null
  vendido: boolean
  lat: number | null
  lng: number | null
  // orcamentos_gerados tem vendedor_nome em 100%; vendas_mapa em parte; e desde
  // 02/09/2026 orcamentos_legado.vendedor_nome (2.689 preenchidos) também é lido.
  // Ainda vem null pro legado que o parser não assinou.
  vendedor: string | null
}

export function useListaOrcamentos() {
  return useQuery<OrcamentoLinha[]>({
    queryKey: ['lista-orcamentos-mapa', 'json'],
    queryFn: async () => {
      return rpcInteira<OrcamentoLinha>('lista_orcamentos_mapa')
    },
  })
}

// ── Marcações de VISITA + anotação por cliente ────────────────────────────
// 1 registro por cliente (chave = telefone só-dígitos, ou 'nome:'+slug sem fone).
export interface Marcacao {
  chave: string
  telefone: string | null
  cliente: string | null
  visitado: boolean
  visitado_em: string | null
  nota: string | null
  autor: string | null
  updated_at: string | null
}

// Retorna um mapa chave -> Marcacao pra lookup O(1) no mapa.
export function useMapaMarcacoes() {
  return useQuery<Record<string, Marcacao>>({
    queryKey: ['mapa-marcacoes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mapa_marcacoes')
        .select('chave, telefone, cliente, visitado, visitado_em, nota, autor, updated_at')
      if (error) throw error
      const map: Record<string, Marcacao> = {}
      for (const m of (data ?? []) as Marcacao[]) map[m.chave] = m
      return map
    },
  })
}

export interface SalvarMarcacaoInput {
  chave: string
  telefone?: string | null
  cliente?: string | null
  visitado: boolean
  visitado_em?: string | null // se já visitado, preserva a data original
  nota?: string | null
  autor?: string | null
}

export function useSalvarMarcacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: SalvarMarcacaoInput) => {
      const payload = {
        chave: m.chave,
        telefone: m.telefone ?? null,
        cliente: m.cliente ?? null,
        visitado: m.visitado,
        visitado_em: m.visitado ? (m.visitado_em ?? new Date().toISOString()) : null,
        nota: m.nota ?? null,
        autor: m.autor ?? null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('mapa_marcacoes').upsert(payload, { onConflict: 'chave' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mapa-marcacoes'] }),
  })
}

// ── Etiquetas do WhatsApp por telefone canônico (filtro/modo do /mapa-visitas) ──
// Uma linha por conversa da matview: (fc, principal, todas[]) — ~17 mil linhas,
// ~600 KB. A tela casa com o cliente do mapa por foneCanon(telefone), espelho
// de fone_canon do banco (lib/fone-canon, testado). Papel restrito recebe lista
// vazia — mesma porta da contatos_page.
export function useEtiquetasMapa() {
  return useQuery<MapaEtiquetas>({
    queryKey: ['mapa-etiquetas-wa', 'v2'],
    staleTime: 60_000,
    queryFn: async () => {
      // v2 = UMA linha jsonb. A v1 devolvia tabela e o PostgREST cortava em
      // 10.000 linhas: 7.236 conversas nunca chegavam (medido em prod, 02/09).
      const { data, error } = await supabase.rpc('mapa_etiquetas_wa_v2')
      if (error) throw error
      type Com = { f: string; p: string | null; v: string | null; e: [string, string][] | null }
      const j = (data ?? {}) as { com?: Com[]; sem?: string[] }
      const m: MapaEtiquetas = new Map()
      for (const r of j.com ?? []) {
        if (!r.f) continue
        const pares = (r.e ?? []).filter(x => x && x[0]).map(([t, v]) => [t, (v ?? '').toUpperCase()] as [string, string])
        m.set(r.f, {
          principal: r.p, principalVendedor: r.v ? r.v.toUpperCase() : null,
          todas: [...new Set(pares.map(x => x[0]))], porVendedor: pares,
        })
      }
      for (const f of j.sem ?? []) if (f && !m.has(f)) m.set(f, { principal: null, principalVendedor: null, todas: [], porVendedor: [] })
      return m
    },
  })
}

// Geocoda as cidades de orçamento que ainda não estão no cache (Nominatim, server-side)
export function useGeocodarCidades() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/geocode-cidades', { method: 'POST' })
      if (!r.ok) throw new Error('Falha no geocoding de cidades')
      return r.json() as Promise<{ atualizados: number; pendentes: number; falhas?: string[] }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orcamentos-mapa'] }),
  })
}

// ── Completar a cidade do cliente salvo pelo card da extensão ────────────────

export interface Municipio { nome: string; uf: string }

/**
 * Os 5.571 municípios do IBGE, de uma vez. É a mesma base que o autocomplete da
 * extensão carrega (`cidades-br.js`) e cabe folgado no corte de 10.000 linhas do
 * PostgREST. Filtrar no cliente é o que permite achar "Criciúma" digitando
 * "criciuma" — `ilike` no servidor não tira acento.
 */
export function useMunicipios() {
  return useQuery<Municipio[]>({
    queryKey: ['municipios-ibge'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('municipios_tom_ibge')
        .select('municipio, UF')
        .not('UF', 'is', null)
      if (error) throw error
      const vistos = new Set<string>()
      const lista: Municipio[] = []
      for (const r of (data ?? []) as { municipio: string | null; UF: string | null }[]) {
        const nome = (r.municipio || '').trim()
        const uf = (r.UF || '').trim().toUpperCase()
        if (!nome || !uf) continue
        const k = `${nome.toLowerCase()}|${uf}`
        if (vistos.has(k)) continue // a tabela tem 11 mil linhas, metade sem UF/duplicada
        vistos.add(k)
        lista.push({ nome, uf })
      }
      return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    },
  })
}

/**
 * Grava cidade/UF de um cliente do card "Dados pra visita".
 *
 * Vai por RPC porque `cliente_dados_visita` não tem policy de UPDATE pra
 * `authenticated` — e abrir a tabela inteira pra escrita só pra isso seria demais.
 * A RPC recusa município que não existe no IBGE, grava a grafia OFICIAL (o join do
 * mapa com o cache de coordenada é por texto) e zera lat/lng pro geocode refazer.
 */
export function useDefinirCidadeVisita() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { telefone: string; cidade: string; uf: string }) => {
      const { data, error } = await supabase.rpc('visita_definir_cidade', {
        p_telefone: v.telefone, p_cidade: v.cidade, p_uf: v.uf,
      })
      if (error) throw new Error(error.message)
      const linhas = (data ?? []) as { telefone: string; nome: string | null; cidade: string; estado: string }[]
      if (!linhas.length) throw new Error('não achei esse telefone no cadastro de visitas')
      return linhas[0]
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitas'] }),
  })
}
