/**
 * Recorte de uma consulta pelo PERÍODO do filtro do Dashboard — as DUAS pontas.
 *
 * Existe porque os hooks de proposta aplicavam só o começo (`.gte`). Nos presets
 * que terminam antes de agora — "Ontem" e o período personalizado — isso somava
 * tudo até o instante da consulta: "Ontem" às 17h incluía o que foi montado HOJE,
 * e 01/08–15/08 virava 01/08–hoje. O número grande do mesmo card (RPC
 * dashboard_orcamentos_periodo, que recebe p_to) já recortava certo, então os dois
 * números do card mediam janelas diferentes (29/09/2026).
 *
 * O intervalo NÃO é calculado aqui: vem de `rangeForPreset` (hooks/useDashboard),
 * a mesma definição que o resto do Dashboard usa — hora local do navegador, que é
 * America/Sao_Paulo para quem usa o CRM. Esta função só garante que o fim não se
 * perca no caminho até a query; mora em lib/ para poder ser testada sem subir o
 * client do Supabase.
 */

export interface IntervaloPeriodo {
  from: Date
  to: Date
}

/** O mínimo de um query builder do PostgREST que o recorte usa. */
export interface ConsultaRecortavel<Q> {
  gte(coluna: string, valor: string): Q
  lte(coluna: string, valor: string): Q
}

/**
 * Aplica `coluna >= from` E `coluna <= to`. Sem intervalo ("Tudo") devolve a
 * consulta intacta. O `to` do rangeForPreset é o último milissegundo do dia
 * (23:59:59.999), por isso `lte` e não `lt`.
 */
export function recortarPeriodo<Q extends ConsultaRecortavel<Q>>(
  q: Q,
  coluna: string,
  intervalo: IntervaloPeriodo | null,
): Q {
  if (!intervalo) return q
  return q.gte(coluna, intervalo.from.toISOString()).lte(coluna, intervalo.to.toISOString())
}

/**
 * Mesmo período, no formato das RPCs do Dashboard que recebem `p_from`/`p_to` e
 * recortam `created_at >= p_from AND created_at < p_to` — fim EXCLUSIVO (é o caso
 * de dashboard_propostas_status, conferido no banco em 29/09/2026). Por isso o
 * `p_to` é o `to` do rangeForPreset + 1 ms: 23:59:59.999 vira 00:00:00.000 do dia
 * seguinte, e nada do último milissegundo do dia fica de fora. Sem intervalo
 * ("Tudo") manda os dois nulos, que a RPC trata como "sem limite".
 */
export function paramsRpcPeriodo(
  intervalo: IntervaloPeriodo | null,
): { p_from: string | null; p_to: string | null } {
  if (!intervalo) return { p_from: null, p_to: null }
  return {
    p_from: intervalo.from.toISOString(),
    p_to: new Date(intervalo.to.getTime() + 1).toISOString(),
  }
}
