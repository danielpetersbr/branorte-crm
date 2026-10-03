/** Preferências visuais são opcionais: storage bloqueado ou cheio não impede o uso do app. */
export function readBrowserPreference(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key) }
  catch { return null }
}

export function writeBrowserPreference(key: string, value: string): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value) }
  catch { /* A preferência continua aplicada em memória nesta aba. */ }
}
