// CRM fields stored as JSON in the existing 'notes' column
// Format: First line = JSON metadata, rest = human-readable notes
// Example: {"temp":"quente","funil":"proposta_enviada","valor":50000,"followup":"2026-04-15","tentativas":3}
// [31/03/2026] Atendeu - Conversa realizada
// Compacta 03 Master
// Orcamento 2026-0478

export interface CrmMeta {
  temp?: string
  funil?: string
  valor?: number
  followup?: string
  tentativas?: number
  ultimo?: string
  motivo?: string
}

export function parseCrmMeta(notes: string | null): CrmMeta {
  if (!notes) return {}
  const firstLine = notes.split('\n')[0].trim()
  if (firstLine.startsWith('{')) {
    try {
      return JSON.parse(firstLine)
    } catch {}
  }
  return {}
}

export function getHumanNotes(notes: string | null): string {
  if (!notes) return ''
  const lines = notes.split('\n')
  if (lines[0].trim().startsWith('{')) {
    return lines.slice(1).join('\n').trim()
  }
  return notes
}

export function buildNotes(meta: CrmMeta, humanNotes: string): string {
  const metaLine = JSON.stringify(meta)
  return humanNotes ? `${metaLine}\n${humanNotes}` : metaLine
}

export function updateCrmMeta(notes: string | null, updates: Partial<CrmMeta>): string {
  const existing = parseCrmMeta(notes)
  const human = getHumanNotes(notes)
  const merged = { ...existing, ...updates }
  return buildNotes(merged, human)
}

export function addHumanNote(notes: string | null, text: string): string {
  const meta = parseCrmMeta(notes)
  const human = getHumanNotes(notes)
  const dateStr = new Date().toLocaleDateString('pt-BR')
  const newNote = `[${dateStr}] ${text}`
  const updatedHuman = human ? `${newNote}\n${human}` : newNote
  return buildNotes(meta, updatedHuman)
}
