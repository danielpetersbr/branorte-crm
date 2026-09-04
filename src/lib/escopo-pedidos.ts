// ============================================================================
// QUEM VÊ QUAIS PEDIDOS.
//
// Isto existe porque a lista /controle/pedidos nasceu SEM recorte: os 9 usuários
// com `role = 'vendor'` abriam a tela e liam os 508 pedidos da empresa — nome do
// cliente, valor e o negócio dos colegas. Na tela do controle.branorte.com o
// vendedor vê só os dele (`vendedorFiltro` trava no nome dele e o seletor nem
// aparece); aqui não travava nada.
//
// ⚠️ O BANCO NÃO SEGURA ISSO. `mirror_pedidos_venda` tem `mirror_pv_sel` com
// `USING (true)` para `authenticated`, e a única policy restritiva
// (`bloqueia_papel_restrito` → `papel_restrito()`) cobre só `mapa`, `consultor` e
// `representante` — `vendor` NÃO está lá. Enquanto a RLS não apertar, o recorte
// é do cliente, e por isso ele falha FECHADO: em dúvida, não mostra nada.
//
// A regra é a MESMA do servidor, em `api/_lib/financeiro-core.ts`:
//   admin | financeiro           -> vê tudo (PAPEIS_GESTORES)
//   qualquer outro com vendedor  -> vê só o que é dele (como v1 ou v2)
//   sem nome de vendedor         -> não vê nada (lá é 403 `sem_escopo`)
// Não invente um mapeamento novo: o nome sai de `useVendedorNome()`
// (profile.vendor_id -> vendors.name, MAIÚSCULO), o mesmo caminho da Agenda.
// ============================================================================

/**
 * Texto único da recusa por escopo. Fica aqui pra que a tela de detalhe e o erro
 * devolvido pelo servidor digam a MESMA coisa — duas frases diferentes pro mesmo
 * bloqueio fazem o vendedor achar que são dois problemas.
 */
export const MSG_FORA_DO_ESCOPO =
  'Este pedido é de outro vendedor. Você vê apenas os pedidos em que é o vendedor responsável.'

/** Papéis que enxergam a operação inteira. Espelha financeiro-core.ts. */
export const PAPEIS_GESTORES: readonly string[] = ['admin', 'financeiro']

export type EscopoPedidos =
  /** Gestor: sem filtro. */
  | { tipo: 'tudo' }
  /** Vendedor: só os pedidos em que ele é vendedor ou vendedor_2. */
  | { tipo: 'vendedor'; nome: string }
  /** Ainda resolvendo o nome — NÃO consultar (consultar aqui é vazar). */
  | { tipo: 'carregando' }
  /** Não deu pra saber quem é: não mostra pedido nenhum. */
  | { tipo: 'sem-escopo' }

/**
 * ⚠️ PASSE O NOME POR AQUI ANTES DE CHAMAR `resolverEscopo`.
 *
 * `useVendedorNome()` foi feito pra Agenda: sem `vendor_id` ele CAI NO
 * `display_name` em maiúsculas. Pra agendar tarefa isso é inofensivo; pra
 * decidir ACESSO é fabricar um vendedor que não existe em `vendors`.
 *
 * Medido: um perfil sem `vendor_id` e com `display_name` "Daniel Peters" gerou
 * o filtro `or=(vendedor.ilike.DANIEL PETERS,...)`. Voltou 0 pedidos por SORTE —
 * ninguém em `vendors` se chama assim. Bastaria o display_name ser "Daniel" pra
 * casar com o vendedor DANIEL e entregar 10 pedidos que não são dele.
 *
 * O servidor não faz isso: `api/_lib/financeiro-core.ts` devolve 403
 * `sem_escopo` quando falta `vendor_id`. Isto alinha o front com ele.
 */
export function nomeParaEscopo(
  vendorId: string | null | undefined,
  nomeDoHook: string,
): string {
  return vendorId ? nomeDoHook : ''
}

export function resolverEscopo(args: {
  role: string | null | undefined
  nomeVendedor: string
  nomeCarregando: boolean
}): EscopoPedidos {
  const { role, nomeVendedor, nomeCarregando } = args

  // Sem papel = sessão não resolvida. Fecha.
  if (!role) return { tipo: 'sem-escopo' }

  if (PAPEIS_GESTORES.includes(role)) return { tipo: 'tudo' }

  // Enquanto o nome não chega, a consulta fica parada. Se ela rodasse "só até
  // o nome chegar", esse intervalo já mostraria a lista inteira na tela.
  if (nomeCarregando) return { tipo: 'carregando' }

  const nome = nomeVendedor.trim()
  if (!nome) return { tipo: 'sem-escopo' }

  return { tipo: 'vendedor', nome }
}

/** Só 'tudo' e 'vendedor' podem consultar. */
export function escopoPodeConsultar(e: EscopoPedidos): boolean {
  return e.tipo === 'tudo' || e.tipo === 'vendedor'
}

/**
 * Filtro `or=` do PostgREST para "sou eu na venda", cobrindo venda dividida
 * (vendedor_2).
 *
 * ⚠️ Vírgula e parêntese SEPARAM termos na sintaxe do `or=`. Um nome com esses
 * caracteres não daria erro — mudaria o significado do filtro e poderia alargar
 * o recorte. Por isso são trocados por espaço antes de entrar.
 */
export function filtroDoVendedor(nome: string): string {
  const seguro = nome.replace(/[,()]/g, ' ').trim()
  return `vendedor.ilike.${seguro},vendedor_2.ilike.${seguro}`
}

/**
 * O pedido JÁ CARREGADO está no escopo? É o par em memória do `filtroDoVendedor`,
 * pra tela de DETALHE — lá não dá pra filtrar na consulta, porque o acesso é por
 * id direto (`/controle/pedidos/<id>`): o pedido chega inteiro e só então dá pra
 * dizer se é dele.
 *
 * Espelha `pedidoNoEscopo()` de `api/_lib/financeiro-core.ts` — mesma comparação
 * (MAIÚSCULO, sem espaço nas pontas) e mesma inclusão de `vendedor_2`. Se as duas
 * divergirem, a tela e o servidor discordam sobre quem pode o quê.
 *
 * 'carregando' e 'sem-escopo' devolvem false: em dúvida, não mostra.
 */
export function pedidoNoEscopo(
  pedido: { vendedor?: string | null; vendedor_2?: string | null },
  e: EscopoPedidos,
): boolean {
  if (e.tipo === 'tudo') return true
  if (e.tipo !== 'vendedor') return false
  const meu = e.nome.trim().toUpperCase()
  const v1 = (pedido.vendedor || '').trim().toUpperCase()
  const v2 = (pedido.vendedor_2 || '').trim().toUpperCase()
  return v1 === meu || (!!v2 && v2 === meu)
}

/** Etiqueta curta pro cabeçalho da tela e do PDF. */
export function descreveEscopo(e: EscopoPedidos): string | null {
  if (e.tipo === 'vendedor') return `Somente os pedidos de ${e.nome}`
  return null
}
