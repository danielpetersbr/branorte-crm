/**
 * Memo de "conta cara sobre um snapshot + uma chave pequena".
 *
 * Existe por causa do Dashboard (29/09/2026). O `useDashboard` baixa ~18 mil linhas
 * da view (8 páginas de 2.500 em série) e ANTES guardava no cache só o resultado já
 * agregado, com o preset do período dentro da queryKey. Trocar "30 dias" → "Hoje"
 * virava chave nova: rebaixava as 18 mil linhas idênticas (o filtro de período é
 * client-side, o fetch não depende dele) e, enquanto isso, o `placeholderData`
 * mostrava os números de 30 dias já com o carimbo "Hoje" — uns 11 s sob carga.
 *
 * Agora o cache guarda o BRUTO numa chave fixa e cada preset é só um `select` sobre
 * ele. Só que o `select` do react-query é memoizado POR OBSERVER: o cabeçalho, a aba
 * aberta e o /analytics são 2-3 observers, e cada um refaria a mesma agregação sobre
 * 18 mil linhas. Este memo faz a conta UMA vez por (snapshot, chave) e entrega o
 * MESMO objeto a todos.
 *
 * WeakMap no snapshot: quando o refetch troca o bruto, o velho sai do cache do
 * react-query e as agregações dele vão embora junto no GC — não precisa de limpeza.
 */
export function memoPorSnapshot<S extends object, K, V>(
  calc: (snapshot: S, chave: K) => V,
): (snapshot: S, chave: K) => V {
  const cache = new WeakMap<S, Map<K, V>>()
  return (snapshot, chave) => {
    let porChave = cache.get(snapshot)
    if (!porChave) {
      porChave = new Map()
      cache.set(snapshot, porChave)
    }
    if (porChave.has(chave)) return porChave.get(chave) as V
    const valor = calc(snapshot, chave)
    porChave.set(chave, valor)
    return valor
  }
}
