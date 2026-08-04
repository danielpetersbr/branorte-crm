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
  '93':   { sigla: 'AF',  nome: 'Afeganistão' },
  '27':   { sigla: 'ZA',  nome: 'África do Sul' },
  '355':  { sigla: 'AL',  nome: 'Albânia' },
  '49':   { sigla: 'DE',  nome: 'Alemanha' },
  '376':  { sigla: 'AD',  nome: 'Andorra' },
  '244':  { sigla: 'AO',  nome: 'Angola' },
  '966':  { sigla: 'SA',  nome: 'Arábia Saudita' },
  '213':  { sigla: 'DZ',  nome: 'Argélia' },
  '54':   { sigla: 'AR',  nome: 'Argentina' },
  '374':  { sigla: 'AM',  nome: 'Armênia' },
  '61':   { sigla: 'AU',  nome: 'Austrália' },
  '43':   { sigla: 'AT',  nome: 'Áustria' },
  '994':  { sigla: 'AZ',  nome: 'Azerbaijão' },
  '880':  { sigla: 'BD',  nome: 'Bangladesh' },
  '32':   { sigla: 'BE',  nome: 'Bélgica' },
  '229':  { sigla: 'BJ',  nome: 'Benin' },
  '375':  { sigla: 'BY',  nome: 'Bielorrússia' },
  '591':  { sigla: 'BO',  nome: 'Bolívia' },
  '387':  { sigla: 'BA',  nome: 'Bósnia' },
  '267':  { sigla: 'BW',  nome: 'Botsuana' },
  '359':  { sigla: 'BG',  nome: 'Bulgária' },
  '226':  { sigla: 'BF',  nome: 'Burquina Faso' },
  '855':  { sigla: 'KH',  nome: 'Camboja' },
  '237':  { sigla: 'CM',  nome: 'Camarões' },
  '974':  { sigla: 'QA',  nome: 'Catar' },
  '7':    { sigla: 'RU',  nome: 'Rússia/Cazaquistão' },
  '235':  { sigla: 'TD',  nome: 'Chade' },
  '56':   { sigla: 'CL',  nome: 'Chile' },
  '86':   { sigla: 'CN',  nome: 'China' },
  '357':  { sigla: 'CY',  nome: 'Chipre' },
  '57':   { sigla: 'CO',  nome: 'Colômbia' },
  '242':  { sigla: 'CG',  nome: 'Congo' },
  '82':   { sigla: 'KR',  nome: 'Coreia do Sul' },
  '225':  { sigla: 'CI',  nome: 'Costa do Marfim' },
  '506':  { sigla: 'CR',  nome: 'Costa Rica' },
  '385':  { sigla: 'HR',  nome: 'Croácia' },
  '53':   { sigla: 'CU',  nome: 'Cuba' },
  '45':   { sigla: 'DK',  nome: 'Dinamarca' },
  '20':   { sigla: 'EG',  nome: 'Egito' },
  '971':  { sigla: 'AE',  nome: 'Emirados Árabes' },
  '593':  { sigla: 'EC',  nome: 'Equador' },
  '421':  { sigla: 'SK',  nome: 'Eslováquia' },
  '386':  { sigla: 'SI',  nome: 'Eslovênia' },
  '34':   { sigla: 'ES',  nome: 'Espanha' },
  '1':    { sigla: 'US',  nome: 'EUA/Canadá' },
  '372':  { sigla: 'EE',  nome: 'Estônia' },
  '251':  { sigla: 'ET',  nome: 'Etiópia' },
  '63':   { sigla: 'PH',  nome: 'Filipinas' },
  '358':  { sigla: 'FI',  nome: 'Finlândia' },
  '33':   { sigla: 'FR',  nome: 'França' },
  '241':  { sigla: 'GA',  nome: 'Gabão' },
  '233':  { sigla: 'GH',  nome: 'Gana' },
  '995':  { sigla: 'GE',  nome: 'Geórgia' },
  '30':   { sigla: 'GR',  nome: 'Grécia' },
  '502':  { sigla: 'GT',  nome: 'Guatemala' },
  '592':  { sigla: 'GY',  nome: 'Guiana' },
  '504':  { sigla: 'HN',  nome: 'Honduras' },
  '36':   { sigla: 'HU',  nome: 'Hungria' },
  '967':  { sigla: 'YE',  nome: 'Iêmen' },
  '91':   { sigla: 'IN',  nome: 'Índia' },
  '62':   { sigla: 'ID',  nome: 'Indonésia' },
  '98':   { sigla: 'IR',  nome: 'Irã' },
  '964':  { sigla: 'IQ',  nome: 'Iraque' },
  '353':  { sigla: 'IE',  nome: 'Irlanda' },
  '354':  { sigla: 'IS',  nome: 'Islândia' },
  '972':  { sigla: 'IL',  nome: 'Israel' },
  '39':   { sigla: 'IT',  nome: 'Itália' },
  '81':   { sigla: 'JP',  nome: 'Japão' },
  '962':  { sigla: 'JO',  nome: 'Jordânia' },
  '254':  { sigla: 'KE',  nome: 'Quênia' },
  '856':  { sigla: 'LA',  nome: 'Laos' },
  '266':  { sigla: 'LS',  nome: 'Lesoto' },
  '371':  { sigla: 'LV',  nome: 'Letônia' },
  '961':  { sigla: 'LB',  nome: 'Líbano' },
  '231':  { sigla: 'LR',  nome: 'Libéria' },
  '218':  { sigla: 'LY',  nome: 'Líbia' },
  '370':  { sigla: 'LT',  nome: 'Lituânia' },
  '352':  { sigla: 'LU',  nome: 'Luxemburgo' },
  '389':  { sigla: 'MK',  nome: 'Macedônia' },
  '261':  { sigla: 'MG',  nome: 'Madagascar' },
  '60':   { sigla: 'MY',  nome: 'Malásia' },
  '265':  { sigla: 'MW',  nome: 'Maláui' },
  '223':  { sigla: 'ML',  nome: 'Mali' },
  '212':  { sigla: 'MA',  nome: 'Marrocos' },
  '222':  { sigla: 'MR',  nome: 'Mauritânia' },
  '52':   { sigla: 'MX',  nome: 'México' },
  '258':  { sigla: 'MZ',  nome: 'Moçambique' },
  '373':  { sigla: 'MD',  nome: 'Moldávia' },
  '976':  { sigla: 'MN',  nome: 'Mongólia' },
  '382':  { sigla: 'ME',  nome: 'Montenegro' },
  '95':   { sigla: 'MM',  nome: 'Myanmar' },
  '264':  { sigla: 'NA',  nome: 'Namíbia' },
  '977':  { sigla: 'NP',  nome: 'Nepal' },
  '505':  { sigla: 'NI',  nome: 'Nicarágua' },
  '227':  { sigla: 'NE',  nome: 'Níger' },
  '234':  { sigla: 'NG',  nome: 'Nigéria' },
  '47':   { sigla: 'NO',  nome: 'Noruega' },
  '64':   { sigla: 'NZ',  nome: 'Nova Zelândia' },
  '968':  { sigla: 'OM',  nome: 'Omã' },
  '31':   { sigla: 'NL',  nome: 'Países Baixos' },
  '92':   { sigla: 'PK',  nome: 'Paquistão' },
  '507':  { sigla: 'PA',  nome: 'Panamá' },
  '675':  { sigla: 'PG',  nome: 'Papua-Nova Guiné' },
  '595':  { sigla: 'PY',  nome: 'Paraguai' },
  '51':   { sigla: 'PE',  nome: 'Peru' },
  '689':  { sigla: 'PF',  nome: 'Polinésia Francesa' },
  '48':   { sigla: 'PL',  nome: 'Polônia' },
  '351':  { sigla: 'PT',  nome: 'Portugal' },
  '44':   { sigla: 'GB',  nome: 'Reino Unido' },
  '236':  { sigla: 'CF',  nome: 'Rep. Centro-Africana' },
  '420':  { sigla: 'CZ',  nome: 'República Tcheca' },
  '1809': { sigla: 'DO',  nome: 'Rep. Dominicana' },
  '40':   { sigla: 'RO',  nome: 'Romênia' },
  '250':  { sigla: 'RW',  nome: 'Ruanda' },
  '221':  { sigla: 'SN',  nome: 'Senegal' },
  '381':  { sigla: 'RS',  nome: 'Sérvia' },
  '232':  { sigla: 'SL',  nome: 'Serra Leoa' },
  '65':   { sigla: 'SG',  nome: 'Singapura' },
  '249':  { sigla: 'SD',  nome: 'Sudão' },
  '46':   { sigla: 'SE',  nome: 'Suécia' },
  '41':   { sigla: 'CH',  nome: 'Suíça' },
  '597':  { sigla: 'SR',  nome: 'Suriname' },
  '66':   { sigla: 'TH',  nome: 'Tailândia' },
  '255':  { sigla: 'TZ',  nome: 'Tanzânia' },
  '228':  { sigla: 'TG',  nome: 'Togo' },
  '216':  { sigla: 'TN',  nome: 'Tunísia' },
  '90':   { sigla: 'TR',  nome: 'Turquia' },
  '380':  { sigla: 'UA',  nome: 'Ucrânia' },
  '256':  { sigla: 'UG',  nome: 'Uganda' },
  '598':  { sigla: 'UY',  nome: 'Uruguai' },
  '58':   { sigla: 'VE',  nome: 'Venezuela' },
  '84':   { sigla: 'VN',  nome: 'Vietnã' },
  '260':  { sigla: 'ZM',  nome: 'Zâmbia' },
  '263':  { sigla: 'ZW',  nome: 'Zimbábue' },
}

/**
 * A MESMA lista acima, com o Brasil na frente, pra quem precisa OFERECER os
 * países (seletor de DDI do orçamento) e não só classificar um número que já
 * chegou. O Brasil não está em DDI_TO_PAIS de propósito — lá o `null` significa
 * "é daqui" — então ele entra aqui explicitamente.
 *
 * Exportar daqui em vez de recriar a lista no orçamento: duas listas divergindo
 * fariam o orçamento aceitar um país que o resto do CRM não sabe classificar.
 */
export const DDIS_CONHECIDOS: Array<{ ddi: string; sigla: string; nome: string }> = [
  { ddi: '55', sigla: 'BR', nome: 'Brasil' },
  ...Object.entries(DDI_TO_PAIS).map(([ddi, p]) => ({ ddi, ...p })),
]

export function paisDoTelefone(tel: string | null | undefined): { sigla: string; nome: string } | null {
  if (!tel) return null
  const bruto = String(tel).trim()
  const digits = bruto.replace(/\D/g, '')
  if (digits.startsWith('55')) return null

  // SÓ CLASSIFICA QUANDO O NÚMERO DE FATO TEM CÓDIGO DE PAÍS.
  //
  // Sem esta trava, telefone brasileiro gravado SEM o 55 era lido como
  // estrangeiro, porque o DDD ocupa a mesma posição do DDI:
  //   (11) 9999-9999 São Paulo        -> "EUA/Canadá"   (DDI 1)
  //   (51) 9999-9999 Porto Alegre     -> "Peru"         (DDI 51)
  //   (54) 9999-9999 Caxias do Sul    -> "Argentina"    (DDI 54)
  //   (34) 9999-9999 Uberlândia       -> "Espanha"      (DDI 34)
  // Isso já saía errado no dashboard e na tela de Atendimentos.
  //
  // Um brasileiro tem 10 ou 11 dígitos sem o país, 12 ou 13 com. Então: ou tem
  // o "+" explícito, ou tem 12+ dígitos. Abaixo disso é daqui.
  //
  // A trava virou OBRIGATÓRIA quando a lista passou de 18 pra 134 países: agora
  // 48 (Polônia) bate com Florianópolis, 27 (África do Sul) com Vitória, 62
  // (Indonésia) com Goiânia. Sem ela, meia lista de DDD viraria país.
  if (!bruto.startsWith('+') && digits.length < 12) return null

  // Match DDI: tenta 4, 3, 2, 1 dígitos — o MAIS LONGO ganha, senão "1" abocanha
  // o começo de "1809" (República Dominicana).
  for (const len of [4, 3, 2, 1]) {
    const ddi = digits.substring(0, len)
    if (DDI_TO_PAIS[ddi]) return DDI_TO_PAIS[ddi]
  }
  return null
}
