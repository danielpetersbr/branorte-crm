// Numero e valor por extenso (pt-BR). O contrato exige "R$ 182.524,00 (cento e
// oitenta e dois mil, quinhentos e vinte e quatro reais)" — sem isso o
// documento sai com lacuna justo no campo que define o preco.

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
const DEZ_A_DEZENOVE = [
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove',
]
const DEZENAS = [
  '', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta',
  'oitenta', 'noventa',
]
const CENTENAS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
]

/** 0..999 por extenso. 100 exato vira "cem" (nao "cento"). */
function ate999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const c = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []
  if (c > 0) partes.push(CENTENAS[c])
  if (resto > 0) {
    if (resto < 10) partes.push(UNIDADES[resto])
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10])
    else {
      const d = Math.floor(resto / 10)
      const u = resto % 10
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d])
    }
  }
  return partes.join(' e ')
}

const ESCALAS: Array<{ sing: string; plur: string }> = [
  { sing: '', plur: '' },
  { sing: 'mil', plur: 'mil' },
  { sing: 'milhão', plur: 'milhões' },
  { sing: 'bilhão', plur: 'bilhões' },
]

/** Inteiro por extenso. Ex.: 182524 -> "cento e oitenta e dois mil, quinhentos e vinte e quatro". */
export function numeroPorExtenso(n: number): string {
  const inteiro = Math.floor(Math.abs(n))
  if (inteiro === 0) return 'zero'

  // Quebra em grupos de 3, do menos significativo pro mais significativo.
  const grupos: number[] = []
  let resto = inteiro
  while (resto > 0) {
    grupos.push(resto % 1000)
    resto = Math.floor(resto / 1000)
  }
  if (grupos.length > ESCALAS.length) return String(inteiro)

  const partes: string[] = []
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]
    if (g === 0) continue
    const escala = ESCALAS[i]
    if (i === 1) {
      // "mil" nao leva "um" na frente: 1.000 = "mil", 2.000 = "dois mil".
      partes.push(g === 1 ? 'mil' : `${ate999(g)} mil`)
    } else if (i === 0) {
      partes.push(ate999(g))
    } else {
      partes.push(`${ate999(g)} ${g === 1 ? escala.sing : escala.plur}`)
    }
  }

  // Ligacao: "e" quando a ultima parte e' menor que cem ou centena redonda;
  // virgula nos demais casos. Segue a norma usada em documentos.
  let texto = partes[0]
  for (let i = 1; i < partes.length; i++) {
    const ultimoGrupo = grupos[grupos.length - 1 - i]
    const usaE = ultimoGrupo < 100 || ultimoGrupo % 100 === 0
    texto += (usaE ? ' e ' : ', ') + partes[i]
  }
  return texto
}

/** Valor monetario por extenso. Ex.: 22816.5 -> "vinte e dois mil, oitocentos e dezesseis reais e cinquenta centavos". */
export function valorPorExtenso(valor: number): string {
  const v = Math.abs(Math.round(valor * 100) / 100)
  const reais = Math.floor(v)
  const centavos = Math.round((v - reais) * 100)

  const partes: string[] = []
  if (reais > 0) {
    partes.push(`${numeroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`)
  }
  if (centavos > 0) {
    partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`)
  }
  if (partes.length === 0) return 'zero reais'
  return partes.join(' e ')
}

/** "R$ 1.234,56" */
export function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
}

/** "R$ 1.234,56 (mil, duzentos e trinta e quatro reais e cinquenta e seis centavos)" */
export function valorComExtenso(v: number): string {
  return `${formatBRL(v)} (${valorPorExtenso(v)})`
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** '2026-09-22' -> 'Grão-Pará/SC, 22 de setembro de 2026.' (so a parte da data) */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return iso || ''
  const [, ano, mes, dia] = m
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`
}

/** '2026-09-22' -> '22/09/2026' */
export function dataBR(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}
