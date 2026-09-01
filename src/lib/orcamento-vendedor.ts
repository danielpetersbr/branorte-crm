export interface PerfilVendedorOrcamento {
  vendor_id?: string | null
  display_name?: string | null
}

export interface VendedorOrcamento {
  id: string
  name: string
  telefone?: string | null
}

export function resolverVendedorDoOrcamento(
  profile: PerfilVendedorOrcamento | null | undefined,
  vendors: VendedorOrcamento[] | null | undefined,
): { nome: string; telefone: string } {
  const vinculado = vendors?.find((vendor) => vendor.id === profile?.vendor_id)
  const primeiroNome = profile?.display_name?.trim().split(/\s+/)[0]?.toUpperCase() || 'DESCONHECIDO'

  return {
    nome: vinculado?.name?.trim().toUpperCase() || primeiroNome,
    telefone: String(vinculado?.telefone || '').replace(/\D/g, ''),
  }
}
