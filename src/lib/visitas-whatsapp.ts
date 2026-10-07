const nomeVendedor = (nome: string | null | undefined) => (nome || '').trim().toUpperCase()

export function vendedorVisitaCorresponde(registro: string | null, vendedor: string): boolean {
  return !!nomeVendedor(vendedor) && (nomeVendedor(registro) || '—') === nomeVendedor(vendedor)
}

export function entradaVisitasWhatsApp(params: URLSearchParams) {
  const ativo = params.get('origem') === 'whatsapp'
  return { ativo, vendedor: ativo ? nomeVendedor(params.get('vendedor')) : '' }
}

export function filtrarVisitasWhatsApp<T extends { visitar: boolean | null; vendedor_nome: string | null }>(
  clientes: T[], vendedor: string | null, soMarcados: boolean,
): T[] {
  return clientes.filter(c => (!soMarcados || c.visitar === true) &&
    (vendedor === null || vendedorVisitaCorresponde(c.vendedor_nome, vendedor)))
}

/** Copia pro clipboard; devolve false se o navegador recusou (aba sem foco, http). */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
