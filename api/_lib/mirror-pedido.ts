// Forma da linha de `mirror_pedidos_venda` (espelho do controle dentro do CRM).
//
// Extraído de api/controle-criar-pedido.ts pra existir UMA definição só. Duas
// cópias divergiriam: a listagem /controle/pedidos lê exatamente estas colunas,
// então um campo que só um dos lados preenche vira coluna vazia na tela sem
// ninguém entender por quê.
//
// ⚠️ POR QUE ESCREVER O ESPELHO EXIGE SERVICE KEY:
// `mirror_pedidos_venda` está com RLS LIGADA e tem GRANT de INSERT/UPDATE pra
// `authenticated`, mas NENHUMA policy permissiva além de `mirror_pv_sel`
// (SELECT). Sem policy, RLS barra a escrita — o UPDATE do browser volta 0 linhas
// e NÃO dá erro. Por isso todo write do espelho passa por rota /api/ com a
// service key (que ignora RLS), nunca direto do front.

/** Linha viva de `pedidos_venda` (controle) reduzida ao que o espelho guarda. */
export function mirrorRow(p: Record<string, unknown>) {
  return {
    id: String(p.id),
    numero_orcamento: p.numero_orcamento ?? null,
    pedido_numero: p.pedido_numero ?? null,
    cliente: p.cliente ?? null,
    vendedor: p.vendedor ?? null,
    vendedor_2: p.vendedor_2 ?? null,
    valor_total: p.valor_total ?? null,
    valor_pago: p.valor_pago ?? null,
    ajuste_valor: p.ajuste_valor ?? null,
    ajuste_data: (p.ajuste_data as string | null)?.slice(0, 10) ?? null,
    status: p.status ?? null,
    status_pagamento: p.status_pagamento ?? null,
    forma_pagamento: p.forma_pagamento ?? null,
    data_venda: (p.data_venda as string | null)?.slice(0, 10) ?? null,
    data_entrega: (p.data_entrega as string | null)?.slice(0, 10) ?? null,
    data_pagamento: (p.data_pagamento as string | null)?.slice(0, 10) ?? null,
    cidade: p.cidade ?? null,
    estado: p.estado ?? null,
    payment_plan_json: p.payment_plan_json ?? null,
    raw: p,
    synced_at: new Date().toISOString(),
  }
}
