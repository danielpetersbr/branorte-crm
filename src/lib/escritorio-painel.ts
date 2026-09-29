import { foraDoRanking } from './vendedores-fora-do-ranking'

export function diaComercial(data = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data)
}

export function intervaloDia(dia: string) {
  // Horário comercial brasileiro (UTC−3, sem horário de verão desde 2019).
  const inicio = new Date(`${dia}T00:00:00-03:00`)
  return { inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + 86400_000).toISOString() }
}

const normaliza = (nome: string) => nome.trim().toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ')
const primeiro = (nome: string) => normaliza(nome).split(' ')[0]

/** As RPCs antigas agrupam pelo primeiro nome. Nunca atribuir um grupo a dois vendedores. */
export function nomeCadastrado(fonte: string, nomes: string[]): string | null {
  const exato = nomes.find(n => normaliza(n) === normaliza(fonte))
  if (exato) return exato
  const candidatos = nomes.filter(n => primeiro(n) === normaliza(fonte))
  return candidatos.length === 1 ? candidatos[0] : null
}

export function valorPorNome(mapa: Record<string, number> | null, nome: string, nomes: string[]): number | null {
  if (mapa === null) return null
  const chave = primeiro(nome)
  if (nomes.filter(n => primeiro(n) === chave).length > 1) return null
  return mapa[chave] ?? 0
}

export function atendimentoHoje(row: { atendimentos: number; atualizado_em: string | null } | undefined, dia: string): number | null {
  if (!row?.atualizado_em) return null
  const atualizado = new Date(row.atualizado_em)
  if (!Number.isFinite(atualizado.getTime()) || diaComercial(atualizado) !== dia) return null
  return row.atendimentos
}

export type RankingMesFonte = { vend: string; atendimentos: number; leads: number; orcamentos: number }
export function rankingMensal(rows: RankingMesFonte[], nomes: string[]) {
  return rows.filter(r => !foraDoRanking(r.vend)).map(({ vend, ...numeros }) => {
    const cadastro = nomeCadastrado(vend, nomes)
    return { nome: cadastro ?? vend, ...numeros, historico: cadastro === null }
  })
}
