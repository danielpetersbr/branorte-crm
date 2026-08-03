/**
 * Formatação pt-BR do módulo Produção Própria.
 *
 * Regra do projeto: a interface NUNCA mostra número em padrão americano.
 * Internamente os cálculos guardam precisão cheia; o arredondamento pra 2 casas
 * acontece SÓ aqui, na hora de exibir.
 */

/** Troca NaN/Infinity por 0 — nunca deixa vazar pra tela. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** R$ 1.234,56 */
export function brl(v: number, casas = 2): string {
  return num(v).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: casas, maximumFractionDigits: casas,
  })
}

/** R$ 1.235 — pra valores grandes onde centavo é ruído. */
export function brlCurto(v: number): string {
  return num(v).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
}

/** R$ 2,0637 — preço por kg pede mais casas pra não sumir diferença de centavo. */
export function brlKg(v: number, casas = 4): string {
  return `${brl(v, casas)}/kg`
}

/** 1.234,5 */
export function numero(v: number, casas = 0): string {
  return num(v).toLocaleString('pt-BR', {
    minimumFractionDigits: casas, maximumFractionDigits: casas,
  })
}

/** 20,00% */
export function pct(v: number, casas = 2): string {
  return `${num(v).toLocaleString('pt-BR', {
    minimumFractionDigits: casas, maximumFractionDigits: casas,
  })}%`
}

/** 15.000 kg */
export function kg(v: number, casas = 0): string {
  return `${numero(v, casas)} kg`
}

/** 15,0 t */
export function toneladas(v: number, casas = 1): string {
  return `${numero(v, casas)} t`
}

/** 18,4 meses — o prazo de retorno do investimento. */
export function meses(v: number, casas = 1): string {
  const x = num(v)
  if (x <= 0) return '—'
  if (x < 1) return 'menos de 1 mês'
  return `${numero(x, casas)} ${x < 2 ? 'mês' : 'meses'}`
}

/** 1,5 ano / 3,2 anos. */
export function anos(v: number, casas = 1): string {
  const x = num(v)
  if (x <= 0) return '—'
  return `${numero(x, casas)} ${x < 2 ? 'ano' : 'anos'}`
}

/** 250 kg/h */
export function kgHora(v: number): string {
  return `${numero(v, 0)} kg/h`
}

/** DD/MM/AAAA a partir de ISO yyyy-mm-dd (sem passar por Date, que puxa fuso). */
export function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—'
  const somenteData = iso.slice(0, 10)
  const [a, m, d] = somenteData.split('-')
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

/** yyyy-mm-dd de hoje no fuso local (não UTC — senão vira "ontem" de madrugada). */
export function hojeISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** yyyy-mm-dd daqui a N dias. */
export function emDiasISO(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + Math.max(0, Math.round(num(dias))))
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Arredonda pra N casas sem acumular erro de ponto flutuante na exibição. */
export function arredondar(v: number, casas = 2): number {
  const f = 10 ** casas
  return Math.round((num(v) + Number.EPSILON) * f) / f
}
