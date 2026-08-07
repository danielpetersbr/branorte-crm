/**
 * Filtro de PERÍODO do mapa de visitas.
 *
 * Existe porque o acervo de orçamentos vai de 2012 até hoje. Sem um corte, a tela
 * abre com 14 anos de uma vez e a régua de cor do pino (verde ≤1 mês / vermelho
 * 1–3 meses / cinza >3 meses) para de separar qualquer coisa: quase tudo vira cinza.
 *
 * Mora aqui, e não dentro do componente, para poder ser testado — a regra tem
 * fronteiras (365/730/1825) e um caso que é fácil errar: registro SEM data.
 */

export type PeriodoFiltro = '12m' | '24m' | '5a' | 'tudo'

export const PERIODO_DIAS: Record<PeriodoFiltro, number | null> = {
  '12m': 365,
  '24m': 730,
  '5a': 1825,
  tudo: null,
}

export const PERIODO_LABEL: [PeriodoFiltro, string][] = [
  ['12m', '12 meses'], ['24m', '24 meses'], ['5a', '5 anos'], ['tudo', 'Tudo'],
]

// No celular a faixa de filtros rola na horizontal e é disputada: com os rótulos
// longos este grupo sozinho empurrava "Estados" e "Viagem" pra fora da tela.
export const PERIODO_LABEL_CURTO: [PeriodoFiltro, string][] = [
  ['12m', '12m'], ['24m', '24m'], ['5a', '5a'], ['tudo', 'Tudo'],
]

export function rotuloPeriodo(p: PeriodoFiltro): string {
  return PERIODO_LABEL.find(([v]) => v === p)?.[1] ?? ''
}

/** Dias decorridos desde a data. `null` quando não há data ou ela é inválida. */
export function diasDesde(dataISO: string | null | undefined, agora: number = Date.now()): number | null {
  if (!dataISO) return null
  const t = new Date(dataISO.length <= 10 ? dataISO + 'T00:00:00' : dataISO).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((agora - t) / 86400000)
}

/**
 * O registro entra na janela?
 *
 * ⚠️ SEM DATA PASSA SEMPRE. 718 pinos do mapa vêm de `vendas_mapa` sem
 * `data_venda` — 78% daquela tabela foi importada só com nome e cidade. Escondê-los
 * faria o filtro APAGAR CLIENTE REAL em vez de filtrar por idade, que é exatamente
 * o oposto do que ele existe para fazer.
 */
export function passaPeriodo(
  dataISO: string | null | undefined,
  periodo: PeriodoFiltro,
  agora: number = Date.now(),
): boolean {
  const limite = PERIODO_DIAS[periodo]
  if (limite == null) return true          // 'tudo'
  const d = diasDesde(dataISO, agora)
  if (d == null) return true               // sem data: não dá pra julgar, não esconde
  return d <= limite
}
