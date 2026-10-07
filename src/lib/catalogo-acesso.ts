export const CHAVE_CATALOGO = 'catalogo.editar'

export function permissaoCatalogo(aprovado: boolean, carregado: boolean, legado: boolean, override?: boolean): boolean {
  return aprovado && carregado && (override ?? legado) === true
}

export function rotaCatalogo(path: string): boolean {
  try {
    return decodeURIComponent(path).toLowerCase().replace(/\/+$/, '') === '/orcamentos/catalogo-admin'
  } catch { return false }
}
