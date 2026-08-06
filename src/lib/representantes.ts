// Territórios de representação comercial da Branorte — 1 dono por UF.
// As 27 UFs estão cobertas, sem sobreposição: mudar um estado aqui muda o mapa,
// o painel de carteira e os totais da página /mapa-representantes.
//
// Cores: escolhidas pra não repetir matiz entre territórios VIZINHOS. O mapa ainda
// desenha um contorno branco entre territórios diferentes (e um fino escuro entre
// estados do mesmo dono), então mesmo tons próximos ficam legíveis.

export interface Representante {
  id: string
  nome: string
  cor: string
  /** rótulo curto da área, só pra leitura humana no painel */
  area: string
  ufs: string[]
}

export const REPRESENTANTES: Representante[] = [
  { id: 'lucas',   nome: 'Lucas',   cor: '#f59e0b', area: 'Nordeste',            ufs: ['BA', 'PE', 'CE', 'RN', 'PB', 'SE', 'AL'] },
  { id: 'eder',    nome: 'Eder',    cor: '#22c55e', area: 'Pará',                ufs: ['PA'] },
  // Representante EXTERNO (06/08/2026). Assumiu MA do Eder e PI do Lucas — por isso
  // as duas UFs saíram das listas deles acima. Cor escolhida longe do verde do Eder
  // e do âmbar do Lucas, que agora são territórios VIZINHOS do dele.
  { id: 'hamurabi', nome: 'Hamurabi', cor: '#0ea5e9', area: 'Maranhão / Piauí',  ufs: ['MA', 'PI'] },
  { id: 'igor',    nome: 'Igor',    cor: '#06b6d4', area: 'Amazônia Norte',      ufs: ['AM', 'AP', 'RR'] },
  { id: 'alvaro',  nome: 'Álvaro',  cor: '#a855f7', area: 'Rondônia / Acre',     ufs: ['RO', 'AC'] },
  { id: 'jardel',  nome: 'Jardel',  cor: '#dc2626', area: 'Mato Grosso',         ufs: ['MT'] },
  { id: 'gustavo', nome: 'Gustavo', cor: '#d946ef', area: 'Tocantins / Goiás',   ufs: ['TO', 'GO', 'DF'] },
  { id: 'ramon',   nome: 'Ramon',   cor: '#3b82f6', area: 'São Paulo / Sudeste', ufs: ['SP', 'MS', 'RJ', 'ES'] },
  { id: 'edilson', nome: 'Edilson', cor: '#84cc16', area: 'Paraná / Minas',      ufs: ['PR', 'MG'] },
  { id: 'pedro',   nome: 'Pedro',   cor: '#f97316', area: 'Rio Grande / Santa Catarina', ufs: ['RS', 'SC'] },
]

/** UF → representante dono. UF fora do mapa = sem dono (pintada de cinza). */
export const DONO_POR_UF: Record<string, Representante> = (() => {
  const m: Record<string, Representante> = {}
  for (const r of REPRESENTANTES) for (const uf of r.ufs) m[uf] = r
  return m
})()

export const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
  PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
}

export const TODAS_UFS = Object.keys(UF_NOME)

/** Sanidade: UFs do Brasil que ninguém cobre. Deve ser [] — a página avisa se não for. */
export const UFS_SEM_DONO = TODAS_UFS.filter(uf => !DONO_POR_UF[uf])

export const COR_SEM_DONO = '#4b5563'
