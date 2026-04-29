// Tipos da view `auditoria.atendimentos_por_cliente` (1 row por cliente — agrupa conversas).

export type StatusReal =
  | 'Vendido'
  | 'Em-andamento'
  | 'Aguardando-Vendedor'
  | 'Abandonado'
  | 'Sem-Resposta'
  | 'Perdido'

export const STATUS_REAL_VALUES: StatusReal[] = [
  'Vendido',
  'Em-andamento',
  'Aguardando-Vendedor',
  'Abandonado',
  'Sem-Resposta',
  'Perdido',
]

export interface CriativoFacebookInline {
  codigo: string
  headline: string | null
  image_url: string | null
  source_id: string | null
  source_url: string | null
  nome_oficial: string | null
}

export interface Atendimento {
  id: string
  telefone_norm: string | null
  qtd_conversas: number | null
  primeira_data: string | null
  ultima_msg: string | null
  conversation_ids: string[] | null
  auditoria_ids: string[] | null
  nome: string | null
  telefone: string | null
  responsavel: string | null
  responsavel_user_id: string | null
  chegou_no_vendedor: boolean | null
  criativo_codigo: string | null
  criativo_facebook: CriativoFacebookInline | null
  data: string | null
  channel_type: string | null
  status_atendimento: string | null
  status_real: StatusReal | string | null
  qualificacao: string | null
  funil_de_vendas: string | null
  como_finalizou: string | null
  avaliacao: number | null
  avaliacao_nota: string | null
  cliente_confirmou: boolean | null
  respondeu_a_ia: boolean | null
  tirou_duvidas: boolean | null
  qual_animal: string | null
  quantidade: string | null
  o_que_precisa: string | null
  finalidade_fabrica: string | null
  quantos_animais: string | null
  capacidade_producao: string | null
  quando_investir: string | null
  tocou_botao_em: string | null
  motivo_contato: string | null
  origem: string | null
  needs_enrichment: boolean | null
  is_internal: boolean | null
  last_message_at: string | null
  last_message_text: string | null
  ai_context_summary: string | null
  tentativa_n: number | null
  finished_at: string | null
  orcamento_valor: number | null
  orcamento_enviado: boolean | null
  categoria: string | null
  created_at: string
  updated_at: string
  conversation_id_disparachat: string | null
  contact_id_disparachat: string | null
  channel_id_disparachat: string | null
  dispatch_envio_id: string | null
  dispatch_em: string | null
  dispatch_animal: string | null
  dispatch_mensagem: string | null
  dispatch_status: string | null
  dispatch_etiqueta: string | null
  dispatch_vendedor_nome: string | null
  foi_dispatched: boolean | null
  dispatch_equipamento_avulso: boolean | null
}

export const ATENDIMENTO_PAGE_SIZE = 50
