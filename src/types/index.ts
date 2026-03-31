export interface Vendor {
  id: string
  key: string
  name: string
}

export type Temperatura = 'quente' | 'morno' | 'frio' | 'vendido' | 'perdido'
export type EstagioFunil = 'novo_lead' | 'primeiro_contato' | 'qualificado' | 'proposta_enviada' | 'negociando' | 'fechado_ganho' | 'fechado_perdido'

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
  // New CRM fields
  temperatura: Temperatura | null
  estagio_funil: EstagioFunil | null
  valor_estimado: number | null
  proximo_followup: string | null
  ultimo_contato: string | null
  motivo_perda: string | null
  tentativas: number | null
}

export interface ContactFilters {
  search: string
  estado: string
  vendor_id: string
  status: string
  orcamento: boolean
  orcamento_ano: string
  temperatura: string
  page: number
}

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
