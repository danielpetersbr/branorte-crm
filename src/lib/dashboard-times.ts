/** Composição fixa compartilhada pelo placar e pela RPC; alterações exigem deploy. */
export const TIMES_DEF: { nome: string; membros: string[] }[] = [
  { nome: 'Esquadrão Classe A', membros: ['ALVARO', 'IGOR', 'EDER'] },
  { nome: 'Los Melhores', membros: ['JARDEL', 'LUCAS', 'RAMON'] },
  { nome: 'Os Caça Lead', membros: ['PEDRO', 'GUSTAVO', 'EDILSON'] },
]

export const META_TIME = 833_000

export interface AtividadeTime {
  time_nome: string
  ligacoes: number
  clientes_conversados: number
  orcamentos: number
  follow_up: number
  lead_quente: number
}
