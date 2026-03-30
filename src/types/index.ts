export interface Vendor {
  id: string
  key: string
  name: string
}

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
  vendors?: { name: string } | null
}

export interface ContactFilters {
  search: string
  estado: string
  vendor_id: string
  status: string
  orcamento: boolean
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

export const PAGE_SIZE = 50
