export type ExcecaoCota = {
  vendedor_nome: string
  ignorar_parados: boolean
  expira_em: string | null
  temporario: boolean
}

/** Uma resposta ausente ou incoerente nunca deve virar um botão desligado. */
export function validarExcecoesCota(valor: unknown): ExcecaoCota[] {
  const nomes = new Set<string>()
  if (!Array.isArray(valor)) throw new Error('Não foi possível conferir as liberações de cota.')
  return valor.map((linha: Partial<ExcecaoCota> | null) => {
    if (!linha || typeof linha.vendedor_nome !== 'string' || !linha.vendedor_nome.trim()
        || typeof linha.ignorar_parados !== 'boolean' || typeof linha.temporario !== 'boolean'
        || (linha.expira_em !== null && (typeof linha.expira_em !== 'string' || !Number.isFinite(Date.parse(linha.expira_em))))
        || linha.temporario !== (linha.expira_em !== null)
        || (!linha.ignorar_parados && linha.temporario)
        || nomes.has(linha.vendedor_nome)) {
      throw new Error('Não foi possível conferir as liberações de cota.')
    }
    nomes.add(linha.vendedor_nome)
    return linha as ExcecaoCota
  })
}
