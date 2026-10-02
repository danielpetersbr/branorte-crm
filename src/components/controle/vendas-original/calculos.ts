export type PedidoStatus = "ABERTO" | "FECHADO" | "CANCELADO";

export interface Pedido {
  id: string;
  pedido_numero: string;
  numero_orcamento: string;
  cliente: string;
  vendedor: string;
  vendedor_2?: string | null;
  data_venda: string;
  valor_total: number;
  status: PedidoStatus;
  atencao_a: string;
  descricao_equipamento: string;
  data_primeiro_contato: string | null;
  fonte_origem: string | null;
  estado: string | null;
  equipamentos_json: any[];
  equipamentos_detalhados?: Array<{ descricao?: string; quantidade?: number; unidade?: string; valor?: number }>;
  ajuste_valor: number;
  ajuste_motivo: string | null;
  ajuste_data: string | null;
  payment_plan_json?: {
    total?: number;
    parcelas?: any[];
  };
}

export const getValorPedido = (pedido: Pedido): number => {
  // Se tem override (pedido dividido 50/50), usar direto
  if ((pedido as any)._valorOverride != null) {
    return (pedido as any)._valorOverride;
  }
  
  let valor = 0;
  
  // Forçar conversão para número (payment_plan_json.total vem como string do JSON)
  const paymentTotal = pedido.payment_plan_json?.total 
    ? Number(pedido.payment_plan_json.total) 
    : 0;
    
  if (paymentTotal > 0) {
    valor = paymentTotal;
  } else {
    valor = Number(pedido.valor_total) || 0;
  }
  
  // Garantir que ajuste também é número
  const ajuste = Number(pedido.ajuste_valor) || 0;
  
  return valor + ajuste;
};

// Expande pedidos com vendedor_2 (split V1/V2) e gera linhas de ajuste quando aplicável
export const expandirPedidos = (
  raw: Pedido[],
  periodoStart: string,
  periodoEnd: string,
  filtroVendedor: string
): Pedido[] => {
  const expanded: Pedido[] = [];
  const filtroAtivo = filtroVendedor?.toUpperCase();
  for (const p of raw) {
    const dataVendaStr = p.data_venda?.split('T')[0] || '';
    const dataVendaInPeriodo = periodoStart && periodoEnd
      ? (dataVendaStr >= periodoStart && dataVendaStr <= periodoEnd)
      : true;
    const ajusteDataStr = p.ajuste_data?.split('T')[0] || '';
    const ajusteInPeriodo = ajusteDataStr && periodoStart && periodoEnd
      ? (ajusteDataStr >= periodoStart && ajusteDataStr <= periodoEnd)
      : false;
    const temAjuste = p.ajuste_valor && Number(p.ajuste_valor) !== 0;

    if (p.vendedor_2 && p.vendedor_2.trim()) {
      const valorOriginal = getValorPedido(p);
      const splitV1 = (p as any).valor_split_v1;
      const splitV2 = (p as any).valor_split_v2;
      const valorV1 = splitV1 != null ? Number(splitV1) : valorOriginal / 2;
      const valorV2 = splitV2 != null ? Number(splitV2) : valorOriginal / 2;
      const v2Name = p.vendedor_2.trim().toUpperCase();
      const v1Name = p.vendedor.toUpperCase();
      if (filtroAtivo && filtroAtivo !== 'TODOS') {
        if (filtroAtivo === v1Name) {
          expanded.push({ ...p, _displayId: `${p.id}_v1`, _valorOverride: valorV1 } as any);
        } else if (filtroAtivo === v2Name) {
          expanded.push({ ...p, _displayId: `${p.id}_v2`, vendedor: v2Name, _valorOverride: valorV2 } as any);
        }
      } else {
        expanded.push({ ...p, _displayId: `${p.id}_v1`, _valorOverride: valorV1 } as any);
        expanded.push({ ...p, _displayId: `${p.id}_v2`, vendedor: v2Name, _valorOverride: valorV2 } as any);
      }
    } else if (temAjuste && ajusteInPeriodo && !dataVendaInPeriodo) {
      const ajusteVal = Number(p.ajuste_valor);
      expanded.push({
        ...p,
        _displayId: `${p.id}_ajuste`,
        _valorOverride: ajusteVal,
        _isAjuste: true,
        pedido_numero: `Acréscimo ${p.pedido_numero || p.numero_orcamento}`,
        data_venda: p.ajuste_data!,
      } as any);
    } else if (temAjuste && ajusteInPeriodo && dataVendaInPeriodo) {
      const ajusteVal = Number(p.ajuste_valor);
      const baseVal = getValorPedido({ ...p, ajuste_valor: 0 } as Pedido);
      expanded.push({ ...p, _displayId: `${p.id}_base`, _valorOverride: baseVal } as any);
      expanded.push({
        ...p,
        _displayId: `${p.id}_ajuste`,
        _valorOverride: ajusteVal,
        _isAjuste: true,
        pedido_numero: `Acréscimo ${p.pedido_numero || p.numero_orcamento}`,
        data_venda: p.ajuste_data!,
      } as any);
    } else {
      expanded.push(p);
    }
  }
  expanded.sort((a, b) => {
    const dateA = a.data_venda || '';
    const dateB = b.data_venda || '';
    return dateB.localeCompare(dateA);
  });
  return expanded;
};


export const consultaPertenceAoContexto = (capturado: string, atual: string, geracaoCapturada: number, geracaoAtual: number, abortado: boolean): boolean => !abortado && !!capturado && capturado === atual && geracaoCapturada === geracaoAtual

/** Padrão explícito da página original para cadastro ausente ou zero. */
export const percentualComissaoControle = (percentual: number | null | undefined): number => Number(percentual) || 1

type ContextoPDF = { dono: string; consulta: string; geracaoPedidos: number; geracaoAno: number }
export const exportacaoPertenceAoContexto = (captura: ContextoPDF, atual: ContextoPDF & { montado: boolean; acessoNegado: boolean }): boolean =>
  atual.montado && !!captura.dono && captura.dono === atual.dono && captura.consulta === atual.consulta &&
  captura.geracaoPedidos === atual.geracaoPedidos && captura.geracaoAno === atual.geracaoAno && !atual.acessoNegado
