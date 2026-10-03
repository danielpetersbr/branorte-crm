/** Identifica o projeto que está no editor, inclusive quando foi trocado pela galeria do iframe. */
export function idExternoProjeto(project: unknown): string | null {
  if (!project || typeof project !== 'object') return null
  const id = (project as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id : null
}
