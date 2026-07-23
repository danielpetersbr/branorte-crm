// ============================================================================
// Tipos e helpers compartilhados da Agenda (calendário + tarefas + lembretes).
// Usado pela página src/pages/Agenda.tsx e pelo notificador global de lembretes.
// ============================================================================

export type AgendaTipo = 'tarefa' | 'lembrete' | 'compromisso'

export interface AgendaItem {
  id: number
  vendedor_nome: string
  tipo: AgendaTipo
  titulo: string
  descricao: string | null
  data: string | null            // 'YYYY-MM-DD'
  hora: string | null            // 'HH:MM[:SS]'
  chat_id: string | null
  contato_nome: string | null
  concluido: boolean
  notificar_wa: boolean
  notificado_wa: boolean
  notificado_app: boolean
  criado_em: string
  atualizado_em: string
}

// Colunas lidas em todas as queries (evita divergência entre page e notifier).
export const AGENDA_SELECT =
  'id, vendedor_nome, tipo, titulo, descricao, data, hora, chat_id, contato_nome, ' +
  'concluido, notificar_wa, notificado_wa, notificado_app, criado_em, atualizado_em'

// 'YYYY-MM-DD' local (sem UTC shift) a partir de um Date.
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

// 'HH:MM' local a partir de um Date.
export function hm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${mm}`
}

// Constrói um Date LOCAL (horário do vendedor = BR) a partir de data + hora.
// Sem hora, assume 09:00 (mesmo default do cron server-side).
export function parseLocalDateTime(dataStr: string, horaStr: string | null): Date {
  const [y, m, d] = dataStr.split('-').map(Number)
  const hmStr = horaStr && horaStr.length >= 4 ? horaStr : '09:00'
  const [hh, mi] = hmStr.split(':').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1, hh || 0, mi || 0, 0, 0)
}

// Escapa os coringas de LIKE (% _ \) pra usar o nome como match case-insensitive
// EXATO no ilike. Sem isso, um vendedor_nome com _ ou % viraria wildcard e casaria
// (vazaria) itens de outro vendedor.
export function likeExato(s: string): string {
  return String(s ?? '').replace(/[\\%_]/g, (c) => '\\' + c)
}
