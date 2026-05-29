// Mapeamento DDD → UF brasileira. Usado para filtrar atendimentos por estado.
export const DDD_TO_UF: Record<string, string> = {
  '11': 'SP', '12': 'SP', '13': 'SP', '14': 'SP', '15': 'SP',
  '16': 'SP', '17': 'SP', '18': 'SP', '19': 'SP',
  '21': 'RJ', '22': 'RJ', '24': 'RJ',
  '27': 'ES', '28': 'ES',
  '31': 'MG', '32': 'MG', '33': 'MG', '34': 'MG', '35': 'MG', '37': 'MG', '38': 'MG',
  '41': 'PR', '42': 'PR', '43': 'PR', '44': 'PR', '45': 'PR', '46': 'PR',
  '47': 'SC', '48': 'SC', '49': 'SC',
  '51': 'RS', '53': 'RS', '54': 'RS', '55': 'RS',
  '61': 'DF',
  '62': 'GO', '64': 'GO',
  '63': 'TO',
  '65': 'MT', '66': 'MT',
  '67': 'MS',
  '68': 'AC',
  '69': 'RO',
  '71': 'BA', '73': 'BA', '74': 'BA', '75': 'BA', '77': 'BA',
  '79': 'SE',
  '81': 'PE', '87': 'PE',
  '82': 'AL',
  '83': 'PB',
  '84': 'RN',
  '85': 'CE', '88': 'CE',
  '86': 'PI', '89': 'PI',
  '91': 'PA', '93': 'PA', '94': 'PA',
  '92': 'AM', '97': 'AM',
  '95': 'RR',
  '96': 'AP',
  '98': 'MA', '99': 'MA',
}

export function ufFromTelefone(tel: string | null | undefined): string {
  if (!tel) return '—'
  const digits = tel.replace(/\D/g, '')
  if (!digits.startsWith('55') || digits.length < 4) return 'INTL'
  const ddd = digits.substring(2, 4)
  return DDD_TO_UF[ddd] ?? 'INTL'
}

// Mapeamento de DDI (codigo do pais) -> { sigla, nome } pra leads internacionais.
// Para BR (55) retorna a UF brasileira; senao tenta identificar o pais.
const DDI_TO_PAIS: Record<string, { sigla: string; nome: string }> = {
  '54':  { sigla: 'AR', nome: 'Argentina' },
  '595': { sigla: 'PY', nome: 'Paraguai' },
  '598': { sigla: 'UY', nome: 'Uruguai' },
  '56':  { sigla: 'CL', nome: 'Chile' },
  '57':  { sigla: 'CO', nome: 'Colômbia' },
  '51':  { sigla: 'PE', nome: 'Peru' },
  '591': { sigla: 'BO', nome: 'Bolívia' },
  '593': { sigla: 'EC', nome: 'Equador' },
  '58':  { sigla: 'VE', nome: 'Venezuela' },
  '1':   { sigla: 'US', nome: 'EUA/Canadá' },
  '351': { sigla: 'PT', nome: 'Portugal' },
  '34':  { sigla: 'ES', nome: 'Espanha' },
  '52':  { sigla: 'MX', nome: 'México' },
  '49':  { sigla: 'DE', nome: 'Alemanha' },
  '33':  { sigla: 'FR', nome: 'França' },
  '39':  { sigla: 'IT', nome: 'Itália' },
  '44':  { sigla: 'GB', nome: 'Reino Unido' },
}

export function paisDoTelefone(tel: string | null | undefined): { sigla: string; nome: string } | null {
  if (!tel) return null
  const digits = tel.replace(/\D/g, '')
  if (digits.startsWith('55')) return null
  // Match DDI: tenta 3 digitos primeiro, depois 2, depois 1
  for (const len of [3, 2, 1]) {
    const ddi = digits.substring(0, len)
    if (DDI_TO_PAIS[ddi]) return DDI_TO_PAIS[ddi]
  }
  return null
}
