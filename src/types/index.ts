export interface Vendor {
  id: string
  key: string
  name: string
}

/**
 * Uma linha de `public.contacts`.
 *
 * Este tipo já declarou `temperatura`, `estagio_funil`, `valor_estimado`,
 * `motivo_perda` e `tentativas` — e NENHUM deles é coluna da tabela. Esse dado
 * mora no JSON da primeira linha de `notes` e quem lê é `parseCrmMeta`
 * (src/lib/crm-fields.ts), que devolve `CrmMeta`. Como a query fazia
 * `select('*')`, os cinco chegavam `undefined` em silêncio — ninguém lia, mas o
 * tipo prometia. Não readicionar campo aqui sem coluna correspondente no banco.
 */
export interface Contact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  city: string | null
  state: string | null
  origin: string | null
  notes: string | null
  vendor_id: string | null
  status: string | null
  is_closed: boolean | null
  telefone_normalizado: string | null
  created_at: string
  updated_at: string
  proximo_followup: string | null
  data_orcamento: string | null
  descricao_orcamento: string | null
  /**
   * ÚLTIMA MENSAGEM TROCADA NO WHATSAPP — não é coluna de `public.contacts`.
   *
   * Vem do LEFT JOIN com a matview do WhatsApp que a RPC `contatos_page` faz.
   * NÃO confundir com "último followup": a data de followup do CRM mora no JSON
   * de `notes`, no campo `ultimo` de `CrmMeta`. Quem carrega contato por
   * `select('*')` (ex.: `useContact`) recebe este campo undefined — só
   * `contatos_page` o preenche.
   */
  ultimo_contato: string | null
}

export type ContactSortKey =
  | 'recente'
  | 'antigo'
  | 'nome_az'
  | 'nome_za'
  | 'orcamento_recente'
  | 'orcamento_antigo'
  | 'estado_az'
  | 'ultimo_contato_recente'
  | 'ultimo_contato_antigo'

export interface ContactFilters {
  search: string
  estado: string
  vendor_id: string
  status: string
  orcamento: boolean
  orcamento_ano: string
  orcamento_mes: string
  temperatura: string
  sort: ContactSortKey
  page: number
  // Filtros de WhatsApp (RPC contatos_page). OPCIONAIS de proposito: quem monta
  // este objeto como literal completo passaria a nao compilar se virassem
  // obrigatorios. (Era o caso do Assign.tsx, removido em 2026-08-17; a razao
  // continua valendo pro proximo que montar o filtro na mao.)
  /** So contatos com chat de WhatsApp sincronizado. */
  com_whatsapp?: boolean
  /**
   * Faixa de tempo desde a ULTIMA INTERACAO (contacts.ultima_interacao_em).
   * 'd30' | 'd60' | 'd100' | 'd365' | 'mais' | 'sem'. Vazio = todas.
   * Some-se aos demais filtros, nao os substitui.
   */
  faixa?: string
  /** Etiqueta principal do WhatsApp (valor exato, sem alias). */
  etiqueta?: string
  /** O CLIENTE falou por ultimo e ninguem respondeu. */
  esperando_resposta?: boolean
  /**
   * SEM nenhum orcamento vinculado (nao existe linha em orcamentos_files com
   * este contact_id). Espelha `orcamento`, que e o oposto.
   *
   * ⚠️ Ate 18/08/2026 `orcamento` NAO media orcamento: filtrava
   * `origin ILIKE 'Orcamento%'`, ou seja a ORIGEM DA IMPORTACAO. Deixava de
   * fora 1.300 contatos que tinham orcamento de verdade e incluia 1.423 que
   * nao tinham arquivo nenhum. Os dois hoje olham o vinculo real.
   *
   * Marcar os DOIS devolve zero de proposito (um contato nao pode ter e nao
   * ter orcamento) — a tela impede o par, mas a RPC nao inventa resultado.
   */
  sem_orcamento?: boolean
}

export const CONTACT_SORT_OPTIONS: { value: ContactSortKey; label: string }[] = [
  { value: 'recente',           label: 'Mais recentes' },
  { value: 'antigo',            label: 'Mais antigos' },
  { value: 'nome_az',           label: 'Nome A → Z' },
  { value: 'nome_za',           label: 'Nome Z → A' },
  { value: 'orcamento_recente', label: 'Orçamento mais novo' },
  { value: 'orcamento_antigo',  label: 'Orçamento mais antigo' },
  { value: 'estado_az',         label: 'Estado A → Z' },
  // Ordenar por último contato força o JOIN com a matview do WhatsApp na RPC,
  // ou seja: a lista passa a mostrar SÓ quem tem chat sincronizado (~10,6k).
  { value: 'ultimo_contato_recente', label: 'Último contato (recente)' },
  { value: 'ultimo_contato_antigo',  label: 'Último contato (antigo)' },
]

export const ESTADOS_BR = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
] as const

export const STATUS_OPTIONS = [
  { value: 'ABERTO', label: 'Aberto', color: 'bg-blue-100 text-blue-700' },
  { value: 'QUALIFICADO', label: 'Qualificado', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'NEGOCIANDO', label: 'Negociando', color: 'bg-amber-100 text-amber-700' },
  { value: 'FECHADO', label: 'Fechado', color: 'bg-green-100 text-green-800' },
  { value: 'PERDIDO', label: 'Perdido', color: 'bg-red-100 text-red-700' },
  { value: 'DESCARTADO', label: 'Descartado', color: 'bg-gray-100 text-gray-500' },
  { value: 'novo', label: 'Novo', color: 'bg-cyan-100 text-cyan-700' },
]

export const TEMPERATURA_OPTIONS = [
  { value: 'quente', label: 'Quente', color: 'bg-red-100 text-red-700', icon: '🔴' },
  { value: 'morno', label: 'Morno', color: 'bg-amber-100 text-amber-700', icon: '🟡' },
  { value: 'frio', label: 'Frio', color: 'bg-blue-100 text-blue-700', icon: '🔵' },
  { value: 'vendido', label: 'Vendido', color: 'bg-green-100 text-green-800', icon: '✅' },
  { value: 'perdido', label: 'Perdido', color: 'bg-gray-100 text-gray-500', icon: '❌' },
]

export const FUNIL_OPTIONS = [
  { value: 'novo_lead', label: 'Novo Lead', color: 'bg-slate-100 text-slate-700' },
  { value: 'primeiro_contato', label: '1o Contato', color: 'bg-blue-100 text-blue-700' },
  { value: 'qualificado', label: 'Qualificado', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'proposta_enviada', label: 'Proposta Enviada', color: 'bg-amber-100 text-amber-700' },
  { value: 'negociando', label: 'Negociando', color: 'bg-orange-100 text-orange-700' },
  { value: 'fechado_ganho', label: 'Fechado Ganho', color: 'bg-green-100 text-green-800' },
  { value: 'fechado_perdido', label: 'Fechado Perdido', color: 'bg-red-100 text-red-700' },
]

export const MOTIVO_PERDA_OPTIONS = [
  { value: 'preco', label: 'Preco alto' },
  { value: 'concorrente', label: 'Comprou do concorrente' },
  { value: 'desistiu', label: 'Desistiu do projeto' },
  { value: 'sem_resposta', label: 'Nao respondeu' },
  { value: 'prazo', label: 'Prazo de entrega' },
  { value: 'nao_fabricamos', label: 'Nao fabricamos' },
  { value: 'outro', label: 'Outro' },
]

export const PAGE_SIZE = 50
