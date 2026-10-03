export function atualizarNomePerfilAtual<T extends { id: string; display_name: string | null }>(profile: T | null, confirmedId: string, displayName: string): T | null {
  return profile?.id === confirmedId ? { ...profile, display_name: displayName } : profile
}
