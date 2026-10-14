export type ContagemIa = { ligados: number; conversando: number }

export function validarContagemIa(valor: unknown): ContagemIa {
  const dados = valor as Partial<ContagemIa> | null
  if (!dados || !Number.isSafeInteger(dados.ligados) || !Number.isSafeInteger(dados.conversando)
      || (dados.ligados as number) < 0 || (dados.conversando as number) < 0
      || (dados.conversando as number) > (dados.ligados as number)) {
    throw new Error('Não foi possível conferir a contagem de atendimentos da IA.')
  }
  return { ligados: dados.ligados as number, conversando: dados.conversando as number }
}
