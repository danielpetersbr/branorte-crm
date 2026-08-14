import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useVendorMap } from '@/hooks/useVendorMap'

// ============================================================================
// Central de Supervisão — camada de dados.
//
// O que esta tela é: a IA lê as conversas dos vendedores e aponta o que ficou
// por fazer. Ela MOSTRA, SUGERE e deixa COPIAR. Ela NUNCA responde cliente e
// NUNCA envia mensagem — quem envia é o vendedor, no WhatsApp dele. Nenhuma
// função deste arquivo escreve em conversa, fila de disparo ou etiqueta.
//
// ⚠️ O DEFEITO QUE ORIGINOU O PROJETO: tela mostrando retrato velho com cara de
// agora. Por isso TODA leitura daqui carrega `varredura` — quando foi o último
// ciclo do motor e há quantos minutos. A tela tem que poder gritar "SEM SINAL"
// em vez de pintar 718 achados de ontem como se fossem de hoje.
//
// ESCRITA: as tabelas de achado são SELECT-only para `authenticated` (o GRANT de
// UPDATE foi revogado de propósito). Encerrar passa pela RPC
// public.supervisao_encerrar. O que aceita INSERT direto é só
// supervisao_interacoes e supervisao_feedback — o rastro humano, não o achado.
//
// RLS: `is_admin() OR vendedor_id = supervisao_meu_vendor_id()`. Para quem não
// passa, estas queries voltam VAZIAS (não dão erro) — a tela mostra "nada por
// aqui", nunca dado de outro vendedor. Nesta fase a página é admin-only porque
// public.profiles.vendor_id está preenchido em 1 de 17 linhas: o vendedor veria
// tela vazia e concluiria que o sistema não achou nada.
// ============================================================================

// ── Vocabulário do banco (CHECK constraints, medidos — não inventar valor) ───

/** supervisao_achados_severidade_check */
export type SupervisaoSeveridade = 'acao' | 'risco' | 'melhoria' | 'oportunidade'
/** supervisao_achados_camada_check */
export type SupervisaoCamada = 'deterministica' | 'heuristica' | 'ia'
/** supervisao_achados_estado_check */
export type SupervisaoEstado =
  | 'aberta' | 'agendada' | 'resolvida' | 'nao_se_aplica' | 'ia_errada'
/** supervisao_achado_evidencias_fonte_check */
export type SupervisaoFonteEvidencia =
  | 'mensagem' | 'orcamento' | 'crm' | 'interacao' | 'compromisso' | 'estruturado'
/** supervisao_interacoes_tipo_check. ⚠️ NÃO existe 'agendamento' aqui. */
export type SupervisaoInteracaoTipo =
  | 'ligacao_feita' | 'ligacao_recebida' | 'visita' | 'reuniao' | 'presencial' | 'outro'
/** supervisao_feedback_motivo_check */
export type SupervisaoFeedbackMotivo =
  | 'ja_falei_por_telefone' | 'ja_falei_pessoalmente' | 'cliente_desistiu'
  | 'nao_e_cliente' | 'leitura_errada' | 'prazo_errado' | 'duplicado' | 'outro'

/**
 * O que a RPC supervisao_encerrar aceita.
 *
 * ⚠️ A função NÃO valida o texto: qualquer coisa fora de
 * ('nao_se_aplica','ia_errada') cai no ELSE e vira 'resolvida' calada. Ou seja,
 * um typo aqui não estoura — ele encerra o achado com o motivo errado. Por isso
 * o tipo é fechado no TypeScript: é a única barreira que existe.
 */
export type SupervisaoEncerramento = 'resolvida' | 'nao_se_aplica' | 'ia_errada'

/** Estados que ainda pedem alguma coisa de alguém. */
export const ESTADOS_PENDENTES: SupervisaoEstado[] = ['aberta', 'agendada']

/**
 * Ordem de exibição. Verde é OPORTUNIDADE (chance comercial), não "em dia" —
 * ausência de apontamento é cinza e não aparece nesta lista.
 *
 * ⚠️ Hoje 100% dos achados são 'acao': as outras três severidades existem no
 * banco e no desenho, mas nenhuma regra as produz ainda. A tela não deve
 * desenhar quatro faixas fixas e mostrar três zeradas como se fossem notícia.
 */
export const SEVERIDADES: SupervisaoSeveridade[] = ['acao', 'risco', 'melhoria', 'oportunidade']

export const ROTULO_SEVERIDADE: Record<SupervisaoSeveridade, string> = {
  acao: 'precisa de ação',
  risco: 'risco comercial',
  melhoria: 'melhoria de condução',
  oportunidade: 'oportunidade',
}

/**
 * Categoria (coluna `categoria`) → rótulo curto pra frase decomposta do gestor.
 *
 * ⚠️ NUNCA mostrar "9" sozinho: é "3 esperando, 2 follow-ups, 2 parados".
 * ⚠️ `categoria` ≠ `regra_key`. Hoje a regra 'SEGUNDA_TENTATIVA' produz
 * categoria 'follow_up' — quem agrupa a tela é a CATEGORIA.
 * Categoria nova que ainda não estiver neste mapa cai no fallback (troca `_`
 * por espaço) em vez de sumir da conta.
 */
export const ROTULO_CATEGORIA: Record<string, string> = {
  follow_up: 'follow-ups',
  cliente_aguardando: 'esperando resposta',
  orcamento_sem_retorno: 'orçamentos parados',
}

/**
 * Singular de cada rótulo. Sem isto a tela escreve "1 follow-ups" e "1
 * orçamentos parados" — e uma tela que cobra o vendedor não pode errar
 * concordância na própria acusação.
 * `cliente_aguardando` não entra: "esperando resposta" já é invariável.
 */
const ROTULO_CATEGORIA_SINGULAR: Record<string, string> = {
  follow_up: 'follow-up',
  orcamento_sem_retorno: 'orçamento parado',
}

export function rotularCategoria(categoria: string, n?: number): string {
  if (n === 1) {
    const s = ROTULO_CATEGORIA_SINGULAR[categoria]
    if (s) return s
  }
  return ROTULO_CATEGORIA[categoria] ?? categoria.replace(/_/g, ' ')
}

// ── Linhas do banco ─────────────────────────────────────────────────────────

export interface SupervisaoAchado {
  id: string
  vendedor_id: string
  chat_id: string
  categoria: string
  tags: string[]
  severidade: SupervisaoSeveridade
  camada: SupervisaoCamada
  regra_key: string
  regra_versao: number
  modelo: string | null
  /** 0..1 (CHECK no banco). A tela mostra como %. */
  confianca: number
  titulo: string
  o_que_aconteceu: string | null
  por_que_vendo: string | null
  proxima_acao: string | null
  score: number
  score_motivo: string
  score_componentes: Record<string, unknown>
  score_em: string
  estado: SupervisaoEstado
  supressao_ate: string | null
  evento_origem: string
  fingerprint: string | null
  /** quantas vezes a varredura reencontrou este mesmo achado */
  ciclo: number
  qtd_evidencias: number
  agendado_para: string | null
  resolvido_em: string | null
  resolvido_por: string | null
  resolvido_como: string | null
  detectado_em: string
  /** recarimbado a cada ciclo da varredura — é o batimento do motor */
  atualizado_em: string
}

export interface SupervisaoEvidencia {
  id: string
  achado_id: string
  fonte: SupervisaoFonteEvidencia
  ref_tabela: string | null
  ref_id: string | null
  trecho: string | null
  peso: number
  ordem: number
  ocorrido_em: string | null
}

/** O card responde 4 perguntas; a 4ª ("qual a evidência") mora aqui. */
export interface SupervisaoAchadoDetalhe extends SupervisaoAchado {
  evidencias: SupervisaoEvidencia[]
  /** nome do vendedor resolvido no cliente (useVendorMap), não por embed */
  vendedorNome: string
}

const COLUNAS_ACHADO =
  'id, vendedor_id, chat_id, categoria, tags, severidade, camada, regra_key, regra_versao, ' +
  'modelo, confianca, titulo, o_que_aconteceu, por_que_vendo, proxima_acao, score, ' +
  'score_motivo, score_componentes, score_em, estado, supressao_ate, evento_origem, ' +
  'fingerprint, ciclo, qtd_evidencias, agendado_para, resolvido_em, resolvido_por, ' +
  'resolvido_como, detectado_em, atualizado_em'

const COLUNAS_EVIDENCIA =
  'id, achado_id, fonte, ref_tabela, ref_id, trecho, peso, ordem, ocorrido_em'

/** Projeção mínima pra contar. 718 linhas hoje; só o que entra em agregação. */
interface AchadoSlim {
  id: string
  vendedor_id: string
  chat_id: string
  categoria: string
  severidade: SupervisaoSeveridade
  estado: SupervisaoEstado
  score: number
}

const COLUNAS_SLIM = 'id, vendedor_id, chat_id, categoria, severidade, estado, score'

// ── Idade do dado ───────────────────────────────────────────────────────────

/** Até aqui o retrato ainda é "agora". Acima disto a tela avisa. */
export const VARREDURA_FRESCA_MIN = 60
/** Passando disto a tela para de afirmar que isto é o estado atual. */
export const VARREDURA_MUDA_MIN = 360

export type SinalVarredura = 'fresco' | 'atrasado' | 'mudo' | 'sem-registro'

/**
 * De onde saiu o instante da última varredura.
 *
 * 'jobs'    → supervisao_jobs, a fonte de verdade (traz também quantas
 *             conversas foram analisadas).
 * 'achados' → ESTIMATIVA: o maior `atualizado_em` da tabela de achados. O motor
 *             recarimba esse campo em todo achado que reencontra, então o máximo
 *             coincide com o fim do último ciclo. É bom, mas é derivado — a tela
 *             deve dizer "estimado" e NUNCA prometer o número de conversas
 *             analisadas a partir daqui.
 */
export type FonteVarredura = 'jobs' | 'achados'

export interface Varredura {
  /** ISO do fim do último ciclo. null = nunca varreu / não dá pra saber. */
  em: string | null
  fonte: FonteVarredura | null
  /** minutos desde `em`, andando com o relógio (não congela entre refetches) */
  idadeMin: number | null
  sinal: SinalVarredura
  /**
   * Quantas conversas o último ciclo percorreu.
   * ⚠️ null quando supervisao_jobs não é legível — ver `jobsAcessivel`. Null
   * significa OMITIR a frase, não escrever zero.
   */
  conversasAnalisadas: number | null
  /** Há um ciclo em andamento agora. */
  rodando: boolean
  status: 'rodando' | 'ok' | 'parcial' | 'erro' | null
  /** último erro registrado pelo motor, se houve */
  erro: string | null
  /**
   * false = a tabela supervisao_jobs existe e tem policy pra admin, mas NÃO tem
   * GRANT SELECT pra `authenticated` — do CRM ela devolve 42501. Enquanto isso
   * não for corrigido no banco, "N conversas analisadas" não tem fonte e a tela
   * precisa OMITIR o número em vez de inventar denominador.
   */
  jobsAcessivel: boolean
  jobsMotivo: string | null
}

const VARREDURA_VAZIA: Varredura = {
  em: null, fonte: null, idadeMin: null, sinal: 'sem-registro',
  conversasAnalisadas: null, rodando: false, status: null, erro: null,
  jobsAcessivel: false, jobsMotivo: null,
}

/**
 * Relógio que anda sozinho.
 *
 * A idade do dado precisa continuar subindo mesmo quando nada novo chega. Se
 * dependesse só do refetch, um motor parado congelaria a tela em "varrido há
 * 2 min" pra sempre — que é exatamente a mentira que esta tela existe pra matar.
 *
 * (Gêmeo de useAgora() em useMotor.ts. Duplicado de propósito: são duas telas
 * independentes e nenhuma deve quebrar se a outra for removida.)
 */
export function useAgora(ms = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return agora
}

export function classificarVarredura(em: string | null, agora: number): {
  idadeMin: number | null
  sinal: SinalVarredura
} {
  if (!em) return { idadeMin: null, sinal: 'sem-registro' }
  // clamp em 0: o instante é carimbado pelo BANCO. Se o relógio do navegador
  // estiver adiantado, idade negativa apareceria como "varrido no futuro".
  const idadeMin = Math.max(0, (agora - new Date(em).getTime()) / 60_000)
  if (!Number.isFinite(idadeMin)) return { idadeMin: null, sinal: 'sem-registro' }
  if (idadeMin > VARREDURA_MUDA_MIN) return { idadeMin, sinal: 'mudo' }
  if (idadeMin > VARREDURA_FRESCA_MIN) return { idadeMin, sinal: 'atrasado' }
  return { idadeMin, sinal: 'fresco' }
}

/**
 * A LEITURA falhou, ou o MOTOR é que está calado?
 *
 * São coisas opostas e a tela precisa separar. O React Query SEGURA o último
 * `data` quando o refetch falha: com a internet caída, a idade sobe sozinha (o
 * relógio anda), o sinal vira 'mudo' e a tela acusaria "a supervisão parou" com
 * toda a convicção — quando o que caiu foi a rede de quem está olhando.
 * Diagnóstico errado com cara de certeza é a mesma doença que esta tela existe
 * pra curar, só que com o sinal trocado.
 *
 * `failureCount > 0` pega a falha ANTES de ela virar isError (que só acontece
 * depois dos retries), que é justamente a janela em que a idade já subiu.
 */
export type EstadoConexao = 'ok' | 'instavel' | 'offline'

function classificarConexao(q: {
  isError: boolean
  failureCount: number
  fetchStatus: string
}): EstadoConexao {
  if (q.isError) return 'offline'
  if (q.failureCount > 0 || q.fetchStatus === 'paused') return 'instavel'
  return 'ok'
}

/**
 * Envelope padrão de leitura: o dado NUNCA viaja sem a idade dele.
 *
 * `varredura` diz quando o motor passou; `conexao` diz se fui EU que não
 * consegui ler. Sem os dois, um número velho e um número inalcançável ficam
 * visualmente idênticos a um número atual.
 */
export interface Leitura<T> {
  dados: T | undefined
  carregando: boolean
  erro: Error | null
  conexao: EstadoConexao
  varredura: Varredura
  atualizar: () => void
}

// ── Última varredura ────────────────────────────────────────────────────────

interface JobLinha {
  job: string
  status: 'rodando' | 'ok' | 'parcial' | 'erro'
  iniciou_em: string
  terminou_em: string | null
  processados: number
  erro: string | null
}

type VarreduraBruta = Omit<Varredura, 'idadeMin' | 'sinal'>

/** O job guarda-chuva; os outros são as regras individuais. */
const JOB_COMPLETO = 'varrer_tudo'

async function lerVarredura(): Promise<VarreduraBruta> {
  let jobsAcessivel = false
  let jobsMotivo: string | null = null
  let jobs: JobLinha[] = []

  // 1) fonte de verdade. Falha aqui NÃO derruba a tela — degrada pra estimativa.
  const r = await supabase
    .from('supervisao_jobs')
    .select('job, status, iniciou_em, terminou_em, processados, erro')
    .order('id', { ascending: false })
    .limit(20)

  if (r.error) {
    const cod = r.error.code ?? ''
    jobsMotivo = cod === '42501' || /permission denied/i.test(r.error.message)
      ? 'supervisao_jobs não tem GRANT SELECT para authenticated (só service_role). Falta um GRANT no banco ou uma RPC SECURITY DEFINER.'
      : r.error.message
  } else {
    jobsAcessivel = true
    jobs = (r.data ?? []) as unknown as JobLinha[]
  }

  if (jobsAcessivel && jobs.length > 0) {
    const completo = jobs.find(j => j.job === JOB_COMPLETO && j.status !== 'rodando')
    const base = completo ?? jobs.find(j => j.status !== 'rodando') ?? jobs[0]
    return {
      em: base.terminou_em ?? base.iniciou_em,
      fonte: 'jobs',
      // só o job guarda-chuva percorre a base inteira; o de uma regra só percorre
      // a fatia dela e viraria um denominador MENOR que a verdade.
      conversasAnalisadas: completo ? completo.processados : null,
      rodando: jobs.some(j => j.status === 'rodando' && !j.terminou_em),
      status: base.status,
      erro: base.erro,
      jobsAcessivel,
      jobsMotivo,
    }
  }

  // 2) estimativa: o motor recarimba atualizado_em em todo achado que reencontra,
  //    então o máximo da tabela coincide com o fim do último ciclo.
  const est = await supabase
    .from('supervisao_achados')
    .select('atualizado_em')
    .order('atualizado_em', { ascending: false })
    .limit(1)
  if (est.error) throw est.error

  const linha = (est.data ?? [])[0] as { atualizado_em: string } | undefined
  return {
    em: linha?.atualizado_em ?? null,
    fonte: linha ? 'achados' : null,
    conversasAnalisadas: null,
    rodando: false,
    status: null,
    erro: null,
    jobsAcessivel,
    jobsMotivo,
  }
}

/**
 * A idade do dado, isolada numa query própria e barata (≤21 linhas).
 *
 * Fica separada da agregação pesada de propósito: assim o "SEM SINAL" reage sem
 * arrastar as ~718 linhas de achado junto a cada verificação.
 *
 * O intervalo é de 2 min, não de segundos, porque quem faz a idade subir é o
 * RELÓGIO local (useAgora), não o refetch: a tela envelhece sozinha e o refetch
 * só serve pra descobrir que houve ciclo NOVO. Medido hoje, cada ciclo destes
 * inclui uma chamada a supervisao_jobs que volta 401 — bater nela a cada 10s
 * seria pagar invocação pra receber a mesma negativa.
 */
export function useSupervisaoVarredura(): Leitura<Varredura> {
  const agora = useAgora()
  const q = useQuery({
    queryKey: ['supervisao', 'varredura'],
    queryFn: lerVarredura,
    staleTime: 90_000,
    refetchInterval: 120_000,
  })

  const varredura = useMemo<Varredura>(() => {
    if (!q.data) return VARREDURA_VAZIA
    const { idadeMin, sinal } = classificarVarredura(q.data.em, agora)
    return { ...q.data, idadeMin, sinal }
  }, [q.data, agora])

  return {
    dados: q.data ? varredura : undefined,
    carregando: q.isLoading,
    erro: (q.error as Error) ?? null,
    conexao: classificarConexao(q),
    varredura,
    atualizar: () => { void q.refetch() },
  }
}

// ── Base de agregação ───────────────────────────────────────────────────────

/**
 * Puxa TODOS os achados pendentes numa projeção magra e agrega no cliente.
 *
 * Por que no cliente: PostgREST não faz GROUP BY, e as três contas que a tela
 * precisa (por severidade, por categoria, conversas DISTINTAS) sairiam de
 * queries diferentes que podem discordar entre si — números que não fecham na
 * mesma tela é como se ensina o gestor a não confiar em nenhum deles. Uma
 * leitura, uma verdade.
 *
 * Pagina de 1.000 em 1.000 porque o PostgREST pode ter teto de linhas por
 * resposta; sem isso a conta pararia silenciosamente em 1.000 e ninguém veria.
 */
const PAGINA = 1000
/** Teto de segurança. Passando disto a tela avisa que a conta está incompleta. */
const TETO_LINHAS = 10_000

async function lerBase(estados: SupervisaoEstado[]): Promise<{ linhas: AchadoSlim[]; truncado: boolean }> {
  const linhas: AchadoSlim[] = []
  for (let de = 0; de < TETO_LINHAS; de += PAGINA) {
    const { data, error } = await supabase
      .from('supervisao_achados')
      .select(COLUNAS_SLIM)
      .in('estado', estados)
      .order('id', { ascending: true })
      .range(de, de + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as unknown as AchadoSlim[]
    linhas.push(...lote)
    if (lote.length < PAGINA) return { linhas, truncado: false }
  }
  return { linhas, truncado: true }
}

function useBase(estados: SupervisaoEstado[]) {
  const chave = [...estados].sort().join(',')
  return useQuery({
    queryKey: ['supervisao', 'base', chave],
    queryFn: () => lerBase(estados),
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}

function zerado(): Record<SupervisaoSeveridade, number> {
  return { acao: 0, risco: 0, melhoria: 0, oportunidade: 0 }
}

export interface ContagemCategoria {
  categoria: string
  /** rótulo pt-BR pra frase decomposta ("esperando resposta") */
  rotulo: string
  n: number
}

function contarCategorias(linhas: AchadoSlim[]): ContagemCategoria[] {
  const m = new Map<string, number>()
  for (const l of linhas) m.set(l.categoria, (m.get(l.categoria) ?? 0) + 1)
  return [...m.entries()]
    .map(([categoria, n]) => ({ categoria, rotulo: rotularCategoria(categoria, n), n }))
    .sort((a, b) => b.n - a.n || a.categoria.localeCompare(b.categoria))
}

// ── 1. Resumo (home do gestor) ──────────────────────────────────────────────

export interface ResumoSupervisao {
  /** o número da manchete: tudo que ainda pede alguma coisa */
  total: number
  abertas: number
  agendadas: number
  porSeveridade: Record<SupervisaoSeveridade, number>
  /** decomposição global — a manchete nunca deve aparecer sem isto ao lado */
  porCategoria: ContagemCategoria[]
  /** chat_id DISTINTOS com achado pendente. É MENOR que `total`. */
  conversasComAchado: number
  vendedoresComAchado: number
  /** true = bateu o teto de linhas; as contas estão POR BAIXO (mostre "mais de"). */
  truncado: boolean
}

export function useSupervisaoResumo(
  estados: SupervisaoEstado[] = ESTADOS_PENDENTES,
): Leitura<ResumoSupervisao> {
  const q = useBase(estados)
  const { varredura } = useSupervisaoVarredura()

  const dados = useMemo<ResumoSupervisao | undefined>(() => {
    if (!q.data) return undefined
    const { linhas, truncado } = q.data
    const porSeveridade = zerado()
    const chats = new Set<string>()
    const vends = new Set<string>()
    let abertas = 0
    let agendadas = 0
    for (const l of linhas) {
      porSeveridade[l.severidade] += 1
      chats.add(l.chat_id)
      vends.add(l.vendedor_id)
      if (l.estado === 'aberta') abertas++
      else if (l.estado === 'agendada') agendadas++
    }
    return {
      total: linhas.length,
      abertas,
      agendadas,
      porSeveridade,
      porCategoria: contarCategorias(linhas),
      conversasComAchado: chats.size,
      vendedoresComAchado: vends.size,
      truncado,
    }
  }, [q.data])

  return {
    dados,
    carregando: q.isLoading,
    erro: (q.error as Error) ?? null,
    conexao: classificarConexao(q),
    varredura,
    atualizar: () => { void q.refetch() },
  }
}

// ── 2. Por vendedor (quem precisa de atenção) ───────────────────────────────

/**
 * Uma linha da lista "quem precisa de atenção".
 *
 * ⚠️ `total` e `conversasComAchado` são números DIFERENTES: uma conversa gera
 * vários achados. ⚠️ `porCategoria` não é enfeite — o total sozinho ("9") não
 * diz se são 9 clientes esperando resposta ou 9 follow-ups vencidos.
 */
export interface VendedorSupervisao {
  vendedorId: string
  /** '—' quando o id não está em vendors (vendedor removido) — nunca some da lista */
  nome: string
  total: number
  porSeveridade: Record<SupervisaoSeveridade, number>
  porCategoria: ContagemCategoria[]
  conversasComAchado: number
  maiorScore: number
}

function agregarPorVendedor(
  linhas: AchadoSlim[],
  nomes: Record<string, string>,
): VendedorSupervisao[] {
  const porVend = new Map<string, AchadoSlim[]>()
  for (const l of linhas) {
    const arr = porVend.get(l.vendedor_id)
    if (arr) arr.push(l)
    else porVend.set(l.vendedor_id, [l])
  }
  return [...porVend.entries()]
    .map(([vendedorId, doVend]) => {
      const porSeveridade = zerado()
      const chats = new Set<string>()
      let maiorScore = 0
      for (const l of doVend) {
        porSeveridade[l.severidade] += 1
        chats.add(l.chat_id)
        if (l.score > maiorScore) maiorScore = l.score
      }
      return {
        vendedorId,
        nome: nomes[vendedorId] ?? '—',
        total: doVend.length,
        porSeveridade,
        porCategoria: contarCategorias(doVend),
        conversasComAchado: chats.size,
        maiorScore,
      }
    })
    .sort((a, b) => b.total - a.total || b.maiorScore - a.maiorScore || a.nome.localeCompare(b.nome))
}

export function useSupervisaoPorVendedor(
  estados: SupervisaoEstado[] = ESTADOS_PENDENTES,
): Leitura<VendedorSupervisao[]> {
  const q = useBase(estados)
  const { varredura } = useSupervisaoVarredura()
  const nomes = useVendorMap()

  const dados = useMemo<VendedorSupervisao[] | undefined>(
    () => (q.data ? agregarPorVendedor(q.data.linhas, nomes) : undefined),
    [q.data, nomes],
  )

  return {
    dados,
    carregando: q.isLoading,
    erro: (q.error as Error) ?? null,
    conexao: classificarConexao(q),
    varredura,
    atualizar: () => { void q.refetch() },
  }
}

// ── 3. Lista de achados (com evidências) ────────────────────────────────────

export interface FiltroAchados {
  vendedorId?: string | null
  severidade?: SupervisaoSeveridade | null
  categoria?: string | null
  estado?: SupervisaoEstado[] | null
  chatId?: string | null
  /** teto de cards. Acima disto a tela avisa que cortou. */
  limite?: number
}

export interface ListaAchados {
  itens: SupervisaoAchadoDetalhe[]
  /** true = havia mais que `limite`; a lista está CORTADA, não completa. */
  truncado: boolean
  limite: number
}

const LIMITE_PADRAO = 100

/** Linha crua com o embed de evidências, antes de resolver o nome do vendedor. */
type AchadoComEmbed = SupervisaoAchado & {
  supervisao_achado_evidencias: SupervisaoEvidencia[] | null
}

export function useSupervisaoAchados(filtro: FiltroAchados = {}): Leitura<ListaAchados> {
  const {
    vendedorId = null, severidade = null, categoria = null,
    estado = null, chatId = null, limite = LIMITE_PADRAO,
  } = filtro
  const estados = estado && estado.length > 0 ? estado : ESTADOS_PENDENTES
  const { varredura } = useSupervisaoVarredura()
  const nomes = useVendorMap()

  const q = useQuery({
    queryKey: [
      'supervisao', 'achados',
      { vendedorId, severidade, categoria, chatId, limite, estados: [...estados].sort().join(',') },
    ],
    queryFn: async (): Promise<{ linhas: AchadoComEmbed[]; truncado: boolean }> => {
      let sel = supabase
        .from('supervisao_achados')
        // embed pela FK supervisao_achado_evidencias_achado_id_fkey
        .select(`${COLUNAS_ACHADO}, supervisao_achado_evidencias(${COLUNAS_EVIDENCIA})`)
        .in('estado', estados)

      if (vendedorId) sel = sel.eq('vendedor_id', vendedorId)
      if (severidade) sel = sel.eq('severidade', severidade)
      if (categoria) sel = sel.eq('categoria', categoria)
      if (chatId) sel = sel.eq('chat_id', chatId)

      const { data, error } = await sel
        .order('score', { ascending: false })
        // desempate estável: sem isto, dois achados de mesmo score trocam de
        // lugar entre refetches e a lista "pisca" sem nada ter mudado.
        .order('detectado_em', { ascending: false })
        .order('ordem', { ascending: true, referencedTable: 'supervisao_achado_evidencias' })
        // +1 pra saber se sobrou, sem pagar um count() na tabela inteira
        .limit(limite + 1)

      if (error) throw error
      const linhas = (data ?? []) as unknown as AchadoComEmbed[]
      return { linhas: linhas.slice(0, limite), truncado: linhas.length > limite }
    },
    staleTime: 60_000,
  })

  const dados = useMemo<ListaAchados | undefined>(() => {
    if (!q.data) return undefined
    return {
      itens: q.data.linhas.map(l => {
        const { supervisao_achado_evidencias, ...achado } = l
        return {
          ...achado,
          evidencias: supervisao_achado_evidencias ?? [],
          vendedorNome: nomes[l.vendedor_id] ?? '—',
        }
      }),
      truncado: q.data.truncado,
      limite,
    }
  }, [q.data, nomes, limite])

  return {
    dados,
    carregando: q.isLoading,
    erro: (q.error as Error) ?? null,
    conexao: classificarConexao(q),
    varredura,
    atualizar: () => { void q.refetch() },
  }
}

// ── 4. Cabeçalho de auditoria ───────────────────────────────────────────────

/**
 * "Analisei N conversas de X e encontrei M situações relevantes."
 *
 * ⚠️ São TRÊS números diferentes e a tela precisa dos três SEPARADOS:
 *   conversasAnalisadas  — o denominador (o que a varredura percorreu)
 *   conversasComAchado   — quantas conversas têm ao menos um apontamento
 *   achados              — quantos apontamentos (uma conversa gera vários)
 *
 * ⚠️ `conversasAnalisadas` vem de supervisao_jobs e hoje é NULL no CRM (sem
 * GRANT). E é sempre NULL quando se pede um vendedor específico: o job conta a
 * base inteira e NÃO quebra por vendedor. Usar a carteira do vendedor como
 * denominador seria inventar — a varredura não olha todos os chats dele.
 * Enquanto for null, a frase honesta é "encontrei M situações em C conversas",
 * sem denominador.
 */
export interface AuditoriaSupervisao {
  vendedorId: string | null
  vendedorNome: string | null
  conversasAnalisadas: number | null
  /** por que o denominador está faltando — texto pronto pra tela */
  conversasAnalisadasMotivo: string | null
  conversasComAchado: number
  achados: number
  porSeveridade: Record<SupervisaoSeveridade, number>
  porCategoria: ContagemCategoria[]
  /** analisadas − comAchado. null quando não há denominador confiável. */
  semApontamento: number | null
}

export function useSupervisaoAuditoria(
  vendedorId: string | null = null,
  estados: SupervisaoEstado[] = ESTADOS_PENDENTES,
): Leitura<AuditoriaSupervisao> {
  const q = useBase(estados)
  const { varredura } = useSupervisaoVarredura()
  const nomes = useVendorMap()

  const dados = useMemo<AuditoriaSupervisao | undefined>(() => {
    if (!q.data) return undefined
    const linhas = vendedorId
      ? q.data.linhas.filter(l => l.vendedor_id === vendedorId)
      : q.data.linhas

    const porSeveridade = zerado()
    const chats = new Set<string>()
    for (const l of linhas) {
      porSeveridade[l.severidade] += 1
      chats.add(l.chat_id)
    }

    let analisadas: number | null = null
    let motivo: string | null = null
    if (vendedorId) {
      motivo = 'A varredura conta a base inteira e não quebra por vendedor.'
    } else if (!varredura.jobsAcessivel) {
      motivo = varredura.jobsMotivo ?? 'Sem acesso ao registro de varreduras.'
    } else if (varredura.conversasAnalisadas === null) {
      motivo = 'O último ciclo registrado foi de uma regra só, não da base inteira.'
    } else {
      analisadas = varredura.conversasAnalisadas
    }

    return {
      vendedorId,
      vendedorNome: vendedorId ? (nomes[vendedorId] ?? '—') : null,
      conversasAnalisadas: analisadas,
      conversasAnalisadasMotivo: motivo,
      conversasComAchado: chats.size,
      achados: linhas.length,
      porSeveridade,
      porCategoria: contarCategorias(linhas),
      semApontamento: analisadas === null ? null : Math.max(0, analisadas - chats.size),
    }
  }, [
    q.data, vendedorId, nomes,
    varredura.jobsAcessivel, varredura.jobsMotivo, varredura.conversasAnalisadas,
  ])

  return {
    dados,
    carregando: q.isLoading,
    erro: (q.error as Error) ?? null,
    conexao: classificarConexao(q),
    varredura,
    atualizar: () => { void q.refetch() },
  }
}

// ── Escrita ─────────────────────────────────────────────────────────────────
//
// Três gestos, e nenhum deles fala com o cliente. O que sai daqui é rastro de
// supervisão: "isto já foi tratado", "liguei", "a IA leu errado".

/** Invalida tudo que conta achado. Chamado por toda mutation. */
function useInvalidarSupervisao() {
  const qc = useQueryClient()
  return () => { void qc.invalidateQueries({ queryKey: ['supervisao'] }) }
}

function traduzirErroEscrita(e: { code?: string; message: string }): Error {
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message)) {
    return new Error('Sem permissão pra registrar isso. A supervisão é restrita ao admin e ao vendedor dono da conversa.')
  }
  if (e.code === 'PGRST202') {
    return new Error('A função supervisao_encerrar não existe neste banco — a migration da Supervisão não foi aplicada.')
  }
  if (e.code === '23514') {
    return new Error('Valor recusado pelo banco (fora da lista permitida). Isso é bug de código, não do usuário.')
  }
  return new Error(e.message)
}

export interface EncerrarAchado {
  achadoId: string
  como: SupervisaoEncerramento
}

/**
 * Encerra um achado. Único caminho de escrita no achado.
 *
 * O GRANT de UPDATE em supervisao_achados foi revogado de propósito: se a tela
 * pudesse dar UPDATE direto, "resolvido" viraria um campo editável e o histórico
 * de quem encerrou o quê deixaria de existir. A RPC é SECURITY DEFINER e carimba
 * resolvido_em / resolvido_por / resolvido_como.
 */
export function useEncerrarAchado() {
  const { session } = useAuth()
  const invalidar = useInvalidarSupervisao()
  return useMutation({
    mutationKey: ['supervisao', 'encerrar'],
    mutationFn: async ({ achadoId, como }: EncerrarAchado) => {
      // ⚠️ nomes de argumento EXATOS: o PostgREST resolve RPC por nome.
      const { error } = await supabase.rpc('supervisao_encerrar', {
        p_achado_id: achadoId,
        p_como: como,
        p_por: session?.user?.id ?? null,
      })
      if (error) throw traduzirErroEscrita(error)
      return achadoId
    },
    onSuccess: invalidar,
  })
}

export interface NovaInteracao {
  vendedorId: string
  chatId: string
  tipo: SupervisaoInteracaoTipo
  /** ISO. NOT NULL sem default no banco — se omitido, vai "agora". */
  ocorridoEm?: string
  observacao?: string | null
  /**
   * Encerra também este achado como 'resolvida', no mesmo gesto.
   * É o caso "já liguei pra ele": registrar a ligação e deixar o card gritando
   * seria pedir pro gestor fazer a mesma coisa duas vezes.
   */
  encerrarAchadoId?: string | null
}

/**
 * Registra ligação / visita / reunião — o que aconteceu FORA do WhatsApp.
 *
 * É isto que impede a supervisão de acusar abandono numa conversa que foi
 * resolvida no telefone. A IA não enxerga ligação; alguém precisa contar.
 *
 * ⚠️ NÃO existe tipo 'agendamento' no CHECK da tabela. "Agendar retorno" não tem
 * onde ser gravado hoje: supervisao_compromissos é SELECT-only pra
 * `authenticated` e supervisao_encerrar não sabe marcar 'agendada'. Registrar um
 * agendamento como 'outro' seria fingir que ficou guardado — a tela deve
 * desabilitar o botão até existir caminho de escrita.
 */
export function useRegistrarInteracao() {
  const { session } = useAuth()
  const invalidar = useInvalidarSupervisao()
  return useMutation({
    mutationKey: ['supervisao', 'interacao'],
    mutationFn: async (i: NovaInteracao) => {
      const { error } = await supabase.from('supervisao_interacoes').insert({
        vendedor_id: i.vendedorId,
        chat_id: i.chatId,
        tipo: i.tipo,
        ocorrido_em: i.ocorridoEm ?? new Date().toISOString(),
        observacao: i.observacao?.trim() || null,
        criado_por: session?.user?.id ?? null,
      })
      if (error) throw traduzirErroEscrita(error)

      if (i.encerrarAchadoId) {
        const r = await supabase.rpc('supervisao_encerrar', {
          p_achado_id: i.encerrarAchadoId,
          p_como: 'resolvida',
          p_por: session?.user?.id ?? null,
        })
        // a interação JÁ foi gravada; não desfazer. Só avisa que o card continua
        // aberto, em vez de mentir que fechou.
        if (r.error) {
          throw new Error(`Interação registrada, mas o achado continua aberto: ${r.error.message}`)
        }
      }
      return true
    },
    onSuccess: invalidar,
  })
}

export interface ErroIA {
  /** o achado inteiro (ou só os metadados da regra que o gerou) */
  achado: Pick<SupervisaoAchado, 'id' | 'regra_key' | 'regra_versao' | 'camada' | 'modelo' | 'confianca'>
  motivo: SupervisaoFeedbackMotivo
  detalhe?: string | null
}

/**
 * "A IA está errada" — o combustível de calibragem da regra.
 *
 * Grava o feedback COM a versão da regra, a camada e a confiança do momento: sem
 * isso não dá pra saber depois se o erro veio de um limiar, de um modelo ou de
 * uma regra que já mudou desde então.
 *
 * Encerra o achado como 'ia_errada' no mesmo gesto, de propósito. Feedback sem
 * encerramento deixaria o mesmo card errado gritando todo dia, e o gestor
 * aprenderia a ignorar a tela inteira.
 */
export function useReportarErroIA() {
  const { session } = useAuth()
  const invalidar = useInvalidarSupervisao()
  return useMutation({
    mutationKey: ['supervisao', 'erro-ia'],
    mutationFn: async ({ achado, motivo, detalhe }: ErroIA) => {
      const { error } = await supabase.from('supervisao_feedback').insert({
        achado_id: achado.id,
        regra_key: achado.regra_key,
        regra_versao: achado.regra_versao,
        camada: achado.camada,
        modelo: achado.modelo,
        confianca_original: achado.confianca,
        usuario_id: session?.user?.id ?? null,
        motivo,
        detalhe: detalhe?.trim() || null,
      })
      if (error) throw traduzirErroEscrita(error)

      const r = await supabase.rpc('supervisao_encerrar', {
        p_achado_id: achado.id,
        p_como: 'ia_errada',
        p_por: session?.user?.id ?? null,
      })
      if (r.error) {
        throw new Error(`Aviso registrado, mas o card continua aberto: ${r.error.message}`)
      }
      return achado.id
    },
    onSuccess: invalidar,
  })
}
