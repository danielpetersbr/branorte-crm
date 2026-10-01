// Compact transport only: the existing dashboard aggregation still gets the same fields.
export const DASHBOARD_COLUMNS = [
  'id', 'nome', 'telefone', 'responsavel', 'criativo_codigo', 'origem', 'motivo_contato',
  'finalidade_fabrica', 'qual_animal', 'quantos_animais', 'quando_investir', 'tocou_botao_em',
  'o_que_precisa', 'data', 'last_message_at', 'is_internal', 'chegou_no_vendedor',
  'orcamento_enviado', 'orcamento_valor', 'status_real', 'status_vendedor', 'finished_at',
] as const

export function decodeDashboardSnapshot(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') throw new Error('Snapshot do dashboard inválido')
  const { columns, rows } = value as { columns?: unknown; rows?: unknown }
  if (!Array.isArray(columns) || columns.length !== DASHBOARD_COLUMNS.length ||
      !columns.every((c, i) => c === DASHBOARD_COLUMNS[i]) || !Array.isArray(rows)) {
    throw new Error('Formato do dashboard incompatível')
  }
  return rows.map(row => {
    if (!Array.isArray(row) || row.length !== DASHBOARD_COLUMNS.length) {
      throw new Error('Linha do dashboard incompleta')
    }
    return Object.fromEntries(DASHBOARD_COLUMNS.map((column, i) => [column, row[i]]))
  })
}
