/**
 * Revisão de pedido depois da venda (o cliente muda o pedido e o valor muda).
 *
 * Regra do Daniel (25/09/2026): a venda original fica no mês dela; a DIFERENÇA
 * conta no mês em que a mudança aconteceu. Ex.: vendido R$ 89.865 em 31/08,
 * cliente acrescenta R$ 7.135 em setembro → agosto segue 89.865, setembro ganha 7.135.
 *
 * O banco já tem onde guardar isso, e todo relatório já lê assim:
 *   valor do pedido = COALESCE(payment_plan_json.total, valor_total) + ajuste_valor
 *   a BASE conta no mês de `data_venda`; o `ajuste_valor` conta no mês de `ajuste_data`.
 * Por isso, numa revisão de pedido de mês passado, a BASE não pode mudar — só o ajuste.
 *
 * Limite do banco: cabe UM ajuste por pedido (um valor, uma data). Um segundo
 * acréscimo em outro mês leva o anterior junto — `ajusteAnteriorMovido` avisa.
 *
 * Tudo aqui é puro (sem Supabase) para ser testado.
 */

export type ValoresPedido = {
  data_venda?: string | null;
  valor_total?: number | string | null;
  payment_plan_json?: { total?: number | string | null } | null;
  ajuste_valor?: number | string | null;
  ajuste_data?: string | null;
  ajuste_motivo?: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

const centavos = (v: number): number => Math.round(v * 100) / 100;

/** Hoje no fuso de São Paulo, YYYY-MM-DD. `toISOString()` vira amanhã depois das 21h. */
export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export const mesDe = (iso?: string | null): string => (iso || "").slice(0, 7);

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-09" → "setembro/2026" */
export function nomeMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-");
  const nome = MESES[Number(mes) - 1];
  return nome ? `${nome}/${ano}` : anoMes;
}

export const brl = (v: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const dataBR = (iso: string): string => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** Valor da venda sem ajuste — a mesma precedência de todos os relatórios. */
export function valorBase(p: ValoresPedido): number {
  const plano = num(p.payment_plan_json?.total);
  return plano > 0 ? plano : num(p.valor_total);
}

/** Valor atual do contrato = venda + ajuste. */
export function valorContrato(p: ValoresPedido): number {
  return centavos(valorBase(p) + num(p.ajuste_valor));
}

export type DecisaoValor = {
  /** sem_mudanca: valor igual; mesmo_mes: venda do mês corrente, muda a própria venda;
   *  diferenca_no_mes_atual: venda de mês passado, a diferença vira ajuste datado hoje. */
  tipo: "sem_mudanca" | "mesmo_mes" | "diferenca_no_mes_atual";
  /** grava em valor_total e payment_plan_json.total */
  base: number;
  ajusteValor: number;
  ajusteData: string | null;
  ajusteMotivo: string | null;
  contratoAnterior: number;
  contratoNovo: number;
  /** contratoNovo − contratoAnterior */
  diferenca: number;
  mesVenda: string;
  mesAtual: string;
  /** Ajuste antigo de OUTRO mês que passa a contar no mês atual (só existe 1 ajuste por pedido). */
  ajusteAnteriorMovido: { valor: number; mes: string } | null;
};

/**
 * Decide onde a mudança de valor de uma EDIÇÃO vai morar.
 *
 * @param original   linha do pedido antes da edição
 * @param novoTotal  valor total do contrato digitado na edição (≤ 0 = não informado: mantém)
 * @param dataVenda  data da venda que vai ser gravada (YYYY-MM-DD)
 * @param hoje       YYYY-MM-DD (padrão: hoje em São Paulo)
 */
export function decidirValorEdicao(
  original: ValoresPedido,
  novoTotal: number,
  dataVenda: string,
  hoje: string = hojeSP(),
): DecisaoValor {
  const baseOrig = centavos(valorBase(original));
  const ajOrig = centavos(num(original.ajuste_valor));
  const ajDataOrig = original.ajuste_data ? original.ajuste_data.slice(0, 10) : null;
  const motivoOrig = original.ajuste_motivo?.trim() || null;
  const contratoAnterior = centavos(baseOrig + ajOrig);
  const mesVenda = mesDe(dataVenda);
  const mesAtual = mesDe(hoje);

  const manter: DecisaoValor = {
    tipo: "sem_mudanca",
    base: baseOrig,
    ajusteValor: ajOrig,
    ajusteData: ajOrig !== 0 ? ajDataOrig : null,
    ajusteMotivo: ajOrig !== 0 ? motivoOrig : null,
    contratoAnterior,
    contratoNovo: contratoAnterior,
    diferenca: 0,
    mesVenda,
    mesAtual,
    ajusteAnteriorMovido: null,
  };

  if (!(novoTotal > 0)) return manter;
  const contratoNovo = centavos(novoTotal);
  const diferenca = centavos(contratoNovo - contratoAnterior);
  if (Math.abs(diferenca) < 0.01) return manter;

  // Ajuste que já existe: sem data, ele conta junto com a venda.
  const mesAjOrig = ajOrig !== 0 ? (ajDataOrig ? mesDe(ajDataOrig) : mesVenda) : null;

  if (mesVenda >= mesAtual) {
    // Venda do mês corrente: a mudança é da própria venda. Ajuste de outro mês fica onde está.
    if (ajOrig !== 0 && mesAjOrig !== mesVenda) {
      return {
        ...manter,
        tipo: "mesmo_mes",
        base: centavos(contratoNovo - ajOrig),
        contratoNovo,
        diferenca,
      };
    }
    return {
      ...manter,
      tipo: "mesmo_mes",
      base: contratoNovo,
      ajusteValor: 0,
      ajusteData: null,
      ajusteMotivo: null,
      contratoNovo,
      diferenca,
    };
  }

  // Venda de mês passado: a base fica congelada e o ajuste inteiro passa a contar hoje.
  const ajusteValor = centavos(contratoNovo - baseOrig);
  const ajusteAnteriorMovido =
    ajOrig !== 0 && mesAjOrig !== mesAtual ? { valor: ajOrig, mes: mesAjOrig as string } : null;

  if (Math.abs(ajusteValor) < 0.01) {
    // Voltou ao valor da venda: não sobra ajuste.
    return {
      ...manter,
      tipo: "diferenca_no_mes_atual",
      ajusteValor: 0,
      ajusteData: null,
      ajusteMotivo: null,
      contratoNovo,
      diferenca,
      ajusteAnteriorMovido,
    };
  }

  const linha = `Revisão ${dataBR(hoje)}: ${brl(contratoAnterior)} → ${brl(contratoNovo)}`;
  const motivo = motivoOrig && mesAjOrig === mesAtual ? `${motivoOrig} · ${linha}` : linha;
  return {
    ...manter,
    tipo: "diferenca_no_mes_atual",
    ajusteValor,
    ajusteData: hoje,
    ajusteMotivo: motivo.slice(0, 500),
    contratoNovo,
    diferenca,
    ajusteAnteriorMovido,
  };
}

/** Frase que aparece embaixo do valor na edição (null = nada a avisar). */
export function avisoValorEdicao(d: DecisaoValor): string | null {
  if (d.tipo !== "diferenca_no_mes_atual") return null;
  const partes: string[] = [];
  partes.push(`A venda de ${nomeMes(d.mesVenda)} continua ${brl(d.base)}.`);
  if (d.ajusteValor > 0) {
    partes.push(`O acréscimo de ${brl(d.ajusteValor)} conta em ${nomeMes(d.mesAtual)}.`);
  } else if (d.ajusteValor < 0) {
    partes.push(`A redução de ${brl(-d.ajusteValor)} sai de ${nomeMes(d.mesAtual)}.`);
  } else {
    partes.push("Sem diferença a lançar.");
  }
  if (d.ajusteAnteriorMovido) {
    partes.push(
      `Atenção: o ajuste antigo de ${brl(d.ajusteAnteriorMovido.valor)} (${nomeMes(d.ajusteAnteriorMovido.mes)}) ` +
        `deixa de contar lá — o pedido só guarda um ajuste.`,
    );
  }
  return partes.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Parcelas do financeiro (order_installments)
//
// `gerar-parcelas` APAGA todas as parcelas e recria como PENDENTE — numa edição isso
// soltaria os recebimentos (`receipts.installment_id`) e zeraria o que já foi pago.
// Aqui o acerto é incremental: parcela paga ou com recebimento nunca é tocada, nada é
// apagado (sai = `canceled`), e o cálculo de vencimento é o MESMO do gerar-parcelas,
// pra parcela que não mudou não ser reescrita.
// ─────────────────────────────────────────────────────────────────────────────

export type ParcelaPlano = {
  n?: number;
  descricao?: string;
  data?: string;
  vencimento?: string;
  valor?: { tipo?: string; fixo?: number; percentual?: number };
};

export type ParcelaFinanceiro = {
  id: string;
  installment_no: number;
  amount: number | string | null;
  due_date: string | null;
  description: string | null;
  status: string | null;
  canceled: boolean | null;
  total_installments: number | null;
};

export type ContextoParcelas = {
  dataVenda: string;
  dataEntrega: string | null;
  /** created_at do pedido (usado por parcelas "na emissão") */
  criadoEm: string | null;
  /** valor atual do contrato (base + ajuste) — base das parcelas percentuais */
  contratoTotal: number;
};

export type ParcelaDesejada = {
  installment_no: number;
  total_installments: number;
  amount: number;
  due_date: string;
  description: string;
  reference_type: string;
  reference_date: string;
  boleto_enviado: boolean;
};

/** Mesmo cálculo do edge `gerar-parcelas` (em UTC, igual ao Deno). */
export function parcelaDoPlano(p: ParcelaPlano, i: number, total: number, ctx: ContextoParcelas): ParcelaDesejada {
  let amount = 0;
  if (p.valor?.tipo === "fixo") amount = num(p.valor.fixo);
  else if (p.valor?.tipo === "percentual") amount = (ctx.contratoTotal * num(p.valor.percentual)) / 100;
  else amount = ctx.contratoTotal / total;

  let dueDate: string;
  let referenceType: string;
  let referenceDate: string;
  const desc = (p.descricao || "").toLowerCase();
  if (p.vencimento === "custom" && p.data) {
    dueDate = p.data.slice(0, 10);
    referenceType = "custom";
    referenceDate = dueDate;
  } else {
    if (desc.includes("pedido")) {
      referenceType = "pedido";
      referenceDate = ctx.dataVenda;
    } else if (desc.includes("emissão")) {
      referenceType = "emissao";
      referenceDate = ctx.criadoEm?.split("T")[0] || ctx.dataVenda;
    } else if (desc.includes("entrega")) {
      referenceType = "entrega";
      referenceDate = ctx.dataEntrega || ctx.dataVenda;
    } else {
      referenceType = "pedido";
      referenceDate = ctx.dataVenda;
    }
    const base = new Date(`${referenceDate.slice(0, 10)}T00:00:00Z`);
    const dias = (p.descricao || "").match(/(\+)?(\d+)\s*(dias?)?/i);
    if (dias) base.setUTCDate(base.getUTCDate() + parseInt(dias[2], 10));
    dueDate = base.toISOString().split("T")[0];
  }

  const isApos = desc.includes("após") || desc.includes("apos");
  return {
    installment_no: p.n || i + 1,
    total_installments: total,
    amount: centavos(amount),
    due_date: dueDate,
    description: p.descricao || `Parcela ${i + 1}/${total}`,
    reference_type: referenceType,
    reference_date: referenceDate,
    boleto_enviado: isApos,
  };
}

export type PlanoParcelas = {
  inserir: ParcelaDesejada[];
  atualizar: { id: string; patch: Partial<ParcelaDesejada> }[];
  cancelar: string[];
  /** parcelas pagas / com recebimento que ficaram como estavam */
  preservadas: number;
};

/**
 * Compara o plano de pagamento com as parcelas do financeiro e diz o mínimo a mudar.
 * @param travadas ids de parcela com recebimento lançado
 */
export function planejarParcelas(
  parcelasPlano: ParcelaPlano[] | null | undefined,
  existentes: ParcelaFinanceiro[],
  travadas: Set<string>,
  ctx: ContextoParcelas,
): PlanoParcelas {
  const resultado: PlanoParcelas = { inserir: [], atualizar: [], cancelar: [], preservadas: 0 };
  // Sem plano não se mexe em nada — nunca "cancelar tudo" por falta de dado.
  if (!parcelasPlano || parcelasPlano.length === 0) return resultado;

  const desejadas = parcelasPlano.map((p, i) => parcelaDoPlano(p, i, parcelasPlano.length, ctx));
  const ativas = existentes.filter((e) => !e.canceled);
  const travada = (e: ParcelaFinanceiro) =>
    travadas.has(e.id) || (e.status || "PENDENTE").toUpperCase() !== "PENDENTE";

  const usadas = new Set<string>();
  for (const d of desejadas) {
    const atual = ativas.find((e) => e.installment_no === d.installment_no && !usadas.has(e.id));
    if (!atual) {
      resultado.inserir.push(d);
      continue;
    }
    usadas.add(atual.id);
    if (travada(atual)) {
      resultado.preservadas++;
      continue;
    }
    const patch: Partial<ParcelaDesejada> = {};
    if (Math.abs(num(atual.amount) - d.amount) >= 0.01) patch.amount = d.amount;
    if ((atual.due_date || "").slice(0, 10) !== d.due_date) {
      patch.due_date = d.due_date;
      patch.reference_type = d.reference_type;
      patch.reference_date = d.reference_date;
    }
    if ((atual.description || "") !== d.description) patch.description = d.description;
    if ((atual.total_installments || 0) !== d.total_installments) patch.total_installments = d.total_installments;
    if (Object.keys(patch).length > 0) resultado.atualizar.push({ id: atual.id, patch });
  }

  const numerosDesejados = new Set(desejadas.map((d) => d.installment_no));
  for (const e of ativas) {
    if (usadas.has(e.id)) continue;
    // Duplicata de um número que continua no plano: deixa como está (não adivinhar qual vale).
    if (numerosDesejados.has(e.installment_no)) continue;
    if (travada(e)) {
      resultado.preservadas++;
      continue;
    }
    resultado.cancelar.push(e.id);
  }
  return resultado;
}
