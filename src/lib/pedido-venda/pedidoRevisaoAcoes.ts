/**
 * Ações de banco da revisão de pedido (a regra pura está em `revisaoPedido.ts`).
 */
import { supabase } from "@/lib/controle-supabase/client";
import {
  planejarParcelas,
  valorContrato,
  type ContextoParcelas,
  type ParcelaFinanceiro,
  type ParcelaPlano,
  type PlanoParcelas,
} from "./revisaoPedido";

export type ResultadoDocumento = { ok: boolean; arquivo_url?: string; error?: string };

/**
 * Regera o Word do pedido a partir da linha gravada.
 *
 * Sem ajuste, é o `gerar-pedido-retroativo` de sempre. Com ajuste, o retroativo
 * imprimiria o valor da VENDA (payment_plan_json.total fica congelado no mês da venda),
 * então chamamos o `gerar-pedido` em modo regeneração com o mesmo payload que o
 * retroativo monta, trocando só o total pelo valor ATUAL do contrato (venda + ajuste).
 * O modo regeneração só gera o arquivo — não grava nada no pedido.
 */
export async function regerarDocumentoPedido(orderId: string): Promise<ResultadoDocumento> {
  const { data: pedido, error } = await supabase.from("pedidos_venda").select("*").eq("id", orderId).single();
  if (error || !pedido) return { ok: false, error: "Pedido não encontrado" };

  const p = pedido as any;
  const ajuste = Number(p.ajuste_valor) || 0;

  if (Math.abs(ajuste) < 0.01) {
    const { data, error: retroError } = await supabase.functions.invoke("gerar-pedido-retroativo", {
      body: { order_id: orderId },
    });
    if (retroError || !data?.ok) {
      return { ok: false, error: retroError?.message || data?.error || "Erro ao regenerar arquivo" };
    }
    return { ok: true, arquivo_url: data.arquivo_url };
  }

  const contrato = valorContrato(p);

  // Mesma montagem do gerar-pedido-retroativo (supabase/functions/gerar-pedido-retroativo).
  let equipamentosDetalhados: any[] = [];
  const detalhados = Array.isArray(p.equipamentos_detalhados) ? p.equipamentos_detalhados : [];
  if (detalhados.length > 0 && detalhados.some((eq: any) => eq.valor > 0)) {
    equipamentosDetalhados = detalhados;
  } else if (p.descricao_equipamento && String(p.descricao_equipamento).trim()) {
    equipamentosDetalhados = [
      { descricao: String(p.descricao_equipamento).trim(), unidade: "UN", quantidade: 1, valor: contrato },
    ];
  }

  const body = {
    numero_orcamento: p.numero_orcamento,
    cliente: p.cliente || "",
    atencao_a: p.atencao_a || "",
    telefone: p.telefone || "",
    cidade: p.cidade || "",
    estado: p.estado || "",
    endereco: p.endereco || "",
    bairro: p.bairro || "",
    cpf_cnpj: p.cpf_cnpj || "",
    cep: p.cep || "",
    fantasia: p.fantasia || "",
    inscricao_estadual: p.inscricao_estadual || "",
    data_venda: p.data_venda,
    dias_uteis: p.dias_uteis,
    tipo_prazo: p.tipo_prazo || "uteis",
    data_entrega: p.data_entrega,
    vendedor: p.vendedor,
    equipamentos: p.equipamentos_json || [],
    equipamentos_detalhados: equipamentosDetalhados,
    motores: p.motores_json || [],
    observacoes: [],
    valor_total: contrato,
    tensao: p.tensao || "",
    voltagem: p.voltagem || "",
    forma_pagamento: p.forma_pagamento || "",
    descricao_equipamento: p.descricao_equipamento || "",
    payment_plan_json: p.payment_plan_json ? { ...p.payment_plan_json, total: contrato } : null,
    data_primeiro_contato: p.data_primeiro_contato || null,
    fonte_origem: p.fonte_origem || null,
    regenerate: true,
    existing_pedido_numero: p.pedido_numero,
  };

  const { data, error: gerarError } = await supabase.functions.invoke("gerar-pedido", { body });
  if (gerarError || !data?.ok || !data?.arquivo_url) {
    return { ok: false, error: gerarError?.message || data?.error || "Erro ao gerar documento" };
  }

  const { error: updError } = await supabase
    .from("pedidos_venda")
    .update({ arquivo_url: data.arquivo_url, updated_at: new Date().toISOString() } as any)
    .eq("id", orderId);
  if (updError) return { ok: false, error: updError.message };

  return { ok: true, arquivo_url: data.arquivo_url };
}

export type ResultadoParcelas = PlanoParcelas & { erro?: string };

/**
 * Leva o plano de pagamento editado para o financeiro (order_installments) sem apagar nada
 * e sem tocar em parcela paga ou com recebimento. Ver `planejarParcelas`.
 */
export async function sincronizarParcelasFinanceiro(
  orderId: string,
  parcelasPlano: ParcelaPlano[] | null | undefined,
  ctx: ContextoParcelas,
): Promise<ResultadoParcelas> {
  const vazio: ResultadoParcelas = { inserir: [], atualizar: [], cancelar: [], preservadas: 0 };
  if (!parcelasPlano || parcelasPlano.length === 0) return vazio;

  const [{ data: existentes, error: e1 }, { data: recebimentos, error: e2 }] = await Promise.all([
    supabase
      .from("order_installments")
      .select("id, installment_no, amount, due_date, description, status, canceled, total_installments")
      .eq("order_id", orderId),
    supabase.from("receipts").select("installment_id").eq("order_id", orderId),
  ]);
  if (e1 || e2) return { ...vazio, erro: (e1 || e2)?.message };

  const travadas = new Set<string>(
    ((recebimentos as any[]) || []).map((r) => r.installment_id).filter(Boolean),
  );
  const plano = planejarParcelas(parcelasPlano, (existentes as ParcelaFinanceiro[]) || [], travadas, ctx);

  try {
    if (plano.inserir.length > 0) {
      const { error } = await supabase.from("order_installments").insert(
        plano.inserir.map((d) => ({
          order_id: orderId,
          installment_no: d.installment_no,
          total_installments: d.total_installments,
          due_date: d.due_date,
          amount: d.amount,
          description: d.description,
          reference_type: d.reference_type,
          reference_date: d.reference_date,
          status: "PENDENTE",
          boleto_enviado: d.boleto_enviado,
          boleto_enviado_em: d.boleto_enviado ? new Date().toISOString() : null,
        })) as any,
      );
      if (error) throw error;
    }
    for (const { id, patch } of plano.atualizar) {
      const { error } = await supabase
        .from("order_installments")
        .update({ ...patch, updated_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    }
    for (const id of plano.cancelar) {
      const { error } = await supabase
        .from("order_installments")
        .update({
          canceled: true,
          canceled_at: new Date().toISOString(),
          cancellation_reason: "Saiu do plano na revisão do pedido",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", id);
      if (error) throw error;
    }
  } catch (err: any) {
    return { ...plano, erro: err?.message || String(err) };
  }
  return plano;
}
