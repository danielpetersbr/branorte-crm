// Tipos da view `auditoria.atendimentos_por_cliente` (1 row por cliente — agrupa conversas).

export type StatusReal =
  | 'Vendido'
  | 'Em-andamento'
  | 'Aguardando-Vendedor'
  | 'Abandonado'
  | 'Sem-Resposta'
  | 'Perdido'

// Status que o VENDEDOR marca manualmente. Independente do status_real (sistema).
export type StatusVendedor =
  | 'novo'         // lead chegou, vendedor ainda nao atendeu
  | 'atendendo'    // em conversa
  | 'proposta'     // mandou orcamento/proforma
  | 'negociando'   // cliente respondeu, ajustando
  | 'fechou'       // VENDEU
  | 'nao_fechou'   // perdido (concorrente, sem budget, etc.)
  | 'sem_retorno'  // cliente sumiu

export const STATUS_VENDEDOR_VALUES: StatusVendedor[] = [
  'novo', 'atendendo', 'proposta', 'negociando', 'fechou', 'nao_fechou', 'sem_retorno',
]

export interface StatusVendedorMeta {
  value: StatusVendedor
  label: string
  emoji: string
  // Cor HSL (mesma usada nos design tokens)
  bg: string  // background do badge
  fg: string  // texto/borda do badge
}

export const STATUS_VENDEDOR_MAP: Record<StatusVendedor, StatusVendedorMeta> = {
  novo:        { value: 'novo',        label: 'Novo',             emoji: '🆕', bg: 'hsl(240 5% 35%)',  fg: 'hsl(240 6% 90%)' },
  atendendo:   { value: 'atendendo',   label: 'Em atendimento',   emoji: '💬', bg: 'hsl(217 91% 60%)', fg: 'hsl(0 0% 100%)' },
  proposta:    { value: 'proposta',    label: 'Proposta enviada', emoji: '💰', bg: 'hsl(38 92% 50%)',  fg: 'hsl(0 0% 100%)' },
  negociando:  { value: 'negociando',  label: 'Negociando',       emoji: '🤝', bg: 'hsl(28 92% 55%)',  fg: 'hsl(0 0% 100%)' },
  fechou:      { value: 'fechou',      label: 'Fechou',           emoji: '✅', bg: 'hsl(152 60% 40%)', fg: 'hsl(0 0% 100%)' },
  nao_fechou:  { value: 'nao_fechou',  label: 'Não fechou',       emoji: '❌', bg: 'hsl(0 72% 51%)',   fg: 'hsl(0 0% 100%)' },
  sem_retorno: { value: 'sem_retorno', label: 'Sem retorno',      emoji: '😴', bg: 'hsl(240 5% 50%)',  fg: 'hsl(240 6% 90%)' },
}

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
  status_vendedor: StatusVendedor | null
}

export const ATENDIMENTO_PAGE_SIZE = 50
