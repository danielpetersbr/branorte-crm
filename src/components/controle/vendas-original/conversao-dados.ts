const diaCivilUTC = (data: string | null | undefined): number | null => {
  const dia = data?.slice(0, 10)
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null
  const instante = Date.parse(`${dia}T00:00:00Z`)
  if (!Number.isFinite(instante) || new Date(instante).toISOString().slice(0, 10) !== dia) return null
  return instante
}

/** Datas civis usam calendário UTC; pares incoerentes não participam da conversão. */
export function diasEntreContatoEVenda(
  contato: string | null | undefined,
  venda: string | null | undefined,
): number | null {
  const inicio = diaCivilUTC(contato)
  const fim = diaCivilUTC(venda)
  if (inicio === null || fim === null || inicio > fim) return null
  return (fim - inicio) / 86_400_000
}

export function conversaoNoMesmoMes(
  contato: string | null | undefined,
  venda: string | null | undefined,
): boolean {
  return diasEntreContatoEVenda(contato, venda) !== null && contato?.slice(0, 7) === venda?.slice(0, 7)
}
