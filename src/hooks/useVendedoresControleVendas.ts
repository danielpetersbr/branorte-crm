import { useMemo } from 'react'

export interface VendedorControleVendas {
  nome: string
  percentual_comissao: number | null
}

export const normalizarVendedor = (nome?: string | null): string => (nome || '').toUpperCase().trim()

/** Recebe apenas a projeção da API privada da consulta autorizada. */
export function useVendedoresControleVendas(fonte: VendedorControleVendas[]) {
  return useMemo(() => ({ vendedores: [...new Set(fonte.map(v => normalizarVendedor(v.nome)).filter(Boolean))].sort() }), [fonte])
}

export function mesclarVendedoresComDados(cadastrados: string[], nomesNosDados: Array<string | null | undefined>): string[] {
  const nomes = new Set(cadastrados)
  for (const nome of nomesNosDados) {
    const normalizado = normalizarVendedor(nome)
    if (normalizado) nomes.add(normalizado)
  }
  return [...nomes].sort()
}
