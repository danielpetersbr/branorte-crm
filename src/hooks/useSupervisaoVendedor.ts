import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Central de Supervisão — dados de UM vendedor.
//
// A IA lê as conversas e aponta o que ficou por fazer. Ela NUNCA responde
// cliente e esta tela NUNCA envia mensagem: ela lê, mostra e registra o que o
// gestor decidiu. Quem fala com o cliente é o vendedor, no WhatsApp dele.
//
// O QUE O BANCO PERMITE (medido em 13/08/2026 — não suponha, foi conferido):
//   supervisao_achados           SELECT. Escrita direta REVOGADA.
//                                Encerrar só pela RPC supervisao_encerrar().
//   supervisao_achado_evidencias SELECT (embed pela FK achado_id).
//   supervisao_interacoes        SELECT + INSERT (policy sup_inter_ins).
//   supervisao_feedback          SELECT + INSERT (policy sup_fb_ins).
//   supervisao_regras            SELECT liberado (qual = true).
//   supervisao_compromissos      SELECT apenas — SEM grant de INSERT. Por isso
//                                "Agendar retorno" ainda não tem onde gravar.
//   supervisao_jobs              tem policy mas NÃO tem GRANT pra authenticated:
//                                do front a query falha. Por isso "quantas
//                                conversas eu analisei" sai de wa_chat_labels,
//                                que é a carteira que a varredura percorre.
// ============================================================================

export type Severidade = 'acao' | 'risco' | 'melhoria' | 'oportunidade'
export type Camada = 'deterministica' | 'heuristica' | 'ia'
/** Os 3 únicos valores aceitos por public.supervisao_encerrar(p_como). */
export type ComoEncerrar = 'resolvida' | 'nao_se_aplica' | 'ia_errada'

/** CHECK supervisao_feedback_motivo_check — não invente valor novo. */
export type MotivoFeedback =
  | 'ja_falei_por_telefone' | 'ja_falei_pessoalmente' | 'cliente_desistiu'
  | 'nao_e_cliente' | 'leitura_errada' | 'prazo_errado' | 'duplicado' | 'outro'

/** CHECK supervisao_interacoes_tipo_check. */
export type TipoInteracao =
  | 'ligacao_feita' | 'ligacao_recebida' | 'visita' | 'reuniao' | 'presencial' | 'outro'

export const MOTIVOS_FEEDBACK: { value: MotivoFeedback; label: string }[] = [
  { value: 'leitura_errada',       label: 'A IA leu a conversa errado' },
  { value: 'prazo_errado',         label: 'O prazo/tempo está errado' },
  { value: 'ja_falei_por_telefone', label: 'Já falei com o cliente por telefone' },
  { value: 'ja_falei_pessoalmente', label: 'Já falei com o cliente pessoalmente' },
  { value: 'cliente_desistiu',     label: 'O cliente já desistiu' },
  { value: 'nao_e_cliente',        label: 'Não é cliente (fornecedor, interno, spam)' },
  { value: 'duplicado',            label: 'Repetido — já apareceu em outro apontamento' },
  { value: 'outro',                label: 'Outro motivo' },
]

export const TIPOS_INTERACAO: { value: TipoInteracao; label: string }[] = [
  { value: 'ligacao_feita',    label: 'Liguei para o cliente' },
  { value: 'ligacao_recebida', label: 'O cliente ligou' },
  { value: 'visita',           label: 'Visita' },
  { value: 'reuniao',          label: 'Reunião' },
  { value: 'presencial',       label: 'Atendimento presencial' },
  { value: 'outro',            label: 'Outro contato fora do WhatsApp' },
]

export interface SupervisaoEvidencia {
  id: string
  fonte: string
  ref_tabela: string | null
  ref_id: string | null
  trecho: string | null
  peso: number | null
  ordem: number | null
  ocorrido_em: string | null
}

export interface SupervisaoAchado {
  id: string
  vendedor_id: string
  chat_id: string
  categoria: string
  tags: string[] | null
  severidade: Severidade
  camada: Camada
  regra_key: string
  regra_versao: number
  modelo: string | null
  confianca: number
  titulo: string
  o_que_aconteceu: string | null
  por_que_vendo: string | null
  proxima_acao: string | null
  score: number
  score_motivo: string | null
  estado: string
  qtd_evidencias: number
  detectado_em: string
  atualizado_em: string
  evidencias: SupervisaoEvidencia[]
}

const COLUNAS_ACHADO =
  'id, vendedor_id, chat_id, categoria, tags, severidade, camada, regra_key, regra_versao,' +
  ' modelo, confianca, titulo, o_que_aconteceu, por_que_vendo, proxima_acao, score,' +
  ' score_motivo, estado, qtd_evidencias, detectado_em, atualizado_em'

const COLUNAS_EVIDENCIA = 'id, fonte, ref_tabela, ref_id, trecho, peso, ordem, ocorrido_em'

export function chaveAchados(vendedorId: string | null | undefined) {
  return ['supervisao', 'achados', vendedorId ?? '-'] as const
}

/**
 * Achados ABERTOS do vendedor, com as evidências embutidas (embed pela FK).
 * Ordena por score desc — o achado mais caro primeiro dentro de cada grupo.
 */
export function useAchadosDoVendedor(vendedorId: string | null | undefined) {
  return useQuery({
    queryKey: chaveAchados(vendedorId),
    enabled: !!vendedorId,
    staleTime: 60_000,
    queryFn: async (): Promise<SupervisaoAchado[]> => {
      const { data, error } = await supabase
        .from('supervisao_achados')
        .select(`${COLUNAS_ACHADO}, evidencias:supervisao_achado_evidencias(${COLUNAS_EVIDENCIA})`)
        .eq('vendedor_id', vendedorId!)
        .eq('estado', 'aberta')
        .order('score', { ascending: false })
        .limit(1000)
      if (error) throw error
      const linhas = (data ?? []) as unknown as SupervisaoAchado[]
      // ordena a evidência aqui (mais simples e estável que ordenar o embed)
      return linhas.map(a => ({
        ...a,
        evidencias: [...(a.evidencias ?? [])].sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0)),
      }))
    },
  })
}

/**
 * Quantas conversas existem na carteira do vendedor — é o universo que a
 * varredura percorre (wa_chat_labels é o espelho do WhatsApp dele).
 * Não é "quantas a IA abriu no LLM": nenhuma regra ativa hoje usa modelo.
 */
export function useCarteiraDoVendedor(vendedorNome: string | null | undefined) {
  const nome = (vendedorNome ?? '').trim().toUpperCase()
  return useQuery({
    queryKey: ['supervisao', 'carteira', nome],
    enabled: !!nome,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('wa_chat_labels')
        .select('chat_id', { count: 'exact', head: true })
        .eq('vendedor_nome', nome)
      if (error) throw error
      return count ?? 0
    },
  })
}

export interface RegraSupervisao {
  key: string
  versao: number
  ativo: boolean
  camada: Camada
  severidade: Severidade
  descricao: string
}

/** Catálogo de regras — usado pra explicar no card COMO a regra funciona. */
export function useRegrasSupervisao() {
  return useQuery({
    queryKey: ['supervisao', 'regras'],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Record<string, RegraSupervisao>> => {
      const { data, error } = await supabase
        .from('supervisao_regras')
        .select('key, versao, ativo, camada, severidade, descricao')
      if (error) throw error
      const mapa: Record<string, RegraSupervisao> = {}
      for (const r of (data ?? []) as RegraSupervisao[]) mapa[r.key] = r
      return mapa
    },
  })
}

export interface ChatInfo {
  chat_id: string
  contact_name: string | null
  phone: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_message_from_me: boolean | null
}

/** Dados do contato de UM chat — carregado só quando o drawer abre. */
export function useChatInfo(vendedorNome: string | null | undefined, chatId: string | null) {
  const nome = (vendedorNome ?? '').trim().toUpperCase()
  return useQuery({
    queryKey: ['supervisao', 'chat-info', nome, chatId],
    enabled: !!nome && !!chatId,
    staleTime: 60_000,
    queryFn: async (): Promise<ChatInfo | null> => {
      const { data, error } = await supabase
        .from('wa_chat_labels')
        .select('chat_id, contact_name, phone, last_message_at, last_message_preview, last_message_from_me')
        .eq('vendedor_nome', nome)
        .eq('chat_id', chatId!)
        .maybeSingle()
      if (error) throw error
      return (data as ChatInfo | null) ?? null
    },
  })
}

/** Vendedores com achado aberto — usado quando a URL não traz um id válido. */
export function useVendedoresComAchados() {
  return useQuery({
    queryKey: ['supervisao', 'vendedores-com-achados'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supervisao_achados')
        .select('vendedor_id, severidade, vendors(name)')
        .eq('estado', 'aberta')
        .limit(5000)
      if (error) throw error
      const mapa = new Map<string, { vendedor_id: string; nome: string; total: number }>()
      for (const linha of (data ?? []) as unknown as
        { vendedor_id: string; vendors: { name: string } | null }[]) {
        const atual = mapa.get(linha.vendedor_id)
        if (atual) atual.total += 1
        else mapa.set(linha.vendedor_id, {
          vendedor_id: linha.vendedor_id,
          nome: linha.vendors?.name ?? 'Sem nome',
          total: 1,
        })
      }
      return [...mapa.values()].sort((a, b) => b.total - a.total)
    },
  })
}

// ─── Ações ──────────────────────────────────────────────────────────────────
// Escrita direta em supervisao_achados está revogada: encerrar é SÓ pela RPC.

export function useEncerrarAchado(vendedorId: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { achadoId: string; como: ComoEncerrar; usuarioId: string | null }) => {
      const { error } = await supabase.rpc('supervisao_encerrar', {
        p_achado_id: v.achadoId,
        p_como: v.como,
        p_por: v.usuarioId,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: chaveAchados(vendedorId) }) },
  })
}

/**
 * Registra um contato que aconteceu FORA do WhatsApp e encerra o apontamento.
 *
 * Encerrar junto não é atalho: a própria varredura fecha o achado quando existe
 * interação com ocorrido_em depois do marco da conversa (é uma das condições do
 * PASSO 1 de supervisao_varrer_*). Ou seja, a tela só antecipa o que o motor
 * faria na próxima rodada — em vez de deixar o card mentir na tela até lá.
 */
export function useRegistrarInteracao(vendedorId: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      achadoId: string
      chatId: string
      vendedorId: string
      tipo: TipoInteracao
      ocorridoEm: string
      observacao: string | null
      usuarioId: string | null
    }) => {
      const { error: erroInsert } = await supabase.from('supervisao_interacoes').insert({
        vendedor_id: v.vendedorId,
        chat_id: v.chatId,
        tipo: v.tipo,
        ocorrido_em: v.ocorridoEm,
        observacao: v.observacao,
        criado_por: v.usuarioId,
      })
      if (erroInsert) throw erroInsert
      const { error: erroRpc } = await supabase.rpc('supervisao_encerrar', {
        p_achado_id: v.achadoId,
        p_como: 'resolvida',
        p_por: v.usuarioId,
      })
      if (erroRpc) throw erroRpc
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: chaveAchados(vendedorId) }) },
  })
}

/**
 * "A IA está errada": grava o motivo (é isso que treina a régua) e encerra o
 * achado como ia_errada. As colunas regra_key/regra_versao/camada/confianca são
 * NOT NULL e ficam congeladas com o valor que o achado tinha na hora do erro.
 */
export function useReportarIaErrada(vendedorId: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      achado: SupervisaoAchado
      motivo: MotivoFeedback
      detalhe: string | null
      usuarioId: string | null
    }) => {
      const { error: erroInsert } = await supabase.from('supervisao_feedback').insert({
        achado_id: v.achado.id,
        regra_key: v.achado.regra_key,
        regra_versao: v.achado.regra_versao,
        camada: v.achado.camada,
        modelo: v.achado.modelo,
        confianca_original: v.achado.confianca,
        usuario_id: v.usuarioId,
        motivo: v.motivo,
        detalhe: v.detalhe,
      })
      if (erroInsert) throw erroInsert
      const { error: erroRpc } = await supabase.rpc('supervisao_encerrar', {
        p_achado_id: v.achado.id,
        p_como: 'ia_errada',
        p_por: v.usuarioId,
      })
      if (erroRpc) throw erroRpc
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: chaveAchados(vendedorId) }) },
  })
}
